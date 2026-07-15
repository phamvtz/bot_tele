import test from "node:test";
import assert from "node:assert/strict";
import {
    bankAmountsMatch,
    convertToUsd,
    convertToVnd,
    getCryptoAmountTolerance,
} from "../src/payment/amounts.js";

test("converts USD products to integer VND with a locked rate", () => {
    assert.equal(convertToVnd(10, "USD", 26_500), 265_000);
    assert.equal(convertToVnd(10_000, "VND", 26_500), 10_000);
    assert.equal(convertToUsd(265_000, "VND", 26_500), 10);
});

test("bank matching is exact by default", () => {
    const previous = process.env.BANK_AMOUNT_TOLERANCE_VND;
    delete process.env.BANK_AMOUNT_TOLERANCE_VND;
    assert.equal(bankAmountsMatch(10_000, 10_000), true);
    assert.equal(bankAmountsMatch(9_999, 10_000), false);
    if (previous === undefined) delete process.env.BANK_AMOUNT_TOLERANCE_VND;
    else process.env.BANK_AMOUNT_TOLERANCE_VND = previous;
});

test("crypto tolerance cannot overlap adjacent unique amounts", () => {
    const previous = process.env.CRYPTO_AMOUNT_TOLERANCE;
    process.env.CRYPTO_AMOUNT_TOLERANCE = "0.00001";
    assert.equal(getCryptoAmountTolerance(), 0.00000049);
    if (previous === undefined) delete process.env.CRYPTO_AMOUNT_TOLERANCE;
    else process.env.CRYPTO_AMOUNT_TOLERANCE = previous;
});
