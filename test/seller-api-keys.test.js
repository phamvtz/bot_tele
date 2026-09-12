import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
    maskApiKey,
    serializeKeyForSeller,
    liveKeyViewForSeller,
    pseudonymizeUser,
} from "../src/seller-api.js";
import { namespacedClientRef, KeySource, SELLER_CLIENT_REF_MAX } from "../src/apikey-store.js";

// Seller API cho một BÊN THỨ BA cấp key sk-* thật — tức là tiêu quota thật của shop
// và nắm giữ hàng hoá dùng được ngay của khách. Hai rủi ro định hình mọi test ở đây:
//
//   1. RÒ RỈ. Lỗ hổng đã sửa ở serializeOrderForSeller là spread cả document. Cùng
//      một lỗi đó với IssuedApiKey còn tệ hơn: field `key` của nó CHÍNH LÀ chuỗi
//      sk-* nguyên văn. Nên chuỗi thật chỉ được xuất hiện ở đúng một chỗ — response
//      của POST /keys — và mọi đường đọc khác phải che.
//   2. CẤP TRÙNG. Endpoint gọi được từ internet, client của seller sẽ retry sau
//      timeout. Tạo key và gia hạn đều không tự hoàn lại, chạy hai lần là mất tiền
//      hai lần. Khoá idempotency (`clientRef`) vì thế không phải tiện ích mà là
//      điều kiện để endpoint này được phép tồn tại.

const SK = "sk-REAL-CUSTOMER-KEY-MUST-NEVER-LEAK-abcdef123456";

const ROW = {
    id: "ckkey0000001",
    telegramId: "777888999",
    key: SK,
    quotaTokens: 20_000_000,
    rpm: 600,
    source: "SELLER",
    models: ["claude-opus-5"],
    profileId: 2,
    profileName: "Server rẻ",
    externalId: "ext-uuid-1",
    expiresAt: new Date("2026-12-31T00:00:00.000Z"),
    renewCount: 3,
    lastRenewAt: new Date("2026-09-01T00:00:00.000Z"),
    lastRenewRef: "seller1:order-8891",
    sellerKeyId: "seller1",
    sellerKeyName: "Nhà cung cấp A",
    hiddenAt: null,
    renewWipAt: null,
    wipError: null,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
};

// ─── 1. Che chuỗi sk-* ─────────────────────────────────────────────────────────

test("maskApiKey không bao giờ trả lại chuỗi dùng được", () => {
    const m = maskApiKey(SK);
    assert.ok(m.includes("…"), "phải có dấu che ở giữa");
    assert.ok(m.length < SK.length / 2, "bản che phải ngắn hơn hẳn bản thật");
    assert.ok(!SK.includes(m.slice(1, -1).replace("…", "")), "không được chứa một khúc dài của key thật");
    // Còn đủ để nhận ra: prefix `sk-` và 4 ký tự cuối.
    assert.ok(m.startsWith("sk-"), `giữ prefix để biết đây là key: ${m}`);
    assert.ok(m.endsWith("3456"), `giữ 4 ký tự cuối để đối chiếu: ${m}`);
});

test("maskApiKey an toàn với key ngắn, rỗng và không phải chuỗi", () => {
    assert.equal(maskApiKey(""), null);
    assert.equal(maskApiKey(null), null);
    assert.equal(maskApiKey(undefined), null);
    // Key ngắn bất thường thì che gần hết — không được in nguyên.
    assert.equal(maskApiKey("abcdefgh"), "ab…gh");
    assert.equal(maskApiKey("ab"), "ab…ab");
    assert.equal(maskApiKey(12345), "12…45");
});

// ─── 2. Serializer key: whitelist + mặc định là CHE ─────────────────────────────

test("serializeKeyForSeller là ĐÚNG whitelist — thêm field phải là một quyết định có chủ ý", () => {
    const out = serializeKeyForSeller(ROW);
    assert.deepEqual(Object.keys(out).sort(), [
        "createdAt", "expiresAt", "hidden", "id", "key", "keyRevealed", "lastRenewAt",
        "models", "pending", "profileId", "profileName", "quotaTokens", "renewCount",
        "rpm", "telegramId",
    ]);
});

test("mặc định là CHE — muốn thấy key thật phải xin tường minh", () => {
    const out = serializeKeyForSeller(ROW);
    assert.equal(out.keyRevealed, false);
    assert.notEqual(out.key, SK);
    assert.ok(!JSON.stringify(out).includes(SK), `key thật không được lọt vào payload mặc định:\n${JSON.stringify(out)}`);

    const revealed = serializeKeyForSeller(ROW, { revealKey: true });
    assert.equal(revealed.key, SK);
    assert.equal(revealed.keyRevealed, true);
});

test("không field nội bộ nào của shop lọt ra cho seller", () => {
    const json = JSON.stringify(serializeKeyForSeller(ROW, { revealKey: true }));
    for (const forbidden of ["sellerKeyId", "sellerKeyName", "lastRenewRef", "renewWipAt", "wipError", "ext-uuid-1"]) {
        assert.ok(!json.includes(forbidden), `payload không được chứa ${forbidden}`);
    }
    // `externalId` là id phía provider: có nó thì seller gọi thẳng provider được nếu
    // token adm_* lộ, và nó cũng không giúp họ làm gì với API của shop.
    assert.ok(!("externalId" in serializeKeyForSeller(ROW)));
});

test("key chưa tạo xong phải hiện pending, không hiện như key đã cấp", () => {
    // Slot claim có key: "" trong lúc chờ provider. Seller đọc nó là "đã cấp" thì sẽ
    // báo cho khách một key không tồn tại.
    const pending = serializeKeyForSeller({ ...ROW, key: "", hiddenAt: new Date() });
    assert.equal(pending.pending, true);
    assert.equal(pending.key, null, "key rỗng phải ra null, không phải bản che của chuỗi rỗng");
    assert.equal(pending.hidden, true);

    const done = serializeKeyForSeller(ROW);
    assert.equal(done.pending, false);
    assert.equal(done.hidden, false);
});

test("serializeKeyForSeller(null) trả null, không ném", () => {
    assert.equal(serializeKeyForSeller(null), null);
    assert.equal(serializeKeyForSeller(undefined), null);
});

test("field thiếu / sai kiểu không làm nổ serializer", () => {
    const out = serializeKeyForSeller({ id: "x" });
    assert.equal(out.id, "x");
    assert.equal(out.telegramId, null);
    assert.deepEqual(out.models, []);
    assert.equal(out.quotaTokens, 0);
    assert.equal(out.renewCount, 0);
    assert.equal(out.profileId, null);
    assert.equal(out.profileName, "");
    assert.equal(out.pending, true);
});

// ─── 3. Trạng thái sống: "không đọc được" KHÁC "đã chết" ──────────────────────────

const NOW = Date.UTC(2026, 8, 13, 12, 0, 0);

test("không đọc được provider thì báo unknown, KHÔNG báo missing", () => {
    // Admin xoá key và mạng đang hỏng là hai chuyện khác nhau. Seller đọc nhầm cái
    // sau thành cái trước sẽ đi cấp lại key cho một khách đang dùng tốt — tốn quota
    // của shop và làm khách rối.
    const v = liveKeyViewForSeller(null, ROW, NOW, 15, false);
    assert.equal(v.live, false);
    assert.equal(v.status, "unknown");
    assert.equal(v.quotaTokensLive, null, "không có số liệu thì không được bịa ra 0");
    assert.equal(v.usedPct, null);
    assert.equal(v.enabled, null);
});

test("key quá hạn theo mốc đã lưu vẫn hiện expired kể cả khi provider không đọc được", () => {
    const old = { ...ROW, expiresAt: new Date(NOW - 86_400_000) };
    const v = liveKeyViewForSeller(null, old, NOW, 15, false);
    assert.equal(v.status, "expired");
    assert.equal(v.daysLeft, 0);
});

test("có số liệu sống thì phân loại đúng và quy đổi quota về token hiển thị", () => {
    const st = { quotaLimit: 300_000, quotaUsed: 270_000, expiresAt: "2026-12-31T00:00:00.000Z", enabled: true, rpm: 600, effectiveRpm: 600, lastUsedAt: null };
    const v = liveKeyViewForSeller(st, ROW, NOW, 15, true);
    assert.equal(v.live, true);
    // 270k/300k = 90% → vượt mốc "sắp hết" (80%) nhưng chưa cạn.
    assert.equal(v.status, "low");
    assert.equal(v.usedPct, 90);
    // quota_limit 300_000 với giá quy đổi 15 → 300_000 × 100/15 × 1M/1M = 2M token.
    assert.equal(v.quotaTokensLive, 2_000_000);
    assert.equal(v.usedTokensLive, 1_800_000);
    assert.equal(v.unlimitedQuota, false);
});

test("quota_limit = 0 là VÔ HẠN — phải ra null, tuyệt đối không ra 0 token", () => {
    // Đọc nhầm thành "0 token" là spam báo khách hết quota trên chính cái key vĩnh
    // viễn họ đã trả tiền mua.
    const st = { quotaLimit: 0, quotaUsed: 999_999, expiresAt: null, enabled: true };
    // Row cũng phải không có hạn: `liveKeyViewForSeller` cố ý fallback về
    // `IssuedApiKey.expiresAt` khi provider không trả, nên muốn test "key vĩnh viễn"
    // thì cả hai nguồn đều phải trống.
    const v = liveKeyViewForSeller(st, { ...ROW, expiresAt: null }, NOW, 15, true);
    assert.equal(v.unlimitedQuota, true);
    assert.equal(v.quotaTokensLive, null);
    assert.equal(v.usedTokensLive, null);
    assert.equal(v.usedPct, null);
    assert.equal(v.status, "active");
    assert.equal(v.daysLeft, null);
    assert.equal(v.renewability.canAddTokens, false, "key vô hạn không gia hạn token được");
    assert.equal(v.renewability.canAddDays, false, "key không hết hạn thì không cộng ngày");
});

test("provider không trả expiresAt thì fallback về mốc đã lưu, không suy ra 'vĩnh viễn'", () => {
    // Bản list của provider KHÔNG có expires_at. Nếu coi null là "không hết hạn" thì
    // mọi key đọc qua danh sách đều hiện vĩnh viễn — sai cho đúng loại key phổ biến nhất.
    const st = { quotaLimit: 300_000, quotaUsed: 0, expiresAt: null, enabled: true };
    const v = liveKeyViewForSeller(st, ROW, NOW, 15, true);
    assert.equal(v.renewability.canAddDays, true, "row.expiresAt vẫn còn nên phải gia hạn ngày được");
    assert.equal(v.daysLeft, Math.ceil((+ROW.expiresAt - NOW) / 86_400_000));
});

test("key bị tắt phía provider hiện disabled, và renewability nói rõ cái gì còn gia hạn được", () => {
    const st = { quotaLimit: 100, quotaUsed: 0, expiresAt: "2026-12-31T00:00:00.000Z", enabled: false };
    const v = liveKeyViewForSeller(st, ROW, NOW, 15, true);
    assert.equal(v.status, "disabled");
    assert.equal(v.enabled, false);
    assert.equal(v.renewability.canAddTokens, true);
    assert.equal(v.renewability.canAddDays, true);
});

// ─── 4. Ẩn danh khách trong thống kê ─────────────────────────────────────────────

const SECRET = "server-secret-not-known-to-seller";

test("mã ẩn danh ổn định với cùng (seller, khách, secret)", () => {
    const a = pseudonymizeUser("seller1", "777888999", SECRET);
    const b = pseudonymizeUser("seller1", "777888999", SECRET);
    assert.equal(a, b, "cùng một khách phải ra cùng một mã thì mới nối chuỗi theo ngày được");
    assert.match(a, /^u_[0-9a-f]{20}$/);
});

test("hai seller khác nhau ra hai mã khác nhau cho cùng một khách", () => {
    const a = pseudonymizeUser("seller1", "777888999", SECRET);
    const b = pseudonymizeUser("seller2", "777888999", SECRET);
    assert.notEqual(a, b, "hai supplier không được phép đối chiếu khách của nhau");
});

test("đổi secret đổi toàn bộ mã — nên seller không dò ngược được", () => {
    assert.notEqual(pseudonymizeUser("seller1", "777888999", SECRET), pseudonymizeUser("seller1", "777888999", "other"));
});

test("thiếu secret thì trả null (fail closed), không fallback về hash không khoá", () => {
    // sha256 trần trên không gian ~10 chữ số là dò được trong khoảng một giây bằng
    // GPU. Không có secret thì "ẩn danh" chỉ là nhãn — thà endpoint từ chối chạy.
    assert.equal(pseudonymizeUser("seller1", "777888999", ""), null);
    assert.equal(pseudonymizeUser("seller1", "777888999", undefined), null);
    assert.equal(pseudonymizeUser("seller1", "777888999", null), null);
});

test("mã không chứa telegramId thật và không phải là hàm thuận nghịch đơn giản", () => {
    const uid = "777888999";
    const code = pseudonymizeUser("seller1", uid, SECRET);
    assert.ok(!code.includes(uid));
    // Hai khách kề nhau phải ra hai mã không liên quan — không được là uid + hằng số.
    const neighbour = pseudonymizeUser("seller1", "777888998", SECRET);
    assert.notEqual(code.slice(-6), neighbour.slice(-6), "mã của hai id kề nhau không được chỉ lệch nhau phần đuôi");
});

test("telegramId rỗng trả null", () => {
    assert.equal(pseudonymizeUser("seller1", "", SECRET), null);
    assert.equal(pseudonymizeUser("seller1", null, SECRET), null);
    assert.equal(pseudonymizeUser("seller1", undefined, SECRET), null);
});

// ─── 5. clientRef — khoá idempotency ────────────────────────────────────────────

test("clientRef được namespace theo seller để một unique index một field là đủ", () => {
    assert.equal(namespacedClientRef("seller1", "order-8891"), "seller1:order-8891");
    // Hai seller dùng cùng một mã đơn của họ thì không được đụng nhau.
    assert.notEqual(namespacedClientRef("seller1", "o1"), namespacedClientRef("seller2", "o1"));
});

test("không có clientRef thì trả null — TUYỆT ĐỐI không bịa giá trị mặc định", () => {
    // Mọi key không-có-clientRef mà nhận chung một giá trị bịa thì unique index
    // chặn ngay key thứ hai, và cả endpoint chết từ lần cấp thứ hai.
    assert.equal(namespacedClientRef("seller1", ""), null);
    assert.equal(namespacedClientRef("seller1", null), null);
    assert.equal(namespacedClientRef("seller1", undefined), null);
    assert.equal(namespacedClientRef("seller1", "   "), null);
});

test("clientRef quá dài bị TỪ CHỐI ở route, không âm thầm cắt rồi trùng", () => {
    // Cắt ngắn im lặng là lỗi khó thấy nhất có thể: hai ref khác nhau quá 120 ký tự
    // ra cùng một giá trị → request thứ hai nhận `duplicate: true` kèm key đã che →
    // seller không bao giờ có key cho khách mà cũng không nhận được lỗi nào.
    const long = "x".repeat(500);
    assert.equal(namespacedClientRef("seller1", long), namespacedClientRef("seller1", `${long}y`),
        "bản cắt THẬT SỰ trùng nhau — đó là lý do route phải chặn trước");
    assert.ok(src.includes("SELLER_CLIENT_REF_MAX"), "phải có trần độ dài");
    assert.ok(code.includes("readClientRef"), "phải đọc qua một hàm để cả POST và PATCH cùng một luật");
    assert.equal((code.match(/readClientRef\(b\)/g) || []).length, 2, "POST /keys và PATCH /keys/:id đều phải kiểm");
    assert.ok(code.includes("client_ref_too_long"), "quá dài phải trả một mã lỗi riêng, không phải 400 chung chung");
    // Trần phải DƯỚI chỗ cắt, để lưới an toàn không bao giờ kích hoạt.
    assert.ok(SELLER_CLIENT_REF_MAX < 120, "trần route phải nhỏ hơn chỗ cắt trong store");
});

test("clientRef hợp lệ không bị đổi dạng", () => {
    assert.equal(namespacedClientRef("s1", "order-8891"), "s1:order-8891");
    assert.equal(namespacedClientRef("s1", "  spaced  "), "s1:spaced", "trim hai đầu");
    assert.equal(namespacedClientRef("s1", "x".repeat(100)).length, "s1:".length + 100);
});

test("KeySource có SELLER và nó khác ADMIN", () => {
    assert.equal(KeySource.SELLER, "SELLER");
    assert.notEqual(KeySource.SELLER, KeySource.ADMIN);
});

// ─── 6. Chốt cấu trúc ──────────────────────────────────────────────────────────

const src = readFileSync(new URL("../src/seller-api.js", import.meta.url), "utf8");

/**
 * Bỏ dòng là COMMENT NGUYÊN DÒNG, để assertion không khớp trúng chính phần văn bản
 * giải thích (comment ở đây trích nguyên cú pháp `...order` và `revealKey: true`).
 */
const code = src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

test("mọi route seller đều nằm SAU middleware sellerAuth", () => {
    const authAt = code.indexOf("router.use(sellerAuth)");
    assert.ok(authAt > 0, "phải có middleware sellerAuth");
    const routes = [...code.matchAll(/^router\.(get|post|put|patch|delete)\(/gm)];
    assert.ok(routes.length >= 10, `phải thấy đủ route, thực tế ${routes.length}`);
    for (const route of routes) {
        assert.ok(
            route.index > authAt,
            `route tại offset ${route.index} nằm TRƯỚC sellerAuth — endpoint public không xác thực`,
        );
    }
});

test("chuỗi sk-* thật chỉ xuất hiện ở POST /keys, không ở route đọc nào", () => {
    // `revealKey: true` là cách DUY NHẤT để serializer nhả key nguyên văn. Nếu nó
    // xuất hiện ở một call site nào khác (list, detail, stats) thì một request GET
    // gọi lại được bao nhiêu lần cũng đọc được cả kho key.
    assert.ok(!/revealKey:\s*true/.test(code), "không route nào được xin revealKey: true");

    // `created.key` (chuỗi provider vừa trả) chỉ được tồn tại bên trong POST /keys —
    // ở đó nó dùng cho ba việc hợp lệ: ghi DB, trả response một lần, và gửi tin
    // Telegram khi `notify`. Ngoài khối đó nó không có lý do gì xuất hiện.
    const postStart = code.indexOf('router.post("/keys"');
    const postEnd = code.indexOf('router.get("/keys"');
    assert.ok(postStart > 0 && postEnd > postStart, "phải khoanh được khối POST /keys");
    assert.ok(!code.slice(0, postStart).includes("created.key"), "không có created.key trước POST /keys");
    assert.ok(!code.slice(postEnd).includes("created.key"), "không có created.key sau POST /keys");
    // Trong khối: đúng BA lần, mỗi lần một việc hợp lệ. Con số này cố tình cứng —
    // thêm lần thứ tư nghĩa là có một đường mới nhả key nguyên văn và phải giải trình.
    const post = code.slice(postStart, postEnd);
    assert.equal(
        (post.match(/key:\s*created\.key/g) || []).length,
        3,
        "3 lần = ghi DB (finalizeSellerKeySlot) + gửi tin Telegram (apiKeyMessage) + res.json một lần",
    );
    assert.ok(post.includes("finalizeSellerKeySlot"), "phải ghi key vào DB qua store");
    assert.ok(post.includes("keyMasked: maskApiKey(created.key)"), "response phải kèm bản che để client log được");

    // serializeKeyForSeller phải được dùng ở cả list và detail.
    assert.ok((code.match(/serializeKeyForSeller\(/g) || []).length >= 3, "1 định nghĩa + list + detail");
});

test("không spread document IssuedApiKey vào response", () => {
    assert.ok(!/\.\.\.\s*row\b/.test(code), "không được spread `...row`");
    assert.ok(!/\.\.\.\s*r\b\s*[,}]/.test(code), "không được spread một dòng key thô");
    assert.ok(!/\.\.\.\s*order\b/.test(code), "vẫn không được spread order (lỗ hổng cũ)");
});

test("POST /keys dùng allowDisabledProfile: false — seller không lách được công tắc ngừng bán", () => {
    // Admin chọn server đang tắt là cố ý; seller tạo key là MỘT LẦN BÁN MỚI nên công
    // tắc "ngừng bán" của server phải có tác dụng. Bật cờ này ở đây là admin tắt
    // server vì upstream hỏng mà seller vẫn tiếp tục bán trên server đó.
    const post = code.slice(code.indexOf('router.post("/keys"'), code.indexOf('router.get("/keys"'));
    assert.ok(post.includes("allowDisabledProfile: false"), "POST /keys phải khoá allowDisabledProfile: false");
});

test("POST /keys giữ chỗ TRƯỚC khi gọi provider", () => {
    // Thứ tự này là toàn bộ cơ chế chống cấp trùng: claim ăn unique index trước,
    // createApiKey sau. Đảo lại là hai request song song cùng tạo được key thật.
    const post = code.slice(code.indexOf('router.post("/keys"'), code.indexOf('router.get("/keys"'));
    const claimAt = post.indexOf("claimSellerKeySlot(");
    const createAt = post.indexOf("createApiKey(");
    assert.ok(claimAt > 0 && createAt > 0, "phải có cả claim và create");
    assert.ok(claimAt < createAt, "claim phải chạy TRƯỚC createApiKey");
    assert.ok(post.includes("claim.claimed"), "phải kiểm tra kết quả claim");
    assert.ok(post.includes("duplicate: true"), "claim thua phải trả duplicate chứ không tạo key thứ hai");
});

test("lỗi tạo key mơ hồ thì GIỮ dấu vết, không xoá slot", () => {
    // Xoá dòng duy nhất ghi nhận "có thể đã tạo key" là mất luôn manh mối đối soát.
    const post = code.slice(code.indexOf('router.post("/keys"'), code.indexOf('router.get("/keys"'));
    assert.ok(post.includes("isSafeApiKeyCreateFailure"), "phải dùng chung bộ phân loại với delivery.js, không tự viết lại");
    assert.ok(post.includes("discardSellerKeySlot"), "lỗi an toàn thì dọn slot");
    assert.ok(post.includes("wipError"), "lỗi mơ hồ phải ghi dấu lại trên dòng");
    assert.ok(post.includes("reconcileId"), "phải trả id để shop đối soát");
    assert.ok(post.includes("retryable: false"), "lỗi mơ hồ phải nói rõ là KHÔNG được retry");
});

test("PATCH /keys/:id có cả hai lớp chặn cấp trùng quota", () => {
    const patch = code.slice(code.indexOf('router.patch("/keys/:id"'), code.indexOf('router.patch("/keys/:id/enabled"'));
    // Lớp 1: clientRef trùng lastRenewRef → trả biên nhận cũ.
    assert.ok(patch.includes("lastRenewRef === renewRef"), "phải nhận ra clientRef đã dùng");
    // Lớp 2: claim atomic renewWipAt.
    const claimAt = patch.indexOf("claimSellerKeyRenew(");
    const renewAt = patch.indexOf("renewApiKey(");
    assert.ok(claimAt > 0 && renewAt > 0 && claimAt < renewAt, "claim phải chạy TRƯỚC renewApiKey");
    // Lỗi mơ hồ thì GIỮ cờ WIP — tự nhả là tự chọn "có thể cộng trùng quota".
    assert.ok(patch.includes("safeToRelease"), "phải phân biệt lỗi nhả được và lỗi phải giữ cờ");
    assert.ok(/if \(safeToRelease\) await releaseSellerKeyRenew/.test(patch), "chỉ nhả cờ khi chắc chắn chưa PATCH");
    assert.ok(patch.includes("renew_in_progress"), "cờ WIP đang giữ phải báo 409 cho client dừng lại");
});

test("endpoint thống kê của seller không trả telegramId thật", () => {
    const route = code.slice(code.indexOf('router.get("/stats/users/daily"'), code.indexOf('router.get("/stats/keys"'));
    assert.ok(route.includes("pseudonymizeUser"), "phải đi qua hàm ẩn danh");
    assert.ok(route.includes("telegramId: null"), "phải xoá id thật khỏi object trả về");
    assert.ok(route.includes("USER_API_SECRET"), "thiếu secret thì phải từ chối, không trả id trần");
    assert.ok(route.includes("no_pseudonym_secret"), "và phải nói rõ lý do");
    assert.ok(route.includes("truncated"), "quét thiếu đơn phải báo là số liệu thiếu");
});

test("bản admin của thống kê chi tiêu tồn tại và trả danh tính thật", () => {
    // Cùng một luật tính, hai mức tin cậy. Seller API ẩn danh; web admin — nơi shop
    // thực sự cần biết khách nào tiêu bao nhiêu — trả tên thật.
    const admin = readFileSync(new URL("../src/api-routes.js", import.meta.url), "utf8");
    assert.ok(admin.includes('router.get("/spend/daily"'), "phải có route admin /spend/daily");
    assert.ok(admin.includes("summarizeUserDailySpend") && admin.includes("summarizeDailySpend"),
        "admin phải dùng ĐÚNG hai hàm mà seller dùng — hai luật tính là hai con số cãi nhau");
    const sellerSrc = code;
    assert.ok(sellerSrc.includes("summarizeDailySpend"), "seller cũng gọi cùng module");
});

test("docs của seller nằm SAU auth", () => {
    // Trang docs mô tả toàn bộ bề mặt API mà một key vốn chỉ để NẠP HÀNG chạm tới.
    // Để public là tự vẽ bản đồ cho người chưa có key.
    const docsAt = code.indexOf('router.get("/docs"');
    const authAt = code.indexOf("router.use(sellerAuth)");
    assert.ok(docsAt > authAt, "route /docs phải nằm sau sellerAuth");
});

test("admin đặt được trần cấp key, và giá trị vô lý không âm thầm siết seller đang chạy", () => {
    assert.ok(src.includes("maxKeysPerDay") && src.includes("maxTokensPerDay"), "phải có trần theo ngày");
    assert.ok(src.includes("readLimits"), "phải đọc trần qua MỘT hàm, không mỗi route một kiểu");
    // POST /api/seller/keys tạo key thật tốn quota của shop; seller là bên thứ ba nên
    // một key bị lộ mà không có trần là một đường rút quota không giới hạn.
    assert.ok(code.includes("429"), "vượt trần phải trả 429");
});
