import test from "node:test";
import assert from "node:assert/strict";

import {
    createKeyWithRecovery,
    isRetryableCreateFailure,
    isSafeApiKeyCreateFailure,
    pickKeyByName,
    pageOlderThan,
    rowToCreatedKey,
} from "../src/gpt2api.js";

// Sự cố thật: đơn C293E146 (1 tỷ token, 271.110đ đã thu tiền). Provider trả HTTP 503
// thoáng qua; bot chỉ gọi tạo key MỘT lần và khoá đơn chờ admin dù provider KHÔNG hề
// tạo key (khách mua lại 6 phút sau chạy bình thường). Provider trả đủ chuỗi sk-* ở
// GET /keys nên bot tự giải quyết được sự mơ hồ: tra theo tên key.

const NOW = Date.UTC(2026, 9, 24, 6, 49, 0);
const ok = (key = "sk-NEW") => ({ ok: true, key, id: "pub-1", profileId: 1, profileName: "S1", providerMutationPossible: true });
const fail = (code, extra = {}) => ({ ok: false, code, message: code, profileId: 1, profileName: "S1", providerMutationPossible: true, ...extra });
const row = (over = {}) => ({
    public_id: "pub-rec", id: 7, name: "order-C293E146", key: "sk-RECOVERED", key_prefix: "sk-RECOVER",
    created_at: new Date(NOW).toISOString(), expires_at: null, ...over,
});

const noSleep = async () => {};
function run({ posts, finds = [], delaysMs }) {
    const calls = { post: 0, find: 0, sleeps: [] };
    const p = [...posts];
    const f = [...finds];
    return createKeyWithRecovery({
        post: async () => { calls.post += 1; return p.shift(); },
        find: async () => { calls.find += 1; return f.shift(); },
        sleep: async (ms) => { calls.sleeps.push(ms); },
        delaysMs,
    }).then((result) => ({ result, calls }));
}

test("thành công ngay lần đầu: không tra, không chờ, không đổi kết quả", async () => {
    const { result, calls } = await run({ posts: [ok()] });
    assert.equal(result.ok, true);
    assert.equal(result.key, "sk-NEW");
    assert.equal(result.attempts, undefined);
    assert.equal(calls.post, 1);
    assert.equal(calls.find, 0);
});

test("ĐƠN C293E146: 503 → provider chắc chắn chưa có key → thử lại → giao key, không cần admin", async () => {
    const { result, calls } = await run({
        posts: [fail("http_503"), ok("sk-SECOND")],
        finds: [{ ok: true, found: false }],
    });
    assert.equal(result.ok, true);
    assert.equal(result.key, "sk-SECOND");
    assert.equal(result.attempts, 2);
    assert.equal(calls.post, 2);
    assert.equal(calls.find, 1, "phải tra theo tên trước khi thử lại — tra mới chắc không cấp trùng");
});

test("503 nhưng provider ĐÃ tạo key (mất phản hồi) → nhận lại ĐÚNG key đó, không tạo thêm", async () => {
    const { result, calls } = await run({
        posts: [fail("http_503")],
        finds: [{ ok: true, found: true, row: row() }],
    });
    assert.equal(result.ok, true);
    assert.equal(result.key, "sk-RECOVERED");
    assert.equal(result.id, "pub-rec", "externalId phải là public_id");
    assert.equal(result.recovered, true);
    assert.equal(calls.post, 1, "KHÔNG được POST lần hai khi key đã tồn tại");
    assert.equal(result.profileId, 1);
    assert.equal(result.code, undefined, "mã lỗi của lần lỗi không được lẫn vào kết quả thành công");
});

test("lỗi mạng/timeout cũng được xử lý như 5xx", async () => {
    const { result } = await run({
        posts: [fail("network"), ok("sk-OK")],
        finds: [{ ok: true, found: false }],
    });
    assert.equal(result.key, "sk-OK");
    const rec = await run({ posts: [fail("network")], finds: [{ ok: true, found: true, row: row() }] });
    assert.equal(rec.result.recovered, true);
});

test("không tra được provider (cũng đang lỗi) → KHÔNG đoán: giữ lỗi mơ hồ để admin soát tay", async () => {
    const { result, calls } = await run({
        posts: [fail("http_503")],
        finds: [{ ok: false, code: "http_503" }],
    });
    assert.equal(result.ok, false);
    assert.equal(result.providerMutationPossible, true);
    assert.equal(result.lookupFailed, "http_503");
    assert.equal(calls.post, 1, "chưa biết đã tạo hay chưa thì không được POST lại");
    assert.equal(isSafeApiKeyCreateFailure(result), false, "vẫn phải bị coi là mơ hồ → không hoàn tiền tự động");
});

test("hết lượt mà luôn XÁC MINH chưa có key → an toàn hoàn tiền (providerMutationPossible:false)", async () => {
    const { result, calls } = await run({
        posts: [fail("http_503"), fail("http_503"), fail("http_503")],
        finds: [{ ok: true, found: false }, { ok: true, found: false }, { ok: true, found: false }],
    });
    assert.equal(result.ok, false);
    assert.equal(result.verifiedNoKey, true);
    assert.equal(result.providerMutationPossible, false);
    assert.equal(result.attempts, 3);
    assert.equal(calls.post, 3);
    assert.equal(isSafeApiKeyCreateFailure(result), true);
});

test("sửa lần cuối: lần cuối lỗi mà tra ra key đã tạo thì vẫn nhận lại", async () => {
    const { result } = await run({
        posts: [fail("http_503"), fail("http_502"), fail("network")],
        finds: [{ ok: true, found: false }, { ok: true, found: false }, { ok: true, found: true, row: row() }],
    });
    assert.equal(result.ok, true);
    assert.equal(result.recovered, true);
    assert.equal(result.attempts, 3);
});

test("429: provider TỪ CHỐI nên chắc chắn chưa tạo — chờ rồi thử lại, KHÔNG cần tra", async () => {
    const { result, calls } = await run({ posts: [fail("rate_limited"), ok("sk-OK")] });
    assert.equal(result.key, "sk-OK");
    assert.equal(calls.find, 0);
    assert.equal(calls.sleeps.length >= 1, true);
});

test("429 kéo dài: hết lượt thì giữ nguyên hành vi cũ (an toàn hoàn tiền)", async () => {
    const { result } = await run({ posts: [fail("rate_limited"), fail("rate_limited"), fail("rate_limited")] });
    assert.equal(result.ok, false);
    assert.equal(isSafeApiKeyCreateFailure(result), true);
});

test("lỗi KHÔNG tạm thời (token sai, thiếu scope, payload sai) → trả ngay, không thử lại", async () => {
    for (const code of ["invalid_admin_key", "scope_denied", 40000, "disabled", "not_configured"]) {
        const { result, calls } = await run({ posts: [fail(code)] });
        assert.equal(result.ok, false);
        assert.equal(calls.post, 1, `${code} không được thử lại`);
        assert.equal(calls.find, 0);
    }
});

test("có chờ giữa các lần thử (backoff) và chờ trước khi tra", async () => {
    const { calls } = await run({
        posts: [fail("http_503"), fail("http_503"), ok()],
        finds: [{ ok: true, found: false }, { ok: true, found: false }],
        delaysMs: [111, 222],
    });
    assert.ok(calls.sleeps.includes(111) && calls.sleeps.includes(222), `thiếu backoff: ${calls.sleeps}`);
});

test("isRetryableCreateFailure: chỉ 5xx / network / no_key_in_response / rate_limited", () => {
    for (const code of ["http_500", "http_502", "http_503", "http_504", "network", "no_key_in_response", "rate_limited"]) {
        assert.equal(isRetryableCreateFailure({ ok: false, code }), true, code);
    }
    for (const code of ["invalid_admin_key", "scope_denied", 40000, "http_404", "disabled"]) {
        assert.equal(isRetryableCreateFailure({ ok: false, code }), false, String(code));
    }
    assert.equal(isRetryableCreateFailure({ ok: true }), false);
});

test("pickKeyByName: khớp tuyệt đối, phải có chuỗi key, và bỏ key CŨ trùng tên", () => {
    const rows = [
        row({ name: "order-C293E146X" }),
        row({ name: "order-C293E146", key: "" }),
        row({ name: "order-C293E146", key: "sk-OLD", created_at: new Date(NOW - 3_600_000).toISOString() }),
        row({ name: "order-C293E146", key: "sk-FRESH" }),
    ];
    assert.equal(pickKeyByName(rows, "order-C293E146")?.key, "sk-OLD", "không giới hạn thời gian thì lấy dòng khớp đầu tiên có key");
    assert.equal(pickKeyByName(rows, "order-C293E146", { notBefore: NOW - 60_000 })?.key, "sk-FRESH", "key cũ trùng tên không được nhận nhầm");
    assert.equal(pickKeyByName(rows, "order-ZZZZ"), null);
    assert.equal(pickKeyByName([], "x"), null);
    assert.equal(pickKeyByName(null, "x"), null);
    assert.equal(pickKeyByName(rows, ""), null);
    // Không rõ thời điểm tạo + có mốc → bỏ qua (không đoán)
    assert.equal(pickKeyByName([row({ created_at: undefined })], "order-C293E146", { notBefore: NOW - 1 }), null);
});

test("pageOlderThan: chỉ kết luận khi trang xếp mới→cũ VÀ cuối trang đã cũ hơn mốc", () => {
    const t = (min) => ({ created_at: new Date(NOW - min * 60_000).toISOString() });
    assert.equal(pageOlderThan([t(1), t(2), t(30)], NOW - 10 * 60_000), true);
    assert.equal(pageOlderThan([t(1), t(2), t(3)], NOW - 10 * 60_000), false, "còn key mới hơn mốc → phải quét trang sau");
    assert.equal(pageOlderThan([t(30), t(1), t(40)], NOW - 10 * 60_000), false, "không xếp thứ tự → không dám kết luận");
    assert.equal(pageOlderThan([{ created_at: "x" }], NOW), false);
    assert.equal(pageOlderThan([], NOW), false);
    assert.equal(pageOlderThan([t(5)], null), false);
});

test("rowToCreatedKey: cùng hình dạng với kết quả tạo key thành công", () => {
    const r = rowToCreatedKey(row({ expires_at: { Time: "2026-11-01T00:00:00Z", Valid: true } }));
    assert.equal(r.ok, true);
    assert.equal(r.key, "sk-RECOVERED");
    assert.equal(r.id, "pub-rec");
    assert.equal(r.name, "order-C293E146");
    assert.equal(r.keyPrefix, "sk-RECOVER");
    assert.equal(r.expiresAt, "2026-11-01T00:00:00Z");
    assert.equal(r.recovered, true);
});
