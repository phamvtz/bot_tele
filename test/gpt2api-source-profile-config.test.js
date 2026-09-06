import test, { mock } from "node:test";
import assert from "node:assert/strict";

/**
 * `loadSettings()` chỉ đọc những khoá nằm trong WHITELIST `SETTING_KEYS`
 * (`where: { key: { in: ... } }`). Quên thêm khoá mới vào đó thì mọi thứ trông
 * như đang chạy — admin bấm Lưu thấy "Đã lưu", `GET /gpt2api/config` đọc THẲNG
 * bảng Setting nên dropdown vẫn hiện đúng lựa chọn — nhưng `getConfig()` không
 * bao giờ thấy giá trị, và key vẫn cấp trên server cũ. Tính năng chết lặng.
 *
 * Đã dính đúng lỗi này lúc ship (2026-09-06): Setting ghi được, UI hiện được,
 * `sourceProfiles` vẫn trả toàn null trên máy chủ thật.
 *
 * Vì vậy mock prisma ở đây PHẢI lọc theo `where.key.in` y như Mongo/PG thật.
 * Mock trả hết mọi dòng bất kể where sẽ cho test xanh mà production hỏng.
 */
const url = (path) => new URL(path, import.meta.url).href;

const settings = { rows: [], lastAskedKeys: null };

mock.module(url("../src/lib/prisma.js"), {
    defaultExport: {
        setting: {
            async findMany({ where } = {}) {
                const want = where?.key?.in;
                settings.lastAskedKeys = want || null;
                if (!Array.isArray(want)) return settings.rows;
                return settings.rows.filter((r) => want.includes(r.key));
            },
        },
    },
});

process.env.GPT2API_BASE = "https://provider.test/api/admin-pub";
process.env.GPT2API_ADMIN_TOKEN = "adm_faketoken";
process.env.GPT2API_USER_ID = "user-1";
// Không để ENV của máy chạy test lọt vào — mọi test dưới đây đo bảng Setting.
delete process.env.GPT2API_PROFILE_GIFTCODE;
delete process.env.GPT2API_PROFILE_REFERRAL;
delete process.env.GPT2API_PROFILE_PURCHASE;

const { getConfig, getSourceProfileId, invalidateGpt2apiConfig } = await import("../src/gpt2api.js");
const { KEY_SOURCES } = await import("../src/apikey-profiles.js");

const THREE_SERVERS = JSON.stringify([
    { id: 1, name: "Server 1", enabled: true, fallbackGroups: ["g-xin"] },
    { id: 2, name: "Server 2", enabled: true, fallbackGroups: ["g-nhanh"] },
    { id: 3, name: "Miễn phí", enabled: false, fallbackGroups: ["g-re"] },
]);

function setSettings(obj) {
    settings.rows = Object.entries(obj).map(([key, value]) => ({ key, value: String(value) }));
    invalidateGpt2apiConfig();
}

test("khoá GPT2API_PROFILE_* nằm trong whitelist mà loadSettings hỏi DB", async () => {
    setSettings({});
    await getConfig();
    assert.ok(Array.isArray(settings.lastAskedKeys), "phải lọc bằng where.key.in");
    for (const k of ["GPT2API_PROFILE_GIFTCODE", "GPT2API_PROFILE_REFERRAL", "GPT2API_PROFILE_PURCHASE"]) {
        assert.ok(settings.lastAskedKeys.includes(k), `thiếu ${k} trong SETTING_KEYS → đọc mãi không ra`);
    }
});

test("Setting trỏ nguồn tới server ĐANG TẮT BÁN đi được tới getSourceProfileId", async () => {
    setSettings({ GPT2API_PROFILES: THREE_SERVERS, GPT2API_PROFILE_GIFTCODE: "3" });

    assert.equal(await getSourceProfileId(KEY_SOURCES.GIFTCODE), 3);
    // Hai nguồn kia không bị kéo theo.
    assert.equal(await getSourceProfileId(KEY_SOURCES.REFERRAL), null);
    assert.equal(await getSourceProfileId(KEY_SOURCES.PURCHASE), null);
});

test("ba nguồn trỏ ba server khác nhau", async () => {
    setSettings({
        GPT2API_PROFILES: THREE_SERVERS,
        GPT2API_PROFILE_GIFTCODE: "3",
        GPT2API_PROFILE_REFERRAL: "3",
        GPT2API_PROFILE_PURCHASE: "2",
    });
    assert.equal(await getSourceProfileId(KEY_SOURCES.GIFTCODE), 3);
    assert.equal(await getSourceProfileId(KEY_SOURCES.REFERRAL), 3);
    assert.equal(await getSourceProfileId(KEY_SOURCES.PURCHASE), 2);
});

test("chưa cấu hình gì → null cả ba, tức giữ nguyên hành vi cũ", async () => {
    setSettings({ GPT2API_PROFILES: THREE_SERVERS });
    for (const s of Object.values(KEY_SOURCES)) {
        assert.equal(await getSourceProfileId(s), null, `${s} phải để createApiKey tự chọn`);
    }
});

test("id trỏ tới server đã xoá rơi về mặc định thay vì chặn cấp key", async () => {
    setSettings({ GPT2API_PROFILES: THREE_SERVERS, GPT2API_PROFILE_GIFTCODE: "99" });
    assert.equal(await getSourceProfileId(KEY_SOURCES.GIFTCODE), null);
});

test("xoá trắng ô trong web admin (ghi chuỗi rỗng) = về mặc định", async () => {
    // PUT /gpt2api/config ghi "" chứ không xoá document, nên "" phải đọc ra null
    // — nếu không admin bỏ chọn xong vẫn bị ghim cứng server cũ.
    setSettings({ GPT2API_PROFILES: THREE_SERVERS, GPT2API_PROFILE_GIFTCODE: "" });
    assert.equal(await getSourceProfileId(KEY_SOURCES.GIFTCODE), null);
});

test("getConfig().sourceProfiles giữ nguyên số thô để UI phân biệt 'đã chọn' với 'server đã xoá'", async () => {
    setSettings({ GPT2API_PROFILES: THREE_SERVERS, GPT2API_PROFILE_REFERRAL: "99" });
    const cfg = await getConfig();
    assert.equal(cfg.sourceProfiles.referral, 99, "bản thô giữ số admin đã lưu");
    assert.equal(await getSourceProfileId(KEY_SOURCES.REFERRAL), null, "bản đã lọc mới là cái dùng để cấp key");
});
