import test from "node:test";
import assert from "node:assert/strict";
import { buildCustomEmojiCheckResult, extractIconPayloadFromText, normalizeCustomEmojiId } from "../src/icon-utils.js";

test("accepts a numeric Telegram custom emoji ID", () => {
    assert.equal(normalizeCustomEmojiId(" 5368324170671202286 "), "5368324170671202286");
    assert.deepEqual(
        extractIconPayloadFromText({ text: "5368324170671202286" }, "📦"),
        { icon: "📦", iconEmojiId: "5368324170671202286" },
    );
});

test("keeps a regular emoji as the static icon", () => {
    assert.deepEqual(
        extractIconPayloadFromText({ text: "🎯" }, "📦"),
        { icon: "🎯", iconEmojiId: null },
    );
});

test("rejects malformed custom emoji IDs", () => {
    assert.throws(() => normalizeCustomEmojiId("5368-3241"), /5-30 chữ số/);
});

test("reports which configured custom emoji IDs Telegram can load", () => {
    const result = buildCustomEmojiCheckResult(
        {
            WALLET: "5368324170671202286",
            LANGUAGE: "5368324170671202299",
        },
        [{ custom_emoji_id: "5368324170671202286", emoji: "👛", set_name: "wallet_icons" }],
    );

    assert.equal(result.total, 2);
    assert.equal(result.valid, 1);
    assert.equal(result.invalid, 1);
    assert.deepEqual(result.items[0], {
        key: "WALLET",
        id: "5368324170671202286",
        valid: true,
        emoji: "👛",
        setName: "wallet_icons",
    });
    assert.equal(result.items[1].valid, false);
});
