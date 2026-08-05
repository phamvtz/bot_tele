import test from "node:test";
import assert from "node:assert/strict";

import { clearCryptoTransferCache, fetchCryptoTransfers } from "../src/payment/crypto.js";

// M2: mỗi lần khách bấm [Kiểm tra] là một lần gọi TronGrid/BscScan. Bấm dày cộng
// với poller 15s là đủ để bị rate-limit, mà bị chặn thì poller cũng mù theo.
// Cache ngắn theo network phải: (1) gộp các lần gọi liền nhau, (2) không được trả
// thiếu transfer khi cửa sổ cần rộng hơn cửa sổ đã cache.
const ADDRESS = "0x00000000000000000000000000000000deadbeef";
const HOUR = 60 * 60 * 1000;

function withEnv(env, fn) {
    const set = {
        BEP20_USDT_ADDRESS: ADDRESS,
        CRYPTO_PAY_ENABLED: "true",
        BSCSCAN_LIMIT: "50",
        CRYPTO_FETCH_CACHE_MS: "10000",
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

function row(hash, ageHours) {
    return {
        hash,
        from: "0x1111111111111111111111111111111111111111",
        to: ADDRESS,
        value: "1000000000000000000",
        tokenDecimal: "18",
        timeStamp: String(Math.floor((Date.now() - ageHours * HOUR) / 1000)),
    };
}

// Trả cùng một tập row cho mọi request; đếm số lần thực sự gọi mạng.
function stubRows(rows) {
    const calls = { count: 0 };
    globalThis.fetch = async () => {
        calls.count += 1;
        return { ok: true, json: async () => ({ status: "1", result: rows }) };
    };
    return calls;
}

test("repeated checks inside the window hit the network once", () => withEnv({}, async () => {
    const calls = stubRows([row("0xa", 0.1)]);
    const sinceMs = Date.now() - HOUR;

    const first = await fetchCryptoTransfers("bep20", { sinceMs });
    const second = await fetchCryptoTransfers("bep20", { sinceMs });

    assert.equal(calls.count, 1, "lần bấm thứ hai phải dùng cache");
    assert.deepEqual(second, first, "cache phải trả đúng dữ liệu như lần đầu");
}));

test("concurrent checks share one in-flight request", () => withEnv({}, async () => {
    const calls = stubRows([row("0xa", 0.1)]);
    const sinceMs = Date.now() - HOUR;

    const [a, b] = await Promise.all([
        fetchCryptoTransfers("bep20", { sinceMs }),
        fetchCryptoTransfers("bep20", { sinceMs }),
    ]);

    assert.equal(calls.count, 1);
    assert.equal(a.length, 1);
    assert.equal(b.length, 1);
}));

test("a wider window is refetched instead of served from a narrower cache", () => withEnv({}, async () => {
    const calls = stubRows([row("0xnew", 0.1), row("0xold", 5)]);

    // Cache cửa sổ 1h trước, rồi hỏi cửa sổ 24h: dùng lại là mất 0xold.
    await fetchCryptoTransfers("bep20", { sinceMs: Date.now() - HOUR });
    const wide = await fetchCryptoTransfers("bep20", { sinceMs: Date.now() - 24 * HOUR });

    assert.equal(calls.count, 2, "cửa sổ rộng hơn phải gọi lại");
    assert.ok(wide.some((t) => t.txid === "0xold"), "không được thiếu transfer cũ");
}));

test("a narrower window reuses the cache but still filters by sinceMs", () => withEnv({}, async () => {
    const calls = stubRows([row("0xnew", 0.1), row("0xold", 5)]);

    await fetchCryptoTransfers("bep20", { sinceMs: Date.now() - 24 * HOUR });
    const narrow = await fetchCryptoTransfers("bep20", { sinceMs: Date.now() - HOUR });

    assert.equal(calls.count, 1, "cache đã phủ cửa sổ này");
    assert.deepEqual(narrow.map((t) => t.txid), ["0xnew"], "vẫn phải cắt theo sinceMs đang hỏi");
}));

test("a failed fetch is not cached", () => withEnv({}, async () => {
    let calls = 0;
    globalThis.fetch = async () => {
        calls += 1;
        if (calls === 1) throw new Error("rate limited");
        return { ok: true, json: async () => ({ status: "1", result: [row("0xa", 0.1)] }) };
    };
    const sinceMs = Date.now() - HOUR;

    await assert.rejects(() => fetchCryptoTransfers("bep20", { sinceMs }));
    const transfers = await fetchCryptoTransfers("bep20", { sinceMs });

    assert.equal(calls, 2, "lỗi không được cache — lần sau phải thử lại");
    assert.equal(transfers.length, 1);
}));

test("CRYPTO_FETCH_CACHE_MS=0 disables the cache", () => withEnv({ CRYPTO_FETCH_CACHE_MS: "0" }, async () => {
    const calls = stubRows([row("0xa", 0.1)]);
    const sinceMs = Date.now() - HOUR;

    await fetchCryptoTransfers("bep20", { sinceMs });
    await fetchCryptoTransfers("bep20", { sinceMs });

    assert.equal(calls.count, 2);
}));
