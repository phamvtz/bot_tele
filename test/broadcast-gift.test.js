import test from "node:test";
import assert from "node:assert/strict";
import { buildGiftRedeemMessage, buildNewOrderText, maskBuyerName } from "../src/broadcast.js";
import { DEFAULT_ICONS, BUTTON_LABELS } from "../src/menu-config.js";

test("icon 'nhận quà' được khai báo trong menu-config → hiện ở panel admin", () => {
    assert.ok(DEFAULT_ICONS.SOCIAL_PROOF_GIFT, "thiếu fallback icon SOCIAL_PROOF_GIFT");
    assert.ok(BUTTON_LABELS.SOCIAL_PROOF_GIFT, "thiếu label admin cho SOCIAL_PROOF_GIFT");
});

test("mã APIKEY: tin nhắn nói 'nhận quà', KHÔNG phải 'mua đơn', kèm số token", () => {
    const { text, reply_markup } = buildGiftRedeemMessage({
        rewardType: "APIKEY", quotaTokens: 12_000_000, receiverName: "alex2014_vn", lang: "vi",
    });
    assert.match(text, /nhận quà/);
    assert.doesNotMatch(text, /mua đơn/);
    assert.doesNotMatch(text, /ĐƠN HÀNG MỚI/);
    assert.match(text, /12M token/);
    // Nút mời nhập giftcode, không phải nút mua
    const flat = reply_markup.inline_keyboard.flat();
    assert.ok(flat.some((b) => b.callback_data === "REDEEM_GIFTCODE"));
    assert.ok(flat.some((b) => b.callback_data === "MUTE_ORDER_NOTIFY"));
});

test("mã ví: hiện 'Quà tặng vào ví', KHÔNG lộ số tiền", () => {
    const { text } = buildGiftRedeemMessage({
        rewardType: "WALLET", receiverName: "NguyenHuy", lang: "vi",
    });
    assert.match(text, /Quà tặng vào ví/);
    assert.doesNotMatch(text, /đ|VND|\$/); // không lộ số tiền / đơn vị tiền tệ
});

test("tên người nhận bị che, không lộ username đầy đủ", () => {
    const { text } = buildGiftRedeemMessage({ rewardType: "APIKEY", quotaTokens: 3_000_000, receiverName: "langvuongalone" });
    assert.match(text, /lan\*\*\*/);
    assert.doesNotMatch(text, /langvuongalone/);
    assert.equal(maskBuyerName("@langvuongalone"), "lan***");
});

test("đa ngôn ngữ: en / zh có bản dịch riêng", () => {
    assert.match(buildGiftRedeemMessage({ lang: "en", rewardType: "APIKEY", quotaTokens: 5_000_000 }).text, /GIFT/i);
    assert.match(buildGiftRedeemMessage({ lang: "zh", rewardType: "WALLET" }).text, /礼物/);
    // lang lạ → rơi về vi
    assert.match(buildGiftRedeemMessage({ lang: "xx", rewardType: "WALLET" }).text, /nhận quà/);
});

// === Tin "ĐƠN HÀNG MỚI" ====================================================
const apikeyOrder = (extra = {}) => ({
    masked: "hot***", safeName: "API Key", price: 6.01, currency: "USD",
    apikey: { tokens: 200_000_000, rpm: 100, validDays: 1 },
    ...extra,
});

test("đơn API key hiện SERVER đã mua", () => {
    // Mỗi server một nhóm model + một giá — người xem phải biết đơn vừa rồi của
    // server nào, không thì tin hype không nói lên được server nào đang chạy.
    const text = buildNewOrderText(apikeyOrder({ serverName: "Server 2" }));
    assert.match(text, /Server: <b>Server 2<\/b>/);
    assert.match(text, /200M token/, "vẫn phải giữ nguyên dòng thông số");
});

test("shop một server → KHÔNG có dòng server (caller truyền rỗng)", () => {
    const text = buildNewOrderText(apikeyOrder({ serverName: "" }));
    assert.doesNotMatch(text, /Server:/);
    assert.match(text, /200M token/);
});

test("đơn thường (không phải API key) không dính dòng nào của key", () => {
    const text = buildNewOrderText({ masked: "abc***", safeName: "Netflix", price: 50_000, currency: "VND" });
    assert.doesNotMatch(text, /Server:/);
    assert.doesNotMatch(text, /token/);
});

test("tên server được escape — admin đặt tên có '<' không phá HTML", () => {
    const text = buildNewOrderText(apikeyOrder({ serverName: "<b>hack</b>" }));
    assert.match(text, /&lt;b&gt;hack&lt;\/b&gt;/);
    assert.doesNotMatch(text, /<b>hack<\/b>/);
});

test("dòng server có bản dịch en / zh", () => {
    assert.match(buildNewOrderText(apikeyOrder({ serverName: "Fast", lang: "en" })), /Server: <b>Fast<\/b>/);
    assert.match(buildNewOrderText(apikeyOrder({ serverName: "Fast", lang: "zh" })), /服务器: <b>Fast<\/b>/);
});

test("button injectable — dùng để test không cần menu-config", () => {
    const spy = [];
    const { reply_markup } = buildGiftRedeemMessage(
        { rewardType: "WALLET" },
        (action, label, target) => { spy.push(action); return { text: `X ${label}`, ...target }; },
    );
    assert.deepEqual(spy, ["REDEEM_GIFTCODE", "MUTE_NOTIFY"]);
    assert.match(reply_markup.inline_keyboard[0][0].text, /^X /);
});
