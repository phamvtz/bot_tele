import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

/**
 * Đọc danh sách key từ provider. `GET /keys` PHÂN TRANG (mặc định 20/trang) và
 * caller hiểu "không có trong danh sách" = "key đã bị xoá bên provider" — nên
 * danh sách thiếu không được phép đi tiếp dưới dạng thành công: notifier sẽ ghi
 * notifyStage = DEAD và khách vĩnh viễn mất tin nhắc gia hạn cho key đó.
 */
const url = (path) => new URL(path, import.meta.url).href;

const settings = { rows: [] };
mock.module(url("../src/lib/prisma.js"), {
    defaultExport: { setting: { async findMany() { return settings.rows; } } },
});

process.env.GPT2API_BASE = "https://provider.test/api/admin-pub";
process.env.GPT2API_ADMIN_TOKEN = "adm_faketoken";
process.env.GPT2API_USER_ID = "user-1";

const { listKeyStatuses, listKeyStatusesCached, invalidateKeyStatusCache, invalidateGpt2apiConfig } =
    await import("../src/gpt2api.js");

let pages = [];   // pages[i] = mảng key trả cho trang i+1
let declaredTotal = null;
let requests = [];

const server = createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
        const u = new URL(req.url, "http://x");
        requests.push(u.search);
        const page = Number(u.searchParams.get("page")) || 1;
        const list = pages[page - 1] || [];
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
            code: 0,
            data: {
                list,
                page,
                page_size: Number(u.searchParams.get("page_size")) || 20,
                ...(declaredTotal === null ? {} : { total: declaredTotal }),
            },
        }));
    });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
process.env.GPT2API_BASE = `http://127.0.0.1:${server.address().port}/api/admin-pub`;
invalidateGpt2apiConfig();
test.after(() => server.close());

/** n key giả, đánh số từ `from`. */
const makeKeys = (from, n) => Array.from({ length: n }, (_, i) => ({
    public_id: `k${from + i}`, name: `key-${from + i}`,
    quota_limit: 1000, quota_used: 10, rpm: 100, tpm: 0, enabled: true,
}));

function setup({ pageList, total }) {
    pages = pageList;
    declaredTotal = total;
    requests = [];
    invalidateKeyStatusCache();
    invalidateGpt2apiConfig();
}

test("đọc HẾT các trang, không dừng ở trang đầu", async () => {
    // Đây là bug gốc: bản đầu không gửi page/page_size nên chỉ nhận 20/382 key,
    // và 362 key thật suýt bị đánh dấu đã chết.
    setup({ pageList: [makeKeys(1, 100), makeKeys(101, 100), makeKeys(201, 100), makeKeys(301, 82)], total: 382 });
    const r = await listKeyStatuses();
    assert.equal(r.ok, true);
    assert.equal(r.byId.size, 382);
    assert.equal(requests.length, 4, "phải gọi đủ 4 trang");
    assert.match(requests[0], /page=1&page_size=100/);
});

test("trang bị DỊCH giữa lúc đọc (key mới chèn lên đầu) → báo đọc thiếu", async () => {
    // Danh sách xếp key mới nhất trước. Một key được tạo giữa lúc đọc → mọi thứ
    // dịch xuống một dòng: dòng cuối trang 1 lặp lại ở đầu trang 2, và key cuối
    // cùng bị đẩy ra ngoài, không bao giờ đọc được.
    //
    // Bẫy: tổng SỐ DÒNG nhận được vẫn đúng bằng total nhờ bản trùng. Đếm bằng
    // số dòng thay vì số key phân biệt là chốt này im lặng cho qua, rồi key bị
    // bỏ sót lãnh án notifyStage = DEAD.
    setup({
        pageList: [makeKeys(1, 100), [makeKeys(100, 1)[0], ...makeKeys(101, 99)]],
        total: 200,
    });
    const r = await listKeyStatuses();
    assert.equal(r.ok, false, "đọc thiếu một key mà vẫn báo thành công");
    assert.equal(r.code, "incomplete");
    assert.equal(r.byId.size, 0, "thất bại thì trả map RỖNG, không trả danh sách một phần");
    assert.match(r.message, /199\/200/);
});

test("server cắt ngang giữa chừng → báo đọc thiếu, không trả một phần", async () => {
    setup({ pageList: [makeKeys(1, 100), makeKeys(101, 50)], total: 382 });
    const r = await listKeyStatuses();
    assert.equal(r.ok, false);
    assert.equal(r.code, "incomplete");
    assert.equal(r.byId.size, 0);
});

test("kho nhỏ hơn một trang thì chỉ tốn một request", async () => {
    setup({ pageList: [makeKeys(1, 7)], total: 7 });
    const r = await listKeyStatuses();
    assert.equal(r.ok, true);
    assert.equal(r.byId.size, 7);
    assert.equal(requests.length, 1);
});

test("provider không khai báo total thì vẫn đọc được, không báo thiếu oan", async () => {
    setup({ pageList: [makeKeys(1, 100), makeKeys(101, 20)], total: null });
    const r = await listKeyStatuses();
    assert.equal(r.ok, true);
    assert.equal(r.byId.size, 120);
});

test("số liệu đầy đủ được lấy từ CHÍNH danh sách, không cần request riêng", async () => {
    // Nhờ vậy bảng admin dựng được cột tpm / effective / dùng lần cuối cho hàng
    // trăm key mà không phải gọi mỗi key một lần.
    setup({
        pageList: [[{
            public_id: "k1", name: "order-ABC", quota_limit: 15_000_000, quota_used: 8_932_130,
            rpm: 100, tpm: 0, effective_rpm: 100, effective_tpm: 100_000_000, enabled: true,
            expires_at: { Time: "2026-09-06T23:09:29+07:00", Valid: true },
            last_used_at: { Time: "2026-09-06T00:07:44+07:00", Valid: true },
            last_used_ip: "14.177.230.194",
            lock_reason: { String: "", Valid: false },
        }]],
        total: 1,
    });
    const k = (await listKeyStatuses()).byId.get("k1");
    assert.equal(k.quotaUsed, 8_932_130);
    assert.equal(k.tpm, 0);
    assert.equal(k.effectiveTpm, 100_000_000);
    assert.equal(k.lastUsedIp, "14.177.230.194");
    assert.equal(k.lockReason, "", "NullString Valid=false phải ra chuỗi rỗng, không phải 'undefined'");
    assert.ok(k.expiresAt.startsWith("2026-09-06"));
});

// === Cache ================================================================

test("cache tránh đọc lại 4 trang mỗi lần khách bấm nút", async () => {
    setup({ pageList: [makeKeys(1, 30)], total: 30 });
    await listKeyStatusesCached();
    const after1 = requests.length;
    await listKeyStatusesCached();
    assert.equal(requests.length, after1, "lượt thứ hai phải lấy từ cache");
});

test("KHÔNG cache lần đọc hỏng — một lỗi thoáng qua không được kéo dài cả phút", async () => {
    setup({ pageList: [makeKeys(1, 100), makeKeys(101, 10)], total: 382 });
    const bad = await listKeyStatusesCached();
    assert.equal(bad.ok, false);
    const after = requests.length;
    await listKeyStatusesCached();
    assert.ok(requests.length > after, "lần hỏng bị cache → cả phút sau nhìn đâu cũng thấy 'không có số liệu'");
});

test("invalidateKeyStatusCache buộc đọc lại — dùng ngay sau khi gia hạn", async () => {
    // Không có bước này thì khách vừa trả tiền gia hạn, mở /mykey vẫn thấy key
    // gạch ngang "đã hết" theo số cũ trong cache.
    setup({ pageList: [makeKeys(1, 5)], total: 5 });
    await listKeyStatusesCached();
    const after = requests.length;
    invalidateKeyStatusCache();
    await listKeyStatusesCached();
    assert.ok(requests.length > after, "xoá cache rồi mà vẫn trả bản cũ");
});
