import test from "node:test";
import assert from "node:assert/strict";
import { buildGiftRedeemMessage, maskBuyerName } from "../src/broadcast.js";

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

test("button injectable — dùng để test không cần menu-config", () => {
    const spy = [];
    const { reply_markup } = buildGiftRedeemMessage(
        { rewardType: "WALLET" },
        (action, label, target) => { spy.push(action); return { text: `X ${label}`, ...target }; },
    );
    assert.deepEqual(spy, ["REDEEM_GIFTCODE", "MUTE_NOTIFY"]);
    assert.match(reply_markup.inline_keyboard[0][0].text, /^X /);
});
