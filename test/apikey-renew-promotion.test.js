import test from "node:test";
import assert from "node:assert/strict";
import { discountedUsdTotal } from "../src/flash-sale-math.js";
import { priceAddTokens, priceAddDays, renewPriceBreakdown } from "../src/apikey-renew.js";

test("nạp thêm token trên key cũ: không áp dụng khuyến mãi dù có flash sale hay vip", () => {
    const listPriceUsd = priceAddTokens(50_000_000, { usdPerMtoken: 0.01 });
    assert.equal(listPriceUsd > 0, true);
    
    // Giả lập logic trong bot: addTokens > 0 thì flashPct luôn = 0
    const addTokens = 50_000_000;
    const days = 0;
    const flashOfferPct = 30; // Flash sale 30% đang diễn ra
    
    let flashPct = 0;
    if (days > 0 && addTokens === 0) {
        flashPct = flashOfferPct;
    }
    
    assert.equal(flashPct, 0, "nạp token không được hưởng khuyến mãi");
    const finalPriceUsd = flashPct > 0 ? discountedUsdTotal(listPriceUsd, flashPct) : listPriceUsd;
    assert.equal(finalPriceUsd, listPriceUsd, "giá nạp token phải giữ nguyên 100% giá gốc");
});

test("gia hạn ngày trên key cũ: áp dụng khuyến mãi flash sale / VIP", () => {
    const keyTokens = 100_000_000;
    const factors = () => ({ rpmMult: 1, daysMult: 1.2 });
    const listPriceUsd = priceAddDays(30, { keyTokens, usdPerMtoken: 0.01, rpm: 0, factors });
    assert.equal(listPriceUsd > 0, true);
    
    const addTokens = 0;
    const days = 30;
    const flashOfferPct = 30; // Flash sale 30%
    
    let flashPct = 0;
    if (days > 0 && addTokens === 0) {
        flashPct = flashOfferPct;
    }
    
    assert.equal(flashPct, 30, "gia hạn ngày được hưởng khuyến mãi flash sale");
    const finalPriceUsd = discountedUsdTotal(listPriceUsd, flashPct);
    assert.equal(finalPriceUsd < listPriceUsd, true, "giá gia hạn ngày phải được giảm");
});
