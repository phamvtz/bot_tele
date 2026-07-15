import test from "node:test";
import assert from "node:assert/strict";
import { buildProductDeepLink } from "../src/telegram-links.js";

test("builds a deep link to the exact product", () => {
    assert.equal(
        buildProductDeepLink("@ShopAccountsPreBot", "6a1234567890abcdef123456"),
        "https://t.me/ShopAccountsPreBot?start=product_6a1234567890abcdef123456",
    );
});

test("rejects invalid bot usernames and product start parameters", () => {
    assert.equal(buildProductDeepLink("bad", "product-1"), null);
    assert.equal(buildProductDeepLink("ValidBot", "bad product"), null);
    assert.equal(buildProductDeepLink("ValidBot", "x".repeat(57)), null);
});
