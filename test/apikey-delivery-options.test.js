import test, { mock } from "node:test";
import assert from "node:assert/strict";

// Khách chọn RPM + số ngày ở bước 2/3 của luồng mua. Trước đây deliverApiKey lấy
// rpm/validDays từ CẤU HÌNH SHOP, nên khách chọn gì cũng ra mặc định. Test này ghim
// hợp đồng: đơn mang gì thì gửi provider đúng cái đó, và ngày hết hạn được lưu lại
// để /mykey hiện được.
const url = (path) => new URL(path, import.meta.url).href;

process.env.ADMIN_IDS = "";

const state = {
    createCalls: [],
    savedKeys: [],
    refunds: [],
    // profileId mà deliverApiKey hỏi cấu hình — chốt rằng nó đọc từ ĐƠN chứ không
    // rơi về cấu hình chung của shop.
    profileAsks: [],
    // Định tuyến "đơn mua" của admin: chỉ được dùng khi đơn KHÔNG mang server.
    sourceAsks: [],
    sourceProfileId: null,
    createResult: { ok: true, key: "sk-test-1", id: "ext-1" },
    // Cấu hình shop CỐ TÌNH khác lựa chọn của khách để phân biệt được hai nguồn.
    cfg: {
        enabled: true,
        configured: true,
        rpm: 300,
        validDays: 30,
        models: ["claude-opus-5"],
        endpoint: "https://api.example.com/v1",
        usageUrl: "https://api.example.com/key",
        docUrl: "https://docs.example.com",
    },
};

// delivery.js gọi isSafeApiKeyCreateFailure để quyết định hoàn tiền. Đó là HÀM
// THUẦN — lấy BẢN THẬT thay vì chép lại vào mock, vì chép lại là dựng nguồn sự thật
// thứ hai: đúng cái bug khiến đơn preflight lỗi mạng bị treo PAID không hoàn tiền.
const { isSafeApiKeyCreateFailure } = await import("../src/gpt2api.js");

mock.module(url("../src/gpt2api.js"), {
    namedExports: {
        isSafeApiKeyCreateFailure,
        async getConfig() { return state.cfg; },
        // Mỗi "server" là cfg chung + nhóm fallback/giá riêng. Mock trả kèm tên để
        // test kiểm được key lưu đúng nguồn.
        async getProfileConfig(profileId) {
            state.profileAsks.push(profileId);
            const id = profileId === null || profileId === undefined ? 1 : Number(profileId);
            return { ...state.cfg, profileId: id, profileName: `Server ${id}` };
        },
        async getProfiles() { return [{ ...state.cfg, profileId: 1, profileName: "Server 1" }]; },
        async createApiKey(args) {
            state.createCalls.push(args);
            return { ...state.createResult, profileId: args?.profileId ?? 1, profileName: `Server ${args?.profileId ?? 1}` };
        },
        // delivery.js import cả hàm gia hạn — mock thay CẢ module nên thiếu là gãy
        // ngay từ lúc load. Đơn ở file này đều là đơn mua mới nên không ai gọi tới.
        async renewApiKey() {
            throw new Error("đơn mua mới không được đi vào nhánh gia hạn");
        },
        invalidateKeyStatusCache: () => {},
        // Server mặc định cho ĐƠN MUA không mang field apikeyProfile (đơn tạo
        // trước khi shop tách nhiều server). null = server đầu tiên đang bật.
        async getSourceProfileId(source) {
            state.sourceAsks.push(source);
            return state.sourceProfileId;
        },
        // keyboards.js import cả hàm này — mock.module thay cả module nên thiếu là gãy.
        isGpt2apiEnabledSync: () => true,
        invalidateGpt2apiConfig: () => {},
        warmGpt2apiConfig: async () => {},
        DEFAULT_MODELS: ["claude-opus-5"],
    },
});

mock.module(url("../src/apikey-store.js"), {
    namedExports: {
        KeySource: { GIFTCODE: "GIFTCODE", PURCHASE: "PURCHASE", ADMIN: "ADMIN" },
        async saveIssuedKey(entry) {
            state.savedKeys.push(entry);
            return { id: "key-1", ...entry };
        },
    },
});

mock.module(url("../src/wallet.js"), {
    namedExports: {
        async refund(tgId, amount, orderId, note) {
            state.refunds.push({ tgId, amount, orderId, note });
            return { success: true };
        },
    },
});

mock.module(url("../src/referral.js"), {
    namedExports: { processReferralCommission: async () => ({}) },
});
mock.module(url("../src/vip.js"), { namedExports: { addSpending: async () => ({}) } });
mock.module(url("../src/inventory.js"), {
    namedExports: { checkStock: async () => {}, invalidateStockCache: () => {} },
});
mock.module(url("../src/broadcast.js"), {
    namedExports: { broadcastNewOrder: async () => {}, maskBuyerName: (v) => v },
});
mock.module(url("../src/lib/logger.js"), { namedExports: { sendLog: () => {} } });
mock.module(url("../src/shop-config.js"), {
    namedExports: {
        isOrderChannelNotifyEnabled: async () => false,
        getOrderNotifyChannel: async () => null,
        getSupportChannelUrlSync: () => "",
        invalidateShopConfig: () => {},
        getBankConfig: async () => ({}),
        getBankConfigSync: () => ({}),
        getSupportChannelUrl: async () => "",
        isOrderBotBroadcastEnabled: async () => false,
        getOrderExpireMinutes: async () => 10,
        getOrderExpireMinutesSync: () => 10,
        getCryptoConfigSync: () => ({}),
        getSepayApiKey: async () => "",
        getSepayApiKeySync: () => "",
        getMaxDeposit: async () => 0,
        getDepositPresets: async () => [],
        warmShopConfig: async () => {},
    },
});

const { deliverOrder } = await import("../src/delivery.js");

const PRODUCT = { id: "prod-key", name: "API Key", deliveryMode: "API_KEY", code: "__API_KEY__" };

function makeOrder(extra = {}) {
    return {
        id: "order-key-1",
        productId: "prod-key",
        userId: "user-1",
        odelegramId: "777",
        chatId: "777",
        quantity: 1,
        finalAmount: 2500,
        paymentMethod: "wallet",
        displayFinalUsd: 0.1,
        apikeyTokens: 7_000_000,
        ...extra,
    };
}

function makePrisma(order) {
    const updates = [];
    return {
        updates,
        order: {
            async updateMany() { return { count: 1 }; },
            async update(args) { updates.push(args); return {}; },
            // Đơn trong DB chưa có deliveryRef → không phải nhánh "giao lại".
            async findUnique() { return { ...order, status: "DELIVERING" }; },
        },
        product: { async findUnique() { return PRODUCT; } },
        user: { async findUnique() { return { id: "user-1", language: "vi" }; } },
    };
}

const telegram = {
    sendMessage: async () => ({}),
    sendDocument: async () => ({}),
    sendPhoto: async () => ({}),
};

function reset() {
    state.createCalls = [];
    state.savedKeys = [];
    state.refunds = [];
    state.profileAsks = [];
    state.sourceAsks = [];
    state.sourceProfileId = null;
    state.createResult = { ok: true, key: "sk-test-1", id: "ext-1" };
}

function deliveredPayload(prisma) {
    const hit = prisma.updates.find((u) => u.data?.deliveryRef === "API_KEY");
    assert.ok(hit, "đơn không được ghi deliveryContent");
    return JSON.parse(hit.data.deliveryContent);
}

test("RPM và số ngày KHÁCH CHỌN được gửi cho provider, không phải mặc định của shop", async () => {
    reset();
    const order = makeOrder({ apikeyRpm: 1200, apikeyValidDays: 7 });
    await deliverOrder({ prisma: makePrisma(order), telegram, order: { ...order } });

    assert.equal(state.createCalls.length, 1);
    assert.equal(state.createCalls[0].rpm, 1200, "phải dùng RPM khách chọn (1200), không phải cfg.rpm 300");
    assert.equal(state.createCalls[0].validDays, 7, "phải dùng 7 ngày khách chọn, không phải cfg 30");
    assert.equal(state.createCalls[0].quotaTokens, 7_000_000);
});

test("chọn 'không hết hạn' (0 ngày) không bị hiểu thành mặc định của shop", async () => {
    // Đây là cái bẫy: 0 là falsy nên `order.apikeyValidDays || cfg.validDays` sẽ
    // âm thầm biến "không hết hạn" thành "30 ngày" — khách mất key sau một tháng.
    reset();
    const order = makeOrder({ apikeyRpm: 600, apikeyValidDays: 0 });
    const prisma = makePrisma(order);
    await deliverOrder({ prisma, telegram, order: { ...order } });

    assert.equal(state.createCalls[0].validDays, 0, "0 ngày phải giữ nguyên là 0");
    assert.equal(state.savedKeys[0].expiresAt, null, "không hết hạn thì không lưu ngày hết hạn");
    assert.equal(deliveredPayload(prisma).expiresAt, null);
});

test("server KHÁCH CHỌN đi theo đơn tới tận provider", async () => {
    // Giá và nhóm model fallback thuộc về từng server. Cấp nhầm server = khách trả
    // tiền server này nhưng nhận key chạy nhóm model khác.
    reset();
    const order = makeOrder({ apikeyRpm: 600, apikeyValidDays: 7, apikeyProfile: 3 });
    await deliverOrder({ prisma: makePrisma(order), telegram, order: { ...order } });

    assert.equal(state.createCalls[0].profileId, 3, "createApiKey phải nhận server của đơn");
    assert.ok(state.profileAsks.includes(3), "cấu hình phải đọc theo server của đơn, không phải cfg chung");
    assert.equal(state.savedKeys[0].profileId, 3, "kho key phải ghi lại server đã cấp");
    assert.equal(state.savedKeys[0].profileName, "Server 3");
});

test("admin tắt server KHÔNG được huỷ đơn đã trả tiền của server đó", async () => {
    // Đơn này đã trừ ví rồi. Tắt server chỉ có nghĩa "ngừng bán", nên đường giao
    // hàng phải xin cấp key kể cả khi server đang tắt — nếu không, createApiKey
    // trả "disabled" và nhánh lỗi bên dưới hoàn tiền + huỷ đơn, khách mất hàng.
    // Với delivery-recovery retry tới 7 ngày, chỉ cần admin gạt công tắc đúng lúc.
    reset();
    const order = makeOrder({ apikeyRpm: 600, apikeyValidDays: 7, apikeyProfile: 2 });
    await deliverOrder({ prisma: makePrisma(order), telegram, order: { ...order } });

    assert.equal(state.createCalls[0].allowDisabledProfile, true,
        "deliverApiKey phải xin cấp key kể cả khi server đã tắt");
});

test("đơn cũ (chưa có field server) không gãy — lùi về server mặc định", async () => {
    // Đơn tạo trước khi có nhiều server vẫn phải giao được key.
    reset();
    const order = makeOrder({ apikeyRpm: 600, apikeyValidDays: 7 }); // apikeyProfile vắng hẳn
    await deliverOrder({ prisma: makePrisma(order), telegram, order: { ...order } });

    assert.equal(state.createCalls.length, 1, "vẫn phải cấp được key");
    assert.equal(state.createCalls[0].profileId, null);
});

test("đơn cũ KHÔNG mang server thì dùng GPT2API_PROFILE_PURCHASE của admin", async () => {
    // Đây là toàn bộ phạm vi của ô "Đơn mua" trong tab Kết nối: bot ghi
    // apikeyProfile cho mọi đơn mua mới, nên nhánh này chỉ chạm tới đơn tạo trước
    // khi shop tách nhiều server mà vẫn còn trong hạn giao lại 7 ngày.
    reset();
    state.sourceProfileId = 4;
    const order = makeOrder({ apikeyRpm: 600, apikeyValidDays: 7 }); // apikeyProfile vắng hẳn
    await deliverOrder({ prisma: makePrisma(order), telegram, order: { ...order } });

    assert.deepEqual(state.sourceAsks, ["purchase"], "phải hỏi định tuyến của nguồn 'đơn mua'");
    assert.equal(state.createCalls[0].profileId, 4);
    assert.ok(state.profileAsks.includes(4), "cấu hình cũng phải đọc theo server đó");
});

test("đơn CÓ mang server thì lựa chọn của khách thắng cấu hình admin", async () => {
    // Đơn đã trừ tiền theo giá của server khách chọn. Để cấu hình admin đè lên là
    // khách trả tiền server này mà nhận key chạy nhóm model của server khác — và
    // admin đổi một ô setting là đổi luôn hàng của những đơn đang chờ giao.
    reset();
    state.sourceProfileId = 4;
    const order = makeOrder({ apikeyRpm: 600, apikeyValidDays: 7, apikeyProfile: 2 });
    await deliverOrder({ prisma: makePrisma(order), telegram, order: { ...order } });

    assert.equal(state.createCalls[0].profileId, 2, "server của đơn phải thắng");
    assert.deepEqual(state.sourceAsks, [], "đơn đã có server thì không cần hỏi định tuyến");
});

test("đơn cũ (chưa có field ngày) mới lùi về cấu hình shop", async () => {
    reset();
    const order = makeOrder({ apikeyRpm: 600 }); // apikeyValidDays vắng hẳn
    await deliverOrder({ prisma: makePrisma(order), telegram, order: { ...order } });

    assert.equal(state.createCalls[0].validDays, 30, "đơn thiếu field mới dùng cfg.validDays");
});

test("ngày hết hạn được lưu vào kho key để /mykey hiện được", async () => {
    reset();
    const order = makeOrder({ apikeyRpm: 300, apikeyValidDays: 10 });
    const before = Date.now();
    const prisma = makePrisma(order);
    await deliverOrder({ prisma, telegram, order: { ...order } });

    const saved = state.savedKeys[0];
    assert.equal(saved.source, "PURCHASE");
    assert.equal(saved.rpm, 300);
    assert.ok(saved.expiresAt, "phải lưu expiresAt");
    const ms = new Date(saved.expiresAt).getTime() - before;
    // 10 ngày ±1 phút cho thời gian chạy test.
    assert.ok(Math.abs(ms - 10 * 86_400_000) < 60_000, `lệch ${ms}ms so với 10 ngày`);

    // Payload gửi khách mang cùng một mốc — không được lệch với kho key.
    assert.equal(deliveredPayload(prisma).expiresAt, new Date(saved.expiresAt).toISOString());
    assert.equal(deliveredPayload(prisma).validDays, 10);
});

test("provider trả về expires_at thì tin nó thay vì tự cộng ngày", async () => {
    reset();
    state.createResult = { ok: true, key: "sk-test-2", id: "ext-2", expiresAt: "2030-01-15T00:00:00.000Z" };
    const order = makeOrder({ apikeyRpm: 300, apikeyValidDays: 10 });
    const prisma = makePrisma(order);
    await deliverOrder({ prisma, telegram, order: { ...order } });

    assert.equal(state.savedKeys[0].expiresAt, "2030-01-15T00:00:00.000Z");
    assert.equal(deliveredPayload(prisma).expiresAt, "2030-01-15T00:00:00.000Z");
});

test("provider không cấp được key → hoàn tiền, không lưu key nào", async () => {
    reset();
    state.createResult = { ok: false, code: "not_configured", message: "provider unavailable before request" };
    const order = makeOrder({ apikeyRpm: 600, apikeyValidDays: 7 });

    await assert.rejects(
        deliverOrder({ prisma: makePrisma(order), telegram, order: { ...order } }),
        /API_KEY create fail/,
    );
    assert.equal(state.savedKeys.length, 0, "thất bại thì không được lưu key");
    assert.equal(state.refunds.length, 1, "khách trả ví phải được hoàn tiền");
    assert.equal(state.refunds[0].amount, 2500);
    assert.equal(state.refunds[0].orderId, "order-key-1", "refund keyed theo order → idempotent");
});


test("timeout tạo key là kết quả mơ hồ → chặn retry, không hoàn tiền/cấp lại tự động", async () => {
    reset();
    state.createResult = { ok: false, code: "network", message: "timeout after POST" };
    const order = makeOrder({ apikeyRpm: 600, apikeyValidDays: 7 });
    const prisma = makePrisma(order);

    const result = await deliverOrder({ prisma, telegram, order: { ...order } });
    assert.equal(result.blocked, true);
    assert.equal(result.deliveryRef, "API_KEY_CREATE_WIP");
    assert.equal(state.refunds.length, 0, "timeout có thể đã tạo key nên không được hoàn tự động");
    assert.equal(state.savedKeys.length, 0);
    assert.ok(prisma.updates.some((u) => u.data?.deliveryRetryBlockedAt), "phải đánh dấu cần đối soát");
});

test("lỗi mạng ở bước PREFLIGHT (chưa POST /keys) thì hoàn tiền — không được treo đơn", async () => {
    // createApiKey tự gọi listModelGroups() trước khi POST /keys. Bước đó lỗi mạng
    // thì nó trả code "network" KÈM providerMutationPossible:false — request tạo key
    // chưa rời process nên chắc chắn không có key nào tồn tại, hoàn tiền là an toàn
    // tuyệt đối.
    //
    // Bug đã sửa: delivery.js từng phân loại bằng isSafeRefundCreateCode(code) do nó
    // tự định nghĩa, chỉ nhìn `code` nên mất providerMutationPossible. "network" bị
    // coi là mơ hồ → đơn đã trừ ví bị treo PAID + deliveryRetryBlockedAt, không hoàn
    // tiền, không có key, chờ admin soát tay. Một cú trục trặc mạng ở preflight biến
    // thành một khách hàng mất tiền.
    reset();
    state.createResult = {
        ok: false,
        code: "network",
        message: "fetch failed khi lấy model-groups",
        providerMutationPossible: false,
    };
    const order = makeOrder({ apikeyRpm: 600, apikeyValidDays: 7 });
    const prisma = makePrisma(order);

    await assert.rejects(
        deliverOrder({ prisma, telegram, order: { ...order } }),
        /API_KEY create fail/,
    );
    assert.equal(state.refunds.length, 1, "preflight chưa POST /keys → phải hoàn tiền ngay");
    assert.equal(state.refunds[0].amount, 2500);
    assert.equal(state.savedKeys.length, 0);
    assert.ok(
        prisma.updates.some((u) => u.data?.status === "CANCELED"),
        "đơn đã hoàn tiền phải bị huỷ, không được treo PAID chờ admin",
    );
});

test("lỗi mạng SAU khi POST /keys vẫn mơ hồ → KHÔNG hoàn tiền (chiều ngược lại)", async () => {
    // Chốt nửa còn lại của hợp đồng: providerMutationPossible:true nghĩa là request
    // đã rời process, provider CÓ THỂ đã tạo key. Hoàn tiền ở đây là khách vừa giữ
    // key vừa lấy lại tiền.
    reset();
    state.createResult = {
        ok: false,
        code: "network",
        message: "timeout after POST /keys",
        providerMutationPossible: true,
    };
    const order = makeOrder({ apikeyRpm: 600, apikeyValidDays: 7 });
    const prisma = makePrisma(order);

    const result = await deliverOrder({ prisma, telegram, order: { ...order } });
    assert.equal(result.blocked, true);
    assert.equal(state.refunds.length, 0, "đã POST rồi thì không được hoàn tự động");
    assert.equal(state.savedKeys.length, 0);
    assert.ok(prisma.updates.some((u) => u.data?.deliveryRetryBlockedAt));
});

test("đơn thiếu số token bị chặn trước khi gọi provider", async () => {
    reset();
    const order = makeOrder({ apikeyTokens: 0, apikeyRpm: 300, apikeyValidDays: 7 });

    await assert.rejects(
        deliverOrder({ prisma: makePrisma(order), telegram, order: { ...order } }),
        /missing apikeyTokens/,
    );
    assert.equal(state.createCalls.length, 0);
});

test("đơn trả bằng QR ngân hàng / USDT mà tạo key lỗi CŨNG được hoàn vào ví", async () => {
    // Đơn QR/USDT chỉ tới được deliverApiKey sau khi poller thấy tiền về và
    // chuyển PAID — tiền đã nằm trong túi shop. Không đảo ngược được chuyển khoản
    // ngân hàng, càng không đảo được on-chain, nên hoàn vào ví là đường DUY NHẤT.
    // Trước đây nhánh hoàn tiền gác bằng `paymentMethod === "wallet"`, tức khách
    // trả tiền thật rồi mất trắng khi provider hỏng.
    for (const method of ["vietqr", "crypto_trc20", "crypto_bep20", "crypto_binance_pay"]) {
        reset();
        state.createResult = { ok: false, code: "not_configured", message: "provider unavailable before request" };
        const order = makeOrder({ apikeyRpm: 600, apikeyValidDays: 7, paymentMethod: method });

        await assert.rejects(
            deliverOrder({ prisma: makePrisma(order), telegram, order: { ...order } }),
            /API_KEY create fail/,
        );
        assert.equal(state.refunds.length, 1, `${method}: phải hoàn tiền`);
        assert.equal(state.refunds[0].amount, 2500, `${method}: hoàn đủ số đã thu`);
        assert.equal(state.refunds[0].orderId, "order-key-1", `${method}: keyed theo order → idempotent`);
        assert.equal(state.savedKeys.length, 0, `${method}: thất bại thì không lưu key`);
    }
});

test("đơn phương thức lạ / miễn phí không bị hoàn tiền khống", async () => {
    // Gác bằng danh sách phương thức CỤ THỂ chứ không phải "khác rỗng": đơn admin
    // cấp tay hay đơn khuyến mãi chưa từng thu tiền, hoàn ở đây là tặng tiền.
    reset();
    state.createResult = { ok: false, code: "not_configured", message: "provider unavailable before request" };
    const order = makeOrder({ apikeyRpm: 600, apikeyValidDays: 7, paymentMethod: "admin_grant" });

    await assert.rejects(
        deliverOrder({ prisma: makePrisma(order), telegram, order: { ...order } }),
        /API_KEY create fail/,
    );
    assert.equal(state.refunds.length, 0, "chưa thu tiền thì không hoàn");
});

test("đơn giá 0đ không tạo giao dịch hoàn tiền rác", async () => {
    reset();
    state.createResult = { ok: false, code: "not_configured", message: "provider unavailable before request" };
    const order = makeOrder({ apikeyRpm: 600, apikeyValidDays: 7, paymentMethod: "vietqr", finalAmount: 0 });

    await assert.rejects(
        deliverOrder({ prisma: makePrisma(order), telegram, order: { ...order } }),
        /API_KEY create fail/,
    );
    assert.equal(state.refunds.length, 0);
});
