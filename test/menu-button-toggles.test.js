import test, { mock } from "node:test";
import assert from "node:assert/strict";

/**
 * Ẩn/hiện nút menu chính.
 *
 * Bối cảnh: tab "Menu Buttons" trong web admin đã tồn tại từ lâu và ghi các khoá
 * BTN_* vào Setting, NHƯNG không dòng nào trong src/ đọc chúng — admin gạt công
 * tắc, tưởng đã ẩn, bot vẫn hiện đủ nút. Test ở đây ghim hai chuyện:
 *   1. tắt một khoá thì nút biến mất thật (và hàng rỗng thì bỏ luôn hàng);
 *   2. MỌI khoá trong MENU_BUTTON_TOGGLES ứng với một nút CÓ THẬT trong menu —
 *      đây đúng là lỗi đã làm cả tab thành đồ trang trí.
 */
const url = (path) => new URL(path, import.meta.url).href;

// Setting mà menu-config sẽ đọc. Test đổi biến này rồi gọi lại warm.
const settings = { rows: [] };

mock.module(url("../src/lib/prisma.js"), {
    defaultExport: {
        setting: {
            async findMany({ where } = {}) {
                const want = where?.key?.in;
                if (!want) return settings.rows;
                return settings.rows.filter((r) => want.includes(r.key));
            },
            async findUnique() { return null; },
        },
    },
});

// Menu chỉ dựng đủ nút khi cửa hàng API key đã cấu hình và có link ngoài.
process.env.GPT2API_BASE = "https://provider.test/api/admin-pub";
process.env.GPT2API_ADMIN_TOKEN = "adm_faketoken";
process.env.GPT2API_USER_ID = "user-1";
process.env.SUPPORT_CHANNEL_URL = "https://t.me/kenh";
process.env.ADMIN_TELEGRAM = "@admin";

const { MENU_BUTTON_TOGGLES, warmMenuButtonFlags, invalidateMenuCache, isMenuActionVisibleSync } =
    await import("../src/menu-config.js");
const { warmGpt2apiConfig } = await import("../src/gpt2api.js");
const { buildMainMenuKeyboard, buildReplyKeyboard } = await import("../src/bot-ui/keyboards.js");

await warmGpt2apiConfig();

/** Đặt danh sách khoá bị tắt rồi nạp lại cache. */
async function hide(...keys) {
    settings.rows = keys.map((key) => ({ key, value: "false" }));
    invalidateMenuCache();
    await warmMenuButtonFlags();
}

const actionsOf = (kb) => kb.reply_markup.inline_keyboard.flat().map((b) => b.callback_data).filter(Boolean);
const textsOf = (kb) => kb.reply_markup.keyboard.flat().map((b) => (typeof b === "string" ? b : b.text));

test("mặc định (chưa tắt gì) hiện đủ mọi nút có công tắc", async () => {
    await hide();
    const kb = buildMainMenuKeyboard({ lang: "vi" });
    const shown = actionsOf(kb);
    // Hai nút link ngoài không mang callback_data → kiểm qua url.
    const urls = kb.reply_markup.inline_keyboard.flat().map((b) => b.url).filter(Boolean);

    for (const t of MENU_BUTTON_TOGGLES) {
        const found = shown.includes(t.action)
            || (t.action === "JOIN_GROUP" && urls.some((u) => u.includes("kenh")))
            || (t.action === "CONTACT_ADMIN" && urls.some((u) => u.includes("admin")));
        assert.ok(found, `công tắc "${t.key}" (${t.label}) không ứng với nút nào trong menu — công tắc chết`);
    }
});

test("tắt một khoá thì đúng nút đó biến mất, các nút khác còn nguyên", async () => {
    await hide("BTN_WALLET");
    const shown = actionsOf(buildMainMenuKeyboard({ lang: "vi" }));
    assert.ok(!shown.includes("WALLET"), "Ví phải biến mất");
    assert.ok(shown.includes("MY_ORDERS"), "Đơn hàng không được biến mất theo");
    assert.ok(shown.includes("LIST_PRODUCTS"), "Mua hàng không được biến mất theo");
});

test("tắt cả hàng thì bỏ luôn hàng, không để lại hàng rỗng", async () => {
    // Ví + Sản phẩm cùng một hàng 2 cột.
    await hide("BTN_WALLET", "BTN_ALL_PRODUCTS");
    const rows = buildMainMenuKeyboard({ lang: "vi" }).reply_markup.inline_keyboard;
    assert.ok(rows.every((r) => r.length > 0), "có hàng rỗng lọt vào bàn phím");
    const shown = rows.flat().map((b) => b.callback_data);
    assert.ok(!shown.includes("WALLET") && !shown.includes("ALL_PRODUCTS"));
});

test("tắt nút link ngoài (Channel / Liên hệ Admin) cũng ăn", async () => {
    await hide("BTN_CHANNEL", "BTN_CONTACT_ADMIN");
    const urls = buildMainMenuKeyboard({ lang: "vi" })
        .reply_markup.inline_keyboard.flat().map((b) => b.url).filter(Boolean);
    assert.equal(urls.length, 0, "hai nút link ngoài phải biến mất");
});

test("bàn phím dưới theo cùng cấu hình — ẩn ở menu mà còn ở đây thì coi như chưa ẩn", async () => {
    await hide("BTN_ALL_PRODUCTS");
    const texts = textsOf(buildReplyKeyboard({ lang: "vi" }));
    assert.ok(!texts.some((t) => /Sản phẩm/.test(t)), "Sản phẩm vẫn còn ở bàn phím dưới");
    assert.ok(texts.some((t) => /Hỗ trợ/.test(t)), "Hỗ trợ không được biến mất theo");
});

test("tắt sạch bàn phím dưới → GỠ bàn phím, không gửi bàn phím rỗng", async () => {
    // Markup.keyboard([]) để Telegram giữ nguyên bàn phím cũ trên máy khách,
    // tức là ẩn không có tác dụng gì.
    await hide("BTN_ALL_PRODUCTS", "BTN_SUPPORT", "BTN_LANGUAGE");
    const kb = buildReplyKeyboard({ lang: "vi" });
    assert.equal(kb.reply_markup.remove_keyboard, true);
});

test("nút Admin Panel không tắt được — admin không tự khoá cửa", async () => {
    await hide(...MENU_BUTTON_TOGGLES.map((t) => t.key));
    const shown = actionsOf(buildMainMenuKeyboard({ lang: "vi", isAdmin: true }));
    assert.ok(shown.includes("ADMIN_PANEL"));
    assert.ok(textsOf(buildReplyKeyboard({ lang: "vi", isAdmin: true })).some((t) => /Admin Panel/.test(t)));
});

test("cache nguội thì HIỆN, không phải ẩn sạch", async () => {
    // Lỗi DB thoáng qua lúc khởi động không được biến menu thành trống trơn.
    invalidateMenuCache();
    assert.equal(isMenuActionVisibleSync("WALLET"), true);
    assert.ok(actionsOf(buildMainMenuKeyboard({ lang: "vi" })).includes("WALLET"));
});

test("khoá công tắc không trùng nhau và action cũng không trùng nhau", () => {
    const keys = MENU_BUTTON_TOGGLES.map((t) => t.key);
    const actions = MENU_BUTTON_TOGGLES.map((t) => t.action);
    assert.equal(new Set(keys).size, keys.length, "có khoá BTN_* bị trùng");
    assert.equal(new Set(actions).size, actions.length, "có action bị trùng — một công tắc sẽ ẩn nhầm nút khác");
});
