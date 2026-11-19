import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Web storefront /shop khớp thiết kế Geist Monochrome Mini App và an toàn CSP", async () => {
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

    // 3. Mọi ID gọi qua $("...") trong app.js đều tồn tại trong index.html
    const usedIds = [...new Set([...js.matchAll(/\$\("([a-z0-9_-]+)"\)/g)].map((m) => m[1]))];
    const missingIds = usedIds.filter((id) => !html.includes(`id="${id}"`));
    assert.deepEqual(missingIds, [], `Thiếu DOM ID trong index.html: ${missingIds.join(", ")}`);

    // 4. Mọi data-action trong HTML (và JS template) đều có handler trong SHOP_ACTIONS
    const htmlActions = [...html.matchAll(/data-action="([a-z0-9_-]+)"/g)].map((m) => m[1]);
    const jsActions = [...js.matchAll(/data-action="([a-z0-9_-]+)"/g)].map((m) => m[1]);
    const allActions = [...new Set([...htmlActions, ...jsActions])];
    const missingActions = allActions.filter((a) => !js.includes(`"${a}":`));
    assert.deepEqual(missingActions, [], `Thiếu handler trong SHOP_ACTIONS: ${missingActions.join(", ")}`);
});
