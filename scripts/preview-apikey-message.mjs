// Xem trước tin nhắn giao key (không chạm DB/Telegram) — đối chiếu với ảnh mẫu.
import { apiKeyMessage, myKeysMessage } from "../src/bot-ui/apikey-messages.js";
import { iconOf } from "../src/menu-config.js";

const sample = {
    key: "sk-preview00000000000000000000000000000000000",
    quotaTokens: 6_000_000,
    rpm: 300,
    models: [
        "claude-opus-5", "claude-opus-4-8", "claude-opus-4-7",
        "claude-sonnet-5", "claude-sonnet-4-6", "claude-haiku-4-5", "claude-fable-5",
    ],
    endpoint: "https://api.xpiki.com/v1",
    usageUrl: "https://api.xpiki.com/key",
    icon: iconOf,
};

for (const lang of ["en", "vi"]) {
    console.log(`\n===== GIFTCODE (${lang}) =====`);
    console.log(apiKeyMessage({ ...sample, kind: "gift", lang }));
}

console.log("\n===== MUA KEY (vi) =====");
console.log(apiKeyMessage({ ...sample, kind: "buy", priceUsd: 0.06, quotaTokens: 6_000_000, lang: "vi" }));

console.log("\n===== /mykey (vi) =====");
console.log(myKeysMessage([
    { key: sample.key, quotaTokens: 6_000_000, rpm: 300, source: "GIFTCODE", createdAt: new Date() },
    { key: "sk-abcdef0123456789", quotaTokens: 20_000_000, rpm: 300, source: "PURCHASE", createdAt: new Date() },
], { lang: "vi", icon: iconOf }));
