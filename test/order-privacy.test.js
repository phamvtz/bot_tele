import test from "node:test";
import assert from "node:assert/strict";
import { maskBuyerName } from "../src/broadcast.js";
import { buildOrderChannelMessage } from "../src/delivery.js";

test("masks buyer names in public notifications", () => {
    assert.equal(maskBuyerName("@langvuongalone"), "lan***");
    assert.equal(maskBuyerName("NguyenHuy"), "Ngu***");
});

test("public channel order message never exposes username or Telegram ID", () => {
    const message = buildOrderChannelMessage({
        order: { id: "order-1", odelegramId: "8548644671", chatId: "8548644671", quantity: 1, finalAmount: 26_000 },
        product: { name: "Kiro Power" },
        user: { username: "langvuongalone", firstName: "Lan" },
    });

    assert.match(message, /lan\*\*\*/);
    assert.doesNotMatch(message, /langvuongalone/);
    assert.doesNotMatch(message, /8548644671/);
    assert.doesNotMatch(message, /User:/);
});
