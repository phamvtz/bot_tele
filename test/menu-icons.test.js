import test from "node:test";
import assert from "node:assert/strict";
import { BUTTON_LABELS, DEFAULT_ICONS } from "../src/menu-config.js";
import { buildMainMenuKeyboard } from "../src/bot-ui/keyboards.js";

test("every configurable bot icon has a label and a static fallback", () => {
    assert.deepEqual(Object.keys(DEFAULT_ICONS).sort(), Object.keys(BUTTON_LABELS).sort());
    for (const [key, icon] of Object.entries(DEFAULT_ICONS)) {
        assert.ok(icon.trim(), `${key} is missing its fallback icon`);
        assert.ok(BUTTON_LABELS[key].trim(), `${key} is missing its admin label`);
    }
});

test("language button accepts a Telegram custom emoji ID", () => {
    const keyboard = buildMainMenuKeyboard({
        icons: DEFAULT_ICONS,
        iconIds: { LANGUAGE: "5368324170671202286" },
        lang: "vi",
    }).reply_markup.inline_keyboard;
    const languageButton = keyboard.flat().find((button) => button.callback_data === "LANGUAGE");

    assert.equal(languageButton.text, "Ngôn ngữ");
    assert.equal(languageButton.icon_custom_emoji_id, "5368324170671202286");
});
