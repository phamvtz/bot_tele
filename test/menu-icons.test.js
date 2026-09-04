import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { BUTTON_LABELS, DEFAULT_ICONS, ICON_GROUPS } from "../src/menu-config.js";
import { buildMainMenuKeyboard } from "../src/bot-ui/keyboards.js";

test("không có key icon nào bị lặp giữa các nhóm", () => {
    // BUTTON_LABELS/DEFAULT_ICONS derive bằng Object.fromEntries — key lặp thì
    // cái sau ĐÈ cái trước, im lặng: panel hiện hai dòng, sửa dòng này nhảy dòng
    // kia, và nhãn của một trong hai biến mất.
    const keys = ICON_GROUPS.flatMap((g) => g.items.map((i) => i.key));
    const dup = keys.filter((k, i) => keys.indexOf(k) !== i);
    assert.deepEqual([...new Set(dup)], [], "key icon bị lặp giữa các nhóm");
});

test("mọi icon dùng trong tin hype đều sửa được ở panel icon", async () => {
    // Tin "ĐƠN HÀNG MỚI" / "CÓ NGƯỜI NHẬN QUÀ" gửi cho TẤT CẢ user — admin phải
    // đổi được icon của chúng. iconOf() một key không có trong ICON_GROUPS thì
    // trả chuỗi rỗng và panel không hiện dòng nào để sửa.
    const src = await readFile(new URL("../src/broadcast.js", import.meta.url), "utf8");
    const used = [...src.matchAll(/iconOf\("([A-Z0-9_]+)"\)/g)].map((m) => m[1]);
    assert.ok(used.length >= 8, "không rút được key icon nào từ broadcast.js");
    for (const key of new Set(used)) {
        assert.ok(DEFAULT_ICONS[key], `broadcast dùng icon "${key}" nhưng panel admin không có dòng nào để sửa`);
    }
});

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
