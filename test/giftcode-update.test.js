import test, { mock } from "node:test";
import assert from "node:assert/strict";

// updateGiftCode chỉ chạm prisma.giftCode.findUnique + .update → mock tối thiểu.
// Cần cờ --experimental-test-module-mocks (đã có trong npm test).
const url = (path) => new URL(path, import.meta.url).href;

let store = {};
let lastUpdate = null;

const prismaMock = {
    giftCode: {
        async findUnique({ where }) {
            const row = Object.values(store).find(
                (g) => (where.code && g.code === where.code) || (where.id && g.id === where.id),
            );
            return row ? { ...row } : null;
        },
        async update({ where, data }) {
            lastUpdate = { where, data };
            const row = store[where.id];
            Object.assign(row, data);
            return { ...row };
        },
    },
};

mock.module(url("../src/lib/prisma.js"), {
    defaultExport: new Proxy({}, { get: (_t, p) => prismaMock[p] }),
});

const { updateGiftCode } = await import("../src/giftcode.js");

function seed(gift) {
    const row = {
        id: "g1", code: "FREE2026", rewardType: "WALLET", amount: 0,
        quotaMinM: 0, quotaMaxM: 0, quotaAlpha: 0, keyRpm: 0, keyValidDays: 0,
        maxUses: null, perUserLimit: 1, vipOnly: 0, expiresAt: null, note: null,
        usedCount: 4, isActive: true, createdBy: "x", ...gift,
    };
    store = { g1: row };
    lastUpdate = null;
    return row;
}

test("APIKEY: nâng miền quota 3–20 → 3–50", async () => {
    seed({ rewardType: "APIKEY", quotaMinM: 3, quotaMaxM: 20 });
    const out = await updateGiftCode("free2026", { quotaMinM: 3, quotaMaxM: 50 });
    assert.equal(out.quotaMinM, 3);
    assert.equal(out.quotaMaxM, 50);
    assert.equal(lastUpdate.data.quotaMaxM, 50);
});

test("APIKEY: chặn max < min (tính trên cặp kết quả)", async () => {
    seed({ rewardType: "APIKEY", quotaMinM: 10, quotaMaxM: 20 });
    await assert.rejects(() => updateGiftCode("FREE2026", { quotaMaxM: 5 }), /Quota tối đa/);
});

test("APIKEY: sửa mỗi min, max lấy giá trị đang lưu để kiểm chéo", async () => {
    seed({ rewardType: "APIKEY", quotaMinM: 3, quotaMaxM: 12 });
    await assert.rejects(() => updateGiftCode("FREE2026", { quotaMinM: 30 }), /Quota tối đa \(12M\)/);
    const ok = await updateGiftCode("FREE2026", { quotaMinM: 8 });
    assert.equal(ok.quotaMinM, 8);
    assert.equal(ok.quotaMaxM, 12);
});

test("APIKEY: sửa RPM và số ngày key", async () => {
    seed({ rewardType: "APIKEY", quotaMinM: 3, quotaMaxM: 50, keyRpm: 300, keyValidDays: 0 });
    const out = await updateGiftCode("FREE2026", { keyRpm: 600, keyValidDays: 30 });
    assert.equal(out.keyRpm, 600);
    assert.equal(out.keyValidDays, 30);
});

test("APIKEY: bỏ qua field amount (type-gated)", async () => {
    seed({ rewardType: "APIKEY", quotaMinM: 3, quotaMaxM: 50 });
    await updateGiftCode("FREE2026", { amount: 99999, keyRpm: 100 });
    assert.equal(lastUpdate.data.amount, undefined, "không được set amount cho mã APIKEY");
});

test("WALLET: sửa số tiền", async () => {
    seed({ rewardType: "WALLET", amount: 50000 });
    const out = await updateGiftCode("FREE2026", { amount: "75000" });
    assert.equal(out.amount, 75000);
});

test("WALLET: chặn số tiền <= 0", async () => {
    seed({ rewardType: "WALLET", amount: 50000 });
    await assert.rejects(() => updateGiftCode("FREE2026", { amount: 0 }), /số dương/);
});

test("WALLET: bỏ qua field quota (type-gated)", async () => {
    seed({ rewardType: "WALLET", amount: 50000 });
    await updateGiftCode("FREE2026", { quotaMinM: 5, quotaMaxM: 40, amount: 60000 });
    assert.equal(lastUpdate.data.quotaMinM, undefined);
    assert.equal(lastUpdate.data.quotaMaxM, undefined);
});

test("field rỗng = xoá: maxUses/expiresAt/note về null, vipOnly về 0", async () => {
    seed({ rewardType: "WALLET", amount: 50000, maxUses: 100, vipOnly: 2, note: "cũ", expiresAt: new Date() });
    const out = await updateGiftCode("FREE2026", {
        amount: 50000, maxUses: "", perUserLimit: 1, vipOnly: 0, expiresAt: "", note: "",
    });
    assert.equal(out.maxUses, null);
    assert.equal(out.vipOnly, 0);
    assert.equal(out.note, null);
    assert.equal(out.expiresAt, null);
});

test("KHÔNG đụng code / rewardType / usedCount", async () => {
    seed({ rewardType: "APIKEY", quotaMinM: 3, quotaMaxM: 20, usedCount: 4 });
    await updateGiftCode("FREE2026", { quotaMaxM: 50, note: "x" });
    assert.equal("code" in lastUpdate.data, false);
    assert.equal("rewardType" in lastUpdate.data, false);
    assert.equal("usedCount" in lastUpdate.data, false);
    assert.equal(store.g1.usedCount, 4);
    assert.equal(store.g1.code, "FREE2026");
});

test("mã không tồn tại → ném lỗi 'Không tìm thấy'", async () => {
    seed({ rewardType: "WALLET" });
    await assert.rejects(() => updateGiftCode("NOPE", { amount: 1 }), /Không tìm thấy/);
});

test("không có field hợp lệ nào → trả nguyên mã, không gọi update", async () => {
    const row = seed({ rewardType: "APIKEY", quotaMinM: 3, quotaMaxM: 50 });
    const out = await updateGiftCode("FREE2026", {});
    assert.equal(lastUpdate, null, "không được gọi prisma.update khi patch rỗng");
    assert.equal(out.code, row.code);
});

test("expiresAt sai định dạng → ném lỗi", async () => {
    seed({ rewardType: "WALLET", amount: 50000 });
    await assert.rejects(() => updateGiftCode("FREE2026", { expiresAt: "không-phải-ngày" }), /Ngày hết hạn/);
});
