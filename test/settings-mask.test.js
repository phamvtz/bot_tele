import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
    maskSettingsForClient,
    maskProviderForClient,
    mergeProviderUpdate,
    isSecretSettingKey,
    SECRET_SETTING_KEYS,
} from "../src/settings-mask.js";

// GET /settings từng trả TOÀN BỘ bảng Setting và chỉ xoá tay 3 khoá. Token adm_* của
// GPT2API (tạo key trên tài khoản shop), GPT2API_PROFILES (adminToken từng server) và
// api_providers (apiKey nhà cung cấp) vì thế lộ nguyên văn xuống trình duyệt, dù
// endpoint chuyên biệt đã che đúng. Test này khoá "mặc định là CHE".

const ADM = "adm_SECRET_SHOP_TOKEN_123456";
const DB = {
    SHOP_NAME: "Shop",
    BANK_CODE: "MB",
    GPT2API_BASE: "https://x.example",
    GPT2API_ADMIN_TOKEN: ADM,
    GPT2API_PROFILES: JSON.stringify([{ id: 1, adminToken: "adm_PROFILE_TOKEN_999" }]),
    api_providers: JSON.stringify([{ id: "1", apiKey: "PROVIDER_KEY_ABC" }]),
    CRYPTOPAY_API_TOKEN: "12345:CRYPTO_BOT_TOKEN",
    TRONGRID_API_KEY: "TRON_KEY_XYZ",
    SEPAY_API_KEY: "SEPAY_KEY",
    BINANCE_API_SECRET: "BIN_SECRET",
    BINANCE_PAY_TOKEN: "BIN_PAY",
    REFERRAL_REWARD_TOKENS_M: "20",
    GPT2API_USD_PER_MTOKEN: "0.01",
};

const wire = (obj) => JSON.stringify(obj);

test("không secret nào xuất hiện trong response, kể cả khi dò theo chuỗi nguyên văn", () => {
    const out = maskSettingsForClient(DB, { env: {} });
    const body = wire(out);
    for (const secret of [ADM, "adm_PROFILE_TOKEN_999", "PROVIDER_KEY_ABC", "CRYPTO_BOT_TOKEN", "TRON_KEY_XYZ", "SEPAY_KEY", "BIN_SECRET", "BIN_PAY"]) {
        assert.ok(!body.includes(secret), `"${secret}" bị lộ trong response`);
    }
});

test("khoá JSON chứa secret lồng bên trong bị bỏ hẳn", () => {
    const out = maskSettingsForClient(DB, { env: {} });
    assert.ok(!("GPT2API_PROFILES" in out));
    assert.ok(!("api_providers" in out));
});

test("secret trả cờ <KEY>_SET để giao diện biết đã cấu hình", () => {
    const out = maskSettingsForClient(DB, { env: {} });
    for (const k of ["GPT2API_ADMIN_TOKEN", "CRYPTOPAY_API_TOKEN", "TRONGRID_API_KEY", "SEPAY_API_KEY", "BINANCE_API_SECRET", "BINANCE_PAY_TOKEN"]) {
        assert.equal(out[`${k}_SET`], "1", `${k}_SET`);
        assert.ok(!(k in out), `${k} không được còn`);
    }
});

test("chưa cấu hình ở đâu cả thì cờ là chuỗi rỗng", () => {
    const out = maskSettingsForClient({ SHOP_NAME: "S" }, { env: {} });
    assert.equal(out.CRYPTOPAY_API_TOKEN_SET, "");
    assert.equal(out.SEPAY_API_KEY_SET, "");
});

test("cấu hình qua ENV cũng tính là đã cấu hình (kể cả tên ENV khác tên khoá)", () => {
    const out = maskSettingsForClient({}, {
        env: { CRYPTOPAY_API_TOKEN: "x", SEPAY_SECRET_KEY: "y" },
        envNames: { SEPAY_API_KEY: ["SEPAY_API_KEY", "SEPAY_SECRET_KEY"] },
    });
    assert.equal(out.CRYPTOPAY_API_TOKEN_SET, "1");
    assert.equal(out.SEPAY_API_KEY_SET, "1");
});

test("khoá secret thêm sau này (hậu tố _TOKEN/_SECRET/_PASSWORD) tự được che dù chưa khai báo", () => {
    const out = maskSettingsForClient({ NEW_VENDOR_TOKEN: "leak-me", SOME_SECRET: "leak2", DB_PASSWORD: "leak3" }, { env: {} });
    assert.ok(!wire(out).includes("leak"), "khoá mới lộ");
    assert.equal(out.NEW_VENDOR_TOKEN_SET, "1");
});

test("KHÔNG che nhầm khoá thường: số token, URL, tên shop…", () => {
    const out = maskSettingsForClient(DB, { env: {} });
    assert.equal(out.SHOP_NAME, "Shop");
    assert.equal(out.BANK_CODE, "MB");
    assert.equal(out.GPT2API_BASE, "https://x.example");
    assert.equal(out.REFERRAL_REWARD_TOKENS_M, "20", "REFERRAL_REWARD_TOKENS_M là số token, không phải secret");
    assert.equal(out.GPT2API_USD_PER_MTOKEN, "0.01");
    assert.equal(isSecretSettingKey("REFERRAL_REWARD_TOKENS_M"), false);
    assert.equal(isSecretSettingKey("GPT2API_USD_PER_MTOKEN"), false);
});

test("không sửa object đầu vào", () => {
    const input = { ...DB };
    maskSettingsForClient(input, { env: {} });
    assert.deepEqual(input, DB);
});

test("danh sách secret đã biết bao gồm Crypto Bot", () => {
    assert.ok(SECRET_SETTING_KEYS.includes("CRYPTOPAY_API_TOKEN"));
});

test("provider: apiKey không ra khỏi server, chỉ có cờ apiKeySet", () => {
    const masked = maskProviderForClient({ id: "1", name: "P", apiKey: "PROVIDER_KEY_ABC", baseUrl: "https://p" });
    assert.equal(masked.apiKey, "");
    assert.equal(masked.apiKeySet, true);
    assert.equal(masked.name, "P");
    assert.ok(!wire(masked).includes("PROVIDER_KEY_ABC"));
    assert.equal(maskProviderForClient({ id: "2", apiKey: "" }).apiKeySet, false);
});

test("sửa provider: apiKey trống/thiếu = GIỮ key cũ, có giá trị = đổi", () => {
    const old = { id: "1", name: "A", baseUrl: "https://a", apiKey: "OLD", authMode: "bearer" };
    assert.equal(mergeProviderUpdate(old, { name: "B", apiKey: "" }).apiKey, "OLD");
    assert.equal(mergeProviderUpdate(old, { name: "B" }).apiKey, "OLD");
    assert.equal(mergeProviderUpdate(old, { apiKey: "   " }).apiKey, "OLD");
    assert.equal(mergeProviderUpdate(old, { apiKey: " NEW " }).apiKey, "NEW");
    const m = mergeProviderUpdate(old, { name: "B", baseUrl: "https://b/", authMode: "header" });
    assert.equal(m.name, "B");
    assert.equal(m.baseUrl, "https://b");
    assert.equal(m.authMode, "header");
});

test("api-routes dùng đúng các hàm che ở GET /settings và /api-providers", () => {
    const src = readFileSync(new URL("../src/api-routes.js", import.meta.url), "utf8");
    assert.ok(src.includes("maskSettingsForClient(settings"), "GET /settings phải đi qua maskSettingsForClient");
    assert.ok(src.includes("map(maskProviderForClient)"), "GET /api-providers phải che apiKey");
    assert.ok(src.includes("mergeProviderUpdate(providers[idx]"), "PUT /api-providers phải giữ key cũ khi để trống");
});
