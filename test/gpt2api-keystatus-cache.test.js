import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

// "API key của tôi" từng treo 12–15 giây mỗi lần cache hết hạn: bot đọc TOÀN BỘ key của
// shop (3.269 key = 33 trang) tuần tự. Test này khoá bốn hành vi sửa lỗi:
//   1. đọc các trang song song nhưng vẫn KHÔNG trả danh sách thiếu;
//   2. single-flight — nhiều người bấm cùng lúc chỉ tốn MỘT lượt quét;
//   3. stale-while-revalidate — có số liệu cũ thì trả ngay, làm mới ngầm;
//   4. sau gia hạn (invalidate) một lượt đọc đang bay không được ghi lại bản cũ.

const url = (path) => new URL(path, import.meta.url).href;
mock.module(url("../src/lib/prisma.js"), {
    defaultExport: { setting: { async findMany() { return []; } } },
});

process.env.GPT2API_BASE = "https://provider.test/api/admin-pub";
process.env.GPT2API_ADMIN_TOKEN = "adm_faketoken";
process.env.GPT2API_USER_ID = "user-1";
// Mặc định đọc TUẦN TỰ (provider giới hạn tốc độ). Các test song song bên dưới bật có chủ đích.
process.env.GPT2API_KEY_LIST_PARALLEL = "4";

const gpt2api = await import("../src/gpt2api.js");
const {
    listKeyStatuses, listKeyStatusesCached, peekKeyStatuses, invalidateKeyStatusCache,
    getKeyStatusesFor, invalidateGpt2apiConfig,
} = gpt2api;

const PAGE = 100;
let total = 350;
let delayMs = 0;
let failPage = null;
let calls = [];
let inflight = 0;
let maxInflight = 0;
let keyDelayMs = 0;
let limitNext = 0; // số request đầu tiên bị trả 42900 "too many requests"

const rowOf = (i) => ({
    public_id: `pub-${i}`, name: `order-${i}`, quota_limit: 1000 + i, quota_used: i,
    expires_at: "2026-12-01T00:00:00Z", enabled: true, rpm: 100, tpm: 0,
    created_at: "2026-10-01T00:00:00Z",
});

const server = createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    calls.push(u.pathname + u.search);
    inflight += 1;
    maxInflight = Math.max(maxInflight, inflight);
    if (limitNext > 0) {
        limitNext -= 1;
        inflight -= 1;
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ code: 42900, message: "too many requests, slow down" }));
    }
    const finish = (status, payload) => {
        inflight -= 1;
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
    };
    const m = u.pathname.match(/\/keys\/(.+)$/);
    if (m) {
        return setTimeout(() => {
            const id = decodeURIComponent(m[1]);
            if (id === "missing") return finish(200, { code: 40400, message: "not found" });
            const i = Number(id.replace("pub-", ""));
            finish(200, { code: 0, data: rowOf(i) });
        }, keyDelayMs);
    }
    const page = Number(u.searchParams.get("page") || 1);
    setTimeout(() => {
        if (failPage === page) return finish(500, { code: 50000, message: "boom" });
        const start = (page - 1) * PAGE;
        const list = [];
        for (let i = start; i < Math.min(total, start + PAGE); i++) list.push(rowOf(i));
        finish(200, { code: 0, data: { list, total } });
    }, delayMs);
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
process.env.GPT2API_BASE = `http://127.0.0.1:${server.address().port}/api/admin-pub`;
invalidateGpt2apiConfig();
test.after(() => server.close());

function reset(over = {}) {
    total = over.total ?? 350;
    delayMs = over.delayMs ?? 0;
    keyDelayMs = over.keyDelayMs ?? 0;
    failPage = over.failPage ?? null;
    limitNext = over.limitNext ?? 0;
    calls = [];
    inflight = 0;
    maxInflight = 0;
    invalidateKeyStatusCache();
    invalidateGpt2apiConfig();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("đọc song song: đủ mọi key, mỗi trang đúng MỘT lần, và thật sự có chạy đồng thời", async () => {
    reset({ total: 950, delayMs: 30 }); // 10 trang
    const r = await listKeyStatuses(null);
    assert.equal(r.ok, true);
    assert.equal(r.byId.size, 950);
    assert.equal(r.total, 950);
    const pages = calls.map((c) => Number(new URL(c, "http://x").searchParams.get("page"))).sort((a, b) => a - b);
    assert.deepEqual(pages, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "mỗi trang đọc đúng một lần");
    assert.ok(maxInflight > 1, `phải có request chạy đồng thời, maxInflight=${maxInflight}`);
    assert.ok(maxInflight <= 4, `không được vượt mức song song cấu hình (4), maxInflight=${maxInflight}`);
});

test("song song thì nhanh hơn rõ rệt so với tuần tự", async () => {
    reset({ total: 1000, delayMs: 60 }); // 10 trang × 60ms: tuần tự ≈ 600ms
    const t0 = Date.now();
    await listKeyStatuses(null);
    const ms = Date.now() - t0;
    assert.ok(ms < 450, `đọc 10 trang mất ${ms}ms — tuần tự sẽ ≈ 600ms+`);
});

test("một trang lỗi → CẢ lượt lỗi, tuyệt đối không trả danh sách thiếu", async () => {
    reset({ total: 450, failPage: 3 });
    const r = await listKeyStatuses(null);
    assert.equal(r.ok, false);
    assert.equal(r.byId.size, 0, "danh sách một phần sẽ khiến notifier khai tử nhầm key thật");
});

test("ít hơn một trang thì chỉ đọc đúng một request", async () => {
    reset({ total: 42 });
    const r = await listKeyStatuses(null);
    assert.equal(r.ok, true);
    assert.equal(r.byId.size, 42);
    assert.equal(calls.length, 1);
});

test("single-flight: 5 người bấm cùng lúc dùng CHUNG một lượt quét", async () => {
    reset({ total: 300, delayMs: 40 });
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => listKeyStatusesCached(null, 60_000)));
    assert.ok(results.every((x) => x.ok && x.byId.size === 300));
    assert.equal(calls.length, 3, "một lượt quét = 3 trang, không phải 15");
});

test("cache còn hạn: không gọi mạng", async () => {
    reset({ total: 120 });
    await listKeyStatusesCached(null, 60_000);
    const before = calls.length;
    const again = await listKeyStatusesCached(null, 60_000);
    assert.equal(again.ok, true);
    assert.equal(calls.length, before);
    assert.ok(peekKeyStatuses(null).ageMs < 1000);
});

test("stale-while-revalidate: cache cũ trả NGAY, làm mới ngầm ở nền", async () => {
    reset({ total: 200, delayMs: 80 });
    await listKeyStatusesCached(null, 60_000);
    const callsAfterFirst = calls.length;
    await sleep(25);
    // ttl 10ms (đã quá hạn) nhưng staleMs rộng → phải trả ngay, không chờ 160ms+ của lượt quét mới
    const t0 = Date.now();
    const stale = await listKeyStatusesCached(null, 10, { staleMs: 60_000 });
    assert.ok(Date.now() - t0 < 40, `trả bản cũ phải tức thì, mất ${Date.now() - t0}ms`);
    assert.equal(stale.ok, true);
    await sleep(400); // chờ lượt làm mới ngầm xong
    assert.ok(calls.length > callsAfterFirst, "phải có lượt làm mới ngầm");
});

test("không có staleMs (hành vi cũ): quá hạn thì CHỜ bản mới", async () => {
    reset({ total: 100, delayMs: 60 });
    await listKeyStatusesCached(null, 60_000);
    await sleep(15);
    const t0 = Date.now();
    await listKeyStatusesCached(null, 5);
    assert.ok(Date.now() - t0 >= 50, "trang admin cần số liệu tươi nên phải chờ");
});

test("lượt đọc lỗi KHÔNG được cache", async () => {
    reset({ total: 250, failPage: 2 });
    const bad = await listKeyStatusesCached(null, 60_000);
    assert.equal(bad.ok, false);
    assert.equal(peekKeyStatuses(null), null);
    failPage = null;
    const good = await listKeyStatusesCached(null, 60_000);
    assert.equal(good.ok, true);
});

test("sau gia hạn (invalidate) lượt đọc ĐANG BAY không ghi lại bản cũ vào cache", async () => {
    reset({ total: 100, delayMs: 120 });
    const running = listKeyStatusesCached(null, 60_000); // bắt đầu đọc bản trước gia hạn
    await sleep(30);
    invalidateKeyStatusCache(); // khách vừa gia hạn xong
    await running;
    assert.equal(peekKeyStatuses(null), null, "bản đọc từ trước gia hạn không được vào cache — khách sẽ thấy 'đã hết' dù đã trả tiền");
});

test("getKeyStatusesFor: chỉ hỏi đúng key được yêu cầu, không quét cả shop", async () => {
    reset({ total: 5000, keyDelayMs: 20 });
    const r = await getKeyStatusesFor([
        { externalId: "pub-1" }, { externalId: "pub-2" }, { externalId: "pub-3" },
    ]);
    assert.equal(r.ok, true);
    assert.equal(r.byId.size, 3);
    assert.equal(r.partial, false);
    assert.ok(calls.every((c) => /\/keys\/pub-\d$/.test(c)), `không được gọi danh sách: ${calls.join(" | ")}`);
    assert.equal(r.byId.get("pub-2").quotaLimit, 1002);
});

test("getKeyStatusesFor: key không tồn tại / lỗi không làm hỏng cả lô", async () => {
    reset({ total: 10 });
    const r = await getKeyStatusesFor([{ externalId: "pub-1" }, { externalId: "missing" }, { externalId: "pub-4" }]);
    assert.equal(r.byId.size, 2);
    assert.equal(r.partial, true);
    assert.ok(r.byId.has("pub-1") && r.byId.has("pub-4"));
});

test("getKeyStatusesFor: hết ngân sách thời gian thì trả phần đã có (partial) thay vì treo", async () => {
    reset({ total: 10, keyDelayMs: 400 });
    const items = Array.from({ length: 12 }, (_, i) => ({ externalId: `pub-${i}` }));
    const t0 = Date.now();
    const r = await getKeyStatusesFor(items, { concurrency: 2, budgetMs: 700 });
    const ms = Date.now() - t0;
    assert.ok(ms < 1300, `phải dừng quanh ngân sách 700ms, thực tế ${ms}ms`);
    assert.equal(r.partial, true);
    assert.ok(r.byId.size < items.length);
});

test("getKeyStatusesFor: danh sách rỗng / thiếu externalId không gọi mạng", async () => {
    reset();
    assert.equal((await getKeyStatusesFor([])).byId.size, 0);
    assert.equal((await getKeyStatusesFor([{ profileId: 1 }, null, {}])).byId.size, 0);
    assert.equal(calls.length, 0);
});

test("provider bảo 'chậm lại' (42900) → lùi rồi thử lại, KHÔNG bỏ cả lượt đọc", async () => {
    reset({ total: 150, limitNext: 1 }); // request đầu bị giới hạn, sau đó bình thường
    const t0 = Date.now();
    const r = await listKeyStatuses(null);
    assert.equal(r.ok, true, "một lần bị giới hạn thoáng qua không được làm hỏng lượt đọc");
    assert.equal(r.byId.size, 150);
    assert.ok(Date.now() - t0 >= 1000, "phải lùi trước khi thử lại (không dồn thêm request)");
});

test("bị giới hạn tốc độ kéo dài → trả lỗi (không treo, không trả thiếu) sau số lần lùi hữu hạn", async () => {
    reset({ total: 150, limitNext: 100 });
    const r = await listKeyStatuses(null);
    assert.equal(r.ok, false);
    assert.equal(String(r.code), "42900");
    assert.equal(r.byId.size, 0);
});

test("getKeyStatusesFor: gặp 42900 thì DỪNG hẳn, không dồn thêm request vào provider đang quá tải", async () => {
    reset({ total: 10, limitNext: 100 });
    const items = Array.from({ length: 12 }, (_, i) => ({ externalId: `pub-${i}` }));
    const r = await getKeyStatusesFor(items, { concurrency: 3, budgetMs: 3000 });
    assert.equal(r.throttled, true);
    assert.equal(r.byId.size, 0);
    assert.ok(calls.length <= 3, `chỉ được bắn tối đa một đợt đầu (${calls.length} request)`);
});
