import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { makeFlashDb } from "./helpers/flash-sale-db.js";

const url = (p) => new URL(p, import.meta.url).href;

/**
 * Test VÒNG GỬI và cơ chế MỞ (§3) — phần khó nhất và dễ hỏng âm thầm nhất.
 *
 * Bốn điều spec đòi mà test ở đây chốt lại:
 *  1. Gửi đủ mọi khách, mỗi người ĐÚNG MỘT tin.
 *  2. Gửi xong SỚM thì KHÔNG được mở — mở sớm là để người bấm nhanh thắng người đọc kỹ.
 *  3. Restart giữa chừng thì NHẶT LẠI đúng chỗ, không gửi trùng, không bỏ sót.
 *  4. Dừng giữa chừng thì con trỏ phải còn đó và đợt không bao giờ mở.
 */

// `SEND_THROTTLE_MS` đọc từ env LÚC MODULE LOAD, nên phải đặt trước khi import.
// Mặc định 50ms × 250 khách = 12.5 giây chỉ để test một vòng gửi.
process.env.FLASH_SEND_THROTTLE_MS = "0";

const NOW = Date.UTC(2026, 8, 13, 12, 0, 0);

/** 24-hex tăng đơn điệu, để `toOid()` của code thật chuyển thành ObjectId được. */
const oid = (i) => (0x100000 + i).toString(16).padStart(24, "0");

function makeUsers(n, from = 0) {
    return Array.from({ length: n }, (_, i) => ({
        _id: oid(from + i),
        id: oid(from + i),
        telegramId: String(900000 + from + i),
        language: "vi",
        isBlocked: false,
    }));
}

function saleRow(over = {}) {
    return {
        id: oid(1),
        productId: "prod-1",
        productName: "Khoá học",
        productCurrency: "VND",
        productPrice: 250000,
        totalDiscount: false,
        discountPct: 30,
        validityMinutes: 60,
        maxSlots: 0,
        status: "SENDING",
        recipientTotal: 0,
        sentCount: 0,
        blockedCount: 0,
        errorCount: 0,
        acceptedCount: 0,
        skippedCount: 0,
        purchasedCount: 0,
        discountGivenTotal: 0,
        progressCursor: null,
        sendLeaseAt: null,
        sendLeaseOwner: null,
        sendStartedAt: new Date(NOW - 60000),
        sendFinishedAt: null,
        opensAt: new Date(NOW + 600000),
        createdAt: new Date(NOW - 60000),
        closedAt: null,
        ...over,
    };
}

let CURRENT = null;
const prismaProxy = new Proxy({}, {
    get: (_t, prop) => (CURRENT ? CURRENT[prop] : undefined),
    has: (_t, prop) => Boolean(CURRENT && prop in CURRENT),
});
mock.module(url("../src/db.js"), { namedExports: { prisma: prismaProxy }, defaultExport: prismaProxy });
const logs = [];
mock.module(url("../src/lib/logger.js"), {
    namedExports: {
        sendLog: (type, msg) => { logs.push({ type, msg }); return Promise.resolve(); },
        warnOnce: (key) => { logs.push({ type: "warnOnce", key }); },
    },
});
const mod = await import("../src/flash-sale.js");

/**
 * Telegram giả. `behaviour(chatId)` cho phép bơm lỗi theo từng khách để test nhánh
 * 403 (chặn bot) và 429 mà không cần dựng cả một mạng lỗi.
 */
function makeTelegram({ behaviour = null } = {}) {
    const sent = [];
    return {
        sent,
        telegram: {
            async sendMessage(chatId, text, opts) {
                if (behaviour) await behaviour(String(chatId), sent.length);
                sent.push({ chatId: String(chatId), text, opts });
                return { message_id: sent.length };
            },
        },
    };
}

const fresh = async ({ users = [], sale = {}, settings = [], responses = [] } = {}) => {
    CURRENT = makeFlashDb({
        users,
        sales: [saleRow(sale)],
        settings,
        responses,
    });
    mod.invalidateFlashOfferCache();
    logs.length = 0;
    return { db: CURRENT, mod, saleId: CURRENT._store.sales[0].id };
};

// ─── Gửi đủ mọi khách ──────────────────────────────────────────────────────────────

test("gửi cho 250 khách: mỗi người đúng MỘT tin, không sót, không trùng", async () => {
    const users = makeUsers(250);
    const { db, mod: m, saleId } = await fresh({ users, sale: { recipientTotal: 250 } });
    const tg = makeTelegram();

    const out = await m.runFlashSaleSend({ telegram: tg.telegram }, saleId, { now: () => NOW });

    assert.equal(out.ok, true);
    assert.equal(out.sent, 250);
    assert.equal(tg.sent.length, 250, "phải gửi đúng 250 tin");
    const ids = tg.sent.map((x) => x.chatId);
    assert.equal(new Set(ids).size, 250, "không khách nào nhận hai tin");
    assert.deepEqual(ids, users.map((u) => u.telegramId), "gửi đủ MỌI khách, đúng thứ tự");

    const row = db._store.sales[0];
    assert.equal(row.sentCount, 250);
    assert.equal(row.blockedCount, 0);
    assert.equal(row.errorCount, 0);
    assert.equal(row.progressCursor, oid(249), "con trỏ phải đứng ở user cuối cùng");
    assert.ok(row.sendFinishedAt, "phải đánh dấu đã gửi xong");
    assert.equal(row.sendLeaseAt, null, "nhả lease khi xong để tick không gửi lại");
    assert.equal(row.sendLeaseOwner, null);
});

test("tin ưu đãi có parse_mode HTML, tắt preview, và kèm bàn phím Nhận/Bỏ qua", async () => {
    const { mod: m, saleId } = await fresh({ users: makeUsers(3), sale: { recipientTotal: 3 } });
    const tg = makeTelegram();
    await m.runFlashSaleSend({ telegram: tg.telegram }, saleId, { now: () => NOW });

    const first = tg.sent[0];
    assert.equal(first.opts.parse_mode, "HTML");
    assert.equal(first.opts.disable_web_page_preview, true);
    const cb = first.opts.reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
    assert.ok(cb.some((c) => c.startsWith("FLASH_ACC:")), `phải có nút Nhận, thấy: ${cb}`);
    assert.ok(cb.some((c) => c.startsWith("FLASH_SKIP:")), `phải có nút Bỏ qua, thấy: ${cb}`);
});

test("§2: tin ưu đãi KHÔNG được tiết lộ số khách, kể cả khi có trần suất", async () => {
    // Đây là tin đã gửi đi thì không sửa được. In "Còn 25 suất" là một lời nói dối
    // có hạn dùng: năm phút sau nó sai và khách đọc lại tin cũ sẽ thấy bot nói nhảm.
    const users = makeUsers(250);
    const { mod: m, saleId } = await fresh({
        users,
        sale: { recipientTotal: 250, maxSlots: 25 },
    });
    const tg = makeTelegram();
    await m.runFlashSaleSend({ telegram: tg.telegram }, saleId, { now: () => NOW });

    for (const msg of tg.sent) {
        assert.ok(!msg.text.includes("250"), `tin không được chứa số khách: ${msg.text}`);
        assert.ok(!msg.text.includes("25 suất"), `tin không được chứa số suất: ${msg.text}`);
        assert.ok(msg.text.includes("Số suất có hạn"), "phải nói 'Số suất có hạn' thay vì con số");
    }
});

test("§3: giờ mở được IN TRONG TIN ngay từ lúc đang gửi", async () => {
    // Gửi trước, mở sau — nên con số này phải có mặt trong tin đầu tiên, không phải
    // được bổ sung sau khi mở.
    const opensAt = new Date(Date.UTC(2026, 8, 13, 13, 6, 0)); // 20:06 giờ VN
    const { mod: m, saleId } = await fresh({
        users: makeUsers(5), sale: { recipientTotal: 5, opensAt },
    });
    const tg = makeTelegram();
    await m.runFlashSaleSend({ telegram: tg.telegram }, saleId, { now: () => NOW });
    for (const msg of tg.sent) {
        assert.ok(msg.text.includes("20:06"), `tin phải in giờ mở 20:06, thực tế: ${msg.text}`);
    }
});

test("khách đã chặn bot bị BỎ QUA, không gửi và không tính vào recipientTotal đã xét", async () => {
    const users = makeUsers(10);
    users[3].isBlocked = true;
    users[7].isBlocked = true;
    const { mod: m, saleId } = await fresh({ users, sale: { recipientTotal: 8 } });
    const tg = makeTelegram();
    const out = await m.runFlashSaleSend({ telegram: tg.telegram }, saleId, { now: () => NOW });

    assert.equal(out.sent, 8);
    assert.equal(tg.sent.length, 8);
    assert.ok(!tg.sent.some((x) => x.chatId === users[3].telegramId));
    assert.ok(!tg.sent.some((x) => x.chatId === users[7].telegramId));
});

// ─── §8: 403 là "bị chặn", KHÔNG phải lỗi ─────────────────────────────────────────

test("403 → đếm blocked riêng, và đánh dấu isBlocked để broadcast khác khỏi tốn lượt", async () => {
    const users = makeUsers(6);
    const blockedIds = new Set([users[1].telegramId, users[4].telegramId]);
    const { db, mod: m, saleId } = await fresh({ users, sale: { recipientTotal: 6 } });
    const tg = makeTelegram({
        behaviour: async (chatId) => {
            if (blockedIds.has(chatId)) { const e = new Error("Forbidden: bot was blocked by the user"); e.code = 403; throw e; }
        },
    });
    const out = await m.runFlashSaleSend({ telegram: tg.telegram }, saleId, { now: () => NOW });

    assert.equal(out.sent, 4);
    assert.equal(out.blocked, 2);
    assert.equal(out.errored, 0, "403 KHÔNG được tính là lỗi (§8)");
    assert.equal(db._store.sales[0].blockedCount, 2);
    assert.equal(db._store.sales[0].errorCount, 0);
    // Đánh dấu để mọi broadcast khác không thử lại — đây là lý do 403 được xử lý riêng.
    assert.equal(db._store.users[1].isBlocked, true);
    assert.equal(db._store.users[4].isBlocked, true);
    assert.equal(db._store.users[0].isBlocked, false, "người nhận được tin thì không bị đánh dấu");
    // Tiến độ vẫn phải tính cả người bị chặn, nếu không thanh tiến độ không bao giờ đầy.
    assert.equal(db._store.sales[0].progressCursor, oid(5));
});

test("429 rồi thành công → vẫn tính là ĐÃ GỬI, không bỏ sót khách", async () => {
    // broadcast.js chỉ thử lại một lần rồi tính là fail; với vài nghìn người nhận thì
    // Telegram sẽ 429 nhiều lần và một lần thử lại là mất oan cả trăm người.
    const users = makeUsers(3);
    let attempts = 0;
    const { mod: m, saleId } = await fresh({ users, sale: { recipientTotal: 3 } });
    const tg = makeTelegram({
        behaviour: async (chatId) => {
            if (chatId === users[1].telegramId && attempts++ === 0) {
                const e = new Error("Too Many Requests"); e.code = 429; e.parameters = { retry_after: 0 }; throw e;
            }
        },
    });
    const out = await m.runFlashSaleSend({ telegram: tg.telegram }, saleId, { now: () => NOW });

    assert.equal(out.sent, 3, "người bị 429 vẫn phải nhận được tin ở lượt thử lại");
    assert.equal(out.errored, 0);
    assert.equal(tg.sent.filter((x) => x.chatId === users[1].telegramId).length, 1);
});

test("lỗi không phải 403 thì đếm vào errorCount — kiểm bằng cấu trúc vì backoff thật mất 16s", async () => {
    // Chạy thật nhánh này nghĩa là 6 lần thử với backoff 250→8000ms cho MỖI khách lỗi.
    // Không đáng: điều cần chốt là 403 đi một đường và MỌI lỗi khác đi đường kia,
    // tức không có lỗi nào bị âm thầm bỏ qua hay bị đếm nhầm thành "đã gửi".
    const src = readFileSync(new URL("../src/flash-sale.js", import.meta.url), "utf8");
    const body = src.slice(src.indexOf("export async function runFlashSaleSend"), src.indexOf("async function sendWithBackoff"));
    assert.match(body, /if \(err\?\.code === 403\)/, "phải rẽ nhánh riêng cho 403");
    assert.match(body, /outcome = "error"/, "mọi lỗi khác phải rơi vào errorCount");
    assert.match(body, /else errored \+= 1/, "errorCount phải được cộng");
    // Và `outcome` chỉ có ba giá trị, không có nhánh nào để một tin "không rõ đã gửi chưa".
    assert.doesNotMatch(body, /outcome = "(?!sent|blocked|error)/, "không được có loại outcome thứ tư");
});

// ─── §3: gửi xong SỚM thì KHÔNG mở ────────────────────────────────────────────────

test("gửi xong trước giờ đã in → đợt VẪN ở SENDING, không mở sớm", async () => {
    // Mở sớm là để người bấm nhanh thắng người đọc kỹ rồi chờ — đúng thứ mà cả thiết
    // kế "gửi trước mở sau" sinh ra để ngăn.
    const { db, mod: m, saleId } = await fresh({
        users: makeUsers(20),
        sale: { recipientTotal: 20, opensAt: new Date(NOW + 600000), sendStartedAt: new Date(NOW) },
    });
    const tg = makeTelegram();
    const out = await m.runFlashSaleSend({ telegram: tg.telegram }, saleId, { now: () => NOW });

    assert.equal(out.ok, true);
    assert.ok(db._store.sales[0].sendFinishedAt, "đã gửi xong");
    assert.equal(db._store.sales[0].status, "SENDING", "nhưng CHƯA được mở");
    assert.equal(db._store.sales[0].openedAt, undefined);
});

test("tick trước giờ in → không mở; tick đúng/sau giờ in → mở", async () => {
    const opensAt = NOW + 600000;
    const { db, mod: m, saleId } = await fresh({
        users: makeUsers(10),
        sale: { recipientTotal: 10, opensAt: new Date(opensAt), sendStartedAt: new Date(NOW) },
    });
    await m.runFlashSaleSend({ telegram: makeTelegram().telegram }, saleId, { now: () => NOW });

    const early = await m.flashSaleTick({ telegram: {} }, { now: opensAt - 1 });
    assert.deepEqual(early.opened, [], "chưa tới giờ thì không mở");
    assert.equal(db._store.sales[0].status, "SENDING");

    const onTime = await m.flashSaleTick({ telegram: {} }, { now: opensAt });
    assert.deepEqual(onTime.opened, [saleId]);
    assert.equal(db._store.sales[0].status, "OPEN");
    assert.equal(db._store.sales[0].openedAt.getTime(), opensAt);
});

test("gửi xong MUỘN hơn giờ đã in → mở ngay khi xong, khách bấm sớm đã thấy tiến độ thật", async () => {
    const opensAt = NOW - 1000; // giờ in đã qua
    const { db, mod: m, saleId } = await fresh({
        users: makeUsers(10),
        sale: { recipientTotal: 10, opensAt: new Date(opensAt), sendStartedAt: new Date(NOW - 60000) },
    });
    await m.runFlashSaleSend({ telegram: makeTelegram().telegram }, saleId, { now: () => NOW });
    assert.equal(db._store.sales[0].status, "OPEN", "gửi xong và đã quá giờ in thì mở luôn");
});

test("maybeOpenSale chỉ mở MỘT lần dù vòng gửi và tick cùng gọi", async () => {
    const { db, mod: m, saleId } = await fresh({
        users: makeUsers(5),
        sale: { recipientTotal: 5, opensAt: new Date(NOW - 1000), sendFinishedAt: new Date(NOW), sendStartedAt: new Date(NOW - 60000) },
    });
    const [a, b] = await Promise.all([
        m.maybeOpenSale(saleId, { now: NOW }),
        m.maybeOpenSale(saleId, { now: NOW }),
    ]);
    assert.equal([a, b].filter(Boolean).length, 1, "đúng một lần trả true → đúng một tin báo admin");
    assert.equal(db._store.sales[0].status, "OPEN");
});

test("§3: admin nhận tin '🔓 Đã MỞ nhận ưu đãi' khi đợt mở", async () => {
    const { mod: m, saleId } = await fresh({
        users: makeUsers(5),
        sale: { recipientTotal: 5, productName: "Khoá học A_B", opensAt: new Date(NOW - 1000), sendFinishedAt: new Date(NOW), sendStartedAt: new Date(NOW - 60000) },
    });
    let notified = null;
    await m.maybeOpenSale(saleId, { now: NOW, notify: (s) => { notified = s; } });
    assert.ok(notified, "notify phải được gọi để bot nhắn riêng cho admin");

    const opened = logs.find((l) => l.msg?.includes("ĐÃ MỞ"));
    assert.ok(opened, "phải có tin báo kênh admin");
    assert.ok(opened.msg.includes("Đã MỞ nhận ưu đãi"), `đúng chữ §3 đòi, thực tế: ${opened.msg}`);
    // sendLog dùng parse_mode MARKDOWN: thẻ <b> sẽ hiện nguyên chữ, còn một dấu `_`
    // lạ trong tên sản phẩm có thể làm cả tin không gửi được.
    assert.ok(!opened.msg.includes("<b>"), "không được dùng thẻ HTML trong tin Markdown");
    assert.ok(opened.msg.includes("A\\_B"), `tên sản phẩm phải escape Markdown, thực tế: ${opened.msg}`);
});

// ─── §3: resume sau deploy ─────────────────────────────────────────────────────────

test("resume từ con trỏ: chỉ gửi phần CÒN LẠI, không trùng, không sót", async () => {
    const users = makeUsers(250);
    // Giả lập: process cũ đã gửi được 125 người rồi chết.
    const { db, mod: m, saleId } = await fresh({
        users,
        sale: { recipientTotal: 250, progressCursor: oid(124), sentCount: 125, sendStartedAt: new Date(NOW - 30000) },
    });
    const tg = makeTelegram();
    const out = await m.runFlashSaleSend({ telegram: tg.telegram }, saleId, { now: () => NOW });

    // `tg.sent` là số tin CỦA LƯỢT NÀY: 125 người còn lại. `out.sent` là TỔNG CỘNG
    // DỒN, khớp `sentCount` trên document (250) — hai con số khác nhau là ĐÚNG, và
    // chính ngữ nghĩa đó làm `recordSendMeasurement({sentCount: sent+blocked+errored})`
    // ra một tốc độ trung bình đúng cho cả đợt dù có bị ngắt giữa chừng.
    assert.equal(tg.sent.length, 125, "lượt này chỉ được gửi 125 tin");
    assert.equal(out.sent, 250, "out.sent phải CỘNG DỒN, khớp sentCount");
    assert.deepEqual(tg.sent.map((x) => x.chatId), users.slice(125).map((u) => u.telegramId),
        "phải bắt đầu đúng từ người thứ 126");
    const row = db._store.sales[0];
    assert.equal(row.sentCount, 250, "tổng phải CỘNG DỒN chứ không đếm lại từ 0");
    assert.equal(row.progressCursor, oid(249));
});

test("resume hai lần liên tiếp không gửi lại ai", async () => {
    const users = makeUsers(60);
    const { db, mod: m, saleId } = await fresh({
        users, sale: { recipientTotal: 60, progressCursor: oid(29), sentCount: 30, sendStartedAt: new Date(NOW - 10000) },
    });
    const tg1 = makeTelegram();
    await m.runFlashSaleSend({ telegram: tg1.telegram }, saleId, { now: () => NOW });
    assert.equal(tg1.sent.length, 30);

    // Bơm lại trạng thái SENDING để chạy lượt thứ hai (mô phỏng một lần restart nữa).
    db._store.sales[0].status = "SENDING";
    db._store.sales[0].sendFinishedAt = null;
    db._store.sales[0].sendLeaseAt = null;
    const tg2 = makeTelegram();
    const out2 = await m.runFlashSaleSend({ telegram: tg2.telegram }, saleId, { now: () => NOW });
    assert.equal(tg2.sent.length, 0, "đã gửi hết rồi thì không gửi lại ai");
    // 0 tin nhưng `sent` vẫn trả 60: nó đọc từ DB (cộng dồn), không phải đếm lượt này.
    assert.equal(out2.sent, 60, "sentCount đọc từ DB, không phải đếm lại");
    assert.equal(db._store.sales[0].sentCount, 60);
});

test("tick NHẶT LẠI một đợt SENDING không ai giữ lease — đây là cơ chế resume sau deploy", async () => {
    // Test này chốt đúng cái bug mà `flashSaleTick` từng có: nó truyền `now` là MỘT SỐ
    // cho `runFlashSaleSend` (vốn gọi `now()` như một hàm). Lỗi bị `.catch()` nuốt và
    // log ra, nên đợt kẹt ở SENDING VĨNH VIỄN mà không có gì báo động.
    const users = makeUsers(40);
    const { db, mod: m, saleId } = await fresh({
        users,
        sale: { recipientTotal: 40, progressCursor: oid(14), sentCount: 15, opensAt: new Date(NOW + 600000), sendStartedAt: new Date(NOW - 5000) },
    });
    const tg = makeTelegram();
    const out = await m.flashSaleTick({ telegram: tg.telegram }, { now: NOW });

    assert.deepEqual(out.resumed, [saleId], "tick phải báo là đã resume đợt này");
    // `runFlashSaleSend` được gọi fire-and-forget nên phải chờ nó thật sự chạy xong.
    for (let i = 0; i < 200 && tg.sent.length < 25; i += 1) await new Promise((r) => setTimeout(r, 5));
    assert.equal(tg.sent.length, 25, "phải gửi tiếp 25 người còn lại");
    assert.equal(db._store.sales[0].sentCount, 40);
    assert.ok(!logs.some((l) => l.msg?.includes?.("resume") && l.type === "ERROR"),
        "không được có lỗi resume — TypeError `now is not a function` từng nằm ở đây");
});

test("tick KHÔNG resume một đợt đang có lease tươi — process khác đang gửi", async () => {
    const users = makeUsers(20);
    const { mod: m, saleId } = await fresh({
        users,
        sale: {
            recipientTotal: 20, opensAt: new Date(NOW + 600000), sendStartedAt: new Date(NOW - 5000),
            sendLeaseAt: new Date(NOW - 1000), sendLeaseOwner: "pid-khác",
        },
    });
    const tg = makeTelegram();
    await m.flashSaleTick({ telegram: tg.telegram }, { now: NOW });
    for (let i = 0; i < 40; i += 1) await new Promise((r) => setTimeout(r, 5));
    // Lease còn tươi nên acquireSendLease thất bại → không gửi gì. Hai process cùng gửi
    // là khách nhận hai tin giống hệt nhau.
    assert.equal(tg.sent.length, 0);
});

test("lease QUÁ HẠN (process cũ chết không kịp nhả) thì process mới giành được", async () => {
    const { db, mod: m, saleId } = await fresh({
        sale: { sendLeaseAt: new Date(NOW - 120000), sendLeaseOwner: "pid-chết" },
    });
    const got = await m.acquireSendLease(saleId, { owner: "pid-mới", now: NOW });
    assert.equal(got, true);
    assert.equal(db._store.sales[0].sendLeaseOwner, "pid-mới");
});

test("hai process giành lease CÙNG LÚC thì đúng một process thắng", async () => {
    const { db, mod: m, saleId } = await fresh({ sale: { sendLeaseAt: null } });
    const [a, b] = await Promise.all([
        m.acquireSendLease(saleId, { owner: "pid-A", now: NOW }),
        m.acquireSendLease(saleId, { owner: "pid-B", now: NOW }),
    ]);
    assert.equal([a, b].filter(Boolean).length, 1, "lease phải loại trừ lẫn nhau");
    assert.ok(["pid-A", "pid-B"].includes(db._store.sales[0].sendLeaseOwner));
});

test("không giành được lease trên đợt không còn SENDING", async () => {
    const { mod: m, saleId } = await fresh({ sale: { status: "OPEN" } });
    assert.equal(await m.acquireSendLease(saleId, { owner: "pid-A", now: NOW }), false);
});

test("hai vòng gửi CÙNG một đợt trong MỘT process → vòng sau từ chối ngay", async () => {
    const users = makeUsers(30);
    const { mod: m, saleId } = await fresh({ users, sale: { recipientTotal: 30 } });
    const tg1 = makeTelegram();
    const tg2 = makeTelegram();
    const p1 = m.runFlashSaleSend({ telegram: tg1.telegram }, saleId, { now: () => NOW });
    const out2 = await m.runFlashSaleSend({ telegram: tg2.telegram }, saleId, { now: () => NOW });
    assert.equal(out2.ok, false);
    assert.equal(out2.reason, "already_running_here");
    assert.equal(tg2.sent.length, 0);
    await p1;
});

// ─── §1 / §3: dừng giữa chừng ──────────────────────────────────────────────────────

test("🛑 Dừng gửi & đóng giữa chừng → vòng gửi cắt, con trỏ còn đó, đợt không bao giờ mở", async () => {
    const users = makeUsers(120);
    const { db, mod: m, saleId } = await fresh({
        users,
        sale: { recipientTotal: 120, opensAt: new Date(NOW - 1000), sendStartedAt: new Date(NOW) },
    });
    const tg = makeTelegram({
        // Admin bấm dừng sau khi bot gửi được 40 tin.
        behaviour: async (_chatId, n) => {
            if (n === 40) await m.closeFlashSale(saleId, { reason: "admin_stop_sending", now: NOW });
        },
    });
    const out = await m.runFlashSaleSend({ telegram: tg.telegram }, saleId, { now: () => NOW });

    assert.equal(out.ok, false);
    assert.equal(out.reason, "aborted");
    assert.ok(tg.sent.length >= 41 && tg.sent.length < 120,
        `phải dừng sớm, thực tế gửi ${tg.sent.length}/120`);
    assert.equal(db._store.sales[0].status, "CLOSED");
    assert.ok(db._store.sales[0].progressCursor, "con trỏ phải còn để admin biết đã dừng ở đâu");
    assert.equal(db._store.sales[0].sendFinishedAt, null, "không được đánh dấu đã gửi xong");

    // Và tick không bao giờ mở một đợt đã CLOSED — khách bấm Nhận phải thấy "đã kết thúc".
    const t = await m.flashSaleTick({ telegram: makeTelegram().telegram }, { now: NOW + 999999 });
    assert.deepEqual(t.opened, []);
    assert.equal(db._store.sales[0].status, "CLOSED");
});

test("tick cũng chốt FULL cho đợt OPEN đã đủ suất (lớp bảo hiểm)", async () => {
    const { db, mod: m } = await fresh({
        sale: { status: "OPEN", maxSlots: 3, acceptedCount: 3, sendFinishedAt: new Date(NOW), opensAt: new Date(NOW - 1000) },
    });
    await m.flashSaleTick({ telegram: {} }, { now: NOW });
    assert.equal(db._store.sales[0].status, "FULL");
});

test("tick KHÔNG chốt FULL khi maxSlots = 0 (không giới hạn)", async () => {
    const { db, mod: m } = await fresh({
        sale: { status: "OPEN", maxSlots: 0, acceptedCount: 500, sendFinishedAt: new Date(NOW), opensAt: new Date(NOW - 1000) },
    });
    await m.flashSaleTick({ telegram: {} }, { now: NOW });
    assert.equal(db._store.sales[0].status, "OPEN", "maxSlots=0 nghĩa là không giới hạn, không được đóng");
});

// ─── §3: đo tốc độ cho lần sau ────────────────────────────────────────────────────

test("gửi xong thì GHI LẠI tốc độ đo được, kèm 15% buffer", async () => {
    const users = makeUsers(100);
    const { db, mod: m, saleId } = await fresh({
        users,
        sale: { recipientTotal: 100, sendStartedAt: new Date(NOW - 60000) }, // 60s cho 100 người
    });
    const out = await m.runFlashSaleSend({ telegram: makeTelegram().telegram }, saleId, { now: () => NOW });

    // 60s / 100 người = 0.6s/người, ×1.15 buffer = 0.69
    assert.equal(out.secsPerUserNext, 0.69);
    const row = db._store.settings.find((s) => s.key === "flash_send_secs_per_user");
    assert.ok(row, "setting phải được sinh ra tự động (§7)");
    assert.equal(row.value, "0.69");
    assert.equal(await m.getSendSecsPerUser(), 0.69);
});

test("lần gửi ĐẦU TIÊN chưa có gì để đo → dùng hằng mặc định (§8)", async () => {
    const { mod: m } = await fresh({});
    assert.equal(await m.getSendSecsPerUser(), 0.05);
});

test("setting tốc độ rác → rơi về mặc định, không được ra NaN rồi in giờ mở '--:--'", async () => {
    for (const junk of ["abc", "0", "-1", "999", "", null]) {
        const { mod: m } = await fresh({
            settings: junk === null ? [] : [{ key: "flash_send_secs_per_user", value: junk }],
        });
        assert.equal(await m.getSendSecsPerUser(), 0.05, `giá trị ${JSON.stringify(junk)} phải về mặc định`);
    }
});

test("tốc độ đo được bị kẹp trong miền hợp lệ", async () => {
    const { mod: m } = await fresh({});
    // Quá nhanh (elapsedMs nhỏ bất thường) → không được ghi 0.0001 rồi dự đoán mở ngay.
    const fast = await m.recordSendMeasurement({ sentCount: 100000, elapsedMs: 10 });
    assert.ok(fast >= 0.005, `phải kẹp sàn 0.005, thực tế ${fast}`);
    // Quá chậm → không được ghi 600s/người rồi in giờ mở năm sau.
    const slow = await m.recordSendMeasurement({ sentCount: 1, elapsedMs: 60_000_000 });
    assert.ok(slow <= 10, `phải kẹp trần 10, thực tế ${slow}`);
    // Không đo được gì thì không ghi.
    assert.equal(await m.recordSendMeasurement({ sentCount: 0, elapsedMs: 1000 }), null);
    assert.equal(await m.recordSendMeasurement({ sentCount: 5, elapsedMs: 0 }), null);
});

test("giờ mở cho lần sau tính từ tốc độ ĐO ĐƯỢC, không từ hằng số", async () => {
    const { mod: m } = await fresh({
        settings: [{ key: "flash_send_secs_per_user", value: "0.5" }],
    });
    assert.equal(await m.getSendSecsPerUser(), 0.5);
    // 1000 khách × 0.5s = 500s + 20s an toàn = 520s → tròn lên phút
    const opens = m.estimateOpensAt({ startedAt: NOW, customerCount: 1000, secsPerUser: 0.5 });
    assert.equal(opens - NOW, Math.ceil(520000 / 60000) * 60000);
});

// ─── createFlashSale ───────────────────────────────────────────────────────────────

test("createFlashSale tạo đợt ở trạng thái SENDING với giờ mở tính TRƯỚC khi gửi", async () => {
    const users = makeUsers(500);
    const db = makeFlashDb({ users, sales: [], settings: [] });
    db._store.products.push({ id: "prod-1", _id: "prod-1", name: "Khoá học", price: 250000, currency: "VND", deliveryMode: "STOCK_LINES", isActive: true });
    CURRENT = db;

    const sale = await mod.createFlashSale({
        productId: "prod-1", discountPct: 30, validityMinutes: 45, maxSlots: 10, adminId: 111, now: NOW,
    });
    assert.equal(sale.status, "SENDING");
    assert.equal(sale.discountPct, 30);
    assert.equal(sale.validityMinutes, 45);
    assert.equal(sale.maxSlots, 10);
    assert.equal(sale.recipientTotal, 500, "phải đếm số khách KHÔNG bị chặn");
    assert.equal(sale.productName, "Khoá học");
    assert.equal(sale.productPrice, 250000);
    assert.equal(sale.totalDiscount, false);
    assert.equal(sale.createdBy, "111");
    // 500 × 0.05 = 25s + 20s = 45s → tròn lên 1 phút
    assert.equal(new Date(sale.opensAt).getTime() - NOW, 60000);
    // KHÔNG assert `sentCount === 0` ở đây: field đó do DEFAULTS của adapter
    // (`lib/prisma.js`) sinh ra lúc insert, không phải do `createFlashSale` ghi — và
    // mock này cố tình KHÔNG tái tạo DEFAULTS. Giá trị 0 lúc mới tạo thuộc về test
    // của chính adapter; ở đây mà bắt mock giả lập DEFAULTS là ta đang test cái mock.
});

test("createFlashSale từ chối % giảm ngoài 1–90", async () => {
    const db = makeFlashDb({ users: [], sales: [], settings: [] });
    db._store.products.push({ id: "prod-1", _id: "prod-1", name: "X", price: 1000, currency: "VND" });
    CURRENT = db;
    for (const bad of [0, 91, -5, null, "abc"]) {
        await assert.rejects(
            () => mod.createFlashSale({ productId: "prod-1", discountPct: bad, now: NOW }),
            /% giảm không hợp lệ/,
            `${JSON.stringify(bad)} phải bị từ chối`,
        );
    }
    assert.equal(db._store.sales.length, 0);
});

test("§8: một sản phẩm chỉ được có MỘT đợt đang chạy", async () => {
    const db = makeFlashDb({ users: makeUsers(5), sales: [], settings: [] });
    db._store.products.push({ id: "prod-1", _id: "prod-1", name: "X", price: 1000, currency: "VND" });
    CURRENT = db;

    const first = await mod.createFlashSale({ productId: "prod-1", discountPct: 20, now: NOW });
    assert.ok(first.id);

    const err = await mod.createFlashSale({ productId: "prod-1", discountPct: 30, now: NOW }).then(() => null, (e) => e);
    assert.ok(err, "đợt thứ hai trên cùng sản phẩm phải bị từ chối");
    assert.equal(err.code, "already_running");
    assert.equal(db._store.sales.length, 1);

    // Sản phẩm KHÁC thì vẫn chạy song song được (§8: không giới hạn số đợt đồng thời).
    db._store.products.push({ id: "prod-2", _id: "prod-2", name: "Y", price: 2000, currency: "VND" });
    const other = await mod.createFlashSale({ productId: "prod-2", discountPct: 30, now: NOW });
    assert.ok(other.id);
    assert.equal(db._store.sales.length, 2);
});

test("đợt đã CLOSED/FULL thì không chặn tạo đợt mới trên cùng sản phẩm", async () => {
    const db = makeFlashDb({ users: makeUsers(5), sales: [], settings: [] });
    db._store.products.push({ id: "prod-1", _id: "prod-1", name: "X", price: 1000, currency: "VND" });
    CURRENT = db;
    await mod.createFlashSale({ productId: "prod-1", discountPct: 20, now: NOW });
    await mod.closeFlashSale(db._store.sales[0].id, { now: NOW });

    const second = await mod.createFlashSale({ productId: "prod-1", discountPct: 30, now: NOW });
    assert.ok(second.id, "đợt cũ đã đóng thì phải cho tạo đợt mới");
    assert.equal(db._store.sales.length, 2);
});

test("createFlashSale với sản phẩm không tồn tại → ném, không tạo đợt mồ côi", async () => {
    const db = makeFlashDb({ users: makeUsers(5), sales: [], settings: [] });
    CURRENT = db;
    await assert.rejects(() => mod.createFlashSale({ productId: "prod-khong-ton-tai", discountPct: 30, now: NOW }),
        /không tìm thấy sản phẩm/);
    assert.equal(db._store.sales.length, 0);
});

test("hàng API key được đánh dấu totalDiscount lúc tạo đợt", async () => {
    const db = makeFlashDb({ users: makeUsers(5), sales: [], settings: [] });
    db._store.products.push({
        id: "prod-key", _id: "prod-key", code: "__API_KEY__", name: "API Key",
        price: 0, currency: "USD", deliveryMode: "API_KEY",
    });
    CURRENT = db;
    const sale = await mod.createFlashSale({ productId: "prod-key", discountPct: 30, now: NOW });
    assert.equal(sale.totalDiscount, true, "phải ghi luật giảm-trên-tổng-đơn vào đợt");
});
