import test from "node:test";
import assert from "node:assert/strict";
import { extractIconPayloadFromText, normalizeCustomEmojiId } from "../src/icon-utils.js";

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
