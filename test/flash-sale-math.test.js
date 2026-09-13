import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
    FLASH_STATUS, FLASH_RESPONSE, LIVE_STATUSES,
    DEFAULT_SECS_PER_USER, MEASURE_BUFFER, OPEN_SAFETY_MS,
    normalizeDiscountPct, discountedUnitPrice, ceilCents, discountedUsdTotal,
    discountedUsdPerM, isTotalDiscountProduct, flashPriceFor,
    roundUpToMinute, estimateOpensAt, sendProgressView, progressBar,
    evaluateClaim, evaluateSkip, pickBestOffer, offerMinutesLeft,
} from "../src/flash-sale-math.js";
// `trimUsd` nằm ở tầng chữ chứ không ở tầng toán, nhưng nó là thứ biến một con số
// float thành thứ khách THẬT SỰ đọc — nên assertion về hiển thị phải đi qua nó.
import { trimUsd } from "../src/flash-sale-text.js";

/**
 * Test PHẦN TOÁN THUẦN của flash sale — không mock gì cả, vì đây là chỗ quyết định
 * TIỀN. Mock prisma ở tầng này chỉ làm test xanh trong khi production sai.
 *
 * `NOW` đóng băng: mọi hàm nhận `now` như tham số nên không có đồng hồ ẩn nào để
 * test phải đuổi theo.
 */
const NOW = Date.UTC(2026, 8, 13, 12, 0, 0); // 12:00:00Z = 19:00 giờ VN

// ─── % giảm (§1: 1–90) ──────────────────────────────────────────────────────────────

test("% giảm hợp lệ là số nguyên 1–90", () => {
    assert.equal(normalizeDiscountPct(1), 1);
    assert.equal(normalizeDiscountPct(30), 30);
    assert.equal(normalizeDiscountPct(90), 90);
});

test("% giảm rác trả 0 chứ không ném — đường tiền không được crash", () => {
    // Trả 0 nghĩa là "không giảm", tức hướng AN TOÀN: thà khách trả giá gốc còn hơn
    // bot giảm sai rồi mất tiền. Ném lỗi giữa lúc khách bấm mua thì mất cả đơn.
    for (const junk of [0, -5, 91, 100, 1000, null, undefined, NaN, Infinity, "", "abc", {}]) {
        assert.equal(normalizeDiscountPct(junk), 0, `${JSON.stringify(junk)} phải về 0`);
    }
});

test("% giảm là chuỗi số hoặc số lẻ vẫn đọc được, phần lẻ bị cắt", () => {
    assert.equal(normalizeDiscountPct("30"), 30);
    assert.equal(normalizeDiscountPct(1.9), 1);
    assert.equal(normalizeDiscountPct(89.99), 89);
});

// ─── §4: hàng STOCK giảm trên GIÁ ĐƠN VỊ, floor ────────────────────────────────────

test("hàng stock: 10.00 −30% → 7.00 (đúng ví dụ §4)", () => {
    assert.equal(discountedUnitPrice(10, 30), 7);
});

test("hàng stock floor phần giảm, tức làm tròn về phía có lợi cho shop", () => {
    // 99 × 30% = 29.7 → floor 29 → còn 70. Khách thấy 70, không phải 69.3.
    assert.equal(discountedUnitPrice(99, 30), 70);
    assert.equal(discountedUnitPrice(250000, 30), 175000);
    assert.equal(discountedUnitPrice(100000, 15), 85000);
});

test("giá đơn vị sau giảm không bao giờ âm và không bao giờ cao hơn giá gốc", () => {
    for (const price of [0, 1, 3, 999, 100000]) {
        for (const pct of [1, 30, 90]) {
            const out = discountedUnitPrice(price, pct);
            assert.ok(out >= 0, `${price} −${pct}% ra ${out} < 0`);
            assert.ok(out <= price, `${price} −${pct}% ra ${out} > giá gốc`);
        }
    }
});

test("giá đơn vị: % không hợp lệ thì giữ nguyên giá, và không mutate giá trị lạ", () => {
    assert.equal(discountedUnitPrice(100000, 0), 100000);
    assert.equal(discountedUnitPrice(100000, 91), 100000);
    assert.equal(discountedUnitPrice(0, 30), 0);
    assert.equal(discountedUnitPrice(-5, 30), -5);
    assert.equal(discountedUnitPrice(NaN, 30), 0);
});

test("giá quá nhỏ để giảm thì giữ nguyên — không âm thầm về 0đ", () => {
    // floor(1 × 30/100) = 0 → còn 1. Giảm về 0 là tặng hàng miễn phí.
    assert.equal(discountedUnitPrice(1, 30), 1);
    assert.equal(discountedUnitPrice(1, 90), 1);
    assert.equal(discountedUnitPrice(2, 30), 2);   // floor(0.6) = 0
    assert.equal(discountedUnitPrice(3, 30), 3);   // floor(0.9) = 0
    // Nhưng 3đ giảm 90% thì floor(2.7) = 2, còn 1đ — vẫn là giảm thật, không phải
    // "quá nhỏ". Đừng nhầm hai ca: ca này KHÔNG được về 0.
    assert.equal(discountedUnitPrice(3, 90), 1);
    // Chốt tổng quát: không tổ hợp nào ra 0đ từ một giá gốc dương.
    for (const price of [1, 2, 3, 5, 7, 99]) {
        for (const pct of [1, 30, 50, 90]) {
            assert.ok(discountedUnitPrice(price, pct) >= 1, `${price}đ −${pct}% về 0đ`);
        }
    }
});

// ─── §4: hàng API KEY giảm trên TỔNG ĐƠN ───────────────────────────────────────────

test("API key: 100M token × 1 cent −30% = 70 cent (đúng ví dụ §4)", () => {
    // 100M token × $0.01/1M = $1.00 = 100 cent. Spec đòi đúng 70 cent.
    assert.equal(discountedUsdTotal(1.0, 30), 0.7);
});

test("ĐÂY LÀ CÁI BẪY §4: giảm vào giá mỗi 1M rồi làm tròn lên cent thì ưu đãi biến mất", () => {
    // Giá mỗi 1M là 1 cent. Giảm 30% ra 0.7 cent, ceilCents đẩy ngược về 1 cent.
    const perMAfter = ceilCents(discountedUsdPerM(0.01, 30));
    assert.equal(perMAfter, 0.01, "0.7 cent phải tròn ngược về 1 cent");
    // Hệ quả: khách mua 100M token vẫn trả ĐỦ 100 cent — ưu đãi tồn tại trên giấy.
    assert.equal(perMAfter * 100, 1.0);
    // Còn giảm vào TỔNG thì khách trả đúng 70 cent.
    assert.equal(discountedUsdTotal(0.01 * 100, 30), 0.7);
});

test("discountedUsdPerM KHÔNG làm tròn — nó chỉ để hiển thị", () => {
    // Spec in ra "0.007 USDT / 1M token". Làm tròn ở đây là mất con số giải thích
    // cho khách hiểu vì sao tổng đơn của họ rẻ hơn.
    //
    // So qua `trimUsd` chứ không so float thô: 0.01 × 70/100 ra
    // 0.007000000000000001, và con số KHÁCH THẤY là kết quả của trimUsd, không phải
    // bit pattern. Assert exact-equal ở đây là assert một thứ không ai nhìn thấy.
    assert.equal(trimUsd(discountedUsdPerM(0.01, 30)), "0.007");
    assert.ok(Math.abs(discountedUsdPerM(0.01, 30) - 0.007) < 1e-9);
    // Hiển thị phải giữ đủ ba chữ số lẻ, không bị ceil về 0.01 như tiền thật.
    assert.equal(trimUsd(discountedUsdPerM(0.01, 30)), "0.007");
    assert.notEqual(ceilCents(discountedUsdPerM(0.01, 30)), 0.007);
});

test("tổng đơn sau giảm vẫn ceil theo cent, khớp toàn bộ đường giá của apikey-pricing", () => {
    // Đổi luật làm tròn ở riêng nhánh flash sale là hai đơn cùng cấu hình ra hai số.
    assert.equal(discountedUsdTotal(0.001, 30), 0.01);
    assert.equal(discountedUsdTotal(1.05, 30), 0.74); // 0.735 → ceil 0.74
});

test("tổng đơn: % không hợp lệ thì chỉ ceil, không giảm", () => {
    assert.equal(discountedUsdTotal(1.0, 0), 1.0);
    assert.equal(discountedUsdTotal(1.0, 91), 1.0);
    assert.equal(discountedUsdTotal(0, 30), 0);
    assert.equal(discountedUsdTotal(NaN, 30), 0);
});

test("tổng đơn sau giảm không bao giờ âm, không bao giờ vượt giá gốc", () => {
    for (const usd of [0.01, 0.07, 1, 12.34, 999]) {
        for (const pct of [1, 30, 90]) {
            const out = discountedUsdTotal(usd, pct);
            assert.ok(out >= 0, `${usd} −${pct}% ra ${out} < 0`);
            assert.ok(out <= ceilCents(usd), `${usd} −${pct}% ra ${out} > giá gốc`);
        }
    }
});

test("ceilCents khử được sai số dấu phẩy động", () => {
    // 1 + 30/30 × 5/100 − 1 = 0.050000000000000044 — không cắt nhiễu thì Math.ceil
    // đẩy lên 6 cent. Đây chính là bug mà apikey-renew đã gặp.
    assert.equal(ceilCents(1 + (30 / 30) * (5 / 100) - 1), 0.05);
    assert.equal(ceilCents(NaN), 0);
});

test("REGRESSION: ceilCents phải nhân 100 TRƯỚC rồi mới cắt nhiễu", () => {
    // Bản flash sale đầu tiên viết ngược — `Math.ceil(Number(n.toFixed(6)) * 100)` —
    // tức khử nhiễu xong rồi nhân 100, đưa nhiễu TRỞ LẠI:
    //   Number((0.07).toFixed(6)) * 100 = 7.000000000000001 → ceil → 8 cent.
    // Khách bị thu oan 1 cent. Test này quét mọi giá trị mà ×100 rơi ngay trên một
    // số nguyên để bug thứ tự đó không quay lại được.
    // Chỉ những giá trị mà ×100 rơi NGAY TRÊN một số nguyên (nhiễu hướng lên).
    // 0.0029 cố tình KHÔNG có ở đây: nó nhỏ hơn 1 cent nên ceil đúng là 0.01,
    // không phải một ca nhiễu.
    const trap = [0.07, 0.29, 0.57, 0.58, 1.07, 2.07, 8.03, 4.35, 1.15];
    for (const usd of trap) {
        const cents = ceilCents(usd);
        const exact = Math.round(usd * 100) / 100;
        assert.equal(cents, exact, `ceilCents(${usd}) = ${cents}, mong ${exact}`);
    }
    // Và nó vẫn phải làm tròn LÊN khi thật sự có phần lẻ.
    assert.equal(ceilCents(0.071), 0.08);
    assert.equal(ceilCents(0.001), 0.01);
    assert.equal(ceilCents(0.0001), 0.01);
});

test("ceilCents dùng CHUNG một định nghĩa với gia hạn API key, không phải bản copy", () => {
    // Hai bản copy của một hàm quyết định tiền tệ sẽ trôi nhau — đã trôi một lần rồi.
    const src = readFileSync(new URL("../src/flash-sale-math.js", import.meta.url), "utf8");
    assert.match(src, /import\s*\{\s*ceilCents\s*\}\s*from\s*"\.\/apikey-renew\.js"/,
        "flash-sale-math.js phải import ceilCents từ apikey-renew.js");
    assert.doesNotMatch(codeOf(src), /function\s+ceilCents\s*\(/,
        "không được định nghĩa lại ceilCents ở flash-sale-math.js");
});

/**
 * Bỏ comment trước khi assert "không có chuỗi X trong source": một câu cảnh báo
 * NHẮC TỚI tên hàm sẽ làm assertion fail oan, và ngược lại cho phép ai đó viết lại
 * hàm miễn là không nhắc tới nó trong comment.
 */
function codeOf(src) {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n")
        .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
        .join("\n");
}

// ─── Phân loại sản phẩm ────────────────────────────────────────────────────────────

test("hàng API key nhận ra bằng deliveryMode HOẶC bằng code ẩn", () => {
    assert.equal(isTotalDiscountProduct({ deliveryMode: "API_KEY" }), true);
    assert.equal(isTotalDiscountProduct({ deliveryMode: "api_key" }), true);
    assert.equal(isTotalDiscountProduct({ code: "__API_KEY__" }), true);
    assert.equal(isTotalDiscountProduct(null), false);
    assert.equal(isTotalDiscountProduct({}), false);
});

test("hàng thường không bị xếp vào nhóm giảm-trên-tổng-đơn", () => {
    for (const mode of ["STOCK_LINES", "TEXT", "FILE", "CONTACT"]) {
        assert.equal(isTotalDiscountProduct({ deliveryMode: mode, code: "X" }), false, mode);
    }
});

test("flashPriceFor: hàng total GIỮ NGUYÊN giá đơn vị để không giảm hai lần", () => {
    // Nếu nhánh total cũng trả giá đã giảm thì caller vừa giảm đơn vị vừa giảm tổng.
    const p = { price: 0, deliveryMode: "API_KEY" };
    const out = flashPriceFor(p, { discountPct: 30 });
    assert.equal(out.mode, "total");
    assert.equal(out.price, 0);
    assert.equal(out.pct, 30);
});

test("flashPriceFor: hàng thường trả giá đơn vị đã giảm, mode 'unit'", () => {
    const out = flashPriceFor({ price: 250000 }, { discountPct: 30 });
    assert.equal(out.mode, "unit");
    assert.equal(out.price, 175000);
});

test("flashPriceFor: không offer / % rác thì mode 'none' và giá nguyên vẹn", () => {
    assert.equal(flashPriceFor({ price: 100 }, null).mode, "none");
    assert.equal(flashPriceFor({ price: 100 }, {}).mode, "none");
    assert.equal(flashPriceFor({ price: 100 }, { discountPct: 0 }).mode, "none");
    assert.equal(flashPriceFor({ price: 100 }, { discountPct: 91 }).price, 100);
    assert.equal(flashPriceFor(null, { discountPct: 30 }).mode, "none");
});

// ─── §3: giờ mở ────────────────────────────────────────────────────────────────────

test("roundUpToMinute luôn làm tròn LÊN phút nguyên", () => {
    const base = Date.UTC(2026, 8, 13, 11, 5, 0);
    assert.equal(roundUpToMinute(base), base);                  // đúng phút → giữ
    assert.equal(roundUpToMinute(base + 1), base + 60000);      // lệch 1ms → phút sau
    assert.equal(roundUpToMinute(base + 30000), base + 60000);
    assert.equal(roundUpToMinute(base + 59999), base + 60000);
    assert.equal(roundUpToMinute(NaN), 0);
});

test("giờ mở = số khách × secs/người + 20s an toàn, làm tròn lên phút", () => {
    const startedAt = Date.UTC(2026, 8, 13, 11, 0, 0);
    // 1000 khách × 0.05s = 50s, +20s = 70s → 11:01:10 → tròn lên 11:02
    const opens = estimateOpensAt({ startedAt, customerCount: 1000, secsPerUser: 0.05 });
    assert.equal(opens, Date.UTC(2026, 8, 13, 11, 2, 0));
});

test("lần gửi ĐẦU TIÊN chưa có gì để đo nên dùng hằng mặc định (§8)", () => {
    const startedAt = Date.UTC(2026, 8, 13, 11, 0, 0);
    const fallback = estimateOpensAt({ startedAt, customerCount: 1000 });
    const explicit = estimateOpensAt({ startedAt, customerCount: 1000, secsPerUser: DEFAULT_SECS_PER_USER });
    assert.equal(fallback, explicit);
    // secsPerUser rác cũng phải rơi về hằng, không được ra NaN rồi in "--:--" cho khách.
    for (const junk of [0, -1, NaN, null, undefined, "abc"]) {
        assert.equal(estimateOpensAt({ startedAt, customerCount: 1000, secsPerUser: junk }), explicit, String(junk));
    }
});

test("0 khách vẫn mở ở phút kế tiếp, không mở ngay lập tức", () => {
    const startedAt = Date.UTC(2026, 8, 13, 11, 0, 0);
    // 0 × s + 20s = 11:00:20 → tròn lên 11:01. Mở "ngay" là khách chưa kịp đọc tin.
    assert.equal(estimateOpensAt({ startedAt, customerCount: 0 }), startedAt + 60000);
});

test("hằng số của §3 không trôi: buffer 15%, an toàn 20s, mặc định 0.05s", () => {
    assert.equal(DEFAULT_SECS_PER_USER, 0.05);
    assert.equal(MEASURE_BUFFER, 1.15);
    assert.equal(OPEN_SAFETY_MS, 20000);
});

// ─── §3 / §8: tiến độ cho khách bấm sớm ────────────────────────────────────────────

test("tiến độ KHÔNG rò số khách — §2 cấm tuyệt đối", () => {
    const view = sendProgressView({ processed: 500, total: 2500, startedAt: NOW - 25000, opensAt: NOW + 60000, now: NOW });
    // Tin này đi tới khách. Nếu nó mang `total` thì chỉ cần một handler bất cẩn
    // in cả object ra là lộ quy mô danh sách khách hàng của shop.
    assert.ok(!("total" in view), `view không được chứa total, đang có: ${Object.keys(view)}`);
    assert.ok(!("recipientTotal" in view));
    assert.ok(!JSON.stringify(view).includes("2500"), "chuỗi 2500 không được xuất hiện trong view");
});

test("ETA không bao giờ sớm hơn giờ đã in trên tin", () => {
    // Tốc độ đo được nói "còn 5s nữa xong", nhưng tin đã hứa mở lúc NOW+120s.
    // Hứa một đằng báo một nẻo là cách nhanh nhất để khách nghĩ bot bị treo.
    const view = sendProgressView({
        processed: 2495, total: 2500, startedAt: NOW - 125000, opensAt: NOW + 120000, now: NOW,
    });
    assert.equal(view.etaMs, 120000);
    assert.equal(view.etaSeconds, 120);
});

test("khi tốc độ thật CHẬM hơn giờ đã in thì ETA theo tốc độ thật", () => {
    // Bot gửi chậm hơn dự đoán: giờ in đã qua mà mới gửi được nửa. Khách phải thấy
    // con số thật, không phải "0 giây" trong khi bot còn cả nghìn tin chưa gửi.
    const view = sendProgressView({
        processed: 100, total: 2500, startedAt: NOW - 100000, opensAt: NOW - 60000, now: NOW,
    });
    // 1s/người × 2400 người còn lại = 2400s
    assert.equal(view.etaSeconds, 2400);
    assert.equal(view.pct, 4);
});

test("phần trăm tiến độ sàn xuống và kẹp trong 0–100", () => {
    assert.equal(sendProgressView({ processed: 0, total: 3, now: NOW, startedAt: NOW }).pct, 0);
    assert.equal(sendProgressView({ processed: 1, total: 3, now: NOW, startedAt: NOW }).pct, 33);
    assert.equal(sendProgressView({ processed: 3, total: 3, now: NOW, startedAt: NOW }).pct, 100);
    // processed > total (đếm cả blocked/error) không được ra 133%
    assert.equal(sendProgressView({ processed: 4, total: 3, now: NOW, startedAt: NOW }).pct, 100);
    // total = 0 → không chia cho 0
    assert.equal(sendProgressView({ processed: 0, total: 0, now: NOW, startedAt: NOW }).pct, 100);
});

test("thanh tiến độ rộng 12, đúng dạng ▓/░ của §2", () => {
    assert.equal(progressBar(0), "░░░░░░░░░░░░");
    assert.equal(progressBar(50), "▓▓▓▓▓▓░░░░░░");
    assert.equal(progressBar(100), "▓▓▓▓▓▓▓▓▓▓▓▓");
    assert.equal(progressBar(50).length, 12);
    // Kẹp giá trị rác thay vì ném: thanh này render thẳng vào popup của khách.
    assert.equal(progressBar(-20), "░░░░░░░░░░░░");
    assert.equal(progressBar(999), "▓▓▓▓▓▓▓▓▓▓▓▓");
    assert.equal(progressBar(NaN).length, 12);
});

// ─── §2 / §5: máy trạng thái claim ─────────────────────────────────────────────────

const sale = (over = {}) => ({
    id: "sale-1", status: FLASH_STATUS.OPEN, validityMinutes: 60, maxSlots: 10, ...over,
});

test("đợt đang mở, khách chưa nhận → ok và ĂN một suất", () => {
    const out = evaluateClaim({ sale: sale(), existing: null, now: NOW });
    assert.equal(out.ok, true);
    assert.equal(out.reason, "accepted");
    assert.equal(out.consumedSlot, true);
    assert.equal(out.expiresAt, new Date(NOW + 60 * 60000).toISOString());
});

test("hạn tính từ LÚC KHÁCH NHẬN, không từ lúc tạo đợt (§1)", () => {
    const t = NOW + 15 * 60000;
    const out = evaluateClaim({ sale: sale({ validityMinutes: 30 }), now: t });
    assert.equal(out.expiresAt, new Date(t + 30 * 60000).toISOString());
});

test("validityMinutes rác thì rơi về 60 mặc định", () => {
    for (const junk of [0, -5, NaN, null, undefined]) {
        const out = evaluateClaim({ sale: sale({ validityMinutes: junk }), now: NOW });
        assert.equal(out.validityMinutes, 60, String(junk));
        assert.equal(out.expiresAt, new Date(NOW + 3600000).toISOString());
    }
});

test("bấm Nhận lần hai → nhắc lại hạn và KHÔNG ăn thêm suất (§2)", () => {
    const existing = { kind: FLASH_RESPONSE.ACCEPT, expiresAt: new Date(NOW + 20 * 60000).toISOString() };
    const out = evaluateClaim({ sale: sale(), existing, now: NOW });
    assert.equal(out.ok, true);
    assert.equal(out.reason, "already");
    assert.equal(out.consumedSlot, false, "10 người bấm lại mà mỗi lần đốt một suất là hết đợt");
    assert.equal(out.expiresAt, existing.expiresAt, "phải nhắc lại đúng hạn cũ, không cấp hạn mới");
});

test("§5: khách đã nhận TRƯỚC khi hết suất thì VẪN dùng được tới hết hạn", () => {
    // Đây là lý do nhánh "đã nhận" phải đặt TRƯỚC nhánh FULL. Đảo lại là tước ưu
    // đãi của người đã kịp nhận, ngay sau khi bot đã hứa với họ.
    const existing = { kind: FLASH_RESPONSE.ACCEPT, expiresAt: new Date(NOW + 10 * 60000).toISOString() };
    const out = evaluateClaim({ sale: sale({ status: FLASH_STATUS.FULL }), existing, now: NOW });
    assert.equal(out.ok, true);
    assert.equal(out.reason, "already");
    assert.equal(out.consumedSlot, false);
});

test("chưa nhận mà đợt đã FULL → từ chối 'full'", () => {
    const out = evaluateClaim({ sale: sale({ status: FLASH_STATUS.FULL }), existing: null, now: NOW });
    assert.equal(out.ok, false);
    assert.equal(out.reason, "full");
});

test("bấm Nhận lúc đang gửi → 'not_open' để handler hiện thanh tiến độ (§3)", () => {
    const out = evaluateClaim({ sale: sale({ status: FLASH_STATUS.SENDING }), now: NOW });
    assert.equal(out.ok, false);
    assert.equal(out.reason, "not_open");
});

test("đợt đã đóng → 'closed', kể cả với người đã nhận", () => {
    // CLOSED đặt TRƯỚC nhánh "đã nhận": admin bấm 🛑 là muốn dừng hẳn, và §5 chỉ hứa
    // giữ ưu đãi cho FULL/CLOSED-do-hết-suất chứ không hứa với đợt bị admin đóng giữa
    // chừng vì lý do khẩn cấp.
    const existing = { kind: FLASH_RESPONSE.ACCEPT, expiresAt: new Date(NOW + 10 * 60000).toISOString() };
    for (const e of [null, existing]) {
        const out = evaluateClaim({ sale: sale({ status: FLASH_STATUS.CLOSED }), existing: e, now: NOW });
        assert.equal(out.ok, false);
        assert.equal(out.reason, "closed");
    }
});

test("ưu đãi đã hết hạn → 'expired', không tự gia hạn", () => {
    const existing = { kind: FLASH_RESPONSE.ACCEPT, expiresAt: new Date(NOW - 1).toISOString() };
    const out = evaluateClaim({ sale: sale(), existing, now: NOW });
    assert.equal(out.ok, false);
    assert.equal(out.reason, "expired");
});

test("không tìm thấy đợt → 'not_found', không phải 'closed'", () => {
    // Hai lý do này ra hai câu khác nhau cho khách; gộp lại thì khách đọc "đợt đã
    // kết thúc" trong khi thật ra bot đang lỗi.
    assert.deepEqual(evaluateClaim({ sale: null, now: NOW }), { ok: false, reason: "not_found" });
});

test("trạng thái lạ trong DB → từ chối an toàn thay vì cho nhận", () => {
    const out = evaluateClaim({ sale: sale({ status: "WEIRD" }), now: NOW });
    assert.equal(out.ok, false);
    assert.equal(out.reason, "closed");
});

test("đã BỎ QUA rồi vẫn nhận được nếu đợt còn mở (§2)", () => {
    const existing = { kind: FLASH_RESPONSE.SKIP, recordedAt: new Date(NOW - 60000).toISOString() };
    const out = evaluateClaim({ sale: sale(), existing, now: NOW });
    assert.equal(out.ok, true);
    assert.equal(out.reason, "accepted");
    assert.equal(out.consumedSlot, true, "lượt bỏ qua không chiếm suất, nên lượt nhận này phải chiếm");
});

// ─── Bỏ qua ────────────────────────────────────────────────────────────────────────

test("bỏ qua luôn được ghi nhận khi đợt chưa đóng, và không ăn suất", () => {
    for (const status of [FLASH_STATUS.SENDING, FLASH_STATUS.OPEN, FLASH_STATUS.FULL]) {
        const out = evaluateSkip({ sale: sale({ status }), now: NOW });
        assert.equal(out.ok, true, status);
        assert.equal(out.reason, "skipped");
        assert.equal(out.recordedAt, new Date(NOW).toISOString());
        assert.ok(!("consumedSlot" in out) || out.consumedSlot === false, status);
    }
});

test("đã nhận rồi thì không cho 'bỏ qua' — sẽ tước mất ưu đãi đang sống", () => {
    const existing = { kind: FLASH_RESPONSE.ACCEPT, expiresAt: new Date(NOW + 60000).toISOString() };
    const out = evaluateSkip({ sale: sale(), existing, now: NOW });
    assert.equal(out.ok, false);
    assert.equal(out.reason, "already_accepted");
});

test("đợt đã đóng thì bỏ qua cũng 'closed', và không tìm thấy thì 'not_found'", () => {
    assert.equal(evaluateSkip({ sale: sale({ status: FLASH_STATUS.CLOSED }), now: NOW }).reason, "closed");
    assert.deepEqual(evaluateSkip({ sale: null, now: NOW }), { ok: false, reason: "not_found" });
});

// ─── §8: một khách chỉ MỘT ưu đãi trên một sản phẩm ───────────────────────────────

test("nhiều ưu đãi cùng sản phẩm → lấy % lớn nhất, không cộng dồn", () => {
    const best = pickBestOffer([
        { saleId: "a", discountPct: 10, expiresAt: new Date(NOW + 60000).toISOString() },
        { saleId: "b", discountPct: 30, expiresAt: new Date(NOW + 60000).toISOString() },
        { saleId: "c", discountPct: 20, expiresAt: new Date(NOW + 60000).toISOString() },
    ]);
    assert.equal(best.saleId, "b");
});

test("bằng % thì lấy hạn muộn hơn — tất định và có lợi cho khách", () => {
    const best = pickBestOffer([
        { saleId: "a", discountPct: 30, expiresAt: new Date(NOW + 60000).toISOString() },
        { saleId: "b", discountPct: 30, expiresAt: new Date(NOW + 900000).toISOString() },
    ]);
    assert.equal(best.saleId, "b");
    // Đảo thứ tự đầu vào vẫn ra cùng kết quả: reduce không được phụ thuộc thứ tự.
    assert.equal(pickBestOffer([best, { saleId: "a", discountPct: 30, expiresAt: new Date(NOW + 60000).toISOString() }]).saleId, "b");
});

test("pickBestOffer với đầu vào rác trả null chứ không ném", () => {
    assert.equal(pickBestOffer([]), null);
    assert.equal(pickBestOffer(null), null);
    assert.equal(pickBestOffer(undefined), null);
    assert.equal(pickBestOffer([null, undefined]), null);
});

test("ưu đãi % rác bị coi như 0 khi so sánh", () => {
    const best = pickBestOffer([
        { saleId: "junk", discountPct: 999 },
        { saleId: "real", discountPct: 5 },
    ]);
    assert.equal(best.saleId, "real");
});

// ─── Phút còn lại ─────────────────────────────────────────────────────────────────

test("phút còn lại làm tròn LÊN — còn 1 giây vẫn nói '1 phút'", () => {
    // Nói "còn 0 phút" cạnh một ưu đãi vẫn dùng được là khiến khách bỏ giỏ hàng.
    assert.equal(offerMinutesLeft(new Date(NOW + 1000).toISOString(), NOW), 1);
    assert.equal(offerMinutesLeft(new Date(NOW + 60000).toISOString(), NOW), 1);
    assert.equal(offerMinutesLeft(new Date(NOW + 61000).toISOString(), NOW), 2);
    assert.equal(offerMinutesLeft(new Date(NOW + 3600000).toISOString(), NOW), 60);
});

test("phút còn lại không bao giờ âm, và null thì bằng 0", () => {
    assert.equal(offerMinutesLeft(new Date(NOW - 1).toISOString(), NOW), 0);
    assert.equal(offerMinutesLeft(null, NOW), 0);
    assert.equal(offerMinutesLeft(undefined, NOW), 0);
});

// ─── Hằng trạng thái ───────────────────────────────────────────────────────────────

test("LIVE_STATUSES = đang gửi + đang mở (§5)", () => {
    assert.deepEqual(LIVE_STATUSES, [FLASH_STATUS.SENDING, FLASH_STATUS.OPEN]);
    // FULL và CLOSED không "sống" cho mục đích tạo đợt mới, nhưng §5 vẫn giữ ưu
    // đãi của người đã nhận — hai chuyện khác nhau, đừng gộp.
    assert.ok(!LIVE_STATUSES.includes(FLASH_STATUS.FULL));
    assert.ok(!LIVE_STATUSES.includes(FLASH_STATUS.CLOSED));
});
