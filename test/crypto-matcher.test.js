import test from "node:test";
import assert from "node:assert/strict";

import {
    cryptoTransferMatchesOrder,
    cryptoTransferMatchesWalletTransaction,
    getOrderExpectedCrypto,
    getWalletTransactionExpectedCrypto,
    buildCryptoPaymentRef,
} from "../src/payment/crypto.js";
import { getCryptoAmountTolerance } from "../src/payment/amounts.js";

const TRC20_ADDRESS = "TQ3XyZmatcherTestAddress000000000";
const BEP20_ADDRESS = "0xAbCdEf0000000000000000000000000000000001";
const CREATED_AT = new Date("2026-01-01T00:00:00.000Z");
const AMOUNT = 10.202181;

function withAddresses(fn) {
    const saved = {
        trc: process.env.TRC20_USDT_ADDRESS,
        bep: process.env.BEP20_USDT_ADDRESS,
        enabled: process.env.CRYPTO_PAY_ENABLED,
    };
    process.env.TRC20_USDT_ADDRESS = TRC20_ADDRESS;
    process.env.BEP20_USDT_ADDRESS = BEP20_ADDRESS;
    process.env.CRYPTO_PAY_ENABLED = "true";
    try {
        return fn();
    } finally {
        for (const [key, value] of [
            ["TRC20_USDT_ADDRESS", saved.trc],
            ["BEP20_USDT_ADDRESS", saved.bep],
            ["CRYPTO_PAY_ENABLED", saved.enabled],
        ]) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    }
}

function order(overrides = {}) {
    return {
        id: "order-abc12345",
        status: "PENDING",
        paymentMethod: "crypto_trc20",
        cryptoNetwork: "trc20",
        cryptoAmount: AMOUNT,
        cryptoAddress: TRC20_ADDRESS,
        createdAt: CREATED_AT,
        ...overrides,
    };
}

function transfer(overrides = {}) {
    return {
        network: "trc20",
        txid: "tx-1",
        to: TRC20_ADDRESS,
        amount: AMOUNT,
        timestamp: CREATED_AT.getTime() + 60_000,
        ...overrides,
    };
}

test("matches an exact transfer on the expected network and address", () => {
    withAddresses(() => {
        assert.equal(cryptoTransferMatchesOrder(transfer(), order()), true);
    });
});

test("rejects a transfer from a different network", () => {
    withAddresses(() => {
        assert.equal(cryptoTransferMatchesOrder(transfer({ network: "bep20" }), order()), false);
    });
});

test("rejects a transfer sent to a different receiving address", () => {
    withAddresses(() => {
        const wrong = transfer({ to: "TWrongAddress0000000000000000000" });
        assert.equal(cryptoTransferMatchesOrder(wrong, order()), false);
    });
});

test("address comparison is case-insensitive (EVM checksum casing)", () => {
    withAddresses(() => {
        const bepOrder = order({
            paymentMethod: "crypto_bep20",
            cryptoNetwork: "bep20",
            cryptoAddress: BEP20_ADDRESS,
        });
        const bepTransfer = transfer({ network: "bep20", to: BEP20_ADDRESS.toLowerCase() });
        assert.equal(cryptoTransferMatchesOrder(bepTransfer, bepOrder), true);
    });
});

test("accepts a transfer inside the tolerance window and rejects one outside it", () => {
    withAddresses(() => {
        const tolerance = getCryptoAmountTolerance();
        assert.equal(cryptoTransferMatchesOrder(transfer({ amount: AMOUNT + tolerance }), order()), true);
        assert.equal(cryptoTransferMatchesOrder(transfer({ amount: AMOUNT + 0.000001 }), order()), false);
        assert.equal(cryptoTransferMatchesOrder(transfer({ amount: AMOUNT - 0.000001 }), order()), false);
    });
});

test("rejects a transfer that predates the order by more than the 60s grace window", () => {
    withAddresses(() => {
        const grace = transfer({ timestamp: CREATED_AT.getTime() - 30_000 });
        assert.equal(cryptoTransferMatchesOrder(grace, order()), true);
        const tooOld = transfer({ timestamp: CREATED_AT.getTime() - 120_000 });
        assert.equal(cryptoTransferMatchesOrder(tooOld, order()), false);
    });
});

test("rejects an order with no expected amount", () => {
    withAddresses(() => {
        assert.equal(cryptoTransferMatchesOrder(transfer(), order({ cryptoAmount: 0, paymentRef: null })), false);
    });
});

test("falls back to paymentRef when the crypto columns are empty", () => {
    withAddresses(() => {
        const ref = buildCryptoPaymentRef({
            network: "trc20",
            amountToken: AMOUNT,
            amountUsd: AMOUNT,
            address: TRC20_ADDRESS,
            token: "USDT",
            usdVndRate: 26000,
        });
        const legacy = order({
            cryptoNetwork: null,
            cryptoAmount: null,
            cryptoAddress: null,
            paymentRef: ref,
        });

        const expected = getOrderExpectedCrypto(legacy);
        assert.equal(expected.network, "trc20");
        assert.equal(expected.amountToken, AMOUNT);
        assert.equal(expected.address, TRC20_ADDRESS);
        assert.equal(cryptoTransferMatchesOrder(transfer(), legacy), true);
    });
});

test("wallet deposit matching follows the same rules as order matching", () => {
    withAddresses(() => {
        const tx = {
            id: "tx-deposit-1",
            type: "DEPOSIT",
            status: "PENDING",
            cryptoNetwork: "trc20",
            cryptoAmount: AMOUNT,
            cryptoAddress: TRC20_ADDRESS,
            createdAt: CREATED_AT,
        };

        assert.equal(getWalletTransactionExpectedCrypto(tx).network, "trc20");
        assert.equal(cryptoTransferMatchesWalletTransaction(transfer(), tx), true);
        assert.equal(cryptoTransferMatchesWalletTransaction(transfer({ network: "bep20" }), tx), false);
        assert.equal(cryptoTransferMatchesWalletTransaction(transfer({ amount: AMOUNT + 0.000001 }), tx), false);
        assert.equal(
            cryptoTransferMatchesWalletTransaction(transfer({ timestamp: CREATED_AT.getTime() - 120_000 }), tx),
            false,
        );
    });
});

// Tolerance không bao giờ được rộng bằng khoảng cách giữa hai offset liền kề
// (0.000001 USDT), nếu không một transfer sẽ match hai checkout khác nhau.
test("tolerance can never span two adjacent unique amounts", () => {
    withAddresses(() => {
        const saved = process.env.CRYPTO_AMOUNT_TOLERANCE;
        process.env.CRYPTO_AMOUNT_TOLERANCE = "1";
        try {
            assert.ok(getCryptoAmountTolerance() < 0.000001 / 2);
            const neighbour = order({ id: "order-neighbour", cryptoAmount: AMOUNT + 0.000001 });
            assert.equal(cryptoTransferMatchesOrder(transfer(), neighbour), false);
        } finally {
            if (saved === undefined) delete process.env.CRYPTO_AMOUNT_TOLERANCE;
            else process.env.CRYPTO_AMOUNT_TOLERANCE = saved;
        }
    });
});
