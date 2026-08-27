import test from "node:test";
import assert from "node:assert/strict";

import {
    fetchCryptoTransfers,
    clearCryptoTransferCache,
    getEnabledCryptoNetworks,
    getCryptoNetworkConfig,
    cryptoNetworkSupportsQr,
    cryptoNetworkLabel,
    networkFromPaymentMethod,
    createCryptoCheckout,
    formatCryptoPaymentMessage,
    cryptoTransferMatchesOrder,
} from "../src/payment/crypto.js";
import {
    parseBinanceV2Date,
    mapBinanceV1Rows,
    mapBinanceV2Rows,
    buildBinanceHistoryUrl,
    fetchBinancePayTransfers,
    BINANCE_PAY_NETWORK,
} from "../src/payment/binance-pay.js";

// Binance Pay la luong tien RIENG: khach chuyen noi bo toi Pay ID, khong on-chain,
// khong dia chi vi, khong explorer. Nguon doi soat la thueapibank.vn.
const PAY_ID = "0336636315";
const TOKEN = "test-token";

function withPay(env, fn) {
    const set = {
        BINANCE_PAY_ID: PAY_ID,
        BINANCE_PAY_TOKEN: TOKEN,
        CRYPTO_PAY_ENABLED: "true",
        CRYPTO_FETCH_CACHE_MS: "0",
        ...env,
    };
    const saved = {};
    for (const [key, value] of Object.entries(set)) {
        saved[key] = process.env[key];
        if (value === null) delete process.env[key];
        else process.env[key] = value;
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

// Dong V1 that, rut gon tu phan hoi live cua thueapibank.
function v1Row(overrides = {}) {
    return {
        uid: 370234688,
        orderId: "437040678600220672",
        note: "",
        orderType: "C2C",
        transactionId: "P_A22FU8RA92D7111D",
        transactionTime: 1781349725442,
        amount: "13",
        currency: "USDT",
        payerInfo: { name: "Najmul hasan prince", binanceId: 1153370073 },
        timestamp: 1781349725442,
        type: "BINANCE_PAY",
        ...overrides,
    };
}

test("chi lay tien VAO: bo qua amount am va type khac BINANCE_PAY", () => {
    const rows = [
        v1Row(),
        // Tien gui RA: amount am. Khop dong nay la bot tu cong tien cua chinh shop.
        v1Row({ transactionId: "P_OUT", amount: "-15" }),
        // Chuyen noi bo giua cac vi Binance cua chinh shop.
        { timestamp: 1772890971000, asset: "USDT", amount: "25.9", type: "FUNDING_MAIN", status: "CONFIRMED", tranId: 354682962883 },
        { timestamp: 1770653798000, asset: "USDT", amount: "1091.99", type: "MAIN_FUNDING", status: "CONFIRMED", tranId: 349385484082 },
    ];

    const mapped = mapBinanceV1Rows(rows, { payId: PAY_ID });
    assert.equal(mapped.length, 1);
    assert.equal(mapped[0].txid, "P_A22FU8RA92D7111D");
    assert.equal(mapped[0].amount, 13);
    assert.equal(mapped[0].network, BINANCE_PAY_NETWORK);
    assert.equal(mapped[0].to, PAY_ID);
});

test("V2 quy doi gio VN (UTC+7) ve epoch ms dung nhu V1", () => {
    // Doi chieu voi transactionTime that cua cung giao dich P_A22FU8RA92D7111D.
    assert.equal(parseBinanceV2Date("13/06/2026 18:22:05"), 1781349725000);
    // Lech mui gio la rui ro that: sai 1 gio la giao dich bi coi nhu xay ra TRUOC
    // khi tao don va bi loai oan.
    assert.equal(parseBinanceV2Date("13/06/2026 18:22:05", 8), 1781346125000);
    // Khong parse duoc thi tra 0 — tang khop don coi la "khong ro thoi diem".
    assert.equal(parseBinanceV2Date("2026-06-13 18:22:05"), 0);
    assert.equal(parseBinanceV2Date(""), 0);
});

test("V2 chi lay type IN va giu duoc description lam memo", () => {
    const mapped = mapBinanceV2Rows([
        { transactionID: "P_IN", amount: 13, description: "nap1683", transactionDate: "13/06/2026 18:22:05", type: "IN" },
        { transactionID: "P_OUT", amount: 15, description: "Laa Laa", transactionDate: "19/08/2026 12:13:31", type: "OUT" },
    ], { payId: PAY_ID });

    assert.equal(mapped.length, 1);
    assert.equal(mapped[0].txid, "P_IN");
    assert.equal(mapped[0].memo, "nap1683");
    assert.equal(mapped[0].timestamp, 1781349725000);
});

test("ghep token vao URL, khong nhan doi neu base da co san token", () => {
    assert.equal(buildBinanceHistoryUrl("https://x.vn/api", "abc"), "https://x.vn/api/abc");
    assert.equal(buildBinanceHistoryUrl("https://x.vn/api/", "abc"), "https://x.vn/api/abc");
    assert.equal(buildBinanceHistoryUrl("https://x.vn/api/abc", "abc"), "https://x.vn/api/abc");
    assert.equal(buildBinanceHistoryUrl("https://x.vn/{token}/history", "abc"), "https://x.vn/abc/history");
});

test("V1 loi thi rot sang V2 du phong, khong nem loi ra ngoai", async () => {
    const calls = [];
    const transfers = await fetchBinancePayTransfers(
        { apiKey: TOKEN, address: PAY_ID },
        0,
        {
            fetchJson: async (url) => {
                calls.push(url);
                if (url.includes("historyapibinancev2")) {
                    return { transactions: [{ transactionID: "P_IN", amount: 7, description: "", transactionDate: "13/06/2026 18:22:05", type: "IN" }] };
                }
                throw new Error("V1 down");
            },
        },
    );

    assert.equal(calls.length, 2, "phai thu V1 truoc roi moi den V2");
    assert.match(calls[0], /historyapibinance\//);
    assert.equal(transfers.length, 1);
    assert.equal(transfers[0].source, "v2");
});

test("V1 tra rong KHONG phai loi: khong goi V2", async () => {
    const calls = [];
    const transfers = await fetchBinancePayTransfers(
        { apiKey: TOKEN, address: PAY_ID },
        0,
        { fetchJson: async (url) => { calls.push(url); return { rows: [] }; } },
    );

    assert.equal(calls.length, 1);
    assert.deepEqual(transfers, []);
});

test("ca hai endpoint loi thi nem loi cua V1 (nguon chinh)", async () => {
    await assert.rejects(
        fetchBinancePayTransfers(
            { apiKey: TOKEN, address: PAY_ID },
            0,
            { fetchJson: async () => { throw new Error("V1 that bai"); } },
        ),
        /V1 that bai/,
    );
});

test("thieu token thi tra rong, khong goi mang", async () => {
    let called = false;
    const transfers = await fetchBinancePayTransfers(
        { apiKey: "", address: PAY_ID },
        0,
        { fetchJson: async () => { called = true; return { rows: [] }; } },
    );
    assert.equal(called, false);
    assert.deepEqual(transfers, []);
});

test("thieu Pay ID hoac token thi mang bi an khoi bot", async () => {
    await withPay({}, async () => {
        assert.ok(getEnabledCryptoNetworks().includes(BINANCE_PAY_NETWORK));
    });
    // Thieu token: khong doc duoc lich su -> khong co cach doi soat. Hien nut la
    // moi khach chuyen tien vao cho khong ai kiem tra.
    await withPay({ BINANCE_PAY_TOKEN: null }, async () => {
        assert.ok(!getEnabledCryptoNetworks().includes(BINANCE_PAY_NETWORK));
    });
    await withPay({ BINANCE_PAY_ID: null }, async () => {
        assert.ok(!getEnabledCryptoNetworks().includes(BINANCE_PAY_NETWORK));
    });
});

test("Pay ID khong quet QR duoc, va nhan hien thi khong phai key thô", async () => {
    await withPay({}, async () => {
        assert.equal(cryptoNetworkSupportsQr(BINANCE_PAY_NETWORK), false);
        assert.equal(cryptoNetworkSupportsQr("trc20"), true);
        // Khong duoc hien "BINANCE_PAY" trong tin nhan khach doc.
        assert.equal(cryptoNetworkLabel(BINANCE_PAY_NETWORK), "Binance Pay");
        assert.equal(networkFromPaymentMethod("crypto_binance_pay"), BINANCE_PAY_NETWORK);
        // Pay ID la "dia chi", khong co contract de doi chieu.
        const config = getCryptoNetworkConfig(BINANCE_PAY_NETWORK);
        assert.equal(config.address, PAY_ID);
        assert.equal(config.contract, "");
        assert.equal(config.explorerTx, "");
    });
});

test("fetchCryptoTransfers dinh tuyen Binance Pay sang nguon rieng, khong qua deposit/hisrec", async () => {
    // Co ca BINANCE_API_KEY/SECRET: neu dinh tuyen sai thi se goi API on-chain,
    // ma Binance Pay KHONG xuat hien o /sapi/v1/capital/deposit/hisrec.
    await withPay({ BINANCE_API_KEY: "k", BINANCE_API_SECRET: "s" }, async () => {
        const urls = [];
        globalThis.fetch = async (url) => {
            urls.push(String(url));
            return new Response(JSON.stringify({ rows: [v1Row()] }), { status: 200, headers: { "content-type": "application/json" } });
        };

        const transfers = await fetchCryptoTransfers(BINANCE_PAY_NETWORK, { sinceMs: 0 });
        assert.equal(urls.length, 1);
        assert.match(urls[0], /thueapibank\.vn\/historyapibinance\//);
        assert.ok(!urls[0].includes("capital/deposit/hisrec"));
        assert.equal(transfers.length, 1);
        assert.equal(transfers[0].network, BINANCE_PAY_NETWORK);
    });
});

test("loc sinceMs phia client, nhung giu transfer khong ro thoi diem", async () => {
    await withPay({}, async () => {
        globalThis.fetch = async () => new Response(JSON.stringify({
            rows: [
                v1Row({ transactionId: "P_CU", transactionTime: 1000, timestamp: 1000 }),
                v1Row({ transactionId: "P_MOI", transactionTime: 9000, timestamp: 9000 }),
                // Khong co timestamp: giu lai, bo di la mat tien khach.
                v1Row({ transactionId: "P_KHONG_GIO", transactionTime: 0, timestamp: 0 }),
            ],
        }), { status: 200, headers: { "content-type": "application/json" } });

        const transfers = await fetchCryptoTransfers(BINANCE_PAY_NETWORK, { sinceMs: 5000 });
        const ids = transfers.map((t) => t.txid).sort();
        assert.deepEqual(ids, ["P_KHONG_GIO", "P_MOI"]);
    });
});

test("khop don dua HOAN TOAN vao so USDT le vi Binance Pay khong mang noi dung CK", async () => {
    await withPay({}, async () => {
        const order = { id: "order-abc-12345678", finalAmount: 260000, createdAt: new Date(1781349000000) };
        const checkout = createCryptoCheckout({
            orderId: order.id,
            amount: order.finalAmount,
            productName: "Goi test",
            quantity: 1,
            network: BINANCE_PAY_NETWORK,
        });
        Object.assign(order, {
            paymentMethod: checkout.paymentMethod,
            cryptoNetwork: checkout.network,
            cryptoAmount: checkout.amountToken,
            cryptoAddress: checkout.address,
        });

        assert.equal(checkout.paymentMethod, "crypto_binance_pay");
        assert.equal(checkout.address, PAY_ID);

        // note RONG (dung nhu moi giao dich Pay that) van khop duoc.
        const exact = { network: BINANCE_PAY_NETWORK, txid: "P_1", to: PAY_ID, amount: checkout.amountToken, memo: "", timestamp: 1781349725442 };
        assert.equal(cryptoTransferMatchesOrder(exact, order), true);

        // Lam tron mat so le -> khong khop. Day la ly do phai canh bao khach.
        const rounded = { ...exact, txid: "P_2", amount: Math.round(checkout.amountToken) };
        assert.equal(cryptoTransferMatchesOrder(rounded, order), false);

        // Slot ke tiep (lech 0.000001) khong duoc khop lan sang don khac.
        const neighbour = { ...exact, txid: "P_3", amount: Number((checkout.amountToken + 0.000001).toFixed(6)) };
        assert.equal(cryptoTransferMatchesOrder(neighbour, order), false);

        // Giao dich xay ra TRUOC khi tao don thi khong phai cua don nay.
        const tooOld = { ...exact, txid: "P_4", timestamp: new Date(order.createdAt).getTime() - 120_000 };
        assert.equal(cryptoTransferMatchesOrder(tooOld, order), false);
    });
});

test("man thanh toan Binance Pay khong noi 'quet QR' va goi Pay ID dung ten", async () => {
    await withPay({}, async () => {
        const checkout = createCryptoCheckout({
            orderId: "order-xyz-87654321",
            amount: 260000,
            productName: "Goi test",
            quantity: 1,
            network: BINANCE_PAY_NETWORK,
        });
        const text = formatCryptoPaymentMessage(checkout, { lang: "vi" });

        assert.match(text, /Binance Pay ID/);
        assert.match(text, /Pay → Chuyển tiền/);
        // Huong dan chung se bao khach di tim vi/mang khong ton tai.
        assert.ok(!text.includes("Quét QR bên dưới"));
        assert.ok(!text.includes("chọn đúng mạng hiển thị"));
        assert.match(text, /số lẻ chính là mã nhận diện đơn/);

        // Mang on-chain van giu huong dan cu.
        const onchain = formatCryptoPaymentMessage({ ...checkout, network: "trc20" }, { lang: "vi" });
        assert.match(onchain, /Quét QR bên dưới/);
    });
});

test("nut USDT dung theo mang DANG BAT, khong hardcode", async () => {
    const { buildWalletKeyboard, buildCheckoutKeyboard } = await import("../src/bot-ui/keyboards.js");

    // Chi Binance Pay duoc cau hinh -> khong duoc hien nut TRC20/BEP20.
    await withPay({ TRC20_USDT_ADDRESS: null, BEP20_USDT_ADDRESS: null, BINANCE_API_KEY: null, BINANCE_API_SECRET: null }, async () => {
        const data = (kb) => kb.reply_markup.inline_keyboard.flat().map((b) => b.callback_data);

        const wallet = data(buildWalletKeyboard(null, { lang: "vi" }));
        assert.ok(wallet.includes("DEPOSIT_CRYPTO:binance_pay"));
        assert.ok(!wallet.includes("DEPOSIT_CRYPTO:trc20"));
        assert.ok(!wallet.includes("DEPOSIT_CRYPTO:bep20"));

        const checkout = data(buildCheckoutKeyboard({ lang: "vi" }));
        assert.ok(checkout.includes("PAY_CRYPTO:binance_pay"));
        assert.ok(!checkout.includes("PAY_CRYPTO:bep20"));
    });

    // Khong mang nao cau hinh -> khong con nut USDT nao.
    await withPay({ BINANCE_PAY_ID: null, BINANCE_PAY_TOKEN: null, TRC20_USDT_ADDRESS: null, BEP20_USDT_ADDRESS: null, BINANCE_API_KEY: null, BINANCE_API_SECRET: null }, async () => {
        const wallet = buildWalletKeyboard(null, { lang: "vi" }).reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
        assert.ok(!wallet.some((d) => String(d).startsWith("DEPOSIT_CRYPTO:")));
        // Nap ngan hang va lich su phai con.
        assert.ok(wallet.includes("DEPOSIT_BANK"));
        assert.ok(wallet.includes("TX_HISTORY"));
    });
});

test("transfer khong ro thoi diem KHONG bi loai, nhung transfer cu that thi bi loai", async () => {
    await withPay({}, async () => {
        const order = { id: "ord-time-check-0001", finalAmount: 260000, createdAt: new Date(1781349000000) };
        const checkout = createCryptoCheckout({
            orderId: order.id, amount: order.finalAmount, productName: "T", quantity: 1, network: BINANCE_PAY_NETWORK,
        });
        Object.assign(order, {
            paymentMethod: checkout.paymentMethod,
            cryptoNetwork: checkout.network,
            cryptoAmount: checkout.amountToken,
            cryptoAddress: checkout.address,
        });
        const base = { network: BINANCE_PAY_NETWORK, to: PAY_ID, amount: checkout.amountToken, memo: "" };
        const created = new Date(order.createdAt).getTime();

        // Giao dich SAU khi tao don: khop.
        assert.equal(cryptoTransferMatchesOrder({ ...base, txid: "P_OK", timestamp: created + 60_000 }, order), true);
        // Giao dich cu that (2 tuan truoc): bi loai.
        assert.equal(cryptoTransferMatchesOrder({ ...base, txid: "P_OLD", timestamp: created - 14 * 24 * 3600_000 }, order), false);
        // Khong ro thoi diem (V2 parse loi -> 0, hoac NaN): van khop, co canh bao.
        // Bo di la mat tien khach; nhung khong duoc im lang, xem transferTimeMatches.
        assert.equal(cryptoTransferMatchesOrder({ ...base, txid: "P_ZERO", timestamp: 0 }, order), true);
        assert.equal(cryptoTransferMatchesOrder({ ...base, txid: "P_NAN", timestamp: Number("13/06/2026") }, order), true);
    });
});

test("loi HTTP KHONG duoc lam ro ri token vao message (message nay di len log channel)", async () => {
    await withPay({ BINANCE_PAY_TOKEN: "SECRET_TOKEN_abc123" }, async () => {
        globalThis.fetch = async () => new Response("nope", { status: 401 });
        await assert.rejects(
            fetchCryptoTransfers(BINANCE_PAY_NETWORK, { sinceMs: 0 }),
            (error) => {
                assert.ok(!error.message.includes("SECRET_TOKEN_abc123"), `token bi ro ri: ${error.message}`);
                assert.match(error.message, /\*\*\*/);
                return true;
            },
        );
    });
});
