import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { serializeOrderForSeller } from "../src/seller-api.js";

// Seller API là endpoint CÔNG KHAI, xác thực bằng một key mà chức năng của nó chỉ là
// NẠP HÀNG (supplier đẩy dòng tồn kho lên). Nó không được nhìn thấy hàng đã bán.
//
// Bug đã sửa: GET /api/seller/orders/:id từng làm `res.json({ order: { ...order } })`
// — spread TOÀN BỘ document. Mà `Order.deliveryContent` chứa payload đã giao: đơn API
// key là chuỗi `sk-*` THẬT của khách, đơn STOCK_LINES là tài khoản/mật khẩu đã bán.
// Kèm theo là odelegramId, chatId, userId, paymentRef, cryptoAddress. Liệt kê id từ
// GET /orders (100/lần) rồi đọc từng cái là lấy được toàn bộ hàng shop đã giao — và
// hàng đó dùng được ngay, không thu hồi lại được.

/** Một order đầy đủ mọi field nhạy cảm, đúng theo schema.prisma. */
const LEAKY_ORDER = {
    id: "ckorder0000001",
    oderId: "oder-1",
    odelegramId: "777888999",
    chatId: "-1001234567890",
    userId: "user-secret-1",
    productId: "prod-1",
    quantity: 1,
    amount: 25000,
    discount: 0,
    finalAmount: 25000,
    currency: "VND",
    status: "DELIVERED",
    paymentMethod: "wallet",
    paymentRef: "WALLET:ckorder0000001",
    cryptoNetwork: "trc20",
    cryptoAmount: 1.000123,
    cryptoAddress: "TSecretWalletAddress123",
    cryptoToken: "USDT",
    cryptoUsdVndRate: 25000,
    displayFinalUsd: 1.0,
    deliveryRef: "API_KEY",
    // Đây là thứ nguy hiểm nhất: chuỗi sk-* thật của khách nằm trong JSON này.
    deliveryContent: JSON.stringify({
        key: "sk-REAL-CUSTOMER-KEY-MUST-NEVER-LEAK",
        quotaTokens: 20_000_000,
        rpm: 600,
        validDays: 30,
        expiresAt: "2026-12-31T00:00:00.000Z",
        models: ["claude-opus-5"],
        endpoint: "https://api.internal.example/v1",
    }),
    deliveryError: "internal detail",
    deliveryRetryBlockedAt: null,
    cancelReason: null,
    couponId: "coupon-secret",
    couponReservedAt: null,
    walletSettledAt: null,
    manualPaidAt: null,
    manualDeliveredAt: null,
    expiresAt: null,
    createdAt: new Date("2026-09-10T10:00:00.000Z"),
    updatedAt: new Date("2026-09-10T10:05:00.000Z"),
    product: { id: "prod-1", name: "API Key" },
};

const FORBIDDEN_VALUES = [
    "sk-REAL-CUSTOMER-KEY-MUST-NEVER-LEAK",
    "777888999",                 // odelegramId
    "-1001234567890",             // chatId
    "user-secret-1",              // userId
    "WALLET:ckorder0000001",      // paymentRef
    "TSecretWalletAddress123",    // cryptoAddress
    "coupon-secret",              // couponId
    "https://api.internal.example/v1", // endpoint nội bộ trong deliveryContent
    "internal detail",            // deliveryError
];

const FORBIDDEN_KEYS = [
    "deliveryContent", "deliveryError", "deliveryRef", "deliveryRetryBlockedAt",
    "odelegramId", "chatId", "userId", "paymentRef",
    "cryptoAddress", "cryptoAmount", "cryptoNetwork", "cryptoToken", "cryptoUsdVndRate",
    "couponId", "couponReservedAt", "couponReleasedAt",
    "walletSettledAt", "manualPaidAt", "manualDeliveredAt",
    "cancelReason", "canceledAt", "displayFinalUsd", "displayUnitPrice", "displayCurrency",
    "expiresAt", "updatedAt", "oderId",
    // `product` KHÔNG nằm ở đây: serializer cố tình trả TÊN sản phẩm dạng chuỗi
    // (endpoint danh sách luôn làm vậy). Thứ bị cấm là object relation — được chốt
    // bằng typeof ở test "field supplier thật sự cần vẫn còn đủ".
];

test("payload seller không chứa BẤT KỲ giá trị nhạy cảm nào của đơn", () => {
    // So trên chuỗi JSON đã serialize: bắt được cả giá trị lồng sâu trong object,
    // thứ mà kiểm tra theo tên field sẽ bỏ sót.
    const json = JSON.stringify(serializeOrderForSeller(LEAKY_ORDER));
    for (const value of FORBIDDEN_VALUES) {
        assert.ok(
            !json.includes(value),
            `payload seller rò rỉ giá trị nhạy cảm: ${JSON.stringify(value)}\nPayload: ${json}`,
        );
    }
});

test("payload seller không chứa BẤT KỲ field nhạy cảm nào", () => {
    const out = serializeOrderForSeller(LEAKY_ORDER);
    const keys = new Set(Object.keys(out));
    for (const key of FORBIDDEN_KEYS) {
        assert.ok(!keys.has(key), `payload seller không được có field ${key}`);
    }
});

test("payload seller là ĐÚNG whitelist — thêm field mới phải là một quyết định có chủ ý", () => {
    // Chốt cứng tập field. Test này cố tình "khó sửa": ai thêm field vào serializer
    // phải sửa cả danh sách ở đây, tức là phải dừng lại suy nghĩ xem field đó có được
    // phép đưa ra internet hay không. Đó là toàn bộ mục đích của nó.
    const out = serializeOrderForSeller(LEAKY_ORDER);
    assert.deepEqual(Object.keys(out).sort(), [
        "amount", "createdAt", "currency", "id", "paymentMethod",
        "product", "productId", "quantity", "shortId", "status",
    ]);
});

test("field supplier thật sự cần vẫn còn đủ", () => {
    // Sửa lỗ hổng mà cắt luôn thứ supplier cần thì integration chết. Họ cần biết đơn
    // nào của sản phẩm nào, số lượng bao nhiêu, đã giao chưa.
    const out = serializeOrderForSeller(LEAKY_ORDER);
    assert.equal(out.id, "ckorder0000001");
    assert.equal(out.shortId, "R0000001", "shortId = 8 ký tự cuối, viết hoa");
    assert.equal(out.productId, "prod-1");
    assert.equal(out.product, "API Key", "tên sản phẩm phải ra chuỗi, không phải object");
    assert.equal(typeof out.product, "string", "cấm trả object relation — nó kéo theo field của product");
    assert.equal(out.quantity, 1);
    assert.equal(out.amount, 25000, "amount giữ nghĩa cũ = finalAmount, không phá integration");
    assert.equal(out.status, "DELIVERED");
    assert.equal(out.paymentMethod, "wallet");
    assert.equal(out.currency, "VND");
});

test("đơn thiếu product relation không được ném lỗi", () => {
    const out = serializeOrderForSeller({ id: "abc12345", productId: "prod-9", quantity: 2, finalAmount: 100 });
    assert.equal(out.product, "prod-9", "thiếu tên thì lùi về productId");
    assert.equal(out.shortId, "ABC12345");
    assert.equal(out.paymentMethod, null);
});

test("order null/undefined trả null, không ném", () => {
    assert.equal(serializeOrderForSeller(null), null);
    assert.equal(serializeOrderForSeller(undefined), null);
});

// ─── Chốt cấu trúc ────────────────────────────────────────────────────────────────

const src = readFileSync(new URL("../src/seller-api.js", import.meta.url), "utf8");

/**
 * Bỏ các dòng là COMMENT NGUYÊN DÒNG, để assertion cấu trúc không khớp trúng chính
 * phần văn bản giải thích bug: comment trong seller-api.js trích nguyên cú pháp
 * `...order` và `k.key === key` để người đọc sau hiểu chuyện gì đã xảy ra.
 *
 * Chỉ lọc theo đầu dòng nên không đụng chuỗi nào và không đụng code có comment ở
 * cuối dòng — nếu một dòng vừa có code vừa có comment thì nó vẫn được giữ nguyên.
 */
const code = src
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");

test("không route seller nào spread cả document vào response", () => {
    // Đây đúng là hình dạng của bug cũ. Chặn bằng test để không ai "tiện tay" viết lại.
    assert.ok(!/\.\.\.\s*order\b/.test(code), "không được spread `...order` trong seller-api.js");
    assert.ok(!/res\.json\(\{\s*order:\s*\{/.test(code), "không được dựng object order trần trong res.json");
    assert.ok(
        code.includes("serializeOrderForSeller"),
        "mọi order trả ra cho seller phải đi qua whitelist serializer",
    );
    // Hai endpoint (danh sách + chi tiết) phải dùng chung một serializer.
    assert.equal(
        (code.match(/serializeOrderForSeller\(/g) || []).length,
        3,
        "1 định nghĩa + 2 endpoint phải dùng nó — lệch là có endpoint tự chọn field",
    );
});

test("sellerAuth so sánh key ở thời gian không đổi (M7)", () => {
    // `===` thoát ở byte khác nhau đầu tiên nên thời gian phản hồi rò độ dài prefix
    // đúng. Endpoint này gọi được từ internet bao nhiêu lần cũng được.
    // server.js và user-api.js đã dùng secretEquals; seller-api từng là chỗ sót lại.
    assert.ok(code.includes('from "./lib/secret-compare.js"'), "phải import secretEquals");
    assert.ok(/secretEquals\(k\.key,\s*key\)/.test(code), "phải so key bằng secretEquals");
    const findCall = code.match(/keys\.find\([\s\S]{0,120}?\);/);
    assert.ok(findCall, "phải tìm thấy lệnh dò key trong sellerAuth");
    assert.ok(!/===/.test(findCall[0]), `lệnh dò key không được so bằng ===: ${findCall[0]}`);
});

test("mọi route seller đều nằm SAU middleware sellerAuth", () => {
    // Thêm endpoint mới phía trên dòng `router.use(sellerAuth)` là một endpoint public
    // không xác thực. Chốt thứ tự để lỗi đó fail ngay trong test.
    const authAt = code.indexOf("router.use(sellerAuth)");
    assert.ok(authAt > 0, "phải có middleware sellerAuth");
    const routes = [...code.matchAll(/^router\.(get|post|put|patch|delete)\(/gm)];
    assert.ok(routes.length > 0, "phải tìm thấy các route seller");
    for (const route of routes) {
        assert.ok(
            route.index > authAt,
            `route tại offset ${route.index} nằm TRƯỚC sellerAuth (${authAt}) — endpoint public không xác thực`,
        );
    }
});
