import test from "node:test";
import assert from "node:assert/strict";
import {
    KEY_SOURCES, KEY_SOURCE_NAMES, sourceSettingKey,
    resolveSourceProfileId, readSourceProfiles, resolveProfiles,
} from "../src/apikey-profiles.js";

/**
 * Nguồn key → server nào. Ba nguồn (giftcode / quà mời bạn / đơn mua) trước đây
 * dùng chung "server đầu tiên đang bật", nên key TẶNG chạy đúng nhóm model đắt
 * tiền mà khách phải trả tiền mới có.
 *
 * Ràng buộc quan trọng nhất: shop chưa cấu hình gì phải chạy Y HỆT như cũ.
 */
const SHOP = { fallbackGroups: ["g-chung"], usdPerMtoken: 0.01, rpm: 300 };
const RAW = [
    { id: 1, profileName: "Server 1", profileEnabled: true, fallbackGroups: ["g-xin"] },
    { id: 2, profileName: "Server 2", profileEnabled: true, fallbackGroups: ["g-nhanh"] },
    { id: 3, profileName: "Miễn phí", profileEnabled: false, fallbackGroups: ["g-re"] },
];
const RESOLVED = resolveProfiles(RAW, SHOP);

test("chưa chọn gì → null, tức giữ nguyên hành vi cũ", () => {
    // null nghĩa là "không chỉ định", caller truyền thẳng cho createApiKey và
    // pickProfile rơi về server đầu tiên đang bật. Trả 1 ở đây là âm thầm ghim
    // cứng server, shop đổi thứ tự server là cấp nhầm.
    const empty = readSourceProfiles(() => "");
    assert.deepEqual(empty, { giftcode: null, referral: null, purchase: null });
    for (const s of KEY_SOURCE_NAMES) {
        assert.equal(resolveSourceProfileId(empty, s, RESOLVED), null);
    }
});

test("đọc đúng khoá Setting của từng nguồn", () => {
    assert.equal(sourceSettingKey(KEY_SOURCES.GIFTCODE), "GPT2API_PROFILE_GIFTCODE");
    assert.equal(sourceSettingKey(KEY_SOURCES.REFERRAL), "GPT2API_PROFILE_REFERRAL");
    assert.equal(sourceSettingKey(KEY_SOURCES.PURCHASE), "GPT2API_PROFILE_PURCHASE");

    const store = { GPT2API_PROFILE_GIFTCODE: "3", GPT2API_PROFILE_PURCHASE: "1" };
    assert.deepEqual(readSourceProfiles((k) => store[k]), { giftcode: 3, referral: null, purchase: 1 });
});

test("trỏ được vào server ĐANG TẮT BÁN — đó chính là cách dùng chờ đợi", () => {
    // Server "Miễn phí" bị tắt để khách không thấy trong menu mua, nhưng key tặng
    // vẫn phải cấp được từ nó (giftcode/referral gọi kèm allowDisabledProfile).
    const sp = readSourceProfiles((k) => ({ GPT2API_PROFILE_GIFTCODE: "3" })[k]);
    assert.equal(resolveSourceProfileId(sp, KEY_SOURCES.GIFTCODE, RESOLVED), 3);
});

test("id trỏ tới server ĐÃ XOÁ rơi về mặc định, không chặn việc cấp key", () => {
    // Thà cấp bằng server mặc định còn hơn hỏng hẳn vì một con số mồ côi trong
    // Setting sau khi admin xoá server.
    const sp = readSourceProfiles((k) => ({ GPT2API_PROFILE_REFERRAL: "99" })[k]);
    assert.equal(resolveSourceProfileId(sp, KEY_SOURCES.REFERRAL, RESOLVED), null);
});

test("giá trị rác trong Setting không làm gãy việc cấp key", () => {
    for (const bad of ["abc", "-1", "0", " ", "null"]) {
        const sp = readSourceProfiles((k) => ({ GPT2API_PROFILE_GIFTCODE: bad })[k]);
        assert.equal(sp.giftcode, null, `"${bad}" phải bị bỏ qua`);
    }
});

test("ba nguồn độc lập nhau, đổi cái này không kéo theo cái kia", () => {
    const store = { GPT2API_PROFILE_GIFTCODE: "3", GPT2API_PROFILE_REFERRAL: "3", GPT2API_PROFILE_PURCHASE: "2" };
    const sp = readSourceProfiles((k) => store[k]);
    assert.equal(resolveSourceProfileId(sp, KEY_SOURCES.GIFTCODE, RESOLVED), 3);
    assert.equal(resolveSourceProfileId(sp, KEY_SOURCES.REFERRAL, RESOLVED), 3);
    assert.equal(resolveSourceProfileId(sp, KEY_SOURCES.PURCHASE, RESOLVED), 2);
});

test("chưa có danh sách server thì không loại id nào (tránh chặn oan lúc boot)", () => {
    const sp = readSourceProfiles((k) => ({ GPT2API_PROFILE_GIFTCODE: "7" })[k]);
    assert.equal(resolveSourceProfileId(sp, KEY_SOURCES.GIFTCODE, []), 7);
});

test("server được chọn mang ĐÚNG nhóm model của nó", () => {
    // Đây là cả mục đích của tính năng: key tặng chạy nhóm rẻ, key bán chạy nhóm xịn.
    const byId = (id) => RESOLVED.find((p) => p.profileId === id);
    assert.deepEqual(byId(3).fallbackGroups, ["g-re"]);
    assert.deepEqual(byId(1).fallbackGroups, ["g-xin"]);
});
