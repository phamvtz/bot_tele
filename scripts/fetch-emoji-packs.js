/**
 * fetch-emoji-packs.js
 * Fetch custom emoji packs from Telegram and store in DB.
 * Run: node scripts/fetch-emoji-packs.js
 */
import "dotenv/config";
import prisma from "../src/lib/prisma.js";

const BOT_TOKEN = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) {
    console.error("❌ Missing BOT_TOKEN in .env");
    process.exit(1);
}

const PACK_NAMES = [
    "ApplicationEmojiCheapLuxuryAIBot",
    "ADROITPACKE",
    "ApplicationEmoji",
    "AppsIconsWB",
];

async function tgApi(method, params = {}) {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.description || "Telegram API error");
    return data.result;
}

async function main() {
    console.log("🚀 Fetching emoji packs from Telegram...\n");

    const packs = {};

    for (const name of PACK_NAMES) {
        process.stdout.write(`📦 ${name} ... `);
        try {
            const set = await tgApi("getStickerSet", { name });
            packs[name] = set.stickers.map((s) => ({
                emoji: s.emoji || "❓",
                id: s.custom_emoji_id || null,
                animated: s.is_animated || false,
                video: s.is_video || false,
            }));

            const withId = packs[name].filter((s) => s.id).length;
            console.log(`✅  ${set.stickers.length} stickers, ${withId} custom emoji`);
        } catch (err) {
            console.log(`❌  ${err.message}`);
            packs[name] = [];
        }
    }

    // Print summary table
    console.log("\n📊 Summary:");
    for (const [name, emojis] of Object.entries(packs)) {
        const chars = [...new Set(emojis.map((e) => e.emoji))].slice(0, 20).join(" ");
        console.log(`  ${name}: ${chars}`);
    }

    // Store in Setting table
    await prisma.setting.upsert({
        where: { key: "emoji_packs" },
        create: { key: "emoji_packs", value: JSON.stringify(packs) },
        update: { value: JSON.stringify(packs) },
    });

    const total = Object.values(packs).reduce((s, arr) => s + arr.filter((e) => e.id).length, 0);
    console.log(`\n✅ Saved to database. Total custom emoji with ID: ${total}`);

    if (typeof prisma.$disconnect === "function") await prisma.$disconnect();
}

main().catch((err) => {
    console.error("Fatal:", err.message);
    process.exit(1);
});
