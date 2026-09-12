import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

// `setApiKeyEnabled` là đường duy nhất để Seller API thu hồi / mở lại một key.
// Hai tính chất phải giữ:
//
//   1. ĐỌC LẠI SAU KHI PATCH. Provider xpiki trả `code: 0` kể cả khi nó BỎ QUA field
//      — đó là lý do `renewApiKey` phải xác nhận bằng cách đọc lại. Tin `code: 0` ở
//      đây thì seller nhận "đã thu hồi" trong khi key của khách vẫn đang chạy, và
//      shop vẫn bị trừ quota cho một key tưởng đã cắt.
//   2. CHỈ gửi `{enabled}`. Gửi kèm field khác là âm thầm đổi quota/hạn của một key
//      mà seller chỉ xin bật/tắt.

const url = (p) => new URL(p, import.meta.url).href;
const settings = { rows: [] };

mock.module(url("../src/lib/prisma.js"), {
    defaultExport: { setting: { async findMany() { return settings.rows; } } },
});

const gpt2api = await import("../src/gpt2api.js");
const { setApiKeyEnabled, invalidateGpt2apiConfig } = gpt2api;

let calls = [];
let handlers = {};

const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
        calls.push({ method: req.method, path: req.url, body: body ? JSON.parse(body) : null });
        const key = `${req.method} ${req.url.split("?")[0]}`;
        const handler = handlers[key];
        if (!handler) {
            res.writeHead(404, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ code: 40400, message: `no handler for ${key}` }));
        }
        const { status = 200, payload } = handler(calls[calls.length - 1]);
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(typeof payload === "string" ? payload : JSON.stringify(payload));
    });
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
process.env.GPT2API_BASE = `http://127.0.0.1:${port}/api/admin-pub`;
process.env.GPT2API_ADMIN_TOKEN = "adm_faketoken";
process.env.GPT2API_USER_ID = "user-1";
invalidateGpt2apiConfig();

test.after(() => server.close());

const EXT = "ext-uuid-1";
const readPath = `/api/admin-pub/keys/${EXT}`;

/** `enabledState` = giá trị provider sẽ trả khi bị đọc lại sau PATCH. */
function setup({ enabledState = false, patchCode = 0, readCode = 0, readFails = false } = {}) {
    calls = [];
    handlers = {
        [`PATCH ${readPath}`]: () => ({ payload: { code: patchCode, message: patchCode === 0 ? "ok" : "lỗi provider" } }),
        [`GET ${readPath}`]: () => (readFails
            ? { status: 500, payload: { code: 50000, message: "đọc hỏng" } }
            : {
                payload: {
                    code: readCode,
                    data: {
                        public_id: EXT, name: "k", quota_limit: 300_000, quota_used: 10,
                        enabled: enabledState, rpm: 600, tpm: 0, expires_at: null,
                    },
                },
            }),
    };
}

test("tắt key: PATCH rồi đọc lại xác nhận, trả trạng thái provider ĐANG giữ", async () => {
    setup({ enabledState: false });
    const r = await setApiKeyEnabled({ externalId: EXT, enabled: false });
    assert.equal(r.ok, true);
    assert.equal(r.enabled, false);

    const patch = calls.find((c) => c.method === "PATCH");
    assert.ok(patch, "phải có một lệnh PATCH");
    assert.deepEqual(patch.body, { enabled: false }, "chỉ gửi {enabled} — không được kèm quota/hạn");
    assert.ok(calls.some((c) => c.method === "GET"), "phải đọc lại để xác nhận");
});

test("mở lại key cũng đi qua đúng một đường", async () => {
    setup({ enabledState: true });
    const r = await setApiKeyEnabled({ externalId: EXT, enabled: true });
    assert.equal(r.ok, true);
    assert.equal(r.enabled, true);
    assert.deepEqual(calls.find((c) => c.method === "PATCH").body, { enabled: true });
});

test("provider trả code 0 nhưng BỎ QUA field → báo lỗi, không báo thành công", async () => {
    // Xin tắt nhưng đọc lại vẫn thấy enabled: true. Đây đúng là hành vi đã được ghi
    // nhận của xpiki với các field lạ — và là lý do không được tin mỗi code 0.
    setup({ enabledState: true });
    const r = await setApiKeyEnabled({ externalId: EXT, enabled: false });
    assert.equal(r.ok, false);
    assert.equal(r.code, "enabled_not_applied");
    assert.equal(r.enabled, true, "phải trả trạng thái THẬT để caller không ghi sai vào DB");
});

test("provider từ chối (code khác 0) thì báo lỗi ngay, không cần đọc lại", async () => {
    setup({ patchCode: 40300 });
    const r = await setApiKeyEnabled({ externalId: EXT, enabled: false });
    assert.equal(r.ok, false);
    assert.equal(r.code, 40300, "mã provider phải được giữ nguyên để caller phân loại");
    assert.ok(!calls.some((c) => c.method === "GET"), "PATCH đã thất bại thì đọc lại là thừa");
});

test("PATCH xong mà đọc lại hỏng → báo lỗi, KHÔNG suy ra thành công", async () => {
    // Không biết lệnh có ăn hay không. Trả ok:true ở đây là nói dối seller.
    setup({ readFails: true });
    const r = await setApiKeyEnabled({ externalId: EXT, enabled: false });
    assert.equal(r.ok, false);
    assert.ok(calls.some((c) => c.method === "PATCH"), "PATCH đã bay đi rồi");
});

test("thiếu externalId / chưa cấu hình thì báo lỗi rõ, không gọi provider", async () => {
    setup();
    const noId = await setApiKeyEnabled({ externalId: "", enabled: false });
    assert.equal(noId.ok, false);
    assert.equal(noId.code, "no_external_id");
    assert.equal(noId.enabled, undefined, "không được bịa trạng thái");

    const blank = await setApiKeyEnabled({ externalId: "   ", enabled: false });
    assert.equal(blank.code, "no_external_id");
    assert.equal(calls.length, 0, "không được gọi provider khi biết trước sẽ hỏng");
});

test("enabled mặc định là true và chỉ `false` tường minh mới tắt", async () => {
    // `enabled: undefined` / `0` / `""` đều không được hiểu là "tắt" — một caller gửi
    // thiếu field mà làm key của khách chết là lỗi rất khó truy.
    setup({ enabledState: true });
    const r = await setApiKeyEnabled({ externalId: EXT });
    assert.deepEqual(calls.find((c) => c.method === "PATCH").body, { enabled: true });
    assert.equal(r.ok, true);

    for (const value of [0, "", null, undefined]) {
        calls = [];
        await setApiKeyEnabled({ externalId: EXT, enabled: value });
        assert.deepEqual(calls.find((c) => c.method === "PATCH").body, { enabled: true }, `enabled=${JSON.stringify(value)} phải thành true`);
    }
});

test("externalId được encode trước khi đưa vào URL", async () => {
    const weird = "id có dấu/../nguy hiểm";
    calls = [];
    handlers = {
        [`PATCH /api/admin-pub/keys/${encodeURIComponent(weird)}`]: () => ({ payload: { code: 0 } }),
        [`GET /api/admin-pub/keys/${encodeURIComponent(weird)}`]: () => ({
            payload: { code: 0, data: { public_id: weird, enabled: false, quota_limit: 0, quota_used: 0 } },
        }),
    };
    const r = await setApiKeyEnabled({ externalId: weird, enabled: false });
    assert.equal(r.ok, true);
    // Không được để "../" thoát khỏi path.
    assert.ok(!calls.some((c) => c.path.includes("/../")), `path không được chứa ../: ${calls.map((c) => c.path).join(", ")}`);
});
