// Kiểm tra USER_UI trong bot.js có đủ key ở cả 3 ngôn ngữ.
// Thiếu key ở en/zh thì khách dùng ngôn ngữ đó thấy "undefined" trong tin nhắn.
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/bot.js", import.meta.url), "utf8");
const block = src.match(/const USER_UI = \{([\s\S]*?)\n    \};/);
if (!block) {
    console.error("❌ Không tìm thấy USER_UI trong src/bot.js");
    process.exit(1);
}

const langKeys = {};
for (const lang of ["vi", "en", "zh"]) {
    const seg = block[1].match(new RegExp(`\\n        ${lang}: \\{([\\s\\S]*?)\\n        \\}`));
    if (!seg) {
        console.error(`❌ Không tìm thấy khối ngôn ngữ ${lang}`);
        process.exit(1);
    }
    langKeys[lang] = new Set([...seg[1].matchAll(/^ {12}(\w+):/gm)].map((m) => m[1]));
    const feature = [...langKeys[lang]].filter((k) => /^(giftcode|apikey)/.test(k));
    console.log(`${lang}: ${langKeys[lang].size} key (giftcode/apikey: ${feature.length})`);
}

let failed = 0;
for (const lang of ["en", "zh"]) {
    const missing = [...langKeys.vi].filter((k) => !langKeys[lang].has(k));
    const extra = [...langKeys[lang]].filter((k) => !langKeys.vi.has(k));
    if (missing.length) { failed++; console.log(`❌ ${lang} thiếu: ${missing.join(", ")}`); }
    if (extra.length) { failed++; console.log(`❌ ${lang} có thêm (vi thiếu): ${extra.join(", ")}`); }
    if (!missing.length && !extra.length) console.log(`✅ ${lang} khớp hoàn toàn với vi`);
}

process.exit(failed ? 1 : 0);
