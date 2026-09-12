import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
    isOrderExpired,
    orderExpiryCutoff,
    orderCancelCutoff,
    VIETQR_MATCH_GRACE_MS,
} from "../src/payment/vietqr.js";
import {
    cryptoExpiresAt,
    cryptoFallbackExpiryCutoff,
    cryptoExpiryWindows,
    isCryptoOrderExpired,
    isCryptoOrderMatchable,
    CRYPTO_MATCH_GRACE_MS,
} from "../src/payment/crypto.js";

// Hai poller thanh toán (bank-poller, crypto-poller) và webhook IPN từng lọc "đơn còn
// hạn để khớp giao dịch" và "đơn quá hạn để huỷ" ra từ CÙNG một cửa sổ `take: 50/100`
// xếp MỚI NHẤT TRƯỚC. Khi tồn đọng vượt cửa sổ thì:
//   - tập quá hạn rỗng → không đơn nào bị huỷ nữa → tồn đọng chỉ tăng;
//   - tập còn hạn thiếu mọi đơn cũ hơn đơn thứ N → khách chuyển tiền cho đơn đó thì
//     tiền vào mà đơn không bao giờ được xác nhận, rồi bị huỷ vì hết hạn.
// Hai lỗi tự khuếch đại và không tự lành.
//
// Sửa lần 1: hai query rời nhau, chặn theo THỜI GIAN, tập quá hạn quét CŨ NHẤT TRƯỚC.
//
// Sửa lần 2 (vẫn chưa đủ): mốc chia hai tập là mốc HẾT HẠN, và vòng huỷ chạy TRƯỚC
// vòng khớp. Khách bấm chuyển tiền ở giây 590 của cửa sổ 600 giây là chuyện bình
// thường, và ngân hàng/chain ghi nhận sau đó 20 giây — tick kế tiếp thấy đơn ĐÃ quá
// hạn nhưng TIỀN ĐÃ VÀO. Huỷ trước là huỷ mất một đơn đã được trả.
//
// Luật hiện tại: **ba vùng**, và tiền thắng mốc hết hạn trong một dải hữu hạn.
//   A. còn hạn trả            → khớp được, KHÔNG huỷ
//   B. quá hạn nhưng trong ân hạn → khớp được, KHÔNG huỷ
//   C. quá hạn QUÁ ân hạn     → huỷ, không khớp
// A∪B = `matchable`, C = `expired`, và hai tập này bù nhau tuyệt đối.
//
// Test này khoá bốn bất biến:
//   1. mốc trong query và bộ lọc trong JS là MỘT luật, không lệch biên;
//   2. `matchable` và `expired` bù nhau tuyệt đối — không bản ghi nào lọt vào cả hai
//      hay ra ngoài cả hai;
//   3. KHỚP TRƯỚC, HUỶ SAU ở cả bốn đường — thứ tự đó là thứ khiến vùng B có nghĩa;
//   4. KHÔNG còn chỗ nào trong src/ tự tính mốc huỷ. Bốn đường là bank-poller tick,
//      crypto-poller tick, webhook IPN (batch + single) và **lưới huỷ 60 giây trong
//      server.js** — cái cuối cùng bị sót ở lần sửa trước và một mình nó đủ vô hiệu
//      hoá ân hạn của ba đường kia, vì nó chạy mỗi phút.
//
// Lưu ý khi đọc: `isOrderExpired` / `isCryptoOrderExpired` / `isCryptoOrderMatchable`
// tự gọi `Date.now()` bên trong, nên mọi mốc so với chúng đều chừa lề >= 1 giây. Chỉ
// các assertion trên `cryptoExpiryWindows(base, now)` là so biên sát nút được, vì `now`
// ở đó là tham số.

const MINUTE = 60_000;
const SAFE = 1_000; // lề an toàn cho đồng hồ trôi giữa hai lần đọc Date.now()
const NOW = Date.now();

function withCryptoExpireMinutes(minutes, fn) {
    const saved = process.env.CRYPTO_EXPIRE_MINUTES;
    process.env.CRYPTO_EXPIRE_MINUTES = String(minutes);
    try {
        return fn();
    } finally {
        if (saved === undefined) delete process.env.CRYPTO_EXPIRE_MINUTES;
        else process.env.CRYPTO_EXPIRE_MINUTES = saved;
    }
}

/**
 * Đánh giá điều kiện `where` theo đúng ngữ nghĩa Mongo mà adapter dịch ra:
 * - `OR` → `$or`
 * - `{ field: null }` khớp cả null LẪN thiếu field
 * - `{ field: { gte/lt: Date } }` KHÔNG khớp bản ghi thiếu field đó
 */
function matches(condition, record) {
    return Object.entries(condition).every(([key, value]) => {
        if (key === "OR") return value.some((clause) => matches(clause, record));
        if (value === null) return record[key] === null || record[key] === undefined;
        if (value instanceof Date) return +new Date(record[key]) === +value;
        if (value && typeof value === "object") {
            const raw = record[key];
            if (raw === null || raw === undefined) return false;
            const actual = new Date(raw).getTime();
            if (Number.isNaN(actual)) return false;
            if ("gte" in value && !(actual >= new Date(value.gte).getTime())) return false;
            if ("lt" in value && !(actual < new Date(value.lt).getTime())) return false;
            return true;
        }
        return record[key] === value;
    });
}

// ─── 1. Dải ân hạn là một luật duy nhất, không phải ba bản sao ──────────────────────

test("orderCancelCutoff = orderExpiryCutoff lùi đúng một dải ân hạn", () => {
    assert.equal(
        orderExpiryCutoff(NOW).getTime() - orderCancelCutoff(NOW).getTime(),
        VIETQR_MATCH_GRACE_MS,
        "khoảng cách hai mốc phải đúng bằng dải ân hạn",
    );
    assert.ok(VIETQR_MATCH_GRACE_MS >= 5 * MINUTE, "ân hạn phải phủ được độ trễ ghi nhận của ngân hàng");
    assert.ok(VIETQR_MATCH_GRACE_MS <= 60 * MINUTE, "ân hạn quá dài là giữ đơn PENDING và coupon/tồn kho lâu vô ích");
});

test("đơn quá hạn nhưng TRONG ân hạn thì chưa đáng huỷ", () => {
    // Đúng ca của bug: khách trả ở giây 590, ngân hàng ghi nhận ở giây 610.
    const paidLate = new Date(orderCancelCutoff(NOW).getTime() + SAFE);
    assert.equal(isOrderExpired(paidLate), true, "đã quá hạn trả — khách thấy đơn 'hết hạn'");
    assert.ok(paidLate >= orderCancelCutoff(NOW), "nhưng CHƯA đáng huỷ: vẫn trong dải ân hạn");

    const longGone = new Date(orderCancelCutoff(NOW).getTime() - SAFE);
    assert.equal(isOrderExpired(longGone), true);
    assert.ok(longGone < orderCancelCutoff(NOW), "quá ân hạn rồi thì huỷ");
});

test("CRYPTO_MATCH_GRACE_MS dương và isCryptoOrderMatchable rộng hơn !isCryptoOrderExpired đúng bằng ân hạn", () => {
    withCryptoExpireMinutes(10, () => {
        assert.ok(CRYPTO_MATCH_GRACE_MS > 0);
        // Vừa mới quá hạn: expired = true nhưng vẫn matchable. Đó chính là vùng B.
        const justExpired = { expiresAt: new Date(Date.now() - SAFE) };
        assert.equal(isCryptoOrderExpired(justExpired), true);
        assert.equal(isCryptoOrderMatchable(justExpired), true, "trong ân hạn thì vẫn phải khớp được");

        // Quá hạn lâu hơn ân hạn: hết matchable.
        const longExpired = { expiresAt: new Date(Date.now() - CRYPTO_MATCH_GRACE_MS - SAFE) };
        assert.equal(isCryptoOrderMatchable(longExpired), false);

        // Còn hạn: cả hai đều đúng như cũ.
        const fresh = { expiresAt: new Date(Date.now() + 5 * MINUTE) };
        assert.equal(isCryptoOrderExpired(fresh), false);
        assert.equal(isCryptoOrderMatchable(fresh), true);
    });
});

test("ân hạn crypto ngắn hơn ngân hàng — vì nó quyết định độ sâu đọc chain mỗi tick", () => {
    // getTakenCryptoAmounts / fetchCryptoTransfers nhìn ngược về createdAt của bản ghi
    // CŨ NHẤT còn khớp được. Ân hạn càng dài thì mỗi tick càng phải kéo nhiều transfer.
    // Ngân hàng không bị ràng buộc đó (lịch sử giao dịch có cửa sổ riêng) nên ân hạn
    // bên đó rộng hơn.
    assert.ok(CRYPTO_MATCH_GRACE_MS < VIETQR_MATCH_GRACE_MS);
});

// ─── 2. Mốc query và bộ lọc JS là MỘT luật ────────────────────────────────────────

test("orderExpiryCutoff suy ra đúng luật của isOrderExpired, không lệch biên", () => {
    const cutoff = orderExpiryCutoff().getTime();
    for (const delta of [-2 * MINUTE, -SAFE, SAFE, 2 * MINUTE]) {
        assert.equal(
            isOrderExpired(new Date(cutoff + delta)),
            delta < 0,
            `createdAt = cutoff ${delta > 0 ? "+" : ""}${delta}ms: quá hạn phải là ${delta < 0}`,
        );
    }
});

test("cutoff nhận `now` tuỳ ý — nhiều query trong một tick phải dùng chung mốc", () => {
    const a = orderExpiryCutoff(NOW).getTime();
    const b = orderExpiryCutoff(NOW + 5_000).getTime();
    assert.equal(b - a, 5_000, "cutoff phải dịch đúng theo now truyền vào, không tự đọc đồng hồ");

    const ca = orderCancelCutoff(NOW).getTime();
    const cb = orderCancelCutoff(NOW + 5_000).getTime();
    assert.equal(cb - ca, 5_000, "mốc huỷ cũng vậy");
});

test("cryptoFallbackExpiryCutoff khớp isCryptoOrderExpired cho bản ghi KHÔNG có expiresAt", () => {
    withCryptoExpireMinutes(10, () => {
        const cutoff = cryptoFallbackExpiryCutoff().getTime();
        for (const delta of [-2 * MINUTE, -SAFE, SAFE, 2 * MINUTE]) {
            const record = { createdAt: new Date(cutoff + delta) };
            assert.equal(
                isCryptoOrderExpired(record),
                delta < 0,
                `createdAt lệch ${delta}ms so với cutoff fallback: quá hạn phải là ${delta < 0}`,
            );
        }
    });
});

test("bản ghi CÓ expiresAt thì field đó thắng — M1, đổi config không hồi sinh đơn cũ", () => {
    const record = { createdAt: new Date(NOW - 20 * MINUTE), expiresAt: new Date(NOW + 5 * MINUTE) };
    withCryptoExpireMinutes(60, () => {
        assert.equal(+cryptoExpiresAt(record), +record.expiresAt, "expiresAt đã ghi phải thắng config hiện tại");
        assert.equal(isCryptoOrderExpired(record), false);

        const past = { createdAt: new Date(NOW - 20 * MINUTE), expiresAt: new Date(NOW - SAFE) };
        assert.equal(isCryptoOrderExpired(past), true, "đã qua expiresAt thì quá hạn kể cả config vừa được nới");
    });
});

// ─── 3. Ba cửa sổ: payable ⊆ matchable, matchable bù expired ────────────────────────

test("ba cửa sổ trả về đủ và matchable rộng hơn payable đúng bằng ân hạn", () => {
    withCryptoExpireMinutes(10, () => {
        const now = new Date(NOW);
        const w = cryptoExpiryWindows({ status: "PENDING" }, now);
        assert.deepEqual(Object.keys(w).sort(), ["expired", "matchable", "payable"]);

        // payable chặn ở `now`, matchable chặn ở `now - grace` — cùng một field.
        assert.equal(+w.payable.OR[0].expiresAt.gte, NOW);
        assert.equal(+w.matchable.OR[0].expiresAt.gte, NOW - CRYPTO_MATCH_GRACE_MS);
        // expired dùng ĐÚNG mốc của matchable nên hai tập bù nhau.
        assert.equal(+w.expired.OR[0].expiresAt.lt, +w.matchable.OR[0].expiresAt.gte);

        // Nhánh fallback (không có expiresAt) cũng vậy.
        const cutoff = cryptoFallbackExpiryCutoff(NOW).getTime();
        assert.equal(+w.payable.OR[1].createdAt.gte, cutoff);
        assert.equal(+w.matchable.OR[1].createdAt.gte, cutoff - CRYPTO_MATCH_GRACE_MS);
        assert.equal(+w.expired.OR[1].createdAt.lt, cutoff - CRYPTO_MATCH_GRACE_MS);
    });
});

test("cửa sổ giữ nguyên điều kiện nền và mỗi cửa sổ có đúng hai nhánh", () => {
    const base = { status: "PENDING", paymentMethod: { in: ["crypto_trc20"] } };
    const w = cryptoExpiryWindows(base, new Date(NOW));

    for (const key of ["payable", "matchable", "expired"]) {
        assert.equal(w[key].status, "PENDING", `${key}: điều kiện nền phải được giữ nguyên`);
        assert.deepEqual(w[key].paymentMethod, { in: ["crypto_trc20"] });
        assert.ok(Array.isArray(w[key].OR) && w[key].OR.length === 2, `${key}: đúng hai nhánh`);
    }
});

test("graceMs = 0 thì matchable suy về payable — không đổi hành vi cũ khi tắt ân hạn", () => {
    withCryptoExpireMinutes(10, () => {
        const w = cryptoExpiryWindows({}, new Date(NOW), 0);
        assert.equal(+w.matchable.OR[0].expiresAt.gte, +w.payable.OR[0].expiresAt.gte);
        assert.equal(+w.matchable.OR[1].createdAt.gte, +w.payable.OR[1].createdAt.gte);
        assert.equal(+w.expired.OR[0].expiresAt.lt, +w.payable.OR[0].expiresAt.gte);
    });
});

test("mọi bản ghi rơi vào ĐÚNG MỘT trong hai cửa sổ matchable / expired", () => {
    withCryptoExpireMinutes(10, () => {
        const now = new Date(NOW);
        const w = cryptoExpiryWindows({ status: "PENDING" }, now);
        const graceBound = NOW - CRYPTO_MATCH_GRACE_MS;
        const cutoff = cryptoFallbackExpiryCutoff(NOW).getTime();
        const fallbackBound = cutoff - CRYPTO_MATCH_GRACE_MS;

        const cases = [];
        // Quanh biên expiresAt: còn hạn / trong ân hạn / quá ân hạn.
        for (const delta of [-CRYPTO_MATCH_GRACE_MS - MINUTE, -MINUTE, -1, 0, 1, MINUTE]) {
            cases.push({
                label: `expiresAt ${delta >= 0 ? "+" : ""}${delta}ms so với now`,
                status: "PENDING",
                expiresAt: new Date(NOW + delta),
                createdAt: new Date(NOW - 60 * MINUTE),
            });
        }
        // Quanh biên ân hạn của expiresAt.
        for (const delta of [-MINUTE, -1, 0, 1, MINUTE]) {
            cases.push({
                label: `expiresAt ${delta >= 0 ? "+" : ""}${delta}ms so với mốc ân hạn`,
                status: "PENDING",
                expiresAt: new Date(graceBound + delta),
                createdAt: new Date(NOW - 60 * MINUTE),
            });
        }
        // Nhánh fallback: quanh biên ân hạn của createdAt.
        for (const delta of [-MINUTE, -1, 0, 1, MINUTE]) {
            cases.push({
                label: `không expiresAt, createdAt ${delta >= 0 ? "+" : ""}${delta}ms so với mốc ân hạn`,
                status: "PENDING",
                createdAt: new Date(fallbackBound + delta),
            });
        }
        // `expiresAt: null` tường minh phải đi nhánh fallback y như thiếu field.
        cases.push({ label: "expiresAt null, createdAt mới", status: "PENDING", expiresAt: null, createdAt: new Date(fallbackBound + MINUTE) });
        cases.push({ label: "expiresAt null, createdAt cũ", status: "PENDING", expiresAt: null, createdAt: new Date(fallbackBound - MINUTE) });

        for (const record of cases) {
            const inMatchable = matches(w.matchable, record);
            const inExpired = matches(w.expired, record);
            const inPayable = matches(w.payable, record);
            // notEqual trên hai boolean = đúng một cái true. Cả hai false nghĩa là bản
            // ghi VÔ HÌNH với cả hai query: không bao giờ được khớp và không bao giờ
            // bị huỷ — đơn treo vĩnh viễn.
            assert.notEqual(inMatchable, inExpired, `${record.label}: phải nằm ở ĐÚNG MỘT cửa sổ (matchable=${inMatchable}, expired=${inExpired})`);
            // payable là tập con của matchable — một đơn còn hạn trả mà không khớp
            // được là vô nghĩa.
            assert.ok(!inPayable || inMatchable, `${record.label}: payable phải là tập con của matchable`);
        }
    });
});

test("cửa sổ matchable đồng ý với isCryptoOrderMatchable mà getTakenCryptoAmounts dùng", () => {
    withCryptoExpireMinutes(10, () => {
        const now = new Date();
        const w = cryptoExpiryWindows({ status: "PENDING" }, now);
        const cutoff = cryptoFallbackExpiryCutoff(now.getTime()).getTime();

        // Chỉ kiểm những mốc cách biên >= 1s: các hàm JS tự đọc Date.now().
        const records = [
            { status: "PENDING", expiresAt: new Date(now.getTime() + 2 * MINUTE), createdAt: new Date(now.getTime() - 60 * MINUTE) },
            { status: "PENDING", expiresAt: new Date(now.getTime() - SAFE), createdAt: new Date(now.getTime() - 60 * MINUTE) },
            { status: "PENDING", expiresAt: new Date(now.getTime() - CRYPTO_MATCH_GRACE_MS - 2 * MINUTE) },
            { status: "PENDING", createdAt: new Date(cutoff + 2 * MINUTE) },
            { status: "PENDING", createdAt: new Date(cutoff - CRYPTO_MATCH_GRACE_MS - 2 * MINUTE) },
        ];
        for (const record of records) {
            assert.equal(
                matches(w.matchable, record),
                isCryptoOrderMatchable(record),
                `query và isCryptoOrderMatchable phải cùng kết luận cho ${JSON.stringify(record)}`,
            );
            assert.equal(
                matches(w.expired, record),
                !isCryptoOrderMatchable(record),
                `expired phải là phủ định của matchable cho ${JSON.stringify(record)}`,
            );
        }
    });
});

test("gọi hai lần với now khác nhau cho hai mốc khác nhau — nên tick phải truyền chung một now", () => {
    const a = cryptoExpiryWindows({}, new Date(NOW));
    const b = cryptoExpiryWindows({}, new Date(NOW + 1_000));
    assert.notEqual(+a.matchable.OR[0].expiresAt.gte, +b.matchable.OR[0].expiresAt.gte);
});

// ─── 4. Chốt cấu trúc: khớp trước, huỷ sau, ở CẢ BA nơi ────────────────────────────

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

/**
 * Bỏ các dòng là COMMENT NGUYÊN DÒNG trước khi chạy assertion "không được có X".
 *
 * Bắt buộc: chính mấy file này chứa comment trích nguyên cú pháp cũ (`take: 50`,
 * `allPending.filter`) để giải thích bug đã sửa. Không lọc comment thì assertion cấm
 * cú pháp cũ khớp trúng phần văn bản giải thích — test đỏ mà code đúng, tệ hơn là
 * ai đó sẽ "sửa" bằng cách xoá comment.
 *
 * Chỉ lọc theo đầu dòng nên không đụng chuỗi nào và không đụng code có comment ở
 * cuối dòng — một dòng vừa có code vừa có comment thì vẫn được giữ nguyên.
 */
const codeOf = (src) => src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

test("bank-poller chia hai tập theo MỐC HUỶ và quét đơn quá hạn CŨ NHẤT TRƯỚC", () => {
    const src = read("../src/bank-poller.js");
    const code = codeOf(src);

    assert.ok(src.includes("orderCancelCutoff"), "phải dùng mốc huỷ từ payment/vietqr.js, không tự tính ân hạn");
    assert.ok(
        src.includes("createdAt: { gte: cancelCutoff }") && src.includes("createdAt: { lt: cancelCutoff }"),
        "hai query phải chặn theo thời gian bằng hai toán tử bù nhau",
    );
    assert.ok(
        src.includes('orderBy: { createdAt: "asc" }'),
        "tập quá hạn phải quét CŨ NHẤT TRƯỚC để tồn đọng rút dần, không khựng",
    );
    assert.ok(!/allPending\s*\.filter/.test(code), "không được partition một cửa sổ take:N ra hai tập nữa");
    assert.ok(!/take:\s*\d+/.test(code), "không được quay lại cửa sổ đếm-số-dòng — phải có trần đặt tên riêng");
    assert.ok(src.includes("warnIfScanTruncated"), "chạm trần quét thì phải kêu, không được im lặng");
});

/**
 * Mỗi đường thanh toán một cặp mốc. Dùng TÊN vòng huỷ chứ không phải chuỗi
 * `status: "CANCELED"`: server.js có tới hai đường IPN và nhiều chỗ huỷ đơn khác
 * (nút huỷ của khách, admin), nên một mốc chung sẽ so chéo hai đường với nhau và
 * cho kết quả vô nghĩa.
 *
 * `sliceFrom`: server.js đặt CẢ HAI đường IPN trong một file và chúng dùng trùng tên
 * biến (`matchableOrders` / `expiredOrders`), nên mốc "duy nhất trong file" không giữ
 * được. Cắt file tại mốc mở đầu đường single rồi xét từng nửa — trong mỗi nửa, cặp
 * mốc vẫn là duy nhất.
 */
const IPN_SINGLE_AT = "const singleCancelCutoff = orderCancelCutoff();";

const ORDER_CASES = [
    {
        label: "bank-poller tick",
        file: "../src/bank-poller.js",
        match: "processOrder({ amount, upperContent, eventKey",
        cancel: "if (expiredOrders.length) {",
    },
    {
        label: "crypto-poller tick",
        file: "../src/crypto-poller.js",
        match: "processTransfer({ transfer, orders:",
        cancel: "await cancelExpiredOrders(expiredOrders);",
        // crypto-poller có HAI chỗ sweep: một trong nhánh "không còn gì để khớp" (return
        // sớm) và một sau vòng khớp. Chỗ cần so thứ tự là chỗ CUỐI; chỗ đầu được một
        // test riêng bên dưới xác nhận là có cổng chắn.
        cancelAt: "last",
        guard: "if (!activeOrders.length && !activeDeposits.length) {",
    },
    {
        label: "IPN batch",
        file: "../src/server.js",
        sliceTo: IPN_SINGLE_AT,
        match: "batchResults.push({ success: true, orderId: order.id })",
        cancel: "for (const order of expiredOrders) {",
    },
    {
        label: "IPN single",
        file: "../src/server.js",
        sliceFrom: IPN_SINGLE_AT,
        match: "matchedOrder = order;",
        cancel: "for (const order of expiredOrders) {",
    },
];

for (const c of ORDER_CASES) {
    test(`KHỚP TRƯỚC HUỶ SAU — ${c.label}`, () => {
        // Đây là toàn bộ ý nghĩa của dải ân hạn. Huỷ trước thì một giao dịch tới trễ
        // vài chục giây không bao giờ khớp được — tiền đã vào tài khoản shop mà đơn đã
        // CANCELED, và chuyển khoản ngân hàng thì không đảo ngược được.
        const full = read(c.file);
        const from = c.sliceFrom ? full.indexOf(c.sliceFrom) : 0;
        assert.ok(
            !c.sliceFrom || from > 0,
            `${c.label}: không tìm thấy mốc cắt ${JSON.stringify(c.sliceFrom)}`,
        );
        const to = c.sliceTo ? full.indexOf(c.sliceTo, from) : full.length;
        assert.ok(
            !c.sliceTo || to > from,
            `${c.label}: mốc cắt ${JSON.stringify(c.sliceTo)} phải nằm SAU mốc mở đầu`,
        );
        const src = full.slice(from, to);

        const m = src.indexOf(c.match);
        assert.ok(m > 0, `${c.label}: không thấy chỗ khớp giao dịch (${JSON.stringify(c.match)})`);

        const hits = src.split(c.cancel).length - 1;
        assert.ok(hits >= 1, `${c.label}: không thấy vòng huỷ (${JSON.stringify(c.cancel)})`);
        if (c.cancelAt === "last") {
            // Nhiều chỗ sweep: cái cần so thứ tự là chỗ cuối, sau vòng khớp.
            const cancel = src.lastIndexOf(c.cancel);
            assert.ok(cancel > m, `${c.label}: vòng huỷ cuối phải nằm SAU chỗ khớp`);
            // Mọi chỗ sweep TRƯỚC vòng khớp phải nằm trong nhánh "không còn gì để
            // khớp" — nhánh đó return ngay nên không bao giờ huỷ một đơn còn cứu được.
            const guard = src.indexOf(c.guard);
            assert.ok(guard > 0, `${c.label}: thiếu cổng chắn ${JSON.stringify(c.guard)}`);
            const first = src.indexOf(c.cancel);
            assert.ok(
                first > guard && first < m,
                `${c.label}: chỗ sweep sớm phải nằm giữa cổng chắn và vòng khớp`,
            );
        } else {
            // Mốc huỷ phải là DUY NHẤT trong phạm vi xét, nếu không assertion trên có
            // thể đang so với một vòng huỷ của đường khác.
            assert.equal(hits, 1, `${c.label}: mốc huỷ phải xuất hiện đúng một lần để phép so thứ tự có nghĩa`);
            assert.ok(src.indexOf(c.cancel, m) > m, `${c.label}: vòng huỷ phải nằm SAU chỗ khớp`);
        }
    });
}

test("crypto-poller chia hai tập theo thời gian, cho CẢ đơn hàng lẫn nạp ví", () => {
    const src = read("../src/crypto-poller.js");

    assert.ok(src.includes("cryptoExpiryWindows"), "phải dùng cửa sổ hết hạn từ payment/crypto.js");
    assert.ok(src.includes("getMatchableCryptoOrders") && src.includes("getExpiredCryptoOrders"));
    assert.ok(
        src.includes("getMatchableCryptoDeposits") && src.includes("getExpiredCryptoDeposits"),
        "đường NẠP VÍ USDT cũng phải được sửa — cùng một lỗi, cùng là tiền của khách",
    );
    assert.equal(
        (src.match(/orderBy: \{ createdAt: "asc" \}/g) || []).length,
        2,
        "cả tập đơn quá hạn và tập nạp quá hạn đều phải quét cũ nhất trước",
    );
    assert.ok(
        !/getPendingCryptoOrders|getPendingCryptoDeposits/.test(src),
        "hai hàm cũ gộp cả hai tập vào một cửa sổ phải biến mất, không ai gọi sót",
    );
    assert.ok(
        !/getPayableCrypto(Orders|Deposits)/.test(src),
        "tên cũ `payable` phải biến hết — còn một chỗ gọi là còn một chỗ khớp bằng cửa sổ hẹp",
    );
    assert.ok(src.includes("warnIfScanTruncated"));
});

test("tick crypto dùng MỘT mốc now cho cả bốn query", () => {
    const src = read("../src/crypto-poller.js");
    assert.ok(
        /const now = new Date\(\);[\s\S]{0,400}getMatchableCryptoOrders\(now\)[\s\S]{0,200}getExpiredCryptoOrders\(now\)/.test(src),
        "tick phải tính now một lần rồi truyền xuống các query",
    );
    assert.ok(
        /getMatchableCryptoDeposits\(now\)[\s\S]{0,200}getExpiredCryptoDeposits\(now\)/.test(src),
        "cả bốn query của tick phải dùng chung now",
    );
});

test("tick crypto vẫn chạy khi KHÔNG còn bản ghi nào còn khớp được", () => {
    // Nếu return sớm chỉ dựa trên tập còn khớp thì khi mọi đơn đều đã quá ân hạn,
    // không lượt nào huỷ chúng — tồn đọng nằm lại vĩnh viễn và tiếp tục chiếm chỗ.
    const src = read("../src/crypto-poller.js");

    // Bóc NGUYÊN VĂN điều kiện return sớm thay vì ghép một regex cố định: điều kiện
    // này viết trải qua hai dòng và thứ tự bốn vế không phải là thứ cần chốt — cái
    // cần chốt là BỐN vế đều có mặt trong cùng một điều kiện.
    const guard = src.match(/if \(([^)]*!matchableOrders\.length[^)]*)\)\s*return;/);
    assert.ok(guard, "không tìm thấy điều kiện return sớm của tick");
    for (const set of ["matchableOrders", "expiredOrders", "matchableDeposits", "expiredDeposits"]) {
        assert.ok(
            new RegExp(`!${set}\\.length`).test(guard[1]),
            `điều kiện return sớm phải xét cả ${set} — thiếu nó là bỏ rơi tập quá hạn`,
        );
    }
    // Vế nào cũng phải là "rỗng thì thôi": một vế viết thành `||` là đảo nghĩa và
    // tick sẽ không bao giờ chạy tiếp.
    assert.ok(!guard[1].includes("||"), "bốn vế phải nối bằng &&, không phải ||");
});

test("vòng khớp KHÔNG lọc lại bằng isCryptoOrderExpired", () => {
    // Bộ lọc đó chính là thứ biến dải ân hạn thành vô nghĩa: mọi bản ghi trong vùng B
    // đều "đã quá hạn" theo JS, nên lọc lại là vứt đúng những đơn cần cứu.
    const src = read("../src/crypto-poller.js");
    assert.ok(
        !/matchableOrders\.filter\(.*isCryptoOrderExpired/.test(src),
        "không được lọc matchableOrders bằng isCryptoOrderExpired",
    );
    assert.ok(
        !/matchableDeposits\.filter\(.*isCryptoOrderExpired/.test(src),
        "không được lọc matchableDeposits bằng isCryptoOrderExpired",
    );
});

test("getTakenCryptoAmounts giữ chỗ số tiền cho CẢ đơn trong dải ân hạn", () => {
    // Đơn trong vùng B vẫn khớp được nên cryptoAmount của nó VẪN phải được giữ chỗ.
    // Lấy isCryptoOrderExpired làm chuẩn ở đây là nhả số tiền của một đơn còn sống ra
    // cho đơn mới — hai đơn chờ cùng một số USDT thì poller không dám credit đơn nào
    // (matches.length > 1), và cả hai khách đều đã chuyển tiền thật.
    const src = read("../src/crypto-poller.js");
    assert.ok(
        src.includes("isCryptoOrderMatchable(row)"),
        "phải dùng isCryptoOrderMatchable, không phải !isCryptoOrderExpired",
    );
    assert.ok(
        !/!isCryptoOrderExpired\(row\)/.test(src),
        "không được giữ chỗ theo !isCryptoOrderExpired nữa",
    );
});

// ─── 5. Webhook IPN không được quay lại cửa sổ đếm-số-dòng ─────────────────────────

test("cả HAI đường IPN đều dùng cửa sổ thời gian, không còn take:50", () => {
    const full = read("../src/server.js");
    // server.js còn nhiều route/hàm khác dùng `take:` hợp lệ (danh sách user,
    // referral, broadcast mỗi phút 5 dòng…). Chỉ xét ĐÚNG vùng webhook IPN — từ khai
    // báo route tới hàm kế tiếp sau nó. Mốc kết thúc phải là CODE chứ không phải
    // comment: comment đổi wording là test mất vùng xét mà không ai hay.
    const start = full.indexOf('app.post("/webhook/ipn"');
    const end = full.indexOf("async function cancelExpiredOrders()", start);
    assert.ok(start > 0 && end > start, "không khoanh được vùng webhook IPN trong server.js");
    const code = codeOf(full.slice(start, end));

    assert.ok(
        !/take:\s*\d+/.test(code),
        "webhook IPN không được dùng cửa sổ đếm-số-dòng — cùng lỗi đã sửa ở poller",
    );
    assert.ok(code.includes("orderCancelCutoff"), "phải dùng chung mốc huỷ với bank-poller");
    // Hai đường (batch + single) đều phải chia hai tập.
    assert.equal(
        (code.match(/createdAt: \{ lt: (?:cancelCutoff|singleCancelCutoff) \}/g) || []).length,
        2,
        "cả đường batch và đường single đều phải quét tập quá hạn riêng",
    );
    assert.equal(
        (code.match(/createdAt: \{ gte: (?:cancelCutoff|singleCancelCutoff) \}/g) || []).length,
        2,
        "cả hai đường đều phải chặn tập khớp theo thời gian",
    );
    assert.equal(
        (code.match(/warnIfScanTruncated\(/g) || []).length, 4,
        "bốn query (2 đường × {khớp, huỷ}) thì phải có bốn chốt kêu khi chạm trần",
    );
});

test("lưới huỷ 60 giây của server.js dùng ĐÚNG mốc 'đáng huỷ', không phải mốc 'quá hạn trả'", () => {
    // Đây là lưới CUỐI và là chỗ nguy hiểm nhất: nó chạy mỗi 60 giây, độc lập với cả
    // ba đường kia. Nếu nó huỷ theo mốc quá hạn trả (10 phút) thì ba đường kia có ân
    // hạn 15 phút cũng vô nghĩa — đơn chết ở phút 11, trước khi giao dịch tới trễ kịp
    // khớp. Ân hạn chỉ tồn tại khi MỌI chỗ huỷ đơn đều dùng cùng một mốc.
    const src = read("../src/server.js");
    const start = src.indexOf("async function cancelExpiredOrders()");
    const end = src.indexOf("\n}", start);
    assert.ok(start > 0 && end > start, "không tìm thấy cancelExpiredOrders trong server.js");
    const body = codeOf(src.slice(start, end));

    assert.ok(body.includes("orderCancelCutoff"), "đơn ngân hàng/ví phải huỷ theo orderCancelCutoff");
    assert.ok(
        body.includes("!isCryptoOrderMatchable(order, now)"),
        "đơn crypto phải huỷ theo phủ định của isCryptoOrderMatchable",
    );
    assert.ok(
        !/isCryptoOrderExpired/.test(body),
        "không được lọc bằng isCryptoOrderExpired — mốc đó chưa tính dải ân hạn",
    );
    assert.ok(
        !/Date\.now\(\)\s*-\s*\d+\s*\*\s*60\s*\*\s*1000/.test(body),
        "không được tự tính mốc hết hạn bằng tay trong hàm này",
    );
    // Vẫn phải giữ cổng atomic: đơn vừa được poller/IPN claim sang PAID không được huỷ.
    assert.ok(
        /where:\s*\{\s*id:\s*o\.id,\s*status:\s*"PENDING"\s*\}/.test(body),
        "huỷ phải là updateMany có điều kiện status PENDING, không phải update trần",
    );
});

test("không còn mốc huỷ đơn TỰ TÍNH ở bất kỳ đâu trong src/", () => {
    // Một mốc tự tính (`Date.now() - 10 * 60 * 1000`) nằm lẫn trong repo là một chỗ
    // dải ân hạn bị bỏ qua mà không test nào ở trên với tới — đúng cái lỗi của lưới huỷ
    // 60 giây. Quét toàn bộ src để chốt, thay vì kê thêm một test cho từng hàm mới.
    const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
    const files = [];
    const walk = (dir) => {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) walk(p);
            else if (e.name.endsWith(".js")) files.push(p);
        }
    };
    walk(SRC);
    assert.ok(files.length > 20, `quét src/ phải ra danh sách file, thực tế ${files.length}`);

    // `orderExpiryCutoff`/`cryptoFallbackExpiryCutoff` được phép tính tay — chúng CHÍNH
    // là nơi định nghĩa mốc. Mọi chỗ khác phải hỏi hai hàm đó.
    const ALLOWED = /[\\/]payment[\\/](vietqr|crypto)\.js$/;
    // Hai dạng mốc tự viết hay gặp: `now - 10 * 60 * 1000` và `now - ORDER_EXPIRE_MINUTES * …`.
    const HARD_TEN_MIN = /Date\.now\(\)\s*-\s*10\s*\*\s*60\s*\*\s*1000/;
    const FROM_CONST = /Date\.now\(\)\s*-\s*ORDER_EXPIRE_MINUTES\s*\*\s*60\s*\*\s*1000/;

    const offenders = [];
    for (const f of files) {
        if (ALLOWED.test(f)) continue;
        const code = codeOf(readFileSync(f, "utf8"));
        if (HARD_TEN_MIN.test(code) || FROM_CONST.test(code)) {
            offenders.push(path.relative(SRC, f).split(path.sep).join("/"));
        }
    }
    assert.deepEqual(
        offenders, [],
        `các file này tự tính mốc huỷ đơn thay vì hỏi orderCancelCutoff: ${offenders.join(", ")}`,
    );
});

test("mọi TRẦN QUÉT đặt tên đều thực sự được khai báo trong file dùng nó", () => {
    // Lỗi thật đã xảy ra: `IPN_MATCH_SCAN_MAX` / `IPN_EXPIRE_SWEEP_MAX` được DÙNG ở tám
    // chỗ trong server.js mà không hề được khai báo. `node --check` không bắt được (nó
    // chỉ kiểm cú pháp), `npm test` cũng không (không test nào gọi webhook), nên nó chỉ
    // nổ khi ngân hàng bắn IPN thật — tiền đã vào tài khoản shop mà không đơn nào được
    // xác nhận, và Casso/SePay không bắn lại webhook cho một cú 500.
    //
    // Quét hai vị trí hay đặt trần nhất: `take: IDENT` và tham số trần của
    // `warnIfScanTruncated`.
    const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
    const files = [];
    const walk = (dir) => {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) walk(p);
            else if (e.name.endsWith(".js")) files.push(p);
        }
    };
    walk(SRC);

    const problems = [];
    for (const f of files) {
        const src = codeOf(readFileSync(f, "utf8"));
        const names = new Set();
        // Nhóm 2 bắt dấu `.`/`(` ngay sau tên để LOẠI `take: Math.min(...)` và
        // `take: Number(limit)` — đó là biểu thức gọi hàm, không phải hằng đặt tên, và
        // `Math`/`Number` là global. Không dùng lookahead: `[\w$]*` sẽ backtrack bớt một
        // ký tự để thoả lookahead và báo "Numbe" thay vì bỏ qua cả cụm.
        for (const m of src.matchAll(/\btake:\s*([A-Za-z_$][\w$]*)(\s*[.(])?/g)) {
            if (!m[2]) names.add(m[1]);
        }
        for (const m of src.matchAll(/warnIfScanTruncated\([^;]*?,\s*([A-Za-z_$][\w$]*)(\s*[.(])?\s*,/g)) {
            if (!m[2]) names.add(m[1]);
        }

        const declared = new Set();
        for (const m of src.matchAll(/\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) declared.add(m[1]);
        for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from/g)) {
            for (const part of m[1].split(",")) {
                const name = part.trim().split(/\s+as\s+/).pop().trim();
                if (name) declared.add(name);
            }
        }
        for (const m of src.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from/g)) declared.add(m[1]);
        // Biến cục bộ kiểu `const { limit } = ...` hay tham số hàm cũng hợp lệ.
        for (const m of src.matchAll(/\(\s*([^)]*)\)\s*(?:=>|\{)/g)) {
            for (const part of m[1].split(",")) {
                const name = part.replace(/=.*$/, "").trim();
                if (/^[A-Za-z_$][\w$]*$/.test(name)) declared.add(name);
            }
        }

        for (const n of names) {
            if (!declared.has(n)) problems.push(`${path.relative(SRC, f).split(path.sep).join("/")}: ${n}`);
        }
    }
    assert.deepEqual(problems, [], `trần quét dùng mà không khai báo → ReferenceError lúc chạy: ${problems.join(", ")}`);
});

test("trần quét IPN PHẢI bằng đúng trần của bank-poller", () => {
    // Hai đường khớp và huỷ CÙNG một tập đơn. Nhìn thấy hai tập khác nhau là một đơn
    // được webhook xác nhận rồi bị poller huỷ ở tick kế tiếp (hoặc ngược lại).
    const src = read("../src/server.js");
    const bank = read("../src/bank-poller.js");

    const grab = (text, name) => {
        const m = text.match(new RegExp(`const ${name} = (\\d+);`));
        assert.ok(m, `${name} phải được khai báo — dùng mà không khai báo là ReferenceError lúc chạy`);
        return Number(m[1]);
    };

    assert.equal(
        grab(src, "IPN_MATCH_SCAN_MAX"), grab(bank, "ACTIVE_ORDER_SCAN_MAX"),
        "trần tập KHỚP của IPN phải bằng của bank-poller",
    );
    assert.equal(
        grab(src, "EXPIRE_SWEEP_MAX"), grab(bank, "EXPIRE_SWEEP_MAX"),
        "trần tập HUỶ của server.js phải bằng của bank-poller",
    );
});

test("IPN dùng chung một hàm phát hiện 'đã xử lý' với poller", () => {
    // Danh sách trạng thái ["PAID","DELIVERING","DELIVERED"] từng bị chép ra 5 nơi và
    // một chỗ đã lệch (thiếu DELIVERING): đơn đang giao bị báo lỗi cho khách và event
    // ledger bị XOÁ. Một hàm dùng chung thì không lệch lại được.
    const src = read("../src/server.js");
    assert.ok(src.includes("isOrderSettledBy"), "phải dùng isOrderSettledBy");
    assert.ok(
        !/"PAID",\s*"DELIVERING",\s*"DELIVERED"/.test(src),
        "không được chép lại danh sách trạng thái đã thanh toán",
    );
});

// ─── 6. Tiền không khớp được thì phải kêu ──────────────────────────────────────────

test("giao dịch CÓ mã đơn mà không khớp được thì báo admin, không im lặng", () => {
    for (const file of ["../src/bank-poller.js", "../src/server.js"]) {
        const src = read(file);
        assert.ok(
            src.includes("alertUnmatchedBankTransfer"),
            `${file}: phải có lưới an toàn cho tiền vào mà không khớp đơn nào`,
        );
    }
    const poller = read("../src/bank-poller.js");
    assert.ok(
        poller.includes('outcome === "nomatch"'),
        "chỉ báo khi thật sự không khớp — 'raced' nghĩa là có đường khác xử lý rồi, không phải tiền treo",
    );
    assert.ok(
        poller.includes("warnOnce"),
        "phải dedupe: giao dịch nằm lại trong lịch sử ngân hàng nhiều ngày, không spam mỗi 15s",
    );
});
