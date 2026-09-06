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

// === Tin "VỪA GIA HẠN KEY" =================================================
// Khách CŨ quay lại nạp thêm là bằng chứng xã hội mạnh hơn một đơn mua mới:
// hàng thì ai cũng mua được, còn quay lại thì phải đáng tiền.
const renewOrder = (extra = {}) => ({
    masked: "hot***", safeName: "API Key", price: 0.55, currency: "USD",
    renew: { addTokens: 50_000_000, addDays: 30, newTokens: 150_000_000 },
    ...extra,
});

test("đơn gia hạn có tiêu đề RIÊNG, không đọc thành 'vừa mua đơn API Key'", () => {
    const text = buildNewOrderText(renewOrder());
    assert.match(text, /VỪA GIA HẠN KEY/);
    assert.doesNotMatch(text, /vừa mua đơn/, "gia hạn không phải mua sản phẩm mới");
    assert.doesNotMatch(text, /“<b>API Key<\/b>”/, "không được khoe tên sản phẩm ẩn");
});

test("tin gia hạn nói rõ cộng thêm bao nhiêu và còn lại bao nhiêu", () => {
    const text = buildNewOrderText(renewOrder());
    assert.match(text, /\+50M token · \+30 ngày/);
    assert.match(text, /Còn lại: 150M token/);
    assert.match(text, /\$0\.55/, "vẫn phải có giá — đây là tin bán hàng");
});

test("chỉ nạp token (không thêm ngày) thì không hiện '+0 ngày'", () => {
    const text = buildNewOrderText(renewOrder({ renew: { addTokens: 50_000_000, addDays: 0, newTokens: 150_000_000 } }));
    assert.match(text, /\+50M token/);
    assert.doesNotMatch(text, /ngày/);
});

test("chỉ gia hạn ngày (không nạp token) thì không hiện '+0 token'", () => {
    const text = buildNewOrderText(renewOrder({ renew: { addTokens: 0, addDays: 30, newTokens: 150_000_000 } }));
    assert.match(text, /\+30 ngày/);
    assert.doesNotMatch(text, /\+0/);
});

test("renew rỗng / không có gì cộng thêm → về lại tin đơn hàng thường", () => {
    assert.match(buildNewOrderText(renewOrder({ renew: null })), /ĐƠN HÀNG MỚI/);
    assert.match(buildNewOrderText(renewOrder({ renew: { addTokens: 0, addDays: 0 } })), /ĐƠN HÀNG MỚI/);
});

test("tin gia hạn hiện server, và escape tên server", () => {
    assert.match(buildNewOrderText(renewOrder({ serverName: "Server 2" })), /Server: <b>Server 2<\/b>/);
    assert.match(buildNewOrderText(renewOrder({ serverName: "<b>x</b>" })), /&lt;b&gt;x&lt;\/b&gt;/);
});

test("tin gia hạn có bản dịch en / zh", () => {
    assert.match(buildNewOrderText(renewOrder({ lang: "en" })), /RENEWED/);
    assert.match(buildNewOrderText(renewOrder({ lang: "zh" })), /续期/);
    assert.match(buildNewOrderText(renewOrder({ lang: "xx" })), /GIA HẠN/);
});
