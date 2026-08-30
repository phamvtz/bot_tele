import test, { mock } from "node:test";
import assert from "node:assert/strict";

// Server thật (api.xpiki.com) ĐÒI fallback_allowed_groups: thiếu field thì trả
// HTTP 200 + {"code":40000,"message":"fallback_allowed_groups is required"} →
// mọi đơn key đều hoàn tiền (đơn 8D664972, 2026-08-30). createApiKey phải tự
// lấy danh sách group khi admin không cấu hình.
//
// gpt2api.js gọi prisma trong loadSettings() → mock để không cần DB.
const url = (path) => new URL(path, import.meta.url).href;

mock.module(url("../src/lib/prisma.js"), {
    defaultExport: {
        setting: { async findMany() { return []; } },
    },
});

process.env.GPT2API_BASE = "https://provider.test/api/admin-pub";
process.env.GPT2API_ADMIN_TOKEN = "adm_faketoken";
process.env.GPT2API_USER_ID = "user-1";
process.env.GPT2API_FALLBACK_GROUPS = "";

const gpt2api = await import("../src/gpt2api.js");
const { createApiKey, listModelGroups, invalidateGpt2apiGroups, invalidateGpt2apiConfig, buildCreateKeyBody } = gpt2api;

const GROUPS_OK = {
    code: 0,
    message: "ok",
    data: {
        list: [
            { public_id: "g-mortal", name: "Mortal", order_index: 100 },
            { public_id: "g-claude-go", name: "Claude-Go", order_index: 100 },
            { public_id: "g-first", name: "Zeta", order_index: 10 },
        ],
    },
};

// httpJson() dùng node:http/https chứ không dùng global fetch, nên không mock
// được bằng cách thay fetch. Chặn bằng một http server thật trên localhost:
// tất định, không ra mạng ngoài, và kiểm được đúng body đã gửi.
import { createServer } from "node:http";

let calls = [];
let handlers = {};

const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
        calls.push({
            method: req.method,
            path: req.url,
            auth: req.headers.authorization || "",
            body: body ? JSON.parse(body) : null,
        });
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
invalidateGpt2apiConfig();

test.after(() => server.close());

function reset({ groups = GROUPS_OK, groupsStatus = 200, createOk = true } = {}) {
    calls = [];
    invalidateGpt2apiGroups();
    invalidateGpt2apiConfig();
    handlers = {
        "GET /api/admin-pub/model-groups": () => ({ status: groupsStatus, payload: groups }),
        "POST /api/admin-pub/keys": (call) => {
            // Bắt chước server thật: thiếu fallback_allowed_groups là 40000.
            if (!call.body?.fallback_allowed_groups?.length) {
                return {
                    status: 200,
                    payload: {
                        code: 40000,
                        message: "fallback_allowed_groups is required: pick at least one fallback group",
                        trace_id: "t-1",
                    },
                };
            }
            if (!createOk) {
                return { status: 200, payload: { code: 50000, message: "boom", trace_id: "t-2" } };
            }
            return {
                status: 200,
                payload: { code: 0, message: "ok", data: { key: "sk-test-key-value", id: "k-1", key_prefix: "sk-test" }, trace_id: "t-3" },
            };
        },
    };
}

test("liệt kê được model group và sắp thứ tự tất định", async () => {
    reset();
    const res = await listModelGroups();

    assert.equal(res.ok, true);
    assert.deepEqual(res.groups.map((g) => g.id), ["g-first", "g-claude-go", "g-mortal"],
        "order_index nhỏ trước, cùng order thì theo tên — không phụ thuộc thứ tự server trả");
    assert.equal(calls[0].auth, "Bearer adm_faketoken", "token phải đi trong header, không phải query");
});

test("group được cache, không gọi lại provider mỗi đơn", async () => {
    reset();
    await listModelGroups();
    const after1 = calls.length;
    const second = await listModelGroups();

    assert.equal(second.cached, true);
    assert.equal(calls.length, after1, "lần hai phải lấy từ cache");
});

test("createApiKey tự lấy TẤT CẢ group khi admin không cấu hình", async () => {
    reset();
    const res = await createApiKey({ quotaTokens: 1_000_000, name: "t", rpm: 300, validDays: 0 });

    assert.equal(res.ok, true, `phải cấp được key, nhận: ${res.code} ${res.message}`);
    assert.equal(res.key, "sk-test-key-value");

    const post = calls.find((c) => c.method === "POST");
    assert.deepEqual(post.body.fallback_allowed_groups, ["g-first", "g-claude-go", "g-mortal"],
        "phải gửi hết group của tài khoản");
    assert.deepEqual(post.body.fallback_order, post.body.fallback_allowed_groups,
        "order phải khớp danh sách allowed");
});

test("admin cấu hình group thì KHÔNG gọi model-groups", async () => {
    reset();
    const res = await createApiKey({
        quotaTokens: 1_000_000, name: "t", rpm: 300, validDays: 0,
        fallbackGroups: ["g-chon-tay"],
    });

    assert.equal(res.ok, true);
    assert.equal(calls.some((c) => c.path.includes("model-groups")), false,
        "đã có group thì không cần hỏi provider");
    assert.deepEqual(calls.find((c) => c.method === "POST").body.fallback_allowed_groups, ["g-chon-tay"]);
});

test("không lấy được group → báo lỗi rõ, KHÔNG gửi request tạo key", async () => {
    reset({ groups: { code: 40100, message: "token hết hạn" } });
    const res = await createApiKey({ quotaTokens: 1_000_000, name: "t" });

    assert.equal(res.ok, false);
    assert.equal(res.code, 40100);
    assert.match(res.message, /token hết hạn/);
    assert.equal(calls.some((c) => c.method === "POST"), false,
        "biết trước sẽ 40000 thì đừng gọi provider — khách không phải chờ rồi hoàn tiền");
});

test("danh sách group rỗng cũng là lỗi, không phải cấp key không group", async () => {
    reset({ groups: { code: 0, message: "ok", data: { list: [] } } });
    const res = await createApiKey({ quotaTokens: 1_000_000, name: "t" });

    assert.equal(res.ok, false);
    assert.equal(res.code, "no_fallback_groups");
    assert.equal(calls.some((c) => c.method === "POST"), false);
});

test("danh sách rỗng KHÔNG bị cache — lần sau phải thử lại", async () => {
    reset({ groups: { code: 0, message: "ok", data: { list: [] } } });
    await listModelGroups();
    const after1 = calls.filter((c) => c.path.includes("model-groups")).length;

    handlers["GET /api/admin-pub/model-groups"] = () => ({ status: 200, payload: GROUPS_OK });
    const second = await listModelGroups();

    assert.equal(second.ok, true);
    assert.equal(second.groups.length, 3, "provider hồi phục thì phải lấy được ngay");
    assert.ok(
        calls.filter((c) => c.path.includes("model-groups")).length > after1,
        "rỗng thì không được cache, phải gọi lại",
    );
});

test("buildCreateKeyBody vẫn thuần: rỗng thì bỏ field", () => {
    // Hàm thuần không tự đi lấy group — đó là việc của createApiKey. Giữ nguyên
    // để test được không cần mạng.
    const body = buildCreateKeyBody({ userId: "u", name: "n", quotaTokens: 1_000_000, fallbackGroups: [] });
    assert.equal("fallback_allowed_groups" in body, false);
    assert.equal("fallback_order" in body, false);
});
