import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sellerApiFile = path.resolve(__dirname, "../src/seller-api.js");
const sellerApiCode = fs.readFileSync(sellerApiFile, "utf8");

test("seller-api.js định nghĩa đầy đủ các routes kiểm tra số dư ví seller", () => {
    assert.ok(
        sellerApiCode.includes('router.get("/me"'),
        "phải có endpoint GET /api/seller/me để seller kiểm tra thông tin & số dư",
    );
    assert.ok(
        sellerApiCode.includes('router.get("/balance"'),
        "phải có endpoint GET /api/seller/balance để seller kiểm tra nhanh số dư",
    );
});

test("adminRouter hỗ trợ cập nhật telegramId liên kết ví", () => {
    assert.ok(
        sellerApiCode.includes('adminRouter.put("/keys/:id"'),
        "adminRouter phải có PUT /keys/:id để cập nhật name và telegramId",
    );
    assert.ok(
        sellerApiCode.includes("telegramId: cleanTelegramId || null"),
        "adminRouter.post /keys phải lưu telegramId vào đối tượng key",
    );
});

test("POST /keys kiểm tra và trừ số dư ví khi seller có liên kết Telegram ID", () => {
    assert.ok(
        /sellerTelegramId\s*=\s*req\.apiKey(\.|\?\.)telegramId/.test(sellerApiCode),
        "phải lấy sellerTelegramId từ req.apiKey.telegramId",
    );
    assert.ok(
        sellerApiCode.includes("walletPurchase(sellerTelegramId, priceVnd") ||
        sellerApiCode.includes("walletPurchase("),
        "phải gọi walletPurchase để trừ tiền ví seller",
    );
    assert.ok(
        sellerApiCode.includes("walletRefund("),
        "phải gọi walletRefund để tự động hoàn tiền nếu tạo key thất bại",
    );
    assert.ok(
        sellerApiCode.includes("insufficient_balance"),
        "phải trả về mã insufficient_balance nếu số dư ví không đủ",
    );
});

test("PATCH /keys/:id kiểm tra và trừ số dư ví khi seller gia hạn key", () => {
    const patch = sellerApiCode.slice(
        sellerApiCode.indexOf('router.patch("/keys/:id"'),
        sellerApiCode.indexOf('router.patch("/keys/:id/enabled"'),
    );
    assert.ok(
        patch.includes("walletPurchase(sellerTelegramId, estPriceVnd") || patch.includes("walletPurchase("),
        "phải gọi walletPurchase khi gia hạn key",
    );
    assert.ok(
        patch.includes("walletRefund("),
        "phải gọi walletRefund khi gia hạn thất bại",
    );
    assert.ok(
        patch.includes("insufficient_balance"),
        "phải báo insufficient_balance nếu ví không đủ tiền gia hạn",
    );
});


