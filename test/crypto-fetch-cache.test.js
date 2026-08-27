import test from "node:test";
import assert from "node:assert/strict";

import { clearCryptoTransferCache, fetchCryptoTransfers } from "../src/payment/crypto.js";

// M2: mỗi lần khách bấm [Kiểm tra] là một lần gọi API nguồn. Bấm dày cộng với
// poller 15s là đủ để bị rate-limit, mà bị chặn thì poller cũng mù theo.
// Cache ngắn theo network phải: (1) gộp các lần gọi liền nhau, (2) không được trả
// thiếu transfer khi cửa sổ cần rộng hơn cửa sổ đã cache.
//
// Dùng TRC20/TronGrid làm ví dụ vì cache nằm ở tầng fetchCryptoTransfers, không
// phụ thuộc nguồn — BEP20 giờ chỉ xác nhận qua Binance (cần API key + chữ ký).
const ADDRESS = "TQ3XyZcacheTestAddress00000000000";
const HOUR = 60 * 60 * 1000;

function withEnv(env, fn) {
    const set = {
        TRC20_USDT_ADDRESS: ADDRESS,
        CRYPTO_PAY_ENABLED: "true",
        TRONGRID_LIMIT: "50",
        CRYPTO_FETCH_CACHE_MS: "10000",
        // Không để môi trường thật bật nhánh Binance trong test.
        BINANCE_API_KEY: "",
        BINANCE_API_SECRET: "",
        ...env,
    };
    const saved = {};
    for (const [key, value] of Object.entries(set)) {
        saved[key] = process.env[key];
        process.env[key] = value;
    }
    const realFetch = globalThis.fetch;
    clearCryptoTransferCache();
    return (async () => {
        try {
            return await fn();
        } finally {
            clearCryptoTransferCache();
            globalThis.fetch = realFetch;
            for (const [key, value] of Object.entries(saved)) {
                if (value === undefined) delete process.env[key];
                else process.env[key] = value;
            }
        }
    })();
}

function row(txid, ageHours) {
    return {
        transaction_id: txid,
        from: "TSenderAddress000000000000000000",
        to: ADDRESS,
        value: "1000000",
        token_info: { decimals: 6 },
        block_timestamp: Date.now() - ageHours * HOUR,
    };
}

// Trả cùng một tập row cho mọi request; đếm số lần thực sự gọi mạng.
function stubRows(rows) {
    const calls = { count: 0 };
    globalThis.fetch = async () => {
        calls.count += 1;
        return { ok: true, json: async () => ({ success: true, data: rows }) };
    };
    return calls;
}

test("repeated checks inside the window hit the network once", () => withEnv({}, async () => {
    const calls = stubRows([row("tx-a", 0.1)]);
    const sinceMs = Date.now() - HOUR;

    const first = await fetchCryptoTransfers("trc20", { sinceMs });
    const second = await fetchCryptoTransfers("trc20", { sinceMs });

    assert.equal(calls.count, 1, "lần bấm thứ hai phải dùng cache");
    assert.deepEqual(second, first, "cache phải trả đúng dữ liệu như lần đầu");
}));

test("concurrent checks share one in-flight request", () => withEnv({}, async () => {
    const calls = stubRows([row("tx-a", 0.1)]);
    const sinceMs = Date.now() - HOUR;

    const [a, b] = await Promise.all([
        fetchCryptoTransfers("trc20", { sinceMs }),
        fetchCryptoTransfers("trc20", { sinceMs }),
    ]);

    assert.equal(calls.count, 1);
    assert.equal(a.length, 1);
    assert.equal(b.length, 1);
}));

test("a wider window is refetched instead of served from a narrower cache", () => withEnv({}, async () => {
    const calls = stubRows([row("tx-new", 0.1), row("tx-old", 5)]);

    // Cache cửa sổ 1h trước, rồi hỏi cửa sổ 24h: dùng lại là mất tx-old.
    await fetchCryptoTransfers("trc20", { sinceMs: Date.now() - HOUR });
    const wide = await fetchCryptoTransfers("trc20", { sinceMs: Date.now() - 24 * HOUR });

    assert.equal(calls.count, 2, "cửa sổ rộng hơn phải gọi lại");
    assert.ok(wide.some((t) => t.txid === "tx-old"), "không được thiếu transfer cũ");
}));

test("a narrower window reuses the cache but still filters by sinceMs", () => withEnv({}, async () => {
    const calls = stubRows([row("tx-new", 0.1), row("tx-old", 5)]);

    await fetchCryptoTransfers("trc20", { sinceMs: Date.now() - 24 * HOUR });
    const narrow = await fetchCryptoTransfers("trc20", { sinceMs: Date.now() - HOUR });

    assert.equal(calls.count, 1, "cache đã phủ cửa sổ này");
    assert.deepEqual(narrow.map((t) => t.txid), ["tx-new"], "vẫn phải cắt theo sinceMs đang hỏi");
}));

test("a failed fetch is not cached", () => withEnv({}, async () => {
    let calls = 0;
    globalThis.fetch = async () => {
        calls += 1;
        if (calls === 1) throw new Error("rate limited");
        return { ok: true, json: async () => ({ success: true, data: [row("tx-a", 0.1)] }) };
    };
    const sinceMs = Date.now() - HOUR;

    await assert.rejects(() => fetchCryptoTransfers("trc20", { sinceMs }));
    const transfers = await fetchCryptoTransfers("trc20", { sinceMs });

    assert.equal(calls, 2, "lỗi không được cache — lần sau phải thử lại");
    assert.equal(transfers.length, 1);
}));

test("CRYPTO_FETCH_CACHE_MS=0 disables the cache", () => withEnv({ CRYPTO_FETCH_CACHE_MS: "0" }, async () => {
    const calls = stubRows([row("tx-a", 0.1)]);
    const sinceMs = Date.now() - HOUR;

    await fetchCryptoTransfers("trc20", { sinceMs });
    await fetchCryptoTransfers("trc20", { sinceMs });

    assert.equal(calls.count, 2);
}));
