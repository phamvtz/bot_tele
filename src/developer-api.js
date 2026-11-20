import { resolvePublicBaseUrl } from "./shop-config.js";
import { getOrCreateSellerKeyForUser, resolveSellerRoleAndScopes } from "./seller-api.js";
import { sellerUsageSince } from "./apikey-store.js";
import { getUserApiKey } from "./user-api.js";
import { getBalance } from "./wallet.js";
import { maskApiKey } from "./lib/mask-secret.js";
import { dayKey, dayStartUtc, DEFAULT_TZ_OFFSET_MINUTES } from "./spend-stats.js";

/**
 * Danh sách endpoint chính thức của Seller API (/api/seller) và User API (/api/user),
 * dùng chung cho Mini App / Web Storefront.
 */
export const SELLER_API_ENDPOINTS = Object.freeze([
    { method: "GET", path: "/me", desc: "Kiểm tra số dư ví liên kết (hoặc /balance)" },
    { method: "GET", path: "/profiles", desc: "Bảng giá $/1M token & danh sách server" },
    { method: "POST", path: "/keys", desc: "Tạo Key AI cho khách (tự động trừ ví)" },
    { method: "GET", path: "/keys", desc: "Danh sách Key AI đã cấp" },
    { method: "GET", path: "/keys/:id", desc: "Chi tiết quota token & trạng thái Key" },
    { method: "PATCH", path: "/keys/:id", desc: "Gia hạn Token / Ngày (tự động trừ ví)" },
    { method: "PATCH", path: "/keys/:id/enabled", desc: "Tạm khóa / Mở lại Key" },
    { method: "DELETE", path: "/keys/:id", desc: "Thu hồi Key" },
    { method: "POST", path: "/giftcode/redeem", desc: "Đổi mã quà tặng" },
]);

export const USER_API_ENDPOINTS = Object.freeze([
    { method: "GET", path: "/products", desc: "Danh sách sản phẩm số đang mở bán" },
    { method: "POST", path: "/purchase", desc: "Mua tài khoản / thẻ tự động bằng ví" },
    { method: "GET", path: "/orders", desc: "Danh sách đơn hàng đã mua" },
    { method: "GET", path: "/orders/:id", desc: "Chi tiết & nội dung giao hàng của đơn" },
]);

function toPositiveInt(value) {
    const n = Math.floor(Number(value));
    return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Tạo các mẫu lệnh cURL chuẩn theo base URL và API key của người dùng.
 */
export function buildDeveloperCurlExamples({
    sellerBase = "/api/seller",
    userBase = "/api/user",
    sellerKey = "sk_...",
    userKey = sellerKey,
} = {}) {
    return {
        createKey: [
            `curl -X POST "${sellerBase}/keys" \\`,
            `  -H "Authorization: Bearer ${sellerKey}" \\`,
            `  -H "Content-Type: application/json" \\`,
            `  -d '{`,
            `    "tokens": 1000000,`,
            `    "name": "DonHang_01",`,
            `    "validDays": 30`,
            `  }'`,
        ].join("\n"),
        balance: [
            `curl -s "${sellerBase}/me" \\`,
            `  -H "Authorization: Bearer ${sellerKey}"`,
        ].join("\n"),
        purchase: [
            `curl -X POST "${userBase}/purchase" \\`,
            `  -H "Authorization: Bearer ${userKey}" \\`,
            `  -H "Content-Type: application/json" \\`,
            `  -d '{`,
            `    "productId": "PRODUCT_ID",`,
            `    "quantity": 1`,
            `  }'`,
        ].join("\n"),
    };
}

/**
 * Thu thập đầy đủ thông tin API Seller / Reseller cho user đang đăng nhập Mini App hoặc Web Shop.
 */
export async function resolveDeveloperApiPayload({ user, requestOrigin = "", deps = {} } = {}) {
    const telegramId = String(user?.telegramId || "").trim();
    if (!telegramId) {
        const err = new Error("Thiếu thông tin tài khoản Telegram.");
        err.statusCode = 400;
        throw err;
    }

    const getOrCreateSellerKeyFn = deps.getOrCreateSellerKeyFn || getOrCreateSellerKeyForUser;
    const getUserApiKeyFn = deps.getUserApiKeyFn || getUserApiKey;
    const resolvePublicBaseUrlFn = deps.resolvePublicBaseUrlFn || resolvePublicBaseUrl;
    const getBalanceFn = deps.getBalanceFn || getBalance;
    const sellerUsageSinceFn = deps.sellerUsageSinceFn || sellerUsageSince;

    const sellerKeyObj = await getOrCreateSellerKeyFn({
        telegramId,
        name: user?.firstName || "",
        username: user?.username || "",
    }).catch((err) => {
        console.warn("[developer-api] getOrCreateSellerKeyForUser fallback:", err?.message);
        return null;
    });

    let personalUserKey = null;
    try {
        personalUserKey = getUserApiKeyFn(telegramId) || null;
    } catch {
        personalUserKey = null;
    }

    const apiKey = String(sellerKeyObj?.key || personalUserKey || "").trim();
    if (!apiKey) {
        const err = new Error("API kết nối chưa được cấu hình trên máy chủ. Vui lòng liên hệ hỗ trợ.");
        err.statusCode = 503;
        throw err;
    }

    const hasDistinctUserKey = Boolean(personalUserKey && personalUserKey !== apiKey);
    const cleanRequestOrigin = String(requestOrigin || "").trim().replace(/\/$/, "");
    const baseUrl = resolvePublicBaseUrlFn() || cleanRequestOrigin;
    const originPrefix = baseUrl || "";
    const sellerBase = originPrefix ? `${originPrefix}/api/seller` : "/api/seller";
    const userBase = originPrefix ? `${originPrefix}/api/user` : "/api/user";
    const userDocsUrl = originPrefix ? `${originPrefix}/api/user/docs` : "/api/user/docs";

    const [balanceVnd, usageToday] = await Promise.all([
        getBalanceFn(telegramId).catch(() => 0),
        sellerKeyObj?.id
            ? sellerUsageSinceFn(
                sellerKeyObj.id,
                dayStartUtc(dayKey(new Date(), DEFAULT_TZ_OFFSET_MINUTES), DEFAULT_TZ_OFFSET_MINUTES),
            ).catch(() => ({ keys: 0, tokens: 0 }))
            : Promise.resolve({ keys: 0, tokens: 0 }),
    ]);

    const limits = {
        maxKeysPerDay: toPositiveInt(sellerKeyObj?.maxKeysPerDay),
        maxTokensPerDay: toPositiveInt(sellerKeyObj?.maxTokensPerDay),
    };

    const effectiveUserKey = personalUserKey || apiKey;
    const { role, scopes } = resolveSellerRoleAndScopes(sellerKeyObj || { key: apiKey });

    return {
        ok: true,
        apiKey,
        maskedKey: maskApiKey(apiKey),
        role,
        scopes,
        personalUserKey: hasDistinctUserKey ? personalUserKey : null,
        maskedPersonalUserKey: hasDistinctUserKey ? maskApiKey(personalUserKey) : null,
        hasDistinctUserKey,
        supportsUserApi: Boolean(personalUserKey) && (apiKey === personalUserKey || apiKey.startsWith("sk_u_v2_")),
        active: sellerKeyObj ? sellerKeyObj.active !== false : true,
        keyName: sellerKeyObj?.name || "",
        createdAt: sellerKeyObj?.createdAt || null,
        balanceVnd: Number(balanceVnd) || 0,
        limits,
        usageToday: {
            keys: Number(usageToday?.keys) || 0,
            tokens: Number(usageToday?.tokens) || 0,
        },
        baseUrl: originPrefix,
        sellerBase,
        userBase,
        userDocsUrl,
        curls: buildDeveloperCurlExamples({
            sellerBase,
            userBase,
            sellerKey: apiKey,
            userKey: effectiveUserKey,
        }),
        maskedCurls: buildDeveloperCurlExamples({
            sellerBase,
            userBase,
            sellerKey: maskApiKey(apiKey),
            userKey: maskApiKey(effectiveUserKey),
        }),
        sellerEndpoints: SELLER_API_ENDPOINTS,
        userEndpoints: USER_API_ENDPOINTS,
    };
}
