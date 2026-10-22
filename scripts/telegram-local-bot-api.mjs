#!/usr/bin/env node
/**
 * scripts/telegram-local-bot-api.mjs
 * 
 * Hỗ trợ vận hành chuyển đổi giữa Telegram Cloud API và Telegram Local Bot API.
 * 
 * Lệnh hỗ trợ:
 *   node scripts/telegram-local-bot-api.mjs status
 *   node scripts/telegram-local-bot-api.mjs logout-cloud <BOT_TOKEN>
 *   node scripts/telegram-local-bot-api.mjs test-local <BOT_TOKEN>
 *   node scripts/telegram-local-bot-api.mjs close-local <BOT_TOKEN>
 */

import "dotenv/config";

const command = process.argv[2] || "status";
const tokenArg = process.argv[3] || process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
const apiRoot = process.env.TELEGRAM_API_ROOT || "http://telegram-bot-api:8081";

function maskToken(token) {
    if (!token) return "(không có)";
    const parts = token.split(":");
    if (parts.length < 2) return "***";
    return `${parts[0]}:***${parts[1].slice(-4)}`;
}

async function checkStatus() {
    console.log("=== KIỂM TRA CẤU HÌNH TELEGRAM BOT API ===");
    console.log(`- TELEGRAM_API_ROOT: ${process.env.TELEGRAM_API_ROOT || "(chưa set -> mặc định https://api.telegram.org)"}`);
    console.log(`- BOT_TOKEN:         ${maskToken(tokenArg)}`);

    if (process.env.TELEGRAM_API_ROOT) {
        console.log(`\nĐang kết nối thử tới local server: ${process.env.TELEGRAM_API_ROOT}...`);
        try {
            const res = await fetch(process.env.TELEGRAM_API_ROOT, { signal: AbortSignal.timeout(4000) });
            console.log(`✅ Kết nối thành công tới local server (HTTP status: ${res.status})`);
        } catch (e) {
            console.log(`⚠️ Không thể kết nối tới ${process.env.TELEGRAM_API_ROOT}: ${e.message}`);
        }
    }
}

async function logoutCloud(token) {
    if (!token) {
        console.error("❌ Thiếu BOT_TOKEN. Dùng: node scripts/telegram-local-bot-api.mjs logout-cloud <TOKEN>");
        process.exit(1);
    }
    console.log(`⏳ Đang gọi logOut trên Telegram Cloud (api.telegram.org) cho token ${maskToken(token)}...`);
    try {
        const res = await fetch(`https://api.telegram.org/bot${token}/logOut`, {
            method: "POST",
            signal: AbortSignal.timeout(10000),
        });
        const data = await res.json();
        if (data.ok) {
            console.log("✅ Đã logOut thành công khỏi Telegram Cloud!");
            console.log("⚠️ LƯU Ý QUAN TRỌNG: Telegram cần khoảng 10 phút để nhả phiên hoàn toàn.");
            console.log("👉 Bây giờ bạn có thể thêm `TELEGRAM_API_ROOT` vào .env và khởi động bot với local server.");
        } else {
            console.error("❌ logOut thất bại từ Telegram Cloud:", data);
        }
    } catch (e) {
        console.error("❌ Lỗi mạng khi gọi logOut:", e.message);
    }
}

async function testLocal(token) {
    if (!token) {
        console.error("❌ Thiếu BOT_TOKEN.");
        process.exit(1);
    }
    const root = process.env.TELEGRAM_API_ROOT || "http://127.0.0.1:8081";
    console.log(`🔍 Đang kiểm tra getMe trên Local Server (${root}) cho bot ${maskToken(token)}...`);
    try {
        const res = await fetch(`${root}/bot${token}/getMe`, { signal: AbortSignal.timeout(10000) });
        const data = await res.json();
        if (data.ok) {
            console.log("🎉 Bot đã kết nối thành công với Local Bot API server!");
            console.log(`- Username:   @${data.result.username}`);
            console.log(`- First Name: ${data.result.first_name}`);
            console.log(`- Bot ID:     ${data.result.id}`);
        } else {
            console.error("⚠️ Local server trả về lỗi:", data);
        }
    } catch (e) {
        console.error("❌ Lỗi kết nối tới local server:", e.message);
    }
}

async function closeLocal(token) {
    if (!token) {
        console.error("❌ Thiếu BOT_TOKEN.");
        process.exit(1);
    }
    const root = process.env.TELEGRAM_API_ROOT || "http://127.0.0.1:8081";
    console.log(`⏳ Đang gọi close trên Local Server (${root}) cho bot ${maskToken(token)}...`);
    try {
        const res = await fetch(`${root}/bot${token}/close`, {
            method: "POST",
            signal: AbortSignal.timeout(10000),
        });
        const data = await res.json();
        if (data.ok) {
            console.log("✅ Đã close bot trên Local Server thành công!");
            console.log("👉 Bạn có thể xoá TELEGRAM_API_ROOT khỏi .env và chuyển lại về Cloud sau ~10 phút.");
        } else {
            console.error("⚠️ Local server trả về lỗi:", data);
        }
    } catch (e) {
        console.error("❌ Lỗi kết nối tới local server:", e.message);
    }
}

switch (command) {
    case "status":
        await checkStatus();
        break;
    case "logout-cloud":
        await logoutCloud(tokenArg);
        break;
    case "test-local":
        await testLocal(tokenArg);
        break;
    case "close-local":
        await closeLocal(tokenArg);
        break;
    default:
        console.log("Lệnh hợp lệ: status | logout-cloud | test-local | close-local");
}
