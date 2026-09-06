import test, { mock } from "node:test";
import assert from "node:assert/strict";

// giftcode.js gọi prisma + wallet + gpt2api + apikey-store, không nhận dependency
// injection → mock module. Cần cờ --experimental-test-module-mocks (đã có trong npm test).
const url = (path) => new URL(path, import.meta.url).href;

const TG_ID = "555000222";

function createState({ gift = {}, keyFails = false } = {}) {
    return {
        gift: {
            id: "gift-key-1",
            code: "WELCOME2",
            rewardType: "APIKEY",
            amount: 0,
            quotaMinM: 5,
            quotaMaxM: 100,
            quotaAlpha: 0,
            keyRpm: 300,
            keyValidDays: 0,
            maxUses: 10,
            usedCount: 0,
            perUserLimit: 1,
            vipOnly: 0,
            expiresAt: null,
            note: null,
            isActive: true,
            ...gift,
        },
        redemptions: [],
        issuedKeys: [],
        createKeyCalls: [],
        // Server admin trỏ cho nguồn này (null = server đầu tiên đang bật).
        sourceAsks: [],
        sourceProfileId: null,
        // Cấu hình RIÊNG của từng server, để kiểm rằng giftcode đọc cfg của server
        // đã trỏ chứ không phải cấu hình phẳng của shop.
        profileAsks: [],
        profileCfgs: {},
        keyFails,
        cfgValidDays: 0,
        providerExpiresAt: null,
    };
}

let state = createState();

const prismaMock = {
    giftCode: {
        async findUnique({ where }) {
            if (where.code && where.code !== state.gift.code) return null;
            if (where.id && where.id !== state.gift.id) return null;
            return { ...state.gift };
        },
        async updateMany({ where, data }) {
            if (where.usedCount?.lt !== undefined && state.gift.usedCount >= where.usedCount.lt) {
                return { count: 0 };
            }
            state.gift.usedCount += data.usedCount.increment;
            return { count: 1 };
        },
    },
    giftCodeRedemption: {
        async count({ where }) {
            return state.redemptions.filter(
                (r) => r.giftCodeId === where.giftCodeId && r.telegramId === where.telegramId,
            ).length;
        },
        async create({ data }) {
            if (state.redemptions.some((r) => r.redeemKey === data.redeemKey)) {
                const err = new Error("E11000 duplicate key error");
                err.code = 11000;
                throw err;
            }
            const doc = { id: `red-${state.redemptions.length + 1}`, ...data };
            state.redemptions.push(doc);
            return { ...doc };
        },
        async update({ where, data }) {
            const doc = state.redemptions.find((r) => r.id === where.id);
            if (doc) Object.assign(doc, data);
            return doc ? { ...doc } : null;
        },
        async delete({ where }) {
            const i = state.redemptions.findIndex((r) => r.id === where.id);
            if (i >= 0) state.redemptions.splice(i, 1);
            return { id: where.id };
        },
        async findMany() { return state.redemptions.map((r) => ({ ...r })); },
    },
    user: {
        async findUnique() { return { vipLevel: state.userVipLevel ?? 0 }; },
    },
};

mock.module(url("../src/lib/prisma.js"), {
    defaultExport: new Proxy({}, { get: (_t, prop) => prismaMock[prop] }),
});

mock.module(url("../src/wallet.js"), {
    namedExports: {
        TxType: { GIFTCODE: "GIFTCODE", ADMIN_ADD: "ADMIN_ADD" },
        async creditWallet() {
            throw new Error("mã APIKEY không được gọi creditWallet");
        },
    },
});

mock.module(url("../src/gpt2api.js"), {
    namedExports: {
        // Nguồn nào cấp key trên server nào. null = server đầu tiên đang bật
        // (hành vi trước khi có tuỳ chọn này).
        async getSourceProfileId(source) { state.sourceAsks.push(source); return state.sourceProfileId; },
        // Cấu hình của ĐÚNG server đã trỏ. giftcode.js phải đọc cái này chứ không
        // phải getConfig() của shop — nếu không thì trỏ server chỉ đổi được nhóm
        // model, còn miền quota/RPM/số ngày vẫn theo cấu hình hàng bán.
        async getProfileConfig(pid) {
            state.profileAsks.push(pid ?? null);
            const shop = {
                profileId: 1, profileName: "Server 1",
                rpm: 300,
                validDays: state.cfgValidDays ?? 0,
                models: ["claude-opus-5", "claude-sonnet-5"],
                endpoint: "https://api.example.com/v1",
                docUrl: "https://docs.example.com",
                usageUrl: "https://api.example.com/key",
            };
            return pid === null || pid === undefined ? shop : { ...shop, ...(state.profileCfgs[pid] || {}) };
        },
        async createApiKey(args) {
            state.createKeyCalls.push(args);
            if (state.keyFails) return { ok: false, code: "network", message: "provider down" };
            return {
                ok: true,
                key: `sk-test-${state.createKeyCalls.length}`,
                id: `ext-${state.createKeyCalls.length}`,
                ...(state.providerExpiresAt ? { expiresAt: state.providerExpiresAt } : {}),
            };
        },
    },
});

mock.module(url("../src/apikey-store.js"), {
    namedExports: {
        KeySource: { GIFTCODE: "GIFTCODE", PURCHASE: "PURCHASE", ADMIN: "ADMIN" },
        async saveIssuedKey(entry) {
            const doc = { id: `key-${state.issuedKeys.length + 1}`, ...entry };
            state.issuedKeys.push(doc);
            return doc;
        },
    },
});

const { redeemGiftCode, GiftCodeError, GiftRewardType } = await import("../src/giftcode.js");
// apikey-pricing.js KHÔNG bị mock (hàm thuần, không I/O) — lấy miền mặc định
// thật để test hợp đồng "gift không set quota → dùng mặc định".
const { FREE_MIN_M, FREE_MAX_M } = await import("../src/apikey-pricing.js");

test("mã APIKEY cấp key thật, quota nằm trong miền cấu hình", async () => {
    state = createState();
    const result = await redeemGiftCode(TG_ID, "welcome2");

    assert.equal(result.success, true);
    assert.equal(result.rewardType, GiftRewardType.APIKEY);
    assert.match(result.key, /^sk-test-/);
    assert.equal(result.rpm, 300);
    assert.ok(result.quotaTokens >= 5_000_000 && result.quotaTokens <= 100_000_000, `quota ${result.quotaTokens} ngoài miền`);
    assert.equal(result.quotaTokens % 1_000_000, 0, "quota phải là bội của 1M");

    // Key phải được lưu vào kho để /mykey thấy
    assert.equal(state.issuedKeys.length, 1);
    assert.equal(state.issuedKeys[0].source, "GIFTCODE");
    assert.equal(state.issuedKeys[0].telegramId, TG_ID);
    assert.equal(state.issuedKeys[0].quotaTokens, result.quotaTokens);

    // Redemption đánh SUCCESS kèm quota đã random
    assert.equal(state.redemptions.length, 1);
    assert.equal(state.redemptions[0].status, "SUCCESS");
    assert.equal(state.redemptions[0].rewardType, "APIKEY");
    assert.equal(state.redemptions[0].quotaTokens, result.quotaTokens);
    assert.equal(state.gift.usedCount, 1);
});

test("tin nhắn mang đủ dữ liệu để render hướng dẫn dùng key", async () => {
    state = createState();
    const result = await redeemGiftCode(TG_ID, "WELCOME2");

    assert.equal(result.endpoint, "https://api.example.com/v1");
    assert.equal(result.docUrl, "https://docs.example.com");
    assert.deepEqual(result.models, ["claude-opus-5", "claude-sonnet-5"]);
});

test("quota truyền cho provider khớp quota báo cho khách", async () => {
    state = createState();
    const result = await redeemGiftCode(TG_ID, "WELCOME2");

    assert.equal(state.createKeyCalls.length, 1);
    assert.equal(state.createKeyCalls[0].quotaTokens, result.quotaTokens,
        "quota gửi provider phải đúng bằng quota hiện cho khách");
    assert.equal(state.createKeyCalls[0].rpm, 300);
});

test("miền quota hẹp được tôn trọng", async () => {
    state = createState({ gift: { quotaMinM: 7, quotaMaxM: 7, maxUses: null, perUserLimit: 5 } });
    for (let i = 0; i < 5; i++) {
        const r = await redeemGiftCode(TG_ID, "WELCOME2");
        assert.equal(r.success, true);
        assert.equal(r.quotaTokens, 7_000_000, "miền 7–7M phải luôn ra đúng 7M");
    }
});

test("tạo key thất bại thì mã KHÔNG bị cháy — rollback cả hai suất", async () => {
    state = createState({ keyFails: true });
    const result = await redeemGiftCode(TG_ID, "WELCOME2");

    assert.equal(result.success, false);
    assert.equal(result.error, GiftCodeError.KEY_FAILED);
    assert.equal(state.gift.usedCount, 0, "lượt dùng toàn cục phải được nhả lại");
    assert.equal(state.redemptions.length, 0, "redemption phải bị xoá để khách đổi lại được");
    assert.equal(state.issuedKeys.length, 0, "không lưu key nào");

    // Provider hồi phục → đổi lại phải thành công.
    state.keyFails = false;
    const retry = await redeemGiftCode(TG_ID, "WELCOME2");
    assert.equal(retry.success, true);
    assert.equal(state.gift.usedCount, 1);
});

test("cùng user không đổi lại được mã APIKEY perUserLimit=1", async () => {
    state = createState();
    await redeemGiftCode(TG_ID, "WELCOME2");
    const second = await redeemGiftCode(TG_ID, "WELCOME2");

    assert.equal(second.success, false);
    assert.equal(second.error, GiftCodeError.ALREADY_USED);
    assert.equal(state.createKeyCalls.length, 1, "không được gọi provider lần hai");
    assert.equal(state.issuedKeys.length, 1);
});

test("hai request song song chỉ cấp MỘT key", async () => {
    state = createState();
    const [a, b] = await Promise.all([
        redeemGiftCode(TG_ID, "WELCOME2"),
        redeemGiftCode(TG_ID, "WELCOME2"),
    ]);

    const wins = [a, b].filter((r) => r.success);
    assert.equal(wins.length, 1, "chỉ một request được cấp key");
    assert.equal(state.createKeyCalls.length, 1, "provider chỉ được gọi một lần");
    assert.equal(state.issuedKeys.length, 1);
    assert.equal(state.gift.usedCount, 1);
});

test("mã APIKEY hết lượt / đã tắt / hết hạn bị từ chối trước khi gọi provider", async () => {
    state = createState({ gift: { maxUses: 1, usedCount: 1 } });
    assert.equal((await redeemGiftCode(TG_ID, "WELCOME2")).error, GiftCodeError.USED_UP);
    assert.equal(state.createKeyCalls.length, 0);

    state = createState({ gift: { isActive: false } });
    assert.equal((await redeemGiftCode(TG_ID, "WELCOME2")).error, GiftCodeError.INACTIVE);
    assert.equal(state.createKeyCalls.length, 0);

    state = createState({ gift: { expiresAt: new Date(Date.now() - 86_400_000) } });
    assert.equal((await redeemGiftCode(TG_ID, "WELCOME2")).error, GiftCodeError.EXPIRED);
    assert.equal(state.createKeyCalls.length, 0);
});

test("mã APIKEY amount=0 vẫn hợp lệ (khác mã ví)", async () => {
    // Mã ví amount=0 là INVALID; mã APIKEY không dùng amount nên phải cho qua.
    state = createState({ gift: { amount: 0 } });
    const result = await redeemGiftCode(TG_ID, "WELCOME2");
    assert.equal(result.success, true);
});

test("phân bố quota nghiêng về mốc thấp qua nhiều lần đổi", async () => {
    // Mã này set quotaMinM/MaxM riêng (5–100M) nên KHÔNG phụ thuộc miền mặc định
    // của apikey-pricing.js — đây cũng là bài kiểm chứng gift-level override.
    state = createState({ gift: { maxUses: null, perUserLimit: 400 } });
    const counts = { low: 0, high: 0 };
    for (let i = 0; i < 400; i++) {
        const r = await redeemGiftCode(TG_ID, "WELCOME2");
        assert.equal(r.success, true);
        assert.ok(
            r.quotaTokens >= 5_000_000 && r.quotaTokens <= 100_000_000,
            `quota ${r.quotaTokens} phải nằm trong miền của mã (5–100M)`,
        );
        if (r.quotaTokens <= 10_000_000) counts.low++;
        if (r.quotaTokens > 50_000_000) counts.high++;
    }
    // Kỳ vọng ~60% thấp, ~5% cao. Ngưỡng nới rộng để không flaky.
    assert.ok(counts.low > 180, `mốc 5–10M chỉ ra ${counts.low}/400, phải > 180`);
    assert.ok(counts.high < 60, `mốc >50M ra ${counts.high}/400, phải < 60`);
    assert.ok(counts.low > counts.high * 3, "mốc thấp phải phổ biến hơn mốc cao rõ rệt");
});

test("mã KHÔNG set miền quota thì dùng mặc định 3–50M", async () => {
    // quotaMinM/MaxM = 0 nghĩa là "không cấu hình" → grantApiKeyReward lùi về
    // FREE_MIN_M/FREE_MAX_M. Đây là hợp đồng giữa giftcode.js và apikey-pricing.js.
    state = createState({ gift: { quotaMinM: 0, quotaMaxM: 0, maxUses: null, perUserLimit: 60 } });
    for (let i = 0; i < 60; i++) {
        const r = await redeemGiftCode(TG_ID, "WELCOME2");
        assert.equal(r.success, true);
        assert.ok(
            r.quotaTokens >= FREE_MIN_M * 1_000_000 && r.quotaTokens <= FREE_MAX_M * 1_000_000,
            `quota ${r.quotaTokens} ngoài miền mặc định ${FREE_MIN_M}–${FREE_MAX_M}M`,
        );
    }
});

test("mã có số ngày thì key được lưu kèm ngày hết hạn", async () => {
    // /mykey đọc IssuedApiKey.expiresAt. Không lưu thì khách không biết key sống
    // tới bao giờ dù mã đã ghi rõ keyValidDays.
    state = createState({ gift: { keyValidDays: 14 } });
    const before = Date.now();
    const result = await redeemGiftCode(TG_ID, "WELCOME2");

    assert.equal(result.success, true);
    assert.equal(state.createKeyCalls[0].validDays, 14, "phải gửi 14 ngày cho provider");

    const saved = state.issuedKeys[0];
    assert.ok(saved.expiresAt, "phải lưu expiresAt vào kho key");
    const ms = new Date(saved.expiresAt).getTime() - before;
    assert.ok(Math.abs(ms - 14 * 86_400_000) < 60_000, `lệch ${ms}ms so với 14 ngày`);
    // Tin nhắn cho khách phải mang cùng mốc, không lệch với kho.
    assert.equal(result.expiresAt, new Date(saved.expiresAt).toISOString());
});

test("mã không set ngày → key không hết hạn theo thời gian", async () => {
    // keyValidDays = 0 và shop cũng không đặt → key chỉ hết khi cạn quota.
    state = createState({ gift: { keyValidDays: 0 } });
    const result = await redeemGiftCode(TG_ID, "WELCOME2");

    assert.equal(result.success, true);
    assert.equal(state.createKeyCalls[0].validDays, 0);
    assert.equal(state.issuedKeys[0].expiresAt, null);
    assert.equal(result.expiresAt, null);
});

test("mã không set ngày thì lùi về cấu hình shop", async () => {
    state = createState({ gift: { keyValidDays: 0 } });
    state.cfgValidDays = 60;
    const result = await redeemGiftCode(TG_ID, "WELCOME2");

    assert.equal(result.success, true);
    assert.equal(state.createKeyCalls[0].validDays, 60, "thiếu keyValidDays thì dùng cfg.validDays");
    assert.ok(result.expiresAt, "có số ngày thì phải có ngày hết hạn");
});

test("provider trả expires_at thì tin nó thay vì tự cộng ngày", async () => {
    state = createState({ gift: { keyValidDays: 14 } });
    state.providerExpiresAt = "2031-06-01T00:00:00.000Z";
    const result = await redeemGiftCode(TG_ID, "WELCOME2");

    assert.equal(result.expiresAt, "2031-06-01T00:00:00.000Z");
    assert.equal(state.issuedKeys[0].expiresAt, "2031-06-01T00:00:00.000Z");
});

test("key giftcode cấp trên ĐÚNG server admin đã trỏ, kể cả server đang tắt bán", async () => {
    // Cả mục đích của tính năng: server "Miễn phí" tắt bán (khách không thấy
    // trong menu mua) nhưng vẫn phải cấp được key tặng từ nó. Thiếu
    // allowDisabledProfile là createApiKey trả code "disabled" → mã cháy oan.
    state = createState();
    state.sourceProfileId = 3;
    const result = await redeemGiftCode(TG_ID, "WELCOME2");

    assert.equal(result.success, true);
    assert.deepEqual(state.sourceAsks, ["giftcode"], "phải hỏi server của nguồn giftcode");
    assert.equal(state.createKeyCalls[0].profileId, 3, "server đã chọn phải tới được provider");
    assert.equal(state.createKeyCalls[0].allowDisabledProfile, true);
});

test("chưa trỏ server thì KHÔNG bật allowDisabledProfile", async () => {
    // profileId null = createApiKey tự chọn. Truyền số bừa ở đây là âm thầm ghim
    // cứng server cho mọi shop chưa cấu hình gì.
    //
    // allowDisabledProfile cũng phải TẮT: bật vô điều kiện là xoá luôn tác dụng
    // của công tắc "ngừng bán" với key tặng — admin tắt hết server vì upstream
    // hỏng mà quên tắt công tắc shop thì mã bị đốt để cấp key trên server đang
    // tắt, thay vì rollback cho khách đổi lại sau.
    state = createState();
    const result = await redeemGiftCode(TG_ID, "WELCOME2");

    assert.equal(result.success, true);
    assert.equal(state.createKeyCalls[0].profileId, null);
    assert.equal(state.createKeyCalls[0].allowDisabledProfile, false);
});

test("miền quota + RPM + số ngày lấy theo SERVER đã trỏ, không phải cấu hình shop", async () => {
    // Đây mới là điểm mấu chốt: nếu chỉ đổi nhóm model mà quota vẫn random theo
    // miền của hàng bán thì server "Miễn phí" chẳng miễn phí hơn chỗ nào.
    state = createState({ gift: { quotaMinM: 0, quotaMaxM: 0, keyRpm: 0, keyValidDays: 0 } });
    state.cfgValidDays = 365;               // shop: key bán mặc định 1 năm
    state.sourceProfileId = 3;
    state.profileCfgs[3] = { freeMinM: 2, freeMaxM: 2, rpm: 50, validDays: 3, models: ["claude-haiku-4-5"] };

    const result = await redeemGiftCode(TG_ID, "WELCOME2");

    assert.equal(result.success, true);
    assert.deepEqual(state.profileAsks, [3], "phải hỏi cấu hình của server đã trỏ");
    assert.equal(result.quotaTokens, 2_000_000, "miền quota phải theo server 3, không phải shop");
    assert.equal(state.createKeyCalls[0].rpm, 50, "RPM phải theo server 3");
    assert.equal(state.createKeyCalls[0].validDays, 3, "số ngày phải theo server 3, không phải 365 của shop");
    assert.deepEqual(state.createKeyCalls[0].models, ["claude-haiku-4-5"]);
    // Danh sách model báo cho khách phải khớp danh sách gửi provider.
    assert.deepEqual(result.models, ["claude-haiku-4-5"]);
    assert.deepEqual(state.issuedKeys[0].models, ["claude-haiku-4-5"]);
});

test("mã tự đặt quota/RPM/ngày vẫn thắng cấu hình server", async () => {
    // Server chỉ là MẶC ĐỊNH. Đè lên lựa chọn admin đã ghi vào từng mã là đổi
    // lặng lẽ giá trị của mọi mã đã phát ra ngoài.
    state = createState({ gift: { quotaMinM: 9, quotaMaxM: 9, keyRpm: 700, keyValidDays: 14 } });
    state.sourceProfileId = 3;
    state.profileCfgs[3] = { freeMinM: 2, freeMaxM: 2, rpm: 50, validDays: 3 };

    const result = await redeemGiftCode(TG_ID, "WELCOME2");

    assert.equal(result.quotaTokens, 9_000_000);
    assert.equal(state.createKeyCalls[0].rpm, 700);
    assert.equal(state.createKeyCalls[0].validDays, 14);
});

test("nguồn viết HOA (KeySource.GIFTCODE) vẫn tra ra đúng server", async () => {
    // apikey-store.js có sẵn enum KeySource viết hoa, giftcode.js import cả hai
    // enum cạnh nhau. Không chuẩn hoá hoa/thường thì gọi nhầm trả null im lặng:
    // key cấp sai server, không lỗi, không log.
    const { resolveSourceProfileId } = await import("../src/apikey-profiles.js");
    const sp = { giftcode: "3", referral: null, purchase: null };
    assert.equal(resolveSourceProfileId(sp, "GIFTCODE", []), 3);
    assert.equal(resolveSourceProfileId(sp, "giftcode", []), 3);
    assert.equal(resolveSourceProfileId(sp, "GiftCode", []), 3);
});
