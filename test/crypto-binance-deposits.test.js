import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import { fetchCryptoTransfers, clearCryptoTransferCache, getEnabledCryptoNetworks } from "../src/payment/crypto.js";
import { resetBinanceTimeOffset, binanceNetworkKey, isBinanceConfigured } from "../src/payment/binance.js";

// Nguồn xác nhận nạp USDT đã chuyển từ BscScan/TronGrid sang lịch sử nạp của
// tài khoản Binance: MỘT API cho mọi mạng, lọc được theo startTime.
const TRC20_ADDRESS = "TQ3XyZbinanceTestAddress000000000";
const BEP20_ADDRESS = "0x00000000000000000000000000000000deadbeef";
const SECRET = "test-secret";
const HOUR = 60 * 60 * 1000;

function withBinance(env, fn) {
    const set = {
        BINANCE_API_KEY: "test-key",
        BINANCE_API_SECRET: SECRET,
        BINANCE_API_BASE: "https://binance.test",
        TRC20_USDT_ADDRESS: TRC20_ADDRESS,
        BEP20_USDT_ADDRESS: BEP20_ADDRESS,
        CRYPTO_PAY_ENABLED: "true",
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
    resetBinanceTimeOffset();
    return (async () => {
        try {
            return await fn();
        } finally {
            clearCryptoTransferCache();
            resetBinanceTimeOffset();
            globalThis.fetch = realFetch;
            for (const [key, value] of Object.entries(saved)) {
                if (value === undefined) delete process.env[key];
                else process.env[key] = value;
            }
        }
    })();
}

function deposit(overrides = {}) {
    return {
        id: "dep-1",
        amount: "10.202181",
        coin: "USDT",
        network: "TRX",
        status: 1,
        address: TRC20_ADDRESS,
        txId: "0xabc",
        insertTime: Date.now() - 60_000,
        ...overrides,
    };
}

// Ghi lại mọi request để kiểm tra chữ ký / tham số; /api/v3/time trả giờ server.
function stubBinance(pages, { serverTimeOffsetMs = 0 } = {}) {
    const requests = [];
    globalThis.fetch = async (input, init) => {
        const url = new URL(String(input));
        if (url.pathname === "/api/v3/time") {
            return { ok: true, json: async () => ({ serverTime: Date.now() + serverTimeOffsetMs }) };
        }
        requests.push({ url, headers: init?.headers || {} });
        const offset = Number(url.searchParams.get("offset") || 0);
        const page = Math.floor(offset / Number(url.searchParams.get("limit") || 1000));
        const body = JSON.stringify(pages[page] || []);
        return { ok: true, status: 200, text: async () => body };
    };
    return requests;
}

test("maps Binance deposits into transfers for the requested network", () => withBinance({}, async () => {
    stubBinance([[
        deposit({ id: "d-trx", network: "TRX", txId: "0xtrx" }),
        deposit({ id: "d-bsc", network: "BSC", txId: "0xbsc", address: BEP20_ADDRESS }),
    ]]);

    const trc = await fetchCryptoTransfers("trc20", { sinceMs: Date.now() - HOUR });
    assert.deepEqual(trc.map((t) => t.txid), ["0xtrx"], "chỉ trả nạp của mạng đang hỏi");
    assert.equal(trc[0].network, "trc20");
    assert.equal(trc[0].amount, 10.202181);

    const bep = await fetchCryptoTransfers("bep20", { sinceMs: Date.now() - HOUR });
    assert.deepEqual(bep.map((t) => t.txid), ["0xbsc"], "cùng một API phục vụ được mạng khác");
}));

test("signs the request and sends the API key header", () => withBinance({}, async () => {
    const requests = stubBinance([[]]);

    await fetchCryptoTransfers("trc20", { sinceMs: Date.now() - HOUR });

    assert.equal(requests.length, 1);
    const { url, headers } = requests[0];
    assert.equal(url.pathname, "/sapi/v1/capital/deposit/hisrec");
    assert.equal(headers["X-MBX-APIKEY"], "test-key");
    assert.equal(url.searchParams.get("coin"), "USDT");
    assert.ok(url.searchParams.get("startTime"), "phải lọc theo startTime, không đọc hết 90 ngày");

    const signature = url.searchParams.get("signature");
    const params = new URLSearchParams(url.search);
    params.delete("signature");
    assert.equal(signature, createHmac("sha256", SECRET).update(params.toString()).digest("hex"));
}));

// Đây là điểm chết người: status 0 = pending (chưa đủ confirm), 7 = wrong deposit.
// Credit đơn theo các bản ghi đó là giao hàng khi tiền chưa thật sự vào.
test("only counts deposits Binance has actually credited", () => withBinance({}, async () => {
    stubBinance([[
        deposit({ id: "d-ok", txId: "0xok", status: 1 }),
        deposit({ id: "d-nowithdraw", txId: "0xnowithdraw", status: 6 }),
        deposit({ id: "d-pending", txId: "0xpending", status: 0 }),
        deposit({ id: "d-wrong", txId: "0xwrong", status: 7 }),
        deposit({ id: "d-confirm", txId: "0xconfirm", status: 8 }),
    ]]);

    const transfers = await fetchCryptoTransfers("trc20", { sinceMs: Date.now() - HOUR });
    assert.deepEqual(transfers.map((t) => t.txid).sort(), ["0xnowithdraw", "0xok"]);
}));

test("ignores other coins and unsupported networks", () => withBinance({}, async () => {
    stubBinance([[
        deposit({ id: "d-usdc", txId: "0xusdc", coin: "USDC" }),
        deposit({ id: "d-btc", txId: "0xbtc", network: "BTC" }),
        deposit({ id: "d-keep", txId: "0xkeep" }),
    ]]);

    const transfers = await fetchCryptoTransfers("trc20", { sinceMs: Date.now() - HOUR });
    assert.deepEqual(transfers.map((t) => t.txid), ["0xkeep"]);
}));

// Nạp nội bộ Binance (Pay / Binance ID) không có txId on-chain. Bỏ các bản ghi
// này là tiền khách đã vào mà đơn vẫn bị hủy sau khi hết hạn.
test("falls back to the record id when there is no on-chain txId", () => withBinance({}, async () => {
    stubBinance([[deposit({ id: 987654, txId: "" })]]);

    const transfers = await fetchCryptoTransfers("trc20", { sinceMs: Date.now() - HOUR });
    assert.deepEqual(transfers.map((t) => t.txid), ["binance-987654"]);
}));

test("pages until a short page comes back", () => withBinance({}, async () => {
    // limit là 1000 nên trang đủ-đầy khó dựng; kiểm tra bằng trang ngắn đầu tiên.
    const requests = stubBinance([[deposit({ id: "d-1", txId: "0x1" })], [deposit({ id: "d-2", txId: "0x2" })]]);

    const transfers = await fetchCryptoTransfers("trc20", { sinceMs: Date.now() - HOUR });
    assert.equal(requests.length, 1, "trang chưa đầy nghĩa là đã hết dữ liệu");
    assert.deepEqual(transfers.map((t) => t.txid), ["0x1"]);
}));

// -1021 = timestamp ngoài recvWindow. Giờ VPS trôi là mọi request đều fail, bot
// mù hoàn toàn — phải đồng bộ lại và thử lại, nhưng chỉ một lần.
test("re-syncs the clock once after a timestamp rejection", () => withBinance({}, async () => {
    let attempts = 0;
    let timeCalls = 0;
    globalThis.fetch = async (input) => {
        const url = new URL(String(input));
        if (url.pathname === "/api/v3/time") {
            timeCalls += 1;
            return { ok: true, json: async () => ({ serverTime: Date.now() + 30_000 }) };
        }
        attempts += 1;
        if (attempts === 1) {
            return { ok: false, status: 400, text: async () => JSON.stringify({ code: -1021, msg: "Timestamp for this request is outside of the recvWindow." }) };
        }
        return { ok: true, status: 200, text: async () => JSON.stringify([deposit({ txId: "0xafter-resync" })]) };
    };

    const transfers = await fetchCryptoTransfers("trc20", { sinceMs: Date.now() - HOUR });
    assert.equal(attempts, 2, "phải thử lại sau khi đồng bộ giờ");
    assert.ok(timeCalls >= 2, "phải gọi lại /api/v3/time để đo lại lệch giờ");
    assert.deepEqual(transfers.map((t) => t.txid), ["0xafter-resync"]);
}));

test("surfaces other Binance errors instead of silently returning nothing", () => withBinance({}, async () => {
    globalThis.fetch = async (input) => {
        const url = new URL(String(input));
        if (url.pathname === "/api/v3/time") {
            return { ok: true, json: async () => ({ serverTime: Date.now() }) };
        }
        return { ok: false, status: 401, text: async () => JSON.stringify({ code: -2015, msg: "Invalid API-key." }) };
    };

    await assert.rejects(
        () => fetchCryptoTransfers("trc20", { sinceMs: Date.now() - HOUR }),
        /Invalid API-key/,
    );
}));

// Không có nguồn xác nhận nào cho BEP20 ngoài Binance. Hiện nút cho khách chuyển
// tiền vào ví không ai đối soát được là mất tiền khách.
test("BEP20 is hidden while Binance is not configured, TRC20 still works", () => withBinance(
    { BINANCE_API_KEY: "", BINANCE_API_SECRET: "" },
    async () => {
        assert.equal(isBinanceConfigured(), false);
        const networks = getEnabledCryptoNetworks();
        assert.ok(networks.includes("trc20"), "TRC20 vẫn đọc chain qua TronGrid");
        assert.ok(!networks.includes("bep20"), "BEP20 phải bị ẩn khi thiếu key Binance");
    },
));

test("both networks are available once Binance is configured", () => withBinance({}, async () => {
    assert.equal(isBinanceConfigured(), true);
    const networks = getEnabledCryptoNetworks();
    assert.ok(networks.includes("trc20"));
    assert.ok(networks.includes("bep20"));
}));

test("maps Binance network codes to internal keys", () => {
    assert.equal(binanceNetworkKey("TRX"), "trc20");
    assert.equal(binanceNetworkKey("BSC"), "bep20");
    assert.equal(binanceNetworkKey("bsc"), "bep20");
    assert.equal(binanceNetworkKey("ETH"), null);
    assert.equal(binanceNetworkKey(""), null);
});
