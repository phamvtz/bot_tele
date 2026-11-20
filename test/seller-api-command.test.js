import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolvePublicBaseUrl, invalidateShopConfig } from "../src/shop-config.js";

test("resolvePublicBaseUrl lấy origin hợp lệ từ MINI_APP_URL hoặc env và bỏ qua placeholder lỗi", () => {
    const prev = {
        API_PUBLIC_URL: process.env.API_PUBLIC_URL,
        PUBLIC_URL: process.env.PUBLIC_URL,
        WEBHOOK_URL: process.env.WEBHOOK_URL,
        MINI_APP_URL: process.env.MINI_APP_URL,
    };
    try {
        delete process.env.API_PUBLIC_URL;
        delete process.env.PUBLIC_URL;
        process.env.WEBHOOK_URL = "https://<domain-shop>";
        process.env.MINI_APP_URL = "https://103-20-102-211.sslip.io/app/?v=2";
        invalidateShopConfig();

        assert.equal(resolvePublicBaseUrl(), "https://103-20-102-211.sslip.io");

        process.env.WEBHOOK_URL = "https://SERVER/bot";
        assert.equal(resolvePublicBaseUrl(), "https://103-20-102-211.sslip.io");

        process.env.API_PUBLIC_URL = "https://api.example.com/custom/";
        assert.equal(resolvePublicBaseUrl(), "https://api.example.com");

        delete process.env.API_PUBLIC_URL;
        delete process.env.MINI_APP_URL;
        invalidateShopConfig();
        assert.equal(resolvePublicBaseUrl(), "");
    } finally {
        for (const [k, v] of Object.entries(prev)) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
        invalidateShopConfig();
    }
});

test("bot.js /api (showApiInfo) không chứa thẻ giả <domain-shop>, escape HTML và dùng /api/seller chuẩn", () => {
    const botSrc = readFileSync(new URL("../src/bot.js", import.meta.url), "utf8");
    const adminSrc = readFileSync(new URL("../src/admin.js", import.meta.url), "utf8");
    const sellerSrc = readFileSync(new URL("../src/seller-api.js", import.meta.url), "utf8");
    const userSrc = readFileSync(new URL("../src/user-api.js", import.meta.url), "utf8");

    assert.equal(botSrc.includes("<domain-shop>"), false, "bot.js không được chứa thẻ <domain-shop> gây lỗi HTML parser của Telegram");

    const apiBlockStart = botSrc.indexOf("const showApiInfo = async");
    const apiBlockEnd = botSrc.indexOf("bot.command(\"api\"", apiBlockStart);
    assert.ok(apiBlockStart > 0 && apiBlockEnd > apiBlockStart);
    const apiBlock = botSrc.slice(apiBlockStart, apiBlockEnd);

    assert.match(apiBlock, /resolvePublicBaseUrl\(\)/);
    assert.match(apiBlock, /escapeHtml\(userKey\)/);
    assert.match(apiBlock, /escapeHtml\(sellerBase\)/);
    assert.match(apiBlock, /\/api\/seller/);
    assert.match(apiBlock, /"tokens":\s*1000000/);

    // Seller & User API đều hỗ trợ tokens và alias quotaTokens
    assert.match(sellerSrc, /b\.tokens\s*\?\?\s*b\.quotaTokens/);
    assert.match(userSrc, /b\.tokens\s*\?\?\s*b\.quotaTokens/);

    // Admin Seller API dùng HTML mode và escape tên key (tránh lỗi ký tự _ trong @username)
    const adminSellerStart = adminSrc.indexOf("function buildSellerApiScreen");
    const adminSellerEnd = adminSrc.indexOf("bot.action(\"ADMIN:EXPORT\"", adminSellerStart);
    const adminBlock = adminSrc.slice(adminSellerStart, adminSellerEnd);
    assert.match(adminBlock, /parse_mode:\s*"HTML"/);
    assert.match(adminBlock, /escapeHtml\(k\.name/);
    assert.doesNotMatch(adminBlock, /parse_mode:\s*"Markdown"/);
});
