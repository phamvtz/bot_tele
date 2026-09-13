import test, { mock, afterEach } from "node:test";
import assert from "node:assert/strict";

/**
 * `fetchBankHistory` phải NÉM LỖI khi provider tắt/hết hạn, chứ không được trả về
 * một "item rác" trông như thành công.
 *
 * Chuyện đã xảy ra thật (2026-09-13): thueapibank trả HTTP 200 kèm
 * `{"status":"error","msg":"Trạng thái API đang tắt"}`. Nhánh fallback cuối của
 * `parseIPNItems` LUÔN trả về một phần tử cho bất kỳ object nào, nên payload đó thành
 * `[{amount:0, content:""}]` → `items.length === 1` → `fetchBankHistory` TRẢ VỀ THÀNH
 * CÔNG. Poller reset backoff, xoá `lastError`, không log, không `sendLog`: auto-confirm
 * đơn VietQR chết hoàn toàn mà admin không nhận được một tín hiệu nào. 10 đơn PENDING
 * tồn 5 tiếng, khách chuyển tiền không nhận được key.
 */

const CFG = {
    baseUrl: "https://provider.test/historyapimbbank",
    token: "tok-secret",
    accountNo: "321336",
    accountName: "",
    timeoutMs: 500,
};

/** Response giả đủ cho `fetchJson`: chỉ cần `ok`, `status` và `json()`. */
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

/** Đếm số lần fetch để chốt "không fallback vô ích". */
let calls = [];
function stubFetch(impl) {
    calls = [];
    mock.method(globalThis, "fetch", async (url, opts) => {
        calls.push({ url: String(url), opts });
        return impl(url, opts);
    });
}

afterEach(() => mock.restoreAll());

const { fetchBankHistory, buildHistoryUrl } = await import("../src/bank-history.js");

// ─── Provider báo lỗi nghiệp vụ ────────────────────────────────────────────────────

test("provider trả {status:'error'} → NÉM, không trả item rác", async () => {
    stubFetch(async () => json({ status: "error", msg: "Trạng thái API đang tắt" }));
    const err = await fetchBankHistory(CFG).then(() => null, (e) => e);
    assert.ok(err, "phải ném lỗi");
    assert.match(err.message, /Trạng thái API đang tắt/, "thông điệp provider phải tới được admin");
    assert.match(err.message, /provider báo lỗi/, "phải nói rõ đây là lỗi provider");
});

test("lỗi provider → KHÔNG thử 3 fallback (cùng một provider, chỉ tốn 3×15s mỗi tick)", async () => {
    stubFetch(async () => json({ status: "error", msg: "Trạng thái API đang tắt" }));
    await assert.rejects(() => fetchBankHistory(CFG));
    assert.equal(calls.length, 1, `chỉ gọi đúng 1 lần, thực tế ${calls.length}`);
});

test("token KHÔNG bị lộ trong thông điệp lỗi (lỗi này đi vào sendLog kênh admin)", async () => {
    stubFetch(async () => json({ status: "error", msg: "Trạng thái API đang tắt" }));
    const err = await fetchBankHistory(CFG).then(() => null, (e) => e);
    assert.ok(!err.message.includes("tok-secret"), "không được in token ra log");
});

test("{success:false} cũng là lỗi provider", async () => {
    stubFetch(async () => json({ success: false, message: "token hết hạn" }));
    const err = await fetchBankHistory(CFG).then(() => null, (e) => e);
    assert.match(err?.message || "", /token hết hạn/);
});

test("status:'error' mà KHÔNG có msg → vẫn ném, dùng chính status làm thông điệp", async () => {
    stubFetch(async () => json({ status: "error" }));
    const err = await fetchBankHistory(CFG).then(() => null, (e) => e);
    assert.match(err?.message || "", /provider báo lỗi/);
});

test("msg dài được cắt — sendLog không phải chỗ để dán cả trang HTML", async () => {
    stubFetch(async () => json({ status: "error", msg: "x".repeat(5000) }));
    const err = await fetchBankHistory(CFG).then(() => null, (e) => e);
    assert.ok(err.message.length < 300, `thông điệp phải bị cắt, thực tế ${err.message.length}`);
});

// ─── Item rác: parseIPNItems fallback luôn trả 1 phần tử ───────────────────────────

test("payload vô nghĩa (không phải error tường minh) → KHÔNG trả item rác", async () => {
    // `parseIPNItems` fallback trả `[{amount:0, content:""}]` cho object bất kỳ.
    // Trước fix, `items.length === 1` được coi là thành công.
    stubFetch(async () => json({ foo: "bar" }));
    const err = await fetchBankHistory(CFG).then((r) => ({ returned: r }), (e) => e);
    assert.ok(!err?.returned, `không được trả dữ liệu, thực tế: ${JSON.stringify(err?.returned)}`);
    assert.ok(err instanceof Error, "phải ném lỗi để poller backoff + báo admin");
});

test("giao dịch có amount nhưng content RỖNG bị loại — không bao giờ khớp được đơn nào", async () => {
    stubFetch(async () => json({
        transactions: [
            { amount: 50000, description: "", transactionID: "t1" },
            { amount: 0, description: "SHOPABCD1234", transactionID: "t2" },
        ],
    }));
    const err = await fetchBankHistory(CFG).then((r) => ({ returned: r }), (e) => e);
    assert.ok(!err?.returned?.length, "cả hai đều vô dụng → không được coi là có dữ liệu");
});

// ─── Không hồi quy: đường hạnh phúc phải y nguyên ─────────────────────────────────

test("giao dịch thật vẫn trả về đúng", async () => {
    stubFetch(async () => json({
        transactions: [
            { amount: 129580, description: "SHOPB6038D55", transactionID: "FT001", transactionDate: "2026-09-13" },
            { amount: 25000, description: "SHOPAAAA0001", transactionID: "FT002" },
        ],
    }));
    const items = await fetchBankHistory(CFG);
    assert.equal(items.length, 2);
    assert.equal(items[0].amount, 129580);
    assert.equal(items[0].content, "SHOPB6038D55");
    assert.equal(items[0].transactionId, "FT001");
});

test("giao dịch OUT (tiền ra) vẫn bị loại như cũ", async () => {
    stubFetch(async () => json({
        transactions: [
            { type: "OUT", amount: 999999, description: "SHOPXXXX9999", transactionID: "t1" },
            { type: "IN", amount: 10000, description: "SHOPYYYY8888", transactionID: "t2" },
        ],
    }));
    const items = await fetchBankHistory(CFG);
    assert.equal(items.length, 1);
    assert.equal(items[0].content, "SHOPYYYY8888");
});

test("empty-OK → trả [] ngay, KHÔNG fallback", async () => {
    stubFetch(async () => json({ status: "success", transactions: [] }));
    const items = await fetchBankHistory(CFG);
    assert.deepEqual(items, []);
    assert.equal(calls.length, 1);
});

test("mảng rỗng trơn cũng là empty-OK", async () => {
    stubFetch(async () => json([]));
    assert.deepEqual(await fetchBankHistory(CFG), []);
});

// ─── Lỗi mạng: giữ ngữ nghĩa cũ (báo lỗi của attempt ĐẦU) ─────────────────────────

test("fetch ném (timeout) → ném lỗi đầu tiên, và ĐÃ thử cả 3 attempt", async () => {
    stubFetch(async () => { throw new Error("The operation was aborted due to timeout"); });
    const err = await fetchBankHistory(CFG).then(() => null, (e) => e);
    assert.match(err.message, /aborted due to timeout/);
    assert.equal(calls.length, 3, "lỗi mạng thì fallback là đúng — provider có thể chấp nhận dạng URL khác");
});

test("HTTP 404 ở attempt đầu → lỗi báo cáo là 404 của attempt đầu", async () => {
    stubFetch(async () => json({ error: "not found" }, 404));
    const err = await fetchBankHistory(CFG).then(() => null, (e) => e);
    assert.match(err.message, /HTTP 404/);
});

test("attempt đầu lỗi mạng, attempt hai có dữ liệu → vẫn dùng được", async () => {
    let n = 0;
    stubFetch(async () => {
        n += 1;
        if (n === 1) throw new Error("network down");
        return json({ transactions: [{ amount: 5000, description: "SHOPZZZZ1111", transactionID: "t9" }] });
    });
    const items = await fetchBankHistory(CFG);
    assert.equal(items.length, 1);
    assert.equal(items[0].content, "SHOPZZZZ1111");
});

// ─── buildHistoryUrl: token nằm ở PATH, không phải query ───────────────────────────

test("buildHistoryUrl nối token vào path (đây là dạng provider chấp nhận)", () => {
    assert.equal(
        buildHistoryUrl("https://provider.test/hist", "abc123"),
        "https://provider.test/hist/abc123",
    );
});

test("buildHistoryUrl không nhân đôi token nếu base đã có sẵn", () => {
    assert.equal(
        buildHistoryUrl("https://provider.test/hist/abc123", "abc123"),
        "https://provider.test/hist/abc123",
    );
});

test("buildHistoryUrl hỗ trợ mẫu {token}", () => {
    assert.equal(
        buildHistoryUrl("https://provider.test/hist/{token}/x", "abc123"),
        "https://provider.test/hist/abc123/x",
    );
});

test("URL gửi đi KHÔNG in token ra log lỗi khi 404", async () => {
    // `fetchJson` ném `HTTP 404 @ <url>` mà url có token dạng query ở attempt 2/3.
    // Chốt lại để biết: nếu sau này log ra token thì test này đỏ.
    stubFetch(async () => json({}, 404));
    const err = await fetchBankHistory(CFG).then(() => null, (e) => e);
    assert.ok(err, "phải ném");
    assert.ok(
        !err.message.includes("tok-secret"),
        `lỗi attempt đầu dùng path-token nên không lộ; thực tế: ${err.message}`,
    );
});
