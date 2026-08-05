import test from "node:test";
import assert from "node:assert/strict";

import { clearCryptoTransferCache, fetchCryptoTransfers } from "../src/payment/crypto.js";

const ADDRESS = "0x00000000000000000000000000000000deadbeef";
const HOUR = 60 * 60 * 1000;

// H1: BscScan tokentx không lọc theo thời gian. Trước khi sửa, hàm chỉ lấy trang
// đầu và bỏ im lặng sinceMs — ví bị spam token dust sẽ đẩy transfer của đơn
// PENDING ra khỏi cửa sổ đó và đơn không bao giờ khớp.
function withBep20(env, fn) {
    const set = {
        BEP20_USDT_ADDRESS: ADDRESS,
        CRYPTO_PAY_ENABLED: "true",
        BSCSCAN_LIMIT: "2",
        BSCSCAN_MAX_PAGES: "5",
        // Các test này đếm chính xác số trang đã gọi → tắt cache fetch (M2).
        CRYPTO_FETCH_CACHE_MS: "0",
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

// Mỗi trang là một mảng row thô kiểu BscScan; ghi lại số trang đã gọi.
function stubPages(pages) {
    const requested = [];
    globalThis.fetch = async (url) => {
        const page = Number(new URL(url).searchParams.get("page"));
        requested.push(page);
        return {
            ok: true,
            json: async () => ({ status: "1", result: pages[page - 1] || [] }),
        };
    };
    return requested;
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

test("keeps paging back until it passes sinceMs", () => withBep20({}, async () => {
    // Trang 1-2 là dust mới; transfer cần tìm nằm ở trang 3.
    const requested = stubPages([
        [row("0xdust1", 0.1), row("0xdust2", 0.2)],
        [row("0xdust3", 0.3), row("0xdust4", 0.4)],
        [row("0xwanted", 0.5), row("0xtooold", 48)],
    ]);

    const sinceMs = Date.now() - 1 * HOUR;
    const transfers = await fetchCryptoTransfers("bep20", { sinceMs });

    assert.deepEqual(requested, [1, 2, 3], "must page back, not stop at page 1");
    assert.ok(transfers.some((t) => t.txid === "0xwanted"), "the in-window transfer must be returned");
    assert.ok(!transfers.some((t) => t.txid === "0xtooold"), "transfers older than sinceMs are dropped");
}));

test("stops at the first page when no sinceMs is given", () => withBep20({}, async () => {
    const requested = stubPages([
        [row("0xa", 0.1), row("0xb", 0.2)],
        [row("0xc", 0.3), row("0xd", 0.4)],
    ]);

    const transfers = await fetchCryptoTransfers("bep20");

    assert.deepEqual(requested, [1], "no time filter → keep the old single-page behaviour");
    assert.equal(transfers.length, 2);
}));

test("stops early when a page comes back short", () => withBep20({}, async () => {
    const requested = stubPages([[row("0xa", 0.1)]]);

    const transfers = await fetchCryptoTransfers("bep20", { sinceMs: Date.now() - 24 * HOUR });

    assert.deepEqual(requested, [1], "a partial page means history is exhausted");
    assert.equal(transfers.length, 1);
}));

test("never reads more than BSCSCAN_MAX_PAGES", () => withBep20({ BSCSCAN_MAX_PAGES: "2" }, async () => {
    const requested = stubPages([
        [row("0xa", 0.1), row("0xb", 0.2)],
        [row("0xc", 0.3), row("0xd", 0.4)],
        [row("0xe", 0.5), row("0xf", 0.6)],
    ]);

    await fetchCryptoTransfers("bep20", { sinceMs: Date.now() - 24 * HOUR });

    assert.deepEqual(requested, [1, 2], "must respect the page cap instead of looping forever");
}));

test("ignores transfers addressed to another wallet", () => withBep20({}, async () => {
    stubPages([[{ ...row("0xother", 0.1), to: "0x9999999999999999999999999999999999999999" }]]);

    const transfers = await fetchCryptoTransfers("bep20", { sinceMs: Date.now() - HOUR });
    assert.equal(transfers.length, 0);
}));
