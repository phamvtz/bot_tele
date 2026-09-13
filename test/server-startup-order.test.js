import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Test CẤU TRÚC của `src/server.js` — KHÔNG import file đó.
 *
 * `server.js` là entry point: import nó là `bot.launch()` chạy thật bằng token
 * production, thành một poller thứ hai và Telegram sẽ 409 giết poller trên VPS.
 * Vì vậy test ở đây đọc NGUỒN và chốt thứ tự các câu lệnh.
 *
 * Bug nó khoá lại (thật, phát hiện 2026-09-13): hai `setInterval` của lưới huỷ đơn
 * quá hạn và broadcast hẹn giờ nằm ở CUỐI một chuỗi ~20 `await` trong
 * `startRuntimeServices`. Một bước treo vĩnh viễn (nghi phạm: `checkAllStock` gửi
 * tin Telegram cho ADMIN_IDS, không timeout) là chúng KHÔNG BAO GIỜ được đăng ký.
 * Treo chứ không ném, nên khối `catch` + retry 10s cũng không thấy gì: log sạch,
 * `runtimeReady` mãi false, và 10 đơn PENDING tồn 5 tiếng thay vì bị huỷ sau 25 phút.
 */

const SRC = readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

/** Bỏ comment — comment của chính fix này nhắc tới `checkAllStock`/`setInterval`. */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
    .join("\n");

const at = (needle) => {
    const i = CODE.indexOf(needle);
    assert.ok(i >= 0, `không thấy \`${needle}\` trong server.js (sau khi bỏ comment)`);
    return i;
};

test("lưới huỷ đơn quá hạn được đăng ký TRƯỚC mọi bước warm-up có thể treo", () => {
    assert.ok(
        at("setInterval(cancelExpiredOrders") < at('runStartupStep("checkAllStock"'),
        "setInterval(cancelExpiredOrders) phải chạy trước checkAllStock — "
        + "checkAllStock treo là lưới huỷ đơn không bao giờ được đăng ký",
    );
    assert.ok(
        at("setInterval(processScheduledBroadcasts") < at('runStartupStep("checkAllStock"'),
        "setInterval(processScheduledBroadcasts) cũng vậy",
    );
});

/**
 * Bug GỐC, nặng hơn nhiều so với thứ tự các bước: `await bot.launch()`.
 *
 * Telegraf 4 trả về một promise chỉ settle khi bot DỪNG. `await` nó ở giữa
 * `startRuntimeServices` là treo vĩnh viễn, nên command menu, `initVipLevels`, mọi
 * warm-up cache, hai `setInterval` và `runtimeReady = true` CHƯA TỪNG CHẠY trên
 * production. Bot vẫn nhận update bình thường (launch đã khởi động polling trước khi
 * promise treo) nên không ai nhận ra — dấu hiệu duy nhất là dòng
 * "🤖 Bot launched successfully!" vắng mặt trong log suốt nhiều tháng.
 */
test("KHÔNG được await bot.launch() ở giữa hàm khởi động", () => {
    assert.doesNotMatch(CODE, /await\s+bot\.launch\s*\(/, "await bot.launch() là treo vĩnh viễn");
    assert.doesNotMatch(
        CODE,
        /await\s+retryTelegramStartup\([^)]*bot\.launch/,
        "bọc qua retryTelegramStartup mà vẫn await thì cũng treo y hệt",
    );
    // Vẫn phải giữ retry khi bị 409 (hai instance cùng polling một token) — chỉ là
    // chuỗi retry đó chạy nền chứ không chặn phần khởi động còn lại.
    assert.match(CODE, /retryTelegramStartup\(label, \(\) => bot\.launch\(\)\)\.catch\(/);
});

test("hai lưới an toàn đăng ký trước cả getMe — không await nào đứng trước chúng", () => {
    const nets = at("setInterval(cancelExpiredOrders");
    assert.ok(nets < at('retryTelegramStartup("getMe"'), "getMe là lời gọi Telegram đầu tiên; lưới phải có trước nó");
    assert.ok(nets < at("await initVipLevels()"), "initVipLevels phải sau lưới");
    assert.ok(nets < at("await warmShopConfig()"), "warmShopConfig phải sau lưới");
    assert.ok(nets < at('runStartupStep("checkAllStock"'), "checkAllStock phải sau lưới");
});

test("checkAllStock và cleanOldExports chạy QUA runStartupStep, không await trần", () => {
    // `await checkAllStock(bot)` trần là đúng cái đã treo: không trần thời gian, không
    // catch, và nằm giữa chuỗi await nên chặn mọi thứ phía sau.
    assert.doesNotMatch(CODE, /await\s+checkAllStock\s*\(/, "không được await trần checkAllStock");
    assert.doesNotMatch(CODE, /await\s+cleanOldExports\s*\(/, "không được await trần cleanOldExports");
    assert.match(CODE, /runStartupStep\("checkAllStock",\s*\(\)\s*=>\s*checkAllStock\(bot\)\)/);
    assert.match(CODE, /runStartupStep\("cleanOldExports",\s*\(\)\s*=>\s*cleanOldExports\(24\)\)/);
});

test("runStartupStep có trần thời gian thật và KHÔNG ném ra ngoài", () => {
    const body = CODE.slice(at("async function runStartupStep"), at("async function startRuntimeServices"));
    assert.match(body, /Promise\.race\(/, "phải đua với một trần thời gian");
    assert.match(body, /setTimeout\(/, "trần thời gian phải là setTimeout");
    assert.match(body, /catch/, "hết trần thì LOG, không ném — ném là khối catch retry cả startup");
    assert.doesNotMatch(body, /throw /, "runStartupStep không được ném");
});

test("runtimeReady chỉ bật SAU khi lưới an toàn đã đăng ký", () => {
    assert.ok(
        at("setInterval(cancelExpiredOrders") < at("runtimeReady = true"),
        "runtimeReady = true phải nằm sau setInterval(cancelExpiredOrders)",
    );
});

test("cả hai setInterval nằm TRONG startRuntimeServices, không trôi ra ngoài", () => {
    const start = at("async function startRuntimeServices");
    assert.ok(at("setInterval(cancelExpiredOrders") > start);
    assert.ok(at("setInterval(processScheduledBroadcasts") > start);
    assert.ok(at("runtimeReady = true") > start);
});

test("vẫn log mốc để đối chiếu trên VPS", () => {
    // `⏰ Order expiration check started` là bằng chứng duy nhất trên log rằng lưới huỷ
    // đơn đã sống. Mất dòng này là mất luôn cách phát hiện bug quay lại.
    assert.match(CODE, /Order expiration check started/);
});
