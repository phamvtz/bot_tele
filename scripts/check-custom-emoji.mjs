/**
 * Chan doan icon dong (chi doc, khong ghi DB, khong gui tin nhan cho user).
 *   node scripts/check-custom-emoji.mjs
 *
 * Tra loi 2 cau hoi:
 *   1) 74 custom emoji ID trong DB con song khong? (getCustomEmojiStickers)
 *   2) Chu bot co Telegram Premium khong? (getChat tren ADMIN_IDS[0])
 */
import "dotenv/config";
import { Telegraf } from "telegraf";
import prisma from "../src/lib/prisma.js";
import { buildCustomEmojiCheckResult } from "../src/icon-utils.js";

const token = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
    console.error("Thieu BOT_TOKEN");
    process.exit(1);
}
const bot = new Telegraf(token);

const rows = await prisma.setting.findMany({});
const raw = rows.find((r) => r.key === "menu_button_ids")?.value || "{}";
const iconIds = JSON.parse(raw);

// --- 1) ID con song khong ---
const ids = [...new Set(Object.values(iconIds).map(String))];
console.log(`Kiem tra ${ids.length} ID duy nhat (tu ${Object.keys(iconIds).length} key)...\n`);
try {
    const stickers = await bot.telegram.callApi("getCustomEmojiStickers", { custom_emoji_ids: ids });
    const r = buildCustomEmojiCheckResult(iconIds, stickers);
    console.log(`ID hop le: ${r.valid}/${r.total}   |   ID chet: ${r.invalid}`);
    const bad = r.items.filter((i) => !i.valid);
    if (bad.length) {
        console.log("\nCac key co ID CHET (Telegram khong con nhan dien):");
        for (const i of bad) console.log(`   ${i.key} = ${i.id}`);
    } else {
        console.log("=> Toan bo ID con song. Van de KHONG phai do ID sai.");
    }
} catch (e) {
    console.log(`getCustomEmojiStickers LOI: ${e.message}`);
}

// --- 2) Thong tin chu bot ---
// LUU Y: Bot API KHONG tra is_premium trong getChat (field nay chi co tren object User,
// vi du message.from). Vay "khong tra ve" = KHONG DO DUOC, chu khong phai "khong co Premium".
// Cach duy nhat biet chac: bat CUSTOM_EMOJI_ICONS=true roi xem icon co render khong.
const ownerId = String(process.env.ADMIN_IDS || "").split(",")[0]?.trim();
console.log(`\nChu bot (ADMIN_IDS[0]) = ${ownerId || "(chua dat)"}`);
if (ownerId) {
    try {
        const chat = await bot.telegram.getChat(ownerId);
        console.log(`   username=@${chat.username || "?"}  is_premium=${chat.is_premium ?? "(getChat khong tra field nay)"}`);
        if (chat.is_premium === true) {
            console.log("=> Chu bot CO Premium. Icon dong le ra phai render duoc.");
        } else {
            console.log("=> KHONG KET LUAN duoc tu day. Bot API khong expose is_premium qua getChat.");
            console.log("   Kiem tra bang cach dat CUSTOM_EMOJI_ICONS=true, restart, roi /start xem icon.");
        }
    } catch (e) {
        console.log(`   getChat loi: ${e.message}`);
    }
}

const me = await bot.telegram.getMe();
console.log(`\nBot = @${me.username} (id=${me.id})`);
console.log("Luu y: neu bot da mua username tren Fragment thi icon dong cung hoat dong,");
console.log("khong lien quan Premium — Bot API khong co cach kiem tra dieu nay tu dong.");
process.exit(0);
