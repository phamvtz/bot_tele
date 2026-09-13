import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

/**
 * Wizard tạo flash sale: ba nút bấm sẵn của bước 2/3/4 (−% / số phút / số suất).
 *
 * Bối cảnh: có một bản sửa thêm các nút `ADMIN:FLASHSALE_PCT/MIN/SLOT` vào tin nhắn
 * mà QUÊN đăng ký `bot.action` tương ứng — nút render ra, admin bấm, Telegraf im
 * lặng nuốt callback vì không handler nào khớp. Không lỗi, không log, trông y như
 * bot chết. Test này bấm THẬT từng nút qua một bot giả để chốt cả ba đường:
 *   1. nút áp đúng giá trị vào session và đẩy đúng bước kế tiếp;
 *   2. nút CŨ nằm lại trong lịch sử chat không được nhảy bước lùi;
 *   3. mọi callback có tham số mà file sinh ra đều có handler đăng ký (quét nguồn).
 */
const url = (path) => new URL(path, import.meta.url).href;

/** Stub prisma đủ rộng: wizard không query gì ở ba bước này, nhưng preview thì có. */
function stubModel() {
    const base = {
        findMany: async () => [],
        findUnique: async () => null,
        findFirst: async () => null,
        count: async () => 0,
        countDocuments: async () => 0,
        aggregate: async () => ({}),
        update: async () => null,
        updateMany: async () => ({ count: 0 }),
        create: async () => null,
        delete: async () => null,
        deleteMany: async () => ({ count: 0 }),
    };
    return new Proxy(base, { get: (t, k) => (k in t ? t[k] : async () => null) });
}
const models = {};
const prismaStub = new Proxy({
    $connect: async () => {},
    $disconnect: async () => {},
    $queryRaw: async () => [],
}, {
    get: (t, k) => {
        if (k in t) return t[k];
        if (!models[k]) models[k] = stubModel();
        return models[k];
    },
});
mock.module(url("../src/lib/prisma.js"), {
    namedExports: { prisma: prismaStub },
    defaultExport: prismaStub,
});

const { registerFlashSaleAdmin } = await import("../src/flash-sale-admin.js");
const { discountedUnitPrice } = await import("../src/flash-sale.js");

/** Bot giả: chỉ ghi lại các handler đã đăng ký. */
function fakeBot() {
    const handlers = [];
    return { handlers, action: (pattern, fn) => handlers.push([pattern, fn]) };
}

/** Dựng ctx giả, gom alert và tin reply để assert. */
function fakeCtx(id = 7) {
    const ctx = {
        from: { id },
        match: [],
        alerts: [],
        replies: [],
        answerCbQuery: async (text, opts) => {
            if (text) ctx.alerts.push({ text: String(text), alert: Boolean(opts && opts.show_alert) });
        },
        reply: async (text) => {
            ctx.replies.push(String(text));
            return { message_id: ctx.replies.length };
        },
    };
    return ctx;
}

/** Tìm handler khớp callback data như Telegraf: chuỗi so bằng, regex thì exec. */
function press(handlers, data) {
    for (const [pattern, fn] of handlers) {
        if (typeof pattern === "string") {
            if (pattern === data) return { fn, match: [data] };
            continue;
        }
        const m = pattern.exec(data);
        if (m) return { fn, match: m };
    }
    return null;
}

async function tap(handlers, data, ctx) {
    const hit = press(handlers, data);
    assert.ok(hit, `không handler nào bắt "${data}" — đây đúng là lỗi nút chết cần chặn`);
    ctx.match = hit.match;
    await hit.fn(ctx);
    return ctx;
}

/** Session y như handler ADMIN:FLASHSALE_PROD để lại sau bước 1. */
function seedSession(sessions, over = {}) {
    const s = {
        action: "CREATE_FLASHSALE",
        step: 2,
        productId: "p1",
        productName: "Gói thử",
        productPrice: 100000,
        productCurrency: "VND",
        totalDiscount: false,
        perMUsd: 0,
        discountPct: 0,
        priceAfter: 100000,
        validityMinutes: 60,
        maxSlots: 0,
        ...over,
    };
    sessions.set(7, s);
    return s;
}

function setup() {
    const sessions = new Map();
    const bot = fakeBot();
    registerFlashSaleAdmin(bot, { sessions, isAdmin: () => true });
    return { sessions, handlers: bot.handlers };
}

// ─── Ba nút bấm sẵn đi đúng đường với gõ tay ───────────────────────────────────────

test("nút −30% áp vào session, tính priceAfter một lần và hỏi bước 3", async () => {
    const { sessions, handlers } = setup();
    const s = seedSession(sessions);
    const ctx = await tap(handlers, "ADMIN:FLASHSALE_PCT:30", fakeCtx());

    assert.equal(s.discountPct, 30);
    assert.equal(s.step, 3);
    assert.equal(s.priceAfter, discountedUnitPrice(100000, 30), "priceAfter phải dùng chung hàm tính giá");
    assert.match(ctx.replies.at(-1), /Bước 3\/5/, "phải hỏi tiếp số phút");
    assert.match(ctx.replies.at(-1), /ADMIN:FLASHSALE_MIN|phút/, "bước 3 phải có nút phút");
});

test("nút 45 phút vào bước 4, nút 25 suất đẩy tới màn xem trước", async () => {
    const { sessions, handlers } = setup();
    const s = seedSession(sessions, { step: 3, discountPct: 30 });

    await tap(handlers, "ADMIN:FLASHSALE_MIN:45", fakeCtx());
    assert.equal(s.validityMinutes, 45);
    assert.equal(s.step, 4);

    const ctx = await tap(handlers, "ADMIN:FLASHSALE_SLOT:25", fakeCtx());
    assert.equal(s.maxSlots, 25);
    assert.equal(s.step, 5, "suất là bước cuối trước preview");
    assert.ok(ctx.replies.length, "phải dựng màn xem trước");
});

test("nút 0 suất = không giới hạn, vẫn đi tiếp được", async () => {
    const { sessions, handlers } = setup();
    const s = seedSession(sessions, { step: 4 });
    await tap(handlers, "ADMIN:FLASHSALE_SLOT:0", fakeCtx());
    assert.equal(s.maxSlots, 0);
    assert.equal(s.step, 5);
});

test("mức giảm ngoài miền 1–90 bị từ chối, session đứng yên", async () => {
    const { sessions, handlers } = setup();
    const s = seedSession(sessions);
    const ctx = await tap(handlers, "ADMIN:FLASHSALE_PCT:95", fakeCtx());
    assert.equal(s.discountPct, 0, "không được kẹp 95 về 90 trong im lặng");
    assert.equal(s.step, 2);
    assert.ok(ctx.alerts.length, "phải báo cho admin biết nút bị từ chối");
});

test("số phút ngoài miền 1–1440 bị từ chối", async () => {
    const { sessions, handlers } = setup();
    const s = seedSession(sessions, { step: 3 });
    const ctx = await tap(handlers, "ADMIN:FLASHSALE_MIN:5000", fakeCtx());
    assert.equal(s.validityMinutes, 60, "giữ giá trị cũ");
    assert.equal(s.step, 3);
    assert.ok(ctx.alerts.length);
});

// ─── Nút cũ trong lịch sử chat ─────────────────────────────────────────────────────

test("bấm nút −% của tin CŨ khi đã qua bước 4: không nhảy bước lùi", async () => {
    const { sessions, handlers } = setup();
    const s = seedSession(sessions, { step: 4, discountPct: 30, priceAfter: 70000 });
    const ctx = await tap(handlers, "ADMIN:FLASHSALE_PCT:50", fakeCtx());

    assert.equal(s.discountPct, 30, "đè % mới lên đợt đang điền dở là sai số trên tin gửi khách");
    assert.equal(s.step, 4);
    assert.ok(ctx.alerts.some((a) => a.alert), "phải bật alert giải thích, không nuốt im lặng");
});

test("phiên tạo đã hết (hết TTL / đã huỷ) thì nút bấm chỉ báo, không ném", async () => {
    const { handlers } = setup(); // sessions rỗng
    const ctx = await tap(handlers, "ADMIN:FLASHSALE_MIN:30", fakeCtx());
    assert.ok(ctx.alerts.length, "phải nói rõ là hết phiên");
    assert.equal(ctx.replies.length, 0, "không được dựng màn bước kế cho một phiên không tồn tại");
});

test("không phải admin thì mọi nút wizard im lặng", async () => {
    const sessions = new Map();
    const bot = fakeBot();
    registerFlashSaleAdmin(bot, { sessions, isAdmin: () => false });
    seedSession(sessions);
    const ctx = await tap(bot.handlers, "ADMIN:FLASHSALE_PCT:30", fakeCtx(99));
    assert.equal(ctx.replies.length, 0);
    assert.equal(ctx.alerts.length, 0);
});

// ─── Quét nguồn: callback sinh ra phải có handler ──────────────────────────────────

test("mọi callback CÓ THAM SỐ của wizard đều có handler regex đăng ký", async () => {
    const src = await readFile(new URL("../src/flash-sale-admin.js", import.meta.url), "utf8");
    const emitted = [...src.matchAll(/[`"]ADMIN:(FLASHSALE_[A-Z]+):\$\{/g)].map((m) => m[1]);
    const registered = new Set([...src.matchAll(/bot\.action\(\/\^ADMIN:(FLASHSALE_[A-Z]+):/g)].map((m) => m[1]));
    assert.ok(emitted.length >= 3, "tiền đề: phải quét thấy ít nhất PCT/MIN/SLOT");
    for (const name of new Set(emitted)) {
        assert.ok(registered.has(name), `ADMIN:${name}:<id> được gắn lên nút nhưng không có bot.action nào bắt`);
    }
});

test("mọi callback TRƠN của wizard đều có handler chuỗi đăng ký", async () => {
    const src = await readFile(new URL("../src/flash-sale-admin.js", import.meta.url), "utf8");
    // Đối số THỨ HAI của Markup.button.callback kết thúc bằng `)` — còn bot.action("X",
    // luôn có dấu phẩy sau chuỗi, nên mẫu này chỉ bắt phía sinh nút.
    const emitted = [...src.matchAll(/,\s*[`"]ADMIN:(FLASHSALE_[A-Z]+)[`"]\s*\)/g)].map((m) => m[1]);
    const registered = new Set([...src.matchAll(/bot\.action\([`"]ADMIN:(FLASHSALE_[A-Z]+)[`"]/g)].map((m) => m[1]));
    assert.ok(emitted.length >= 3, "tiền đề: phải quét thấy SEND/CANCEL/NEW...");
    for (const name of new Set(emitted)) {
        assert.ok(registered.has(name), `ADMIN:${name} được gắn lên nút nhưng không có bot.action nào bắt`);
    }
});
