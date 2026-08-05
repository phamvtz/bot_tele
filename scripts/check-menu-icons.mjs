/**
 * Kiểm tra 2 Setting row điều khiển icon (chỉ đọc, không ghi gì).
 *   node scripts/check-menu-icons.mjs
 */
import "dotenv/config";
import prisma from "../src/lib/prisma.js";

const rows = await prisma.setting.findMany({});
const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]));

for (const key of ["menu_buttons", "menu_button_ids"]) {
    const raw = byKey[key];
    if (raw === undefined) {
        console.log(`${key}: KHONG CO ROW`);
        continue;
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        console.log(`${key}: JSON LOI -> ${e.message} | raw=${String(raw).slice(0, 120)}`);
        continue;
    }
    const keys = Object.keys(parsed);
    console.log(`${key}: ${keys.length} key`);
    if (key === "menu_button_ids" && keys.length) {
        console.log("  => Cac key dang dung custom emoji ID (se mat icon neu bot khong co Premium/Fragment):");
        for (const k of keys) console.log(`     ${k} = ${parsed[k]}`);
    }
    if (key === "menu_buttons") {
        const empty = keys.filter((k) => !String(parsed[k] ?? "").trim());
        if (empty.length) console.log(`  => ${empty.length} key co emoji tinh RONG: ${empty.join(", ")}`);
    }
}

console.log(`\nCUSTOM_EMOJI_ICONS env = ${process.env.CUSTOM_EMOJI_ICONS ?? "(chua dat)"}`);
process.exit(0);
