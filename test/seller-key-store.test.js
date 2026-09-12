import test, { mock } from "node:test";
import assert from "node:assert/strict";

// Tầng store của Seller Key API. Đây là nơi chứa hai bất biến tài chính:
//
//   1. HAI request cùng `clientRef` chỉ tạo được MỘT key. `POST /keys` gọi provider
//      sau khi claim, nên nếu claim không atomic thì mỗi lần client retry sau timeout
//      là một key sk-* thật nữa được sinh ra — tốn quota của shop, không hoàn lại được.
//   2. HAI request gia hạn song song chỉ một cái tới được `renewApiKey`. `quota_limit`
//      bên provider là số tuyệt đối và renewApiKey đọc-rồi-cộng, nên qua được hai lần
//      là khách nhận gấp đôi token miễn phí.
//
// Cả hai đều dựa vào hành vi của MongoDB (unique index, updateMany có điều kiện),
// nên prisma giả ở đây phải GIẢ ĐÚNG hai hành vi đó — kể cả chi tiết index sparse
// bỏ qua document thiếu field, thứ mà một fake "mọi dòng đều có clientRef" sẽ che mất.

const url = (p) => new URL(p, import.meta.url).href;

// ─── Prisma giả: một collection in-memory với unique index trên clientRef ────────
let rows = [];
let nextId = 0;
const duplicateError = () => Object.assign(new Error("E11000 duplicate key error collection: issuedApiKeys index: clientRef"), { code: 11000 });

/** Khớp `where` theo ngữ nghĩa Mongo mà adapter dịch ra. */
function matches(where = {}, row) {
    return Object.entries(where).every(([key, cond]) => {
        const actual = row[key];
        if (cond === null) return actual === null || actual === undefined;
        if (cond && typeof cond === "object" && !(cond instanceof Date)) {
            if ("in" in cond) return cond.in.includes(actual);
            if ("gte" in cond && !(actual >= cond.gte)) return false;
            if ("lt" in cond && !(actual < cond.lt)) return false;
            return true;
        }
        const c = cond instanceof Date ? +cond : cond;
        const a = actual instanceof Date ? +actual : actual;
        return a === c;
    });
}

function applyData(row, data = {}) {
    for (const [k, v] of Object.entries(data)) {
        if (v && typeof v === "object" && !(v instanceof Date) && "increment" in v) {
            row[k] = (Number(row[k]) || 0) + Number(v.increment);
        } else {
            row[k] = v;
        }
    }
    return row;
}

const issuedApiKey = {
    async create({ data }) {
        // UNIQUE SPARSE INDEX trên clientRef: chỉ những document CÓ field này mới bị
        // ràng buộc. Thiếu field (mọi key do bot/admin/giftcode cấp) thì bao nhiêu
        // dòng cũng được — đúng như index sparse thật.
        if (data.clientRef !== undefined && data.clientRef !== null) {
            if (rows.some((r) => r.clientRef === data.clientRef)) throw duplicateError();
        }
        const row = {
            id: `key-${++nextId}`,
            renewCount: 0, lastRenewAt: null, notifyStage: 0, notifyAt: null,
            rpm: 0, source: "PURCHASE", models: [], expiresAt: null, priceUsd: null,
            sellerKeyId: null, sellerKeyName: "", renewWipAt: null, lastRenewRef: null,
            hiddenAt: null, createdAt: new Date(),
            ...data,
        };
        rows.push(row);
        return { ...row };
    },
    async findFirst({ where }) {
        const hit = rows.find((r) => matches(where, r));
        return hit ? { ...hit } : null;
    },
    async findMany({ where, orderBy, take, skip, select } = {}) {
        let out = rows.filter((r) => matches(where, r));
        if (orderBy?.createdAt === "desc") out = [...out].sort((a, b) => +b.createdAt - +a.createdAt);
        if (orderBy?.createdAt === "asc") out = [...out].sort((a, b) => +a.createdAt - +b.createdAt);
        if (skip) out = out.slice(skip);
        if (take) out = out.slice(0, take);
        out = out.map((r) => ({ ...r }));
        if (select) out = out.map((r) => Object.fromEntries(Object.keys(select).map((k) => [k, r[k]])));
        return out;
    },
    async count({ where }) {
        return rows.filter((r) => matches(where, r)).length;
    },
    async update({ where, data }) {
        const row = rows.find((r) => matches(where, r));
        if (!row) return null;
        return { ...applyData(row, data) };
    },
    async updateMany({ where, data }) {
        const hit = rows.filter((r) => matches(where, r));
        for (const row of hit) applyData(row, data);
        return { count: hit.length };
    },
    async delete({ where }) {
        const i = rows.findIndex((r) => matches(where, r));
        if (i < 0) return null;
        return rows.splice(i, 1)[0];
    },
};

const prisma = { issuedApiKey };
mock.module(url("../src/lib/prisma.js"), { defaultExport: prisma, namedExports: { prisma } });

const store = await import("../src/apikey-store.js");
const {
    claimSellerKeySlot, finalizeSellerKeySlot, discardSellerKeySlot,
    getSellerIssuedKey, listSellerIssuedKeys, countSellerIssuedKeys,
    claimSellerKeyRenew, releaseSellerKeyRenew, finalizeSellerKeyRenew,
    sellerUsageSince, KeySource,
} = store;

const reset = () => { rows = []; nextId = 0; };

const slot = (over = {}) => ({
    telegramId: "777888999",
    quotaTokens: 20_000_000,
    sellerKeyId: "seller1",
    sellerKeyName: "Nhà cung cấp A",
    clientRef: "order-8891",
    profileId: 1,
    ...over,
});

// ─── 1. Claim tạo key ───────────────────────────────────────────────────────────

test("claim tạo một dòng tạm: key rỗng, ẨN khỏi /mykey, nguồn SELLER, scope đúng seller", async () => {
    reset();
    const r = await claimSellerKeySlot(slot());
    assert.equal(r.claimed, true);
    assert.equal(r.row.key, "", "chưa có key thật — provider chưa được gọi");
    assert.ok(r.row.hiddenAt instanceof Date, "phải ẩn ngay, nếu không khách thấy một key rỗng trong /mykey");
    assert.equal(r.row.source, KeySource.SELLER);
    assert.equal(r.row.sellerKeyId, "seller1");
    assert.equal(r.row.clientRef, "seller1:order-8891", "clientRef phải được namespace theo seller");
    assert.equal(r.row.telegramId, "777888999");
    assert.equal(r.row.quotaTokens, 20_000_000);
});

test("HAI claim cùng clientRef: đúng một cái thắng, cái thua KHÔNG được tạo key thứ hai", async () => {
    reset();
    // Chạy song song thật — đây chính là hình dạng của một client retry trong lúc
    // request đầu còn đang chờ provider.
    const [a, b] = await Promise.all([claimSellerKeySlot(slot()), claimSellerKeySlot(slot())]);
    const won = [a, b].filter((x) => x.claimed);
    const lost = [a, b].filter((x) => !x.claimed);
    assert.equal(won.length, 1, "chỉ một claim được chấp nhận");
    assert.equal(lost.length, 1);
    assert.equal(lost[0].duplicate, true);
    assert.equal(lost[0].row.id, won[0].row.id, "bên thua phải trỏ tới dòng của bên thắng");
    assert.equal(rows.length, 1, "chỉ MỘT dòng được tạo — bên thua không để lại rác");
});

// Không có clientRef thì không có gì để chống trùng — đó là hành vi cố ý và được
// nói rõ trong docs: client không gửi clientRef thì tự chịu rủi ro retry. Điều quan
// trọng là store KHÔNG bịa ra một ref mặc định, vì mọi key không-có-ref sẽ đụng nhau
// trên unique index và endpoint chết ngay từ lần cấp thứ hai.
test("hai claim không clientRef tạo hai dòng riêng", async () => {
    reset();
    const a = await claimSellerKeySlot(slot({ clientRef: null }));
    const b = await claimSellerKeySlot(slot({ clientRef: null }));
    assert.equal(a.claimed, true);
    assert.equal(b.claimed, true);
    assert.equal(a.clientRef, null);
    assert.equal(rows.length, 2);
});

test("hai seller dùng cùng một mã đơn của họ thì không đụng nhau", async () => {
    reset();
    const a = await claimSellerKeySlot(slot({ sellerKeyId: "seller1", clientRef: "order-1" }));
    const b = await claimSellerKeySlot(slot({ sellerKeyId: "seller2", clientRef: "order-1" }));
    assert.equal(a.claimed, true);
    assert.equal(b.claimed, true, "namespace theo seller nên hai bên độc lập");
});

test("clientRef đã dùng lại sau khi finalize vẫn nhận ra là trùng", async () => {
    // Ca thực tế nhất: request đầu THÀNH CÔNG, client không nhận được response (rớt
    // mạng) và retry. Lần hai phải trả dòng cũ, không cấp key mới.
    reset();
    const first = await claimSellerKeySlot(slot());
    await finalizeSellerKeySlot(first.row.id, { key: "sk-real-1", externalId: "ext-1", profileName: "S1" });
    const retry = await claimSellerKeySlot(slot());
    assert.equal(retry.claimed, false);
    assert.equal(retry.duplicate, true);
    assert.equal(retry.row.key, "sk-real-1");
    assert.equal(rows.length, 1);
});

// ─── 2. Finalize / discard ─────────────────────────────────────────────────────

test("finalize ghi key thật và MỞ khoá để khách thấy trong /mykey", async () => {
    reset();
    const c = await claimSellerKeySlot(slot());
    const saved = await finalizeSellerKeySlot(c.row.id, {
        key: "sk-real-key", externalId: "ext-uuid", expiresAt: "2026-12-31T00:00:00.000Z",
        quotaTokens: 20_000_000, rpm: 600, models: ["claude-opus-5"],
        profileId: 2, profileName: "Server rẻ", priceUsd: 3.5,
    });
    assert.equal(saved.key, "sk-real-key");
    assert.equal(saved.hiddenAt, null, "phải bỏ ẩn — đây là lúc key trở nên hiển thị với khách");
    assert.equal(saved.profileName, "Server rẻ");
    assert.equal(saved.priceUsd, 3.5, "giá phải được ghi lại để shop đối soát doanh thu seller");
    assert.deepEqual(saved.models, ["claude-opus-5"]);
});

test("discard xoá dòng tạm — provider từ chối thì không để lại rác", async () => {
    reset();
    const c = await claimSellerKeySlot(slot());
    assert.equal(rows.length, 1);
    await discardSellerKeySlot(c.row.id);
    assert.equal(rows.length, 0);
    // Xoá xong thì clientRef được giải phóng: seller sửa tham số rồi thử lại được.
    const again = await claimSellerKeySlot(slot());
    assert.equal(again.claimed, true);
});

// ─── 3. Scope theo seller ──────────────────────────────────────────────────────

test("getSellerIssuedKey KHÔNG trả key của seller khác", async () => {
    reset();
    const a = await claimSellerKeySlot(slot({ sellerKeyId: "seller1", clientRef: "a" }));
    await claimSellerKeySlot(slot({ sellerKeyId: "seller2", clientRef: "b", telegramId: "111222333" }));

    assert.ok(await getSellerIssuedKey(a.row.id, "seller1"), "chủ sở hữu đọc được");
    assert.equal(await getSellerIssuedKey(a.row.id, "seller2"), null, "seller khác KHÔNG đọc được");
    assert.equal(await getSellerIssuedKey(a.row.id, ""), null, "thiếu sellerKeyId cũng không đọc được");
    assert.equal(await getSellerIssuedKey("id-khong-ton-tai", "seller1"), null);
});

test("list/count chỉ thấy key của chính seller đó", async () => {
    reset();
    for (const [sid, ref] of [["seller1", "x1"], ["seller1", "x2"], ["seller2", "y1"]]) {
        await claimSellerKeySlot(slot({ sellerKeyId: sid, clientRef: ref }));
    }
    assert.equal(await countSellerIssuedKeys("seller1"), 2);
    assert.equal(await countSellerIssuedKeys("seller2"), 1);
    assert.equal((await listSellerIssuedKeys({ sellerKeyId: "seller1" })).length, 2);
    assert.equal((await listSellerIssuedKeys({ sellerKeyId: "seller2" })).length, 1);
    assert.equal((await listSellerIssuedKeys({ sellerKeyId: "seller1", limit: 1 })).length, 1);
});

test("list sắp MỚI NHẤT TRƯỚC và tôn trọng phân trang", async () => {
    reset();
    for (let i = 0; i < 5; i++) {
        await claimSellerKeySlot(slot({ clientRef: `r${i}` }));
        rows[rows.length - 1].createdAt = new Date(Date.UTC(2026, 8, 1 + i));
    }
    const page1 = await listSellerIssuedKeys({ sellerKeyId: "seller1", limit: 2, skip: 0 });
    const page2 = await listSellerIssuedKeys({ sellerKeyId: "seller1", limit: 2, skip: 2 });
    assert.equal(page1[0].clientRef, "seller1:r4", "mới nhất trước");
    assert.deepEqual(page1.map((r) => r.clientRef), ["seller1:r4", "seller1:r3"]);
    assert.deepEqual(page2.map((r) => r.clientRef), ["seller1:r2", "seller1:r1"]);
});

test("limit vượt trần bị kẹp, không cho kéo cả collection", async () => {
    reset();
    await claimSellerKeySlot(slot({ clientRef: "cap" }));
    const out = await listSellerIssuedKeys({ sellerKeyId: "seller1", limit: 100_000 });
    assert.equal(out.length, 1);
    assert.ok(store.SELLER_LIST_MAX <= 100, "trần phải ≤ 100 như các endpoint danh sách khác");
});

// ─── 4. Claim gia hạn ──────────────────────────────────────────────────────────

test("claim gia hạn: đúng MỘT trong hai request song song qua được", async () => {
    reset();
    const c = await claimSellerKeySlot(slot());
    await finalizeSellerKeySlot(c.row.id, { key: "sk-1", externalId: "ext-1" });

    const [a, b] = await Promise.all([
        claimSellerKeyRenew(c.row.id, "seller1", "seller1:renew-1"),
        claimSellerKeyRenew(c.row.id, "seller1", "seller1:renew-1"),
    ]);
    assert.notEqual(a, b, "chỉ một cái claim được — qua cả hai là khách nhận gấp đôi token");
    assert.equal([a, b].filter(Boolean).length, 1);
});

test("cờ WIP đang giữ thì mọi claim sau đều thất bại cho tới khi được nhả", async () => {
    reset();
    const c = await claimSellerKeySlot(slot());
    await finalizeSellerKeySlot(c.row.id, { key: "sk-1", externalId: "ext-1" });

    assert.equal(await claimSellerKeyRenew(c.row.id, "seller1", null), true);
    assert.equal(await claimSellerKeyRenew(c.row.id, "seller1", null), false, "đang WIP");
    assert.equal(await claimSellerKeyRenew(c.row.id, "seller1", null), false, "vẫn đang WIP");

    await releaseSellerKeyRenew(c.row.id);
    assert.equal(await claimSellerKeyRenew(c.row.id, "seller1", null), true, "nhả rồi thì claim lại được");
});

test("claim gia hạn bị scope theo seller — không mượn id của seller khác", async () => {
    reset();
    const a = await claimSellerKeySlot(slot({ sellerKeyId: "seller1", clientRef: "s1" }));
    await finalizeSellerKeySlot(a.row.id, { key: "sk-1", externalId: "ext-1" });

    assert.equal(await claimSellerKeyRenew(a.row.id, "seller2", null), false, "seller khác không claim được");
    const row = rows.find((r) => r.id === a.row.id);
    assert.equal(row.renewWipAt, null, "và không được để lại dấu vết gì trên dòng");
    assert.equal(await claimSellerKeyRenew(a.row.id, "seller1", null), true, "chủ sở hữu thì được");
});

test("finalize gia hạn: xoá WIP, tăng renewCount, GIỮ lastRenewRef làm biên nhận", async () => {
    reset();
    const c = await claimSellerKeySlot(slot());
    await finalizeSellerKeySlot(c.row.id, { key: "sk-1", externalId: "ext-1" });
    await claimSellerKeyRenew(c.row.id, "seller1", "seller1:r1");

    const saved = await finalizeSellerKeyRenew(c.row.id, {
        quotaTokens: 40_000_000, expiresAt: "2027-06-01T00:00:00.000Z", renewRef: "seller1:r1",
    });
    assert.equal(saved.renewWipAt, null, "phải xoá cờ để lần sau gia hạn tiếp được");
    assert.equal(saved.renewCount, 1);
    assert.ok(saved.lastRenewAt instanceof Date);
    assert.equal(saved.quotaTokens, 40_000_000, "quota mới phải được ghi lại — /mykey đọc từ đây");
    assert.equal(saved.expiresAt.toISOString(), "2027-06-01T00:00:00.000Z");
    // lastRenewRef GIỮ LẠI: đó là bằng chứng để lần retry cùng clientRef nhận ra
    // "đã làm rồi" mà không gọi provider lần nữa.
    assert.equal(saved.lastRenewRef, "seller1:r1");

    await claimSellerKeyRenew(c.row.id, "seller1", "seller1:r2");
    const second = await finalizeSellerKeyRenew(c.row.id, { quotaTokens: 60_000_000, renewRef: "seller1:r2" });
    assert.equal(second.renewCount, 2, "renewCount cộng dồn, không đặt lại");
    assert.equal(second.lastRenewRef, "seller1:r2");
});

test("release KHÔNG tăng renewCount — nhả cờ thì không phải là một lần gia hạn", async () => {
    reset();
    const c = await claimSellerKeySlot(slot());
    await finalizeSellerKeySlot(c.row.id, { key: "sk-1", externalId: "ext-1" });
    await claimSellerKeyRenew(c.row.id, "seller1", null);
    const r = await releaseSellerKeyRenew(c.row.id);
    assert.equal(r.renewCount, 0);
    assert.equal(r.renewWipAt, null);
    assert.equal(r.lastRenewAt, null);
});

// ─── 5. Trần theo ngày ─────────────────────────────────────────────────────────

test("sellerUsageSince đếm từ mốc, chỉ tính dòng ĐÃ có key", async () => {
    reset();
    const day0 = Date.UTC(2026, 8, 10);
    // Ba key thật + một slot còn chờ provider.
    for (const [ref, tokens, at] of [["a", 10_000_000, day0], ["b", 20_000_000, day0 + 1000], ["c", 30_000_000, day0 + 86_400_000]]) {
        const c = await claimSellerKeySlot(slot({ clientRef: ref, quotaTokens: tokens }));
        await finalizeSellerKeySlot(c.row.id, { key: `sk-${ref}`, externalId: ref, quotaTokens: tokens });
        rows.find((r) => r.id === c.row.id).createdAt = new Date(at);
    }
    const pending = await claimSellerKeySlot(slot({ clientRef: "pending", quotaTokens: 99_000_000 }));
    rows.find((r) => r.id === pending.row.id).createdAt = new Date(day0 + 2000);

    const since = new Date(day0);
    const used = await sellerUsageSince("seller1", since);
    assert.equal(used.keys, 3, "slot chưa finalize KHÔNG được tính là đã cấp");
    assert.equal(used.tokens, 60_000_000, "và quota của nó cũng không bị cộng vào trần");
    assert.equal(used.pending, 1, "nhưng phải BÁO để seller biết có một lượt đang treo");
});

test("sellerUsageSince không tính key của seller khác", async () => {
    reset();
    const a = await claimSellerKeySlot(slot({ sellerKeyId: "seller1", clientRef: "a", quotaTokens: 5_000_000 }));
    await finalizeSellerKeySlot(a.row.id, { key: "sk-a", externalId: "a" });
    const b = await claimSellerKeySlot(slot({ sellerKeyId: "seller2", clientRef: "b", quotaTokens: 50_000_000 }));
    await finalizeSellerKeySlot(b.row.id, { key: "sk-b", externalId: "b" });

    const used = await sellerUsageSince("seller1", new Date(Date.UTC(2000, 0, 1)));
    assert.equal(used.keys, 1);
    assert.equal(used.tokens, 5_000_000, "quota của seller khác không được tính vào trần của seller này");
});

test("mốc `since` loại đúng dòng cũ hơn", async () => {
    reset();
    const old = await claimSellerKeySlot(slot({ clientRef: "old" }));
    await finalizeSellerKeySlot(old.row.id, { key: "sk-old", externalId: "old" });
    rows.find((r) => r.id === old.row.id).createdAt = new Date(Date.UTC(2026, 8, 1));

    const fresh = await claimSellerKeySlot(slot({ clientRef: "fresh" }));
    await finalizeSellerKeySlot(fresh.row.id, { key: "sk-fresh", externalId: "fresh" });
    rows.find((r) => r.id === fresh.row.id).createdAt = new Date(Date.UTC(2026, 8, 12));

    const used = await sellerUsageSince("seller1", new Date(Date.UTC(2026, 8, 10)));
    assert.equal(used.keys, 1, "chỉ dòng từ mốc trở đi");
});
