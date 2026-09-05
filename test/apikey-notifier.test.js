import test from "node:test";
import assert from "node:assert/strict";
import { buildRenewNudge, runApiKeyNotifierOnce } from "../src/apikey-notifier.js";
import { keyLifecycle, STAGE_LOW, STAGE_CRITICAL, STAGE_DEAD } from "../src/apikey-renew.js";

/**
 * Job nhắc gia hạn. Điều quan trọng nhất phải ghim: KHÔNG SPAM. Khách nhận đúng
 * một tin mỗi mốc, và một key được gia hạn rồi lại sắp hết thì chu kỳ chạy lại.
 */
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 5, 12, 0, 0);
const at = (d) => new Date(NOW + d * DAY).toISOString();

function harness({ keys = [], users = [], sendFails = null } = {}) {
    const sent = [];
    const rows = keys.map((k) => ({
        id: k.id, telegramId: k.telegramId || "111", key: k.key || "sk-" + k.id,
        externalId: k.externalId ?? k.id, quotaTokens: k.quotaTokens ?? 100e6,
        expiresAt: k.expiresAt ?? null, notifyStage: k.notifyStage ?? 0, createdAt: new Date(NOW),
    }));
    const prisma = {
        issuedApiKey: {
            async findMany() { return rows.filter((r) => r.externalId != null && r.notifyStage < STAGE_DEAD); },
            async update({ where, data }) {
                const r = rows.find((x) => x.id === where.id);
                if (r) Object.assign(r, data);
                return r;
            },
            async updateMany({ where, data }) {
                const r = rows.find((x) => x.id === where.id && x.notifyStage === where.notifyStage);
                if (!r) return { count: 0 };
                Object.assign(r, data);
                return { count: 1 };
            },
        },
        user: {
            async findMany() { return users.length ? users : [{ telegramId: "111", language: "vi", isBlocked: false }]; },
            async update() { return null; },
        },
    };
    const telegram = {
        async sendMessage(chatId, text, opts) {
            if (sendFails) throw sendFails;
            sent.push({ chatId, text, opts });
            return { message_id: sent.length };
        },
    };
    return { prisma, telegram, rows, sent };
}

const statusMap = (obj) => new Map(Object.entries(obj));

test("key sắp hết (80%) được nhắc đúng một lần", async () => {
    const h = harness({ keys: [{ id: "k1", expiresAt: at(30) }] });
    const st = statusMap({ k1: { quotaLimit: 1000, quotaUsed: 800, expiresAt: at(30), enabled: true } });

    const r1 = await runApiKeyNotifierOnce({ ...h, statuses: st, now: NOW });
    assert.equal(r1.notified, 1);
    assert.equal(h.rows[0].notifyStage, STAGE_LOW);

    // Quét lại ngay: KHÔNG được nhắn lần hai cho cùng một mốc.
    const r2 = await runApiKeyNotifierOnce({ ...h, statuses: st, now: NOW + 60_000 });
    assert.equal(r2.notified, 0);
    assert.equal(h.sent.length, 1, "khách bị nhắn hai lần cho cùng một mốc");
});

test("đủ ba mốc thì đúng ba tin, không hơn", async () => {
    const h = harness({ keys: [{ id: "k1", expiresAt: at(30) }] });
    const mk = (used) => statusMap({ k1: { quotaLimit: 1000, quotaUsed: used, expiresAt: at(30), enabled: true } });

    await runApiKeyNotifierOnce({ ...h, statuses: mk(800), now: NOW });      // 80%
    await runApiKeyNotifierOnce({ ...h, statuses: mk(960), now: NOW + DAY }); // 96%
    await runApiKeyNotifierOnce({ ...h, statuses: mk(1000), now: NOW + 2 * DAY }); // cạn
    // Quét thêm hai lượt nữa — không được sinh tin thứ tư.
    await runApiKeyNotifierOnce({ ...h, statuses: mk(1000), now: NOW + 3 * DAY });
    await runApiKeyNotifierOnce({ ...h, statuses: mk(1000), now: NOW + 4 * DAY });

    assert.equal(h.sent.length, 3, `phải đúng 3 tin, nhận ${h.sent.length}`);
    assert.match(h.sent[0].text, /sắp hết/);
    assert.match(h.sent[2].text, /đã hết/);
});

test("tụt thẳng từ khoẻ sang cạn chỉ nhận MỘT tin, không nhận bù", async () => {
    const h = harness({ keys: [{ id: "k1", expiresAt: at(30) }] });
    const st = statusMap({ k1: { quotaLimit: 1000, quotaUsed: 1000, expiresAt: at(30), enabled: true } });
    await runApiKeyNotifierOnce({ ...h, statuses: st, now: NOW });
    assert.equal(h.sent.length, 1);
    assert.match(h.sent[0].text, /đã hết/);
});

test("gia hạn xong (notifyStage về 0) thì chu kỳ nhắc chạy lại", async () => {
    const h = harness({ keys: [{ id: "k1", expiresAt: at(30), notifyStage: STAGE_DEAD }] });
    // deliverApiKeyRenewal reset notifyStage = 0.
    h.rows[0].notifyStage = 0;
    const st = statusMap({ k1: { quotaLimit: 2000, quotaUsed: 1700, expiresAt: at(60), enabled: true } });
    const r = await runApiKeyNotifierOnce({ ...h, statuses: st, now: NOW });
    assert.equal(r.notified, 1, "key đã gia hạn rồi lại sắp hết thì phải nhắc lại");
});

test("key khoẻ thì im lặng", async () => {
    const h = harness({ keys: [{ id: "k1", expiresAt: at(30) }] });
    const st = statusMap({ k1: { quotaLimit: 1000, quotaUsed: 10, expiresAt: at(30), enabled: true } });
    const r = await runApiKeyNotifierOnce({ ...h, statuses: st, now: NOW });
    assert.equal(r.notified, 0);
    assert.equal(h.sent.length, 0);
});

test("key vô hạn quota + không hết hạn KHÔNG bị nhắc", async () => {
    // quota_limit = 0 là vô hạn. Đọc nhầm là spam mọi khách mua key vĩnh viễn.
    const h = harness({ keys: [{ id: "k1", expiresAt: null }] });
    const st = statusMap({ k1: { quotaLimit: 0, quotaUsed: 9e9, expiresAt: null, enabled: true } });
    const r = await runApiKeyNotifierOnce({ ...h, statuses: st, now: NOW });
    assert.equal(r.notified, 0);
});

test("key provider đã xoá: đóng hồ sơ, KHÔNG nhắn gì", async () => {
    const h = harness({ keys: [{ id: "k1", expiresAt: at(30) }] });
    // Map có dữ liệu (provider trả về bình thường) nhưng thiếu k1.
    const st = statusMap({ other: { quotaLimit: 1000, quotaUsed: 1, expiresAt: at(30), enabled: true } });
    await runApiKeyNotifierOnce({ ...h, statuses: st, now: NOW });
    assert.equal(h.sent.length, 0, "key không còn thì nhắc gia hạn là mời vào ngõ cụt");
    assert.equal(h.rows[0].notifyStage, STAGE_DEAD, "phải đánh dấu để vòng sau không quét lại mãi");
});

test("quá nửa kho key biến mất = nghi đọc thiếu, KHÔNG đóng key nào", async () => {
    // Ca có thật: GET /keys phân trang 20/trang, kho có 382 key. Đọc mỗi trang đầu
    // rồi đóng hồ sơ phần còn lại là khai tử vĩnh viễn key khách đang dùng.
    const keys = Array.from({ length: 10 }, (_, i) => ({ id: `k${i}`, expiresAt: at(30) }));
    const h = harness({ keys });
    const st = statusMap({ k0: { quotaLimit: 1000, quotaUsed: 1, expiresAt: at(30), enabled: true } });
    await runApiKeyNotifierOnce({ ...h, statuses: st, now: NOW });
    assert.ok(h.rows.slice(1).every((r) => r.notifyStage === 0), "đã đóng nhầm key thật");
    assert.equal(h.sent.length, 0);
});

test("provider trả rỗng (lỗi mạng) KHÔNG được coi là mọi key đã chết", async () => {
    // Map rỗng nghĩa là không đọc được số liệu, không phải \"tất cả key bị xoá\".
    const h = harness({ keys: [{ id: "k1", expiresAt: at(30) }] });
    await runApiKeyNotifierOnce({ ...h, statuses: statusMap({}), now: NOW });
    assert.equal(h.rows[0].notifyStage, 0, "một lần lỗi mạng đã khai tử toàn bộ key");
    assert.equal(h.sent.length, 0);
});

test("key chết quá 30 ngày thì thôi, không đào mộ", async () => {
    const h = harness({ keys: [{ id: "k1", expiresAt: at(-40) }] });
    const st = statusMap({ k1: { quotaLimit: 1000, quotaUsed: 10, expiresAt: at(-40), enabled: true } });
    const r = await runApiKeyNotifierOnce({ ...h, statuses: st, now: NOW });
    assert.equal(h.sent.length, 0);
    assert.equal(r.skipped, 1);
});

test("khách đã chặn bot thì bỏ qua và GIỮ mốc để lần sau nhắc lại", async () => {
    const h = harness({
        keys: [{ id: "k1", expiresAt: at(30) }],
        users: [{ telegramId: "111", language: "vi", isBlocked: true }],
    });
    const st = statusMap({ k1: { quotaLimit: 1000, quotaUsed: 900, expiresAt: at(30), enabled: true } });
    await runApiKeyNotifierOnce({ ...h, statuses: st, now: NOW });
    assert.equal(h.sent.length, 0);
    assert.equal(h.rows[0].notifyStage, 0, "không được đốt mốc khi chưa gửi được tin");
});

test("nút trong tin nhắc dẫn thẳng tới màn gia hạn ĐÚNG key đó", async () => {
    const h = harness({ keys: [{ id: "abc123", expiresAt: at(30) }] });
    const st = statusMap({ abc123: { quotaLimit: 1000, quotaUsed: 900, expiresAt: at(30), enabled: true } });
    await runApiKeyNotifierOnce({ ...h, statuses: st, now: NOW });
    const kb = h.sent[0].opts.reply_markup.inline_keyboard.flat();
    assert.ok(kb.some((b) => b.callback_data === "APIKEY_RN:abc123"), "thiếu nút gia hạn đúng key");
    assert.ok(kb.some((b) => b.callback_data === "APIKEY_MINE"));
});

// === Nội dung tin ==========================================================

test("tin nhắc nói ĐÚNG lý do: hết quota hay hết hạn", async () => {
    const byQuota = buildRenewNudge({
        stage: STAGE_CRITICAL, key: "sk-x", lang: "vi",
        life: keyLifecycle({ quotaLimit: 1000, quotaUsed: 960, expiresAt: at(300) }, NOW),
    });
    assert.match(byQuota.text, /Đã dùng <b>96%<\/b> quota/);

    const byTime = buildRenewNudge({
        stage: STAGE_CRITICAL, key: "sk-x", lang: "vi",
        life: keyLifecycle({ quotaLimit: 1000, quotaUsed: 10, expiresAt: at(0.5) }, NOW),
    });
    assert.match(byTime.text, /Còn <b>1<\/b> ngày/);
});

test("tin nhắc có bản dịch en / zh", () => {
    const life = keyLifecycle({ quotaLimit: 1000, quotaUsed: 900, expiresAt: at(30) }, NOW);
    assert.match(buildRenewNudge({ stage: STAGE_LOW, key: "sk-x", lang: "en", life }).text, /running low/);
    assert.match(buildRenewNudge({ stage: STAGE_LOW, key: "sk-x", lang: "zh", life }).text, /即将用完/);
    // Ngôn ngữ lạ rơi về vi, không vỡ.
    assert.match(buildRenewNudge({ stage: STAGE_LOW, key: "sk-x", lang: "xx", life }).text, /sắp hết/);
});

test("key được escape HTML — không phá tin nhắn", () => {
    const life = keyLifecycle({ quotaLimit: 1000, quotaUsed: 900, expiresAt: at(30) }, NOW);
    const { text } = buildRenewNudge({ stage: STAGE_LOW, key: "sk-<b>x", lang: "vi", life });
    assert.match(text, /sk-&lt;b&gt;x/);
});
