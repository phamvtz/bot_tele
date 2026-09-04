import test from "node:test";
import assert from "node:assert/strict";

import {
    normalizeProfile, normalizeProfiles, serializeProfiles, parseProfiles,
    defaultProfile, resolveProfile, resolveProfiles, enabledProfiles, pickProfile,
    MAX_PROFILES,
} from "../src/apikey-profiles.js";

// Cấu hình chung của shop dùng làm nền cho mọi test gộp knob.
const SHOP = {
    base: "https://provider.test/api/admin-pub",
    adminToken: "adm_x",
    userId: "u-1",
    enabled: true,
    configured: true,
    endpoint: "https://provider.test/v1",
    models: ["claude-opus-5"],
    fallbackGroups: ["g-shop"],
    usdPerMtoken: 0.01,
    rpm: 300,
    tpm: 0,
    validDays: 0,
    rpmIncluded: 300,
    rpmSurchargePct: 20,
    daySurchargePct: 5,
    noExpiryMult: 1.5,
    maxBuyTokens: 1_000_000 * 1_000_000,
    rpmPresets: [100, 300],
    daysPresets: [1, 30],
    freeMinM: 3,
    freeMaxM: 50,
    freeAlpha: 2,
    quotaRefPrice: 15,
    allowedModelsMode: "all",
};

// ─── parse / normalize ────────────────────────────────────────────────────────

test("parseProfiles: JSON hỏng không làm sập, trả rỗng để lùi về profile mặc định", () => {
    assert.deepEqual(parseProfiles("{không phải json"), []);
    assert.deepEqual(parseProfiles(""), []);
    assert.deepEqual(parseProfiles(null), []);
    // Object đơn lẻ (không phải mảng) cũng bị từ chối — tránh lưu nhầm shape.
    assert.deepEqual(parseProfiles('{"id":1}'), []);
    assert.deepEqual(parseProfiles('[{"id":2}]'), [{ id: 2 }]);
});

test("normalizeProfile: id/tên tự sinh, enabled thiếu = bật", () => {
    const p = normalizeProfile({}, 1);
    assert.equal(p.id, 2);          // index + 1
    assert.equal(p.name, "Server 2");
    assert.equal(p.enabled, true);  // thiếu field ≠ tắt
    assert.deepEqual(p.fallbackGroups, []);
});

test("normalizeProfile: knob rỗng KHÔNG được ghi vào (rỗng = kế thừa)", () => {
    const p = normalizeProfile({ id: 1, usdPerMtoken: "", rpm: null, maxBuyM: undefined }, 0);
    assert.ok(!("usdPerMtoken" in p), "chuỗi rỗng phải bị bỏ, không thành 0");
    assert.ok(!("rpm" in p));
    assert.ok(!("maxBuyM" in p));
});

test("normalizeProfile: knob vô lý bị loại thay vì lưu giá trị hỏng", () => {
    const p = normalizeProfile({
        id: 1,
        usdPerMtoken: 0,        // phải > 0
        noExpiryMult: 0.5,      // phải >= 1
        rpmIncluded: 0,         // phải >= 1
        allowedModelsMode: "bừa",
    }, 0);
    assert.ok(!("usdPerMtoken" in p));
    assert.ok(!("noExpiryMult" in p));
    assert.ok(!("rpmIncluded" in p));
    assert.ok(!("allowedModelsMode" in p));
});

test("normalizeProfile: đọc list từ chuỗi admin gõ lẫn mảng JSON", () => {
    assert.deepEqual(normalizeProfile({ id: 1, rpmPresets: "100, 300 600" }, 0).rpmPresets, [100, 300, 600]);
    assert.deepEqual(normalizeProfile({ id: 1, buyPresetsM: "[100,200]" }, 0).buyPresetsM, [100, 200]);
    assert.deepEqual(normalizeProfile({ id: 1, models: "a, b\nc" }, 0).models, ["a", "b", "c"]);
    assert.deepEqual(normalizeProfile({ id: 1, fallbackGroups: ["g1", " g2 ", ""] }, 0).fallbackGroups, ["g1", "g2"]);
});

test("normalizeProfiles: id trùng được cấp lại, không im lặng ghi đè nhau", () => {
    const list = normalizeProfiles([{ id: 1, name: "A" }, { id: 1, name: "B" }, { id: 1, name: "C" }]);
    assert.deepEqual(list.map((p) => p.id), [1, 2, 3]);
    assert.deepEqual(list.map((p) => p.name), ["A", "B", "C"]);
});

test("normalizeProfiles: cắt về MAX_PROFILES", () => {
    const many = Array.from({ length: MAX_PROFILES + 4 }, (_, i) => ({ id: i + 1, name: `S${i}` }));
    assert.equal(normalizeProfiles(many).length, MAX_PROFILES);
});

test("serializeProfiles → parse lại ra đúng danh sách đã chuẩn hoá", () => {
    const json = serializeProfiles([{ name: "Một", fallbackGroups: "g1,g2", usdPerMtoken: "0.02" }]);
    const back = normalizeProfiles(json);
    assert.equal(back.length, 1);
    assert.equal(back[0].id, 1);
    assert.equal(back[0].name, "Một");
    assert.deepEqual(back[0].fallbackGroups, ["g1", "g2"]);
    assert.equal(back[0].usdPerMtoken, 0.02);
});

// ─── resolve: gộp knob ────────────────────────────────────────────────────────

test("resolveProfile: knob không đặt thì kế thừa shop", () => {
    const r = resolveProfile(normalizeProfile({ id: 2, name: "S2" }, 1), SHOP);
    assert.equal(r.usdPerMtoken, SHOP.usdPerMtoken);
    assert.equal(r.rpm, SHOP.rpm);
    assert.equal(r.quotaRefPrice, SHOP.quotaRefPrice);
    assert.equal(r.maxBuyTokens, SHOP.maxBuyTokens);
    // Kết nối luôn là của shop — đó là ý nghĩa "cùng một kết nối".
    assert.equal(r.base, SHOP.base);
    assert.equal(r.adminToken, SHOP.adminToken);
    assert.equal(r.userId, SHOP.userId);
});

test("resolveProfile: knob đặt riêng thì đè lên shop", () => {
    const r = resolveProfile(normalizeProfile({ id: 3, name: "S3", usdPerMtoken: 0.05, rpm: 900 }, 2), SHOP);
    assert.equal(r.usdPerMtoken, 0.05);
    assert.equal(r.rpm, 900);
    assert.equal(r.daySurchargePct, SHOP.daySurchargePct, "knob khác vẫn kế thừa");
});

test("resolveProfile: maxBuyM (triệu) quy đổi sang maxBuyTokens (token)", () => {
    const r = resolveProfile(normalizeProfile({ id: 1, maxBuyM: 500 }, 0), SHOP);
    assert.equal(r.maxBuyTokens, 500 * 1_000_000);
    assert.ok(!("maxBuyM" in r), "chỉ giữ đơn vị token ở bản resolve");
});

test("resolveProfile: fallbackGroups rỗng thì kế thừa shop; có thì thắng", () => {
    const inherit = resolveProfile(normalizeProfile({ id: 1 }, 0), SHOP);
    assert.deepEqual(inherit.fallbackGroups, ["g-shop"]);

    const own = resolveProfile(normalizeProfile({ id: 2, fallbackGroups: ["g-a", "g-b"] }, 1), SHOP);
    assert.deepEqual(own.fallbackGroups, ["g-a", "g-b"]);
});

test("resolveProfile: validDays = 0 là giá trị THẬT, không bị coi là chưa đặt", () => {
    // 0 = key không hết hạn. Nếu resolve dùng `||` thì shop.validDays sẽ đè lên.
    const shop = { ...SHOP, validDays: 30 };
    const r = resolveProfile(normalizeProfile({ id: 1, validDays: 0 }, 0), shop);
    assert.equal(r.validDays, 0);
});

test("resolveProfile: quotaRefPrice = 0 (gửi token thô) cũng phải giữ được", () => {
    const r = resolveProfile(normalizeProfile({ id: 1, quotaRefPrice: 0 }, 0), SHOP);
    assert.equal(r.quotaRefPrice, 0);
});

test("resolveProfile: tắt server KHÔNG bị cờ bật của cửa hàng che mất", () => {
    const r = resolveProfile(normalizeProfile({ id: 1, enabled: false }, 0), SHOP);
    assert.equal(r.profileEnabled, false);
    assert.equal(r.enabled, false, "shop bật nhưng server tắt = không bán được");
});

test("resolveProfile: tắt cả cửa hàng thì mọi server đều không bán được", () => {
    const r = resolveProfile(normalizeProfile({ id: 1 }, 0), { ...SHOP, enabled: false });
    assert.equal(r.profileEnabled, true);
    assert.equal(r.enabled, false);
});

// ─── danh sách + chọn ─────────────────────────────────────────────────────────

test("resolveProfiles: chưa cấu hình → đúng 1 profile dựng từ cấu hình phẳng", () => {
    const list = resolveProfiles("", SHOP);
    assert.equal(list.length, 1, "1 phần tử = bot bỏ qua bước chọn server");
    assert.equal(list[0].profileId, 1);
    assert.deepEqual(list[0].fallbackGroups, SHOP.fallbackGroups);
    assert.equal(list[0].usdPerMtoken, SHOP.usdPerMtoken);
});

test("defaultProfile giữ nguyên nhóm fallback đang dùng của shop", () => {
    assert.deepEqual(defaultProfile(SHOP).fallbackGroups, ["g-shop"]);
    assert.deepEqual(defaultProfile({}).fallbackGroups, []);
});

test("enabledProfiles: lọc theo cờ của TỪNG server", () => {
    const list = resolveProfiles([
        { id: 1, name: "A" },
        { id: 2, name: "B", enabled: false },
        { id: 3, name: "C" },
    ], SHOP);
    assert.deepEqual(enabledProfiles(list).map((p) => p.profileId), [1, 3]);
});

test("enabledProfiles: tắt hết thì vẫn trả cái đầu, không trả danh sách rỗng", () => {
    const list = resolveProfiles([{ id: 1, enabled: false }, { id: 2, enabled: false }], SHOP);
    assert.equal(enabledProfiles(list).length, 1);
    assert.equal(enabledProfiles(list)[0].profileId, 1);
});

test("pickProfile: tìm đúng id", () => {
    const list = resolveProfiles([{ id: 1, name: "A" }, { id: 7, name: "B" }], SHOP);
    assert.equal(pickProfile(list, 7).profileName, "B");
    assert.equal(pickProfile(list, "7").profileName, "B", "id từ callback data là chuỗi");
});

test("pickProfile: id không còn (admin xoá server) → server đầu ĐANG BẬT, không null", () => {
    // Đơn đã trừ tiền trỏ tới profile bị xoá vẫn phải giao được key.
    const list = resolveProfiles([{ id: 1, name: "A", enabled: false }, { id: 2, name: "B" }], SHOP);
    const got = pickProfile(list, 99);
    assert.ok(got, "không được trả null");
    assert.equal(got.profileName, "B", "phải bỏ qua server đang tắt");
});

test("pickProfile: không truyền id (giftcode/referral/đơn cũ) → server đầu đang bật", () => {
    const list = resolveProfiles([{ id: 1, name: "A" }, { id: 2, name: "B" }], SHOP);
    assert.equal(pickProfile(list, null).profileName, "A");
    assert.equal(pickProfile(list, undefined).profileName, "A");
});

test("pickProfile: danh sách rỗng → null (caller tự lùi về cfg chung)", () => {
    assert.equal(pickProfile([], 1), null);
});
