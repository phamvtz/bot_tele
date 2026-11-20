import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Web storefront /shop khớp thiết kế Geist Monochrome Mini App, hỗ trợ PC/Tablet/Mobile và an toàn CSP", async () => {
    const [html, css, js] = await Promise.all([
        readFile(new URL("../public/shop/index.html", import.meta.url), "utf8"),
        readFile(new URL("../public/shop/styles.css", import.meta.url), "utf8"),
        readFile(new URL("../public/shop/app.js", import.meta.url), "utf8"),
    ]);

    // 1. An toàn CSP: không dùng inline event handler trong HTML
    assert.doesNotMatch(
        html,
        /\son(click|change|input|submit|error|load)=/i,
        "public/shop/index.html không được chứa inline event handler",
    );

    // 2. Đồng bộ theme & font với Mini App (#09090B / #111113 / Geist + Geist Mono)
    assert.match(html, /Geist\+Mono/);
    assert.match(css, /--bg:\s*#09090b/i);
    assert.match(css, /--card:\s*#111113/i);
    assert.match(css, /--elevated:\s*#18181b/i);

    // 3. Đủ layout cho Auto / PC / Tablet / Mobile + sidebar PC + bottom nav Mobile/Tablet
    for (const mode of ["auto", "pc", "tablet", "mobile"]) {
        assert.match(
            html,
            new RegExp(`data-device-btn="${mode}"`),
            `Thiếu nút chuyển chế độ thiết bị: ${mode}`,
        );
    }
    assert.match(css, /body\[data-resolved-view="pc"\]\s+\.pc-sidebar/);
    assert.match(css, /body\[data-resolved-view="pc"\]\s+\.shop-product-grid/);
    assert.match(css, /body\[data-resolved-view="tablet"\]\s+\.shop-product-grid/);
    assert.match(css, /body\[data-device-mode="mobile"\]\s+\.shop-app-shell/);

    // 4. Mọi ID gọi qua $("...") trong app.js đều tồn tại trong index.html
    const usedIds = [...new Set([...js.matchAll(/\$\("([a-z0-9_-]+)"\)/g)].map((m) => m[1]))];
    const missingIds = usedIds.filter((id) => !html.includes(`id="${id}"`));
    assert.deepEqual(missingIds, [], `Thiếu DOM ID trong index.html: ${missingIds.join(", ")}`);

    // 5. Mọi data-action trong HTML (và JS template) đều có handler trong SHOP_ACTIONS
    const htmlActions = [...html.matchAll(/data-action="([a-z0-9_-]+)"/g)].map((m) => m[1]);
    const jsActions = [...js.matchAll(/data-action="([a-z0-9_-]+)"/g)].map((m) => m[1]);
    const allActions = [...new Set([...htmlActions, ...jsActions])];
    const missingActions = allActions.filter((a) => !js.includes(`"${a}":`));
    assert.deepEqual(missingActions, [], `Thiếu handler trong SHOP_ACTIONS: ${missingActions.join(", ")}`);

    // 6. Mọi class tĩnh trong index.html phải có rule trong styles.css (không dùng class Tailwind chưa build)
    const staticClasses = new Set();
    for (const m of html.matchAll(/\bclass="([^"]+)"/g)) {
        for (const cls of m[1].split(/\s+/)) {
            if (cls && cls !== "dark" && cls !== "group") staticClasses.add(cls);
        }
    }
    const missingClasses = [];
    for (const cls of staticClasses) {
        const cssEsc = cls
            .replace(/([:/.\[\]])/g, "\\$1")
            .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const re = new RegExp(`\\.${cssEsc}(?:[:{,\\s>])`);
        if (!re.test(css)) missingClasses.push(cls);
    }
    assert.deepEqual(
        missingClasses,
        [],
        `Class HTML chưa có CSS trong styles.css: ${missingClasses.join(", ")}`,
    );

    // 7. Web hỗ trợ đăng nhập & xuất Key của tôi + popup yêu cầu đăng nhập Telegram khi mới vào (kèm nút Xem trước chế độ khách) + bot.js có handler weblogin_
    for (const action of [
        "start-web-login",
        "login-with-apikey",
        "login-modal-with-apikey",
        "dismiss-auth-modal",
        "export-keys-copy",
        "export-keys-txt",
        "export-keys-csv",
        "export-keys-json",
    ]) {
        assert.match(html, new RegExp(`data-action="${action}"`), `Thiếu nút ${action} trên Web /shop`);
    }
    assert.match(html, /id="telegram-auth-modal"/);
    assert.match(html, /id="shop-guest-banner"/);
    assert.match(html, /Xem trước chế độ khách/);
    assert.match(js, /openAuthModal/);
    assert.match(js, /shop-guest-dismissed/);

    const botSrc = await readFile(new URL("../src/bot.js", import.meta.url), "utf8");
    assert.match(botSrc, /weblogin_/);
    assert.match(botSrc, /WEBLOGIN_\(OK\|NO\)/);
});
