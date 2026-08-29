// Nạp toàn bộ module và đăng ký handler — bắt lỗi import vòng / thiếu export /
// tên hàm sai mà node --check không thấy. Không chạm DB, không gọi Telegram API.
process.env.BOT_TOKEN = process.env.BOT_TOKEN || "123:FAKE";
process.env.GPT2API_BASE = process.env.GPT2API_BASE || "https://api.example.com/api/admin-pub";
process.env.GPT2API_ADMIN_TOKEN = process.env.GPT2API_ADMIN_TOKEN || "adm_smoketest";
process.env.GPT2API_USER_ID = process.env.GPT2API_USER_ID || "smoke-user";

const [bots, admin, delivery, apiRoutes, keyboards, gpt2api, pricing] = await Promise.all([
    import("../src/bot.js"),
    import("../src/admin.js"),
    import("../src/delivery.js"),
    import("../src/api-routes.js"),
    import("../src/bot-ui/keyboards.js"),
    import("../src/gpt2api.js"),
    import("../src/apikey-pricing.js"),
]);

const bot = bots.createBot({});
admin.registerAdminCommands(bot);
console.log("✅ bot + admin handler đăng ký được");

// Menu chính phải có cả hai nút mới khi GPT2API đã cấu hình.
const rows = keyboards.buildMainMenuKeyboard({ lang: "vi" }).reply_markup.inline_keyboard;
const labels = rows.flat().map((b) => b.text);
const wanted = ["Nhập GIFTCODE", "Tạo API key"];
for (const w of wanted) {
    const found = labels.some((l) => l.includes(w));
    console.log(`${found ? "✅" : "❌"} menu chính có nút "${w}"`);
    if (!found) process.exitCode = 1;
}

// Ẩn nút khi thiếu cấu hình.
delete process.env.GPT2API_ADMIN_TOKEN;
gpt2api.invalidateGpt2apiConfig();
const hiddenLabels = keyboards.buildMainMenuKeyboard({ lang: "vi" }).reply_markup.inline_keyboard.flat().map((b) => b.text);
const stillThere = hiddenLabels.some((l) => l.includes("Tạo API key"));
console.log(`${stillThere ? "❌" : "✅"} thiếu adm_ token thì nút bị ẩn`);
if (stillThere) process.exitCode = 1;
process.env.GPT2API_ADMIN_TOKEN = "adm_smoketest";
gpt2api.invalidateGpt2apiConfig();

// Body gửi provider: không có group nào cấu hình → KHÔNG gửi fallback_allowed_groups.
const body = gpt2api.buildCreateKeyBody({
    userId: "u1", name: "smoke", quotaTokens: 6_000_000, rpm: 300, models: ["m1"], fallbackGroups: [],
});
const omitted = !("fallback_allowed_groups" in body) && !("fallback_order" in body);
console.log(`${omitted ? "✅" : "❌"} group rỗng → bỏ hẳn field fallback (server tự áp mọi group)`);
if (!omitted) process.exitCode = 1;

const withGroups = gpt2api.buildCreateKeyBody({
    userId: "u1", name: "smoke", quotaTokens: 6_000_000, fallbackGroups: ["g1", "g2"],
});
const sent = withGroups.fallback_allowed_groups?.length === 2 && withGroups.fallback_order?.length === 2;
console.log(`${sent ? "✅" : "❌"} có group cấu hình → gửi đủ cả allowed_groups và order`);
if (!sent) process.exitCode = 1;

// delivery.js phải nhận diện API_KEY
const hasApiKeyMode = /case "API_KEY":/.test(
    await (await import("node:fs/promises")).readFile(new URL("../src/delivery.js", import.meta.url), "utf8"),
);
console.log(`${hasApiKeyMode ? "✅" : "❌"} delivery.js có nhánh giao API_KEY`);
if (!hasApiKeyMode) process.exitCode = 1;

console.log(`\n${process.exitCode ? "Có kiểm tra thất bại" : "Tất cả kiểm tra đạt"}`);
process.exit(process.exitCode || 0);
