import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { flashButtons } from "../src/flash-sale-text.js";

const botSource = await readFile(new URL("../src/bot.js", import.meta.url), "utf8");

test("mọi nút flashButtons (gồm cả FLASH_BUY) đều có handler trong bot.js", () => {
    const registered = [...botSource.matchAll(/bot\.action\(\/(\^FLASH_[^/]+)\/,/g)]
        .map((m) => new RegExp(m[1]));

    assert.ok(registered.length >= 4, `Phải có ít nhất 4 handler FLASH_*, tìm thấy ${registered.length}`);

    // Nút khi đã nhận: Mua ngay và Đã nhận
    const acceptedKbd = flashButtons("accepted", "sale-abc-123");
    const acceptedCallbacks = acceptedKbd.inline_keyboard.flat().map((b) => b.callback_data);
    assert.deepEqual(acceptedCallbacks, ["FLASH_BUY:sale-abc-123", "FLASH_DONE:sale-abc-123"]);

    for (const cb of acceptedCallbacks) {
        const handled = registered.some((re) => re.test(cb));
        assert.ok(handled, `Callback ${cb} phải được xử lý bởi một handler trong bot.js`);
    }

    // Nút khi ban đầu: Nhận và Bỏ qua
    const initialKbd = flashButtons("initial", "sale-abc-123");
    const initialCallbacks = initialKbd.inline_keyboard.flat().map((b) => b.callback_data);
    for (const cb of initialCallbacks) {
        const handled = registered.some((re) => re.test(cb));
        assert.ok(handled, `Callback ${cb} phải được xử lý bởi một handler trong bot.js`);
    }

    // Nút khi bỏ qua: Nhận lại và Đã bỏ qua
    const skippedKbd = flashButtons("skipped", "sale-abc-123");
    const skippedCallbacks = skippedKbd.inline_keyboard.flat().map((b) => b.callback_data);
    for (const cb of skippedCallbacks) {
        const handled = registered.some((re) => re.test(cb));
        assert.ok(handled, `Callback ${cb} phải được xử lý bởi một handler trong bot.js`);
    }
});

test("finishOnboarding và bot.start đều điều hướng deep link flash_ qua navigateToFlashSale", () => {
    // finishOnboarding phải kiểm tra flash_
    assert.match(
        botSource,
        /if\s*\(\s*startParam\?\.startsWith\("flash_"\)\s*\)\s*\{\s*const\s+saleId\s*=\s*startParam\.slice\("flash_"\.length\);\s*await\s+navigateToFlashSale\(ctx,\s*saleId,\s*\{\s*edit:\s*false\s*\}\);/m,
        "finishOnboarding phải điều hướng flash_ vào navigateToFlashSale",
    );

    // bot.start phải gọi navigateToFlashSale
    assert.match(
        botSource,
        /await\s+navigateToFlashSale\(ctx,\s*saleId,\s*\{\s*edit:\s*false\s*\}\);/m,
        "bot.start phải gọi navigateToFlashSale",
    );
});

test("các hàm điều hướng và hiển thị flash sale/sản phẩm được hoist dạng async function", () => {
    assert.match(botSource, /async function navigateToFlashSale\(/, "navigateToFlashSale phải là function declaration để hoist");
    assert.match(botSource, /async function showProductDetail\(/, "showProductDetail phải là function declaration để hoist");
});
