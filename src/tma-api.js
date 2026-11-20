import { Router } from "express";
import QRCode from "qrcode";
import defaultPrisma from "./lib/prisma.js";
import { balanceCache } from "./lib/cache.js";
import { SETTLED_ORDER_STATUSES } from "./lib/payment-events.js";
import {
    isApikeyProcessingActive,
    claimApikeyProcessing,
    releaseApikeyProcessing,
} from "./lib/apikey-processing-flag.js";
import { maskApiKey } from "./lib/mask-secret.js";
import { sendLog } from "./lib/logger.js";
import {
    createTmaAuthMiddleware,
    createChannelGateMiddleware,
    checkRequiredChannelMember,
    invalidateChannelGateCache,
    signTmaSessionToken,
} from "./middleware/tmaAuth.js";
import {
    getBalance,
    createDeposit,
    confirmDepositByBankScan,
    getTransactionHistory,
    generateDepositContent,
    purchase as walletPurchase,
    refund as walletRefund,
    invalidateWalletCache,
    promoteSettledWalletOrder,
} from "./wallet.js";
import { deliverOrder, isPaidUpfrontMethod } from "./delivery.js";
import { getStockCount } from "./inventory.js";
import {
    validateCoupon,
    validateCouponObject,
    calculateDiscount,
    reserveCouponForOrder,
    releaseOrderCoupon,
} from "./coupon.js";
import { applyQuantityDiscount } from "./quantity-discount.js";
import { getVipLevels, getUserVipInfo, getVipDiscount } from "./vip.js";
import { redeemGiftCode, GiftRewardType } from "./giftcode.js";
import { broadcastGiftRedeem } from "./broadcast.js";
import {
    applyFlashToProduct,
    applyFlashToProducts,
    getActiveFlashOffer,
    acceptOffer,
    skipOffer,
    listFlashSales,
    FLASH_STATUS,
    FLASH_RESPONSE,
    discountedUsdTotal,
} from "./flash-sale.js";
import {
    getConfig as getGpt2apiConfig,
    getProfiles,
    getProfileConfig,
    listKeyStatusesCached,
    peekKeyStatuses,
    warmKeyStatuses,
    getKeyStatusesFor,
    getKeyStatus,
} from "./gpt2api.js";
import { listIssuedKeys } from "./apikey-store.js";
import {
    parseTokenAmount,
    parseRpmAmount,
    parseDaysAmount,
    parseTpmAmount,
    priceUsdForKey,
    keyPriceFactors,
    priceBreakdown,
    formatTokens,
    DEFAULT_BUY_PRESETS_M,
    MIN_BUY_TOKENS,
    MAX_BUY_TOKENS,
    MIN_KEY_RPM,
    MAX_KEY_RPM,
    DEFAULT_RPM_PRESETS,
    MIN_KEY_DAYS,
    MAX_KEY_DAYS,
    DEFAULT_DAYS_PRESETS,
    MIN_KEY_TPM,
    MAX_KEY_TPM,
    DEFAULT_KEY_TPM,
} from "./apikey-pricing.js";
import {
    keyLifecycle,
    renewability,
    renewPriceBreakdown,
    remainingDaysForPricing,
    renewDayBasis,
    renewBlockReason,
    toDisplayTokens,
    decorateKeys,
    arrangeKeys,
    normalizeKeyFilter,
} from "./apikey-renew.js";
import {
    getOrCreateUser,
    getReferralConfig,
    getReferralStats,
    getReferralLink,
    processReferralOnboarding,
    redeemWelcomeCode,
    listEligibleTopupKeys,
    redeemPointsToNewKey,
    redeemPointsToTopup,
    getUserReferralHistory,
    getDailyReferralLeaderboard,
    getReferralLeaderboard,
} from "./referral.js";
import { deliverInviteGrantsMessages, sendGrantedKeyOrTopupDm } from "./referral-scheduler.js";
import { createCheckout, getExpireMinutes } from "./payment/provider.js";
import { BANK_BINS, buildVietQrString, generateQRUrl } from "./payment/vietqr.js";
import {
    buildCryptoPaymentRef,
    buildCryptoDepositRef,
    createCryptoCheckout,
    createCryptoDepositCheckout,
    cryptoNetworkLabel,
    cryptoNetworkSupportsQr,
    getEnabledCryptoNetworks,
    getUsdVndRate,
    isCryptoPaymentMethod,
    restoreCryptoCheckout,
} from "./payment/crypto.js";
import {
    createCryptoPayInvoice,
    getCryptoPayConfig,
    getCryptoPayInvoices,
    isCryptoPayConfigured,
    processCryptoPayInvoicePaid,
} from "./payment/cryptopay.js";
import { confirmOrderByBankScan } from "./bank-poller.js";
import {
    confirmDepositByCryptoScan,
    confirmOrderByCryptoScan,
    getTakenCryptoAmounts,
} from "./crypto-poller.js";
import { getBankConfigSync, getMaxDeposit, getDepositPresets } from "./shop-config.js";
import { isUsdCurrency, toVndAmount } from "./money-display.js";
import { formatOrderCode } from "./order-code.js";
import { iconOf } from "./menu-config.js";
import { escapeHtml } from "./bot-ui/format.js";
import { apiKeyMessage } from "./bot-ui/apikey-messages.js";
import { resolveDeveloperApiPayload } from "./developer-api.js";

let _bot = null;
export function setTmaBotInstance(bot) {
    _bot = bot;
}

const CHECK_DEBOUNCE_MS = Math.max(3000, Number(process.env.CRYPTO_CHECK_DEBOUNCE_MS || 15_000));
const MYKEYS_SCAN_LIMIT = 200;
const MYKEYS_STALE_MS = 15 * 60_000;

/**
 * Bọc `bot.telegram` khi giao hàng từ Mini App:
 * - Vẫn gửi đầy đủ thông báo đơn cho Admin & Kênh Order, và gửi biên nhận / file cho khách trong Bot chat.
 * - Riêng tin gửi thẳng tới `customerChatId`: nếu khách chưa từng `/start` bot (`400 chat not found`)
 *   hoặc đang tắt/chặn bot (`403 Forbidden`), bắt lỗi an toàn thay vì làm gãy `deliverStockLines` / `deliverText`.
 *   Nhờ đó khách vẫn nhận được tài khoản/key ngay trên màn hình Mini App!
 */
function buildCustomerTolerantTelegram(baseTelegram, customerChatId, stateOut = { customerDmSkipped: false }) {
    if (!baseTelegram) return null;
    const custStr = String(customerChatId || "");
    const sendMethods = new Set(["sendMessage", "sendDocument", "sendPhoto"]);

    return new Proxy(baseTelegram, {
        get(target, prop, receiver) {
            const val = Reflect.get(target, prop, receiver);
            if (!sendMethods.has(prop) || typeof val !== "function") {
                return typeof val === "function" ? val.bind(target) : val;
            }
            return async (...args) => {
                const targetChat = String(args[0] ?? "");
                try {
                    return await val.apply(target, args);
                } catch (err) {
                    const code = Number(err?.code || err?.response?.error_code || 0);
                    const msg = String(err?.description || err?.message || "").toLowerCase();
                    const isUnreachableCustomer = targetChat === custStr && (
                        code === 403
                        || (code === 400 && /chat not found|user is deactivated|peer_id_invalid|bot was blocked/.test(msg))
                    );
                    if (isUnreachableCustomer) {
                        stateOut.customerDmSkipped = true;
                        console.warn(`[tma-delivery] Bỏ qua gửi DM cho ${custStr} (${prop}): ${err?.message || err}`);
                        return { message_id: 0, dmSkipped: true };
                    }
                    throw err;
                }
            };
        },
    });
}

async function generateLocalVietQrDataUrl({ bankCode, accountNumber, amount, content }) {
    try {
        const cleanCode = String(bankCode || "MB").toUpperCase().replace(/[^A-Z0-9]/g, "");
        const bankBin = BANK_BINS[cleanCode] || (/^\d{6}$/.test(cleanCode) ? cleanCode : "970422");
        if (!accountNumber) return null;
        const emvco = buildVietQrString({ bankBin, accountNumber, amount, content });
        return await QRCode.toDataURL(emvco, {
            width: 440,
            margin: 2,
            errorCorrectionLevel: "M",
        });
    } catch {
        return null;
    }
}

async function generateTextQrDataUrl(text) {
    if (!text) return null;
    try {
        return await QRCode.toDataURL(String(text), {
            width: 420,
            margin: 2,
            errorCorrectionLevel: "M",
        });
    } catch {
        return null;
    }
}

export function createTmaApiRouter(deps = {}) {
    const prisma = deps.prisma || defaultPrisma;
    const getBot = deps.getBot || (() => _bot);
    const getBotToken = deps.getBotToken || (() => process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || "");
    const deliverOrderFn = deps.deliverOrder || deliverOrder;

    const router = Router();

    // Per-user locks chống bấm đúp song song trên Mini App
    const userCheckoutLocks = new Map();
    const userApikeyLocks = new Map();
    const scanDebounceMap = new Map();

    async function withUserLock(telegramId, fn) {
        const key = String(telegramId);
        if (userCheckoutLocks.get(key)) {
            const err = new Error("Đang xử lý giao dịch trước đó, vui lòng chờ giây lát.");
            err.statusCode = 409;
            err.code = "CHECKOUT_BUSY";
            throw err;
        }
        userCheckoutLocks.set(key, true);
        try {
            return await fn();
        } finally {
            userCheckoutLocks.delete(key);
        }
    }

    function getUserApikeySession(telegramId) {
        const key = String(telegramId);
        if (!userApikeyLocks.has(key)) userApikeyLocks.set(key, {});
        return userApikeyLocks.get(key);
    }

    function checkScanDebounce(scanKey) {
        const now = Date.now();
        const last = scanDebounceMap.get(scanKey) || 0;
        if (now - last < CHECK_DEBOUNCE_MS) {
            return {
                ok: false,
                retryAfterSec: Math.max(1, Math.ceil((CHECK_DEBOUNCE_MS - (now - last)) / 1000)),
            };
        }
        scanDebounceMap.set(scanKey, now);
        return { ok: true };
    }

    const tmaAuth = createTmaAuthMiddleware({
        getBotToken,
        prisma,
        getOrCreateUser: deps.getOrCreateUser || getOrCreateUser,
    });

    const requireChannelJoin = createChannelGateMiddleware({
        getTelegram: () => getBot()?.telegram || null,
        configFn: deps.channelConfigFn,
    });

    let cachedApiKeyProductId = null;
    async function getApiKeyProduct() {
        if (cachedApiKeyProductId) {
            const found = await prisma.product.findUnique({ where: { id: cachedApiKeyProductId } }).catch(() => null);
            if (found) return found;
            cachedApiKeyProductId = null;
        }
        let product = await prisma.product.findUnique({ where: { code: "__API_KEY__" } }).catch(() => null);
        if (!product) {
            product = await prisma.product.create({
                data: {
                    code: "__API_KEY__",
                    name: "API Key",
                    description: "API key token (tạo động theo số token khách chọn)",
                    price: 0,
                    currency: "USD",
                    deliveryMode: "API_KEY",
                    isActive: false,
                    unlisted: true,
                    icon: iconOf("APIKEY_BUY"),
                },
            }).catch(async () => prisma.product.findUnique({ where: { code: "__API_KEY__" } }));
        }
        cachedApiKeyProductId = product?.id || null;
        return product;
    }

    async function readShopPublicMeta() {
        const bot = getBot();
        const me = await bot?.telegram?.getMe?.().catch(() => null);
        const rows = await prisma.setting.findMany({
            where: {
                key: {
                    in: [
                        "SHOP_NAME",
                        "SHOP_BANNER_TEXT",
                        "SHOP_SUPPORT_USERNAME",
                        "MINI_APP_SHORT_NAME",
                    ],
                },
            },
        }).catch(() => []);
        const map = Object.fromEntries((rows || []).map((r) => [r.key, r.value]));
        const bank = getBankConfigSync();
        const cryptoNetworks = getEnabledCryptoNetworks();
        const cryptoPayReady = isCryptoPayConfigured();

        return {
            name: map.SHOP_NAME || process.env.SHOP_NAME || "VIESOP",
            bannerText: map.SHOP_BANNER_TEXT || null,
            supportUsername: map.SHOP_SUPPORT_USERNAME || process.env.ADMIN_TELEGRAM || null,
            botUsername: process.env.TELEGRAM_BOT_USERNAME || me?.username || null,
            miniAppShortName: map.MINI_APP_SHORT_NAME || process.env.MINI_APP_SHORT_NAME || "",
            usdVndRate: getUsdVndRate(),
            payments: {
                wallet: true,
                vietqr: Boolean(bank?.accountNumber),
                cryptoNetworks: cryptoNetworks.map((net) => ({
                    key: net,
                    label: cryptoNetworkLabel(net),
                    method: `crypto_${net}`,
                    qrSupported: cryptoNetworkSupportsQr(net),
                })),
                cryptopay: cryptoPayReady,
            },
        };
    }

    // ─── 1. AUTH, PROFILE & CHANNEL GATE ──────────────────────────────────────

    const runTmaReferralOnboardingIfJoined = async (user, tgUser) => {
        const tgId = user.telegramId;
        const bot = getBot();
        const refCfg = await getReferralConfig().catch(() => null);
        // Nếu Admin cấu hình referralChannelId riêng trên Web Admin thì xác minh trên kênh đó
        if (refCfg?.channelId && bot?.telegram?.getChatMember) {
            try {
                const m = await bot.telegram.getChatMember(refCfg.channelId, Number(tgId));
                const st = m?.status;
                const ok = st === "restricted" ? m?.is_member !== false : ["creator", "administrator", "member"].includes(st);
                if (!ok) return null;
            } catch {
                if (process.env.GROUP_GATE_FAILOPEN !== "true") return null;
            }
        }

        const out = await processReferralOnboarding(tgUser || {
            id: Number(tgId),
            first_name: user.firstName || "",
            username: user.username || "",
            is_premium: Boolean(user.isTelegramPremium),
        });
        if (!out) return null;

        if (bot?.telegram) {
            if (out.welcomeReward?.status === "redeemed" && out.welcomeReward.keyData) {
                sendGrantedKeyOrTopupDm(bot.telegram, out.welcomeReward.keyData, {
                    header: `🌟 <b>[QUÀ CHÀO MỪNG BẠN MỚI · ${escapeHtml(out.welcomeReward.code)}]</b>`,
                    note: "Kích hoạt thành công từ Mini App!",
                    icon: iconOf,
                }).catch(() => {});
            }
            if (out.inviteGrants && !out.ageGate?.deferred) {
                const rawWho = user.username
                    ? `@${user.username}`
                    : (user.firstName || "Một người bạn");
                deliverInviteGrantsMessages(bot.telegram, out.inviteGrants, {
                    refereeDisplayName: rawWho,
                    icon: iconOf,
                }).catch(() => {});
            }
        }
        return out;
    };

    const handleBootstrap = async (req, res) => {
        try {
            const user = req.tmaUser;
            const tgId = user.telegramId;
            const botToken = getBotToken();

            const [balance, vipInfo, channelGate, shop] = await Promise.all([
                getBalance(tgId),
                getUserVipInfo(user.id).catch(() => null),
                checkRequiredChannelMember({
                    telegram: getBot()?.telegram || null,
                    telegramId: tgId,
                    configOverride: deps.channelConfigFn?.(),
                }),
                readShopPublicMeta(),
            ]);

            // Nếu khách mới vào qua link ref Mini App và đã ở sẵn trong kênh → tự kích hoạt thưởng nền
            if (channelGate?.joined && user.referredBy && !user.channelPointAwarded && !user.referralLateClaim) {
                runTmaReferralOnboardingIfJoined(user, req.tmaTgUser).catch(() => {});
            }

            let sessionToken = null;
            if (botToken) {
                try {
                    sessionToken = signTmaSessionToken(
                        { telegramId: tgId, isPremium: Boolean(user.isTelegramPremium) },
                        botToken,
                    );
                } catch {}
            }

            res.json({
                ok: true,
                sessionToken,
                startParam: req.tmaStartParam || "",
                user: {
                    id: user.id,
                    telegramId: user.telegramId,
                    username: user.username || "",
                    firstName: user.firstName || "",
                    language: user.language || "vi",
                    vipLevel: user.vipLevel || 0,
                    totalSpent: user.totalSpent || 0,
                    referralCode: user.referralCode || "",
                    referralPoints: user.referralPoints || 0,
                    keyFilter: user.keyFilter || (user.hideExpiredKeys ? "active" : "all"),
                },
                balance,
                vip: vipInfo
                    ? {
                        level: vipInfo.currentLevel?.level ?? user.vipLevel ?? 0,
                        name: vipInfo.currentLevel?.name || "Thường",
                        discountPercent: vipInfo.currentLevel?.discountPercent || 0,
                        nextLevel: vipInfo.nextLevel
                            ? {
                                level: vipInfo.nextLevel.level,
                                name: vipInfo.nextLevel.name,
                                minSpent: vipInfo.nextLevel.minSpent,
                                discountPercent: vipInfo.nextLevel.discountPercent,
                            }
                            : null,
                        progress: vipInfo.progress ?? 100,
                        remaining: vipInfo.remaining ?? 0,
                    }
                    : null,
                channelGate,
                shop,
            });
        } catch (err) {
            console.error("[tma/auth] error:", err);
            res.status(500).json({ error: "Không thể tải thông tin tài khoản." });
        }
    };

    router.post("/auth", tmaAuth, handleBootstrap);
    router.get("/me", tmaAuth, handleBootstrap);

    router.post("/verify-channel", tmaAuth, async (req, res) => {
        try {
            const tgId = req.tmaUser.telegramId;
            invalidateChannelGateCache(tgId);
            const bot = getBot();
            const status = await checkRequiredChannelMember({
                telegram: bot?.telegram || null,
                telegramId: tgId,
                forceFresh: true,
                configOverride: deps.channelConfigFn?.(),
            });

            let onboarding = null;
            if (status.joined) {
                try {
                    const out = await runTmaReferralOnboardingIfJoined(req.tmaUser, req.tmaTgUser);
                    if (out) {
                        onboarding = {
                            welcomeStatus: out.welcomeReward?.status || null,
                            welcomeCode: out.welcomeReward?.code || null,
                            ageDeferred: Boolean(out.ageGate?.deferred),
                            remainingDays: out.ageGate?.remainingDays || 0,
                            pointsAwarded: out.pointsAwarded?.points || 0,
                            rewarded: Boolean(out.inviteGrants?.referee || out.inviteGrants?.referrer),
                        };
                    }
                } catch (e) {
                    console.warn("[tma/verify-channel] onboarding reward skipped:", e?.message);
                }
            }

            res.json({ ok: true, channelGate: status, onboarding });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    router.patch("/preferences", tmaAuth, async (req, res) => {
        try {
            const data = {};
            if (req.body?.language && ["vi", "en", "zh"].includes(String(req.body.language))) {
                data.language = String(req.body.language);
            }
            if (req.body?.keyFilter !== undefined) {
                const kf = normalizeKeyFilter(req.body.keyFilter);
                data.keyFilter = kf;
                data.hideExpiredKeys = kf !== "all";
            }
            if (!Object.keys(data).length) {
                return res.status(400).json({ error: "Không có tùy chọn hợp lệ để lưu" });
            }
            const updated = await prisma.user.update({
                where: { id: req.tmaUser.id },
                data,
            });
            res.json({
                ok: true,
                language: updated.language,
                keyFilter: updated.keyFilter || "all",
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ─── 2. CATALOG, FLASH SALE & PRODUCT CHECKOUT ────────────────────────────

    router.get("/catalog", tmaAuth, async (req, res) => {
        try {
            const tgId = req.tmaUser.telegramId;
            const [categories, rawProducts, iconSetting, qtyDiscountSetting, shop] = await Promise.all([
                prisma.category.findMany({
                    where: { isActive: true },
                    orderBy: [{ order: "asc" }, { name: "asc" }],
                }),
                prisma.product.findMany({
                    where: { isActive: true, unlisted: { not: true } },
                    orderBy: { createdAt: "desc" },
                    include: { category: true },
                }),
                prisma.setting.findUnique({ where: { key: "icon_overrides" } }).catch(() => null),
                prisma.setting.findUnique({ where: { key: "quantity_discounts" } }).catch(() => null),
                readShopPublicMeta(),
            ]);

            const iconOverrides = iconSetting?.value ? JSON.parse(iconSetting.value) : {};
            let qtyMap = {};
            try {
                qtyMap = qtyDiscountSetting?.value ? JSON.parse(qtyDiscountSetting.value) : {};
            } catch {}

            const stockProductIds = rawProducts
                .filter((p) => p.deliveryMode === "STOCK_LINES")
                .map((p) => p.id);

            const [stockCounts, soldCountRows, flashedProducts, vipDiscountPercent] = await Promise.all([
                stockProductIds.length
                    ? prisma.stockItem.groupBy({
                        by: ["productId"],
                        where: { productId: { in: stockProductIds }, isSold: false },
                        _count: { _all: true },
                    })
                    : Promise.resolve([]),
                rawProducts.length
                    ? prisma.order.groupBy({
                        by: ["productId"],
                        where: { productId: { in: rawProducts.map((p) => p.id) }, status: "DELIVERED" },
                        _count: { _all: true },
                    })
                    : Promise.resolve([]),
                applyFlashToProducts(rawProducts, tgId),
                req.tmaUser.vipLevel > 0 ? getVipDiscount(req.tmaUser.id).catch(() => 0) : Promise.resolve(0),
            ]);

            const stockByProductId = new Map(stockCounts.map((r) => [r.productId, r._count._all]));
            const soldByProductId = new Map(soldCountRows.map((r) => [r.productId, r._count._all]));
            const usdVndRate = shop.usdVndRate;

            const products = flashedProducts
                .filter((p) => {
                    if (p.deliveryMode === "STOCK_LINES" && p.autoHideWhenEmpty) {
                        return (stockByProductId.get(p.id) || 0) > 0;
                    }
                    return true;
                })
                .map((p) => {
                    const stockCount = p.deliveryMode === "STOCK_LINES"
                        ? (stockByProductId.get(p.id) || 0)
                        : null;
                    const inStock = p.deliveryMode === "STOCK_LINES" ? stockCount > 0 : true;
                    const priceVnd = toVndAmount(p.price, p.currency, { rate: usdVndRate });
                    const listPriceRaw = p.priceBeforeFlash ?? p.price;
                    const listPriceVnd = toVndAmount(listPriceRaw, p.currency, { rate: usdVndRate });

                    return {
                        id: p.id,
                        code: p.code,
                        name: p.name,
                        description: p.description || "",
                        note: p.note || "",
                        price: p.price,
                        listPrice: listPriceRaw,
                        priceVnd,
                        listPriceVnd,
                        priceUsd: isUsdCurrency(p.currency) ? Number(p.price) : Number((priceVnd / usdVndRate).toFixed(2)),
                        currency: p.currency || "VND",
                        deliveryMode: p.deliveryMode,
                        imageUrl: p.imageUrl || null,
                        icon: p.icon || null,
                        iconSlug: iconOverrides[p.id] || null,
                        categoryId: p.categoryId || null,
                        categoryName: p.category?.name || "Khác",
                        categoryIcon: p.category?.icon || "",
                        stockCount,
                        soldCount: (soldByProductId.get(p.id) || 0) + (Number(p.soldFake) || 0),
                        inStock,
                        flashPct: Number(p.flashPct) || 0,
                        flashExpiresAt: p.flashOffer?.expiresAt || null,
                        flashSaleId: p.flashOffer?.saleId || null,
                        vipDiscountPercent,
                        quantityTiers: Array.isArray(qtyMap[p.id]) ? qtyMap[p.id] : [],
                        requiresWalletOrCryptoPay: isUsdCurrency(p.currency),
                        createdAt: p.createdAt,
                    };
                });

            const countByCat = new Map();
            for (const p of products) {
                if (p.categoryId) countByCat.set(p.categoryId, (countByCat.get(p.categoryId) || 0) + 1);
            }

            res.json({
                ok: true,
                shop,
                categories: categories.map((c) => ({
                    id: c.id,
                    name: c.name,
                    icon: c.icon || "",
                    productCount: countByCat.get(c.id) || 0,
                })),
                products,
            });
        } catch (err) {
            console.error("[tma/catalog] error:", err);
            res.status(500).json({ error: "Không thể tải danh sách sản phẩm." });
        }
    });

    router.get("/flash-sales", tmaAuth, async (req, res) => {
        try {
            const tgId = req.tmaUser.telegramId;
            const now = Date.now();
            const [openSales, myResponses] = await Promise.all([
                listFlashSales({ take: 20, status: FLASH_STATUS.OPEN }),
                prisma.flashSaleResponse.findMany({
                    where: { telegramId: tgId },
                    orderBy: { createdAt: "desc" },
                    take: 30,
                }),
            ]);

            const respBySale = new Map(myResponses.map((r) => [String(r.flashSaleId), r]));
            const extraSaleIds = myResponses
                .filter((r) => r.kind === FLASH_RESPONSE.ACCEPT && r.expiresAt && new Date(r.expiresAt).getTime() > now)
                .map((r) => r.flashSaleId)
                .filter((id) => !openSales.some((s) => String(s.id) === String(id)));

            const extraSales = extraSaleIds.length
                ? await prisma.flashSale.findMany({ where: { id: { in: extraSaleIds } } })
                : [];

            const allSales = [...openSales, ...extraSales];
            res.json({
                ok: true,
                sales: allSales.map((s) => {
                    const resp = respBySale.get(String(s.id)) || null;
                    const claimed = resp?.kind === FLASH_RESPONSE.ACCEPT
                        && (!resp.expiresAt || new Date(resp.expiresAt).getTime() > now);
                    const slotsLeft = s.maxSlots > 0 ? Math.max(0, s.maxSlots - (s.acceptedCount || 0)) : null;
                    return {
                        id: s.id,
                        productId: s.productId,
                        productName: s.productName,
                        productPrice: s.productPrice,
                        productCurrency: s.productCurrency || "VND",
                        totalDiscount: Boolean(s.totalDiscount),
                        targetProfileId: s.targetProfileId ?? null,
                        discountPct: s.discountPct,
                        validityMinutes: s.validityMinutes,
                        maxSlots: s.maxSlots,
                        acceptedCount: s.acceptedCount || 0,
                        slotsLeft,
                        status: s.status,
                        guideText: s.guideText || null,
                        claimed,
                        myExpiresAt: claimed ? resp.expiresAt : null,
                        purchased: Boolean(resp?.purchased),
                    };
                }),
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    router.post("/flash-sales/:id/claim", tmaAuth, async (req, res) => {
        try {
            const action = String(req.body?.action || "accept").toLowerCase();
            if (action === "skip") {
                const out = await skipOffer(req.tmaUser.telegramId, req.params.id);
                return res.json({ ok: Boolean(out?.ok), ...out });
            }
            const out = await acceptOffer(req.tmaUser.telegramId, req.params.id);
            if (!out?.ok) {
                return res.status(400).json({
                    ok: false,
                    reason: out?.reason || "unavailable",
                    error: out?.reason === "full"
                        ? "Rất tiếc, đợt Flash Sale này vừa hết sạch suất!"
                        : out?.reason === "not_open_yet"
                            ? "Đợt Flash Sale chưa tới giờ mở, vui lòng chờ giây lát."
                            : "Không thể nhận ưu đãi lúc này.",
                });
            }
            res.json({
                ok: true,
                expiresAt: out.expiresAt || out.response?.expiresAt || null,
                already: Boolean(out.already),
                discountPct: out.sale?.discountPct || 0,
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * Tính báo giá sản phẩm thường — khớp chính xác công thức `processPaymentFlow` ở `src/bot.js`.
     */
    async function computeProductQuote({ rawProduct, user, quantity, couponCode = "" }) {
        const qty = Math.max(1, Math.floor(Number(quantity) || 1));
        if (!rawProduct || !rawProduct.isActive || rawProduct.code === "__API_KEY__") {
            return { ok: false, status: 404, error: "Sản phẩm không tồn tại hoặc đã ngừng kinh doanh." };
        }
        if (rawProduct.deliveryMode === "CONTACT") {
            return {
                ok: false,
                status: 400,
                code: "CONTACT_ONLY",
                error: "Sản phẩm này cần liên hệ trực tiếp Admin để được tư vấn và kích hoạt.",
            };
        }

        if (rawProduct.deliveryMode === "STOCK_LINES") {
            const stock = await getStockCount(rawProduct.id);
            if (stock < qty) {
                return {
                    ok: false,
                    status: 400,
                    code: "OUT_OF_STOCK",
                    error: stock <= 0 ? "Sản phẩm vừa hết hàng." : `Kho chỉ còn ${stock} sản phẩm (bạn chọn ${qty}).`,
                    stockCount: stock,
                };
            }
        }

        const product = await applyFlashToProduct(rawProduct, user.telegramId, { fresh: true });
        const usdVndRate = getUsdVndRate();
        const unitPrice = toVndAmount(product.price, product.currency, { rate: usdVndRate });
        const gross = unitPrice * qty;
        const qtyRes = await applyQuantityDiscount(product.id, unitPrice, qty);

        let coupon = null;
        let couponDiscount = 0;
        let couponError = null;
        const normalizedCode = String(couponCode || "").trim().toUpperCase();
        if (normalizedCode) {
            const validated = await validateCoupon(normalizedCode, gross, user.telegramId);
            if (!validated.valid) {
                couponError = validated.error === "EXPIRED"
                    ? "Mã giảm giá đã hết hạn."
                    : validated.error === "USED_UP"
                        ? "Mã giảm giá đã hết lượt sử dụng."
                        : validated.error === "MIN_ORDER"
                            ? `Đơn tối thiểu để dùng mã này là ${Number(validated.minOrder || 0).toLocaleString("vi-VN")}đ.`
                            : validated.error === "VIP_REQUIRED"
                                ? `Mã này chỉ dành cho thành viên VIP ${validated.vipLevel}+.`
                                : "Mã giảm giá không hợp lệ.";
            } else {
                coupon = validated.coupon;
                couponDiscount = calculateDiscount(coupon, gross);
            }
        }

        let vipDiscountPercent = 0;
        let vipDiscount = 0;
        if (user.vipLevel > 0) {
            vipDiscountPercent = await getVipDiscount(user.id).catch(() => 0);
            if (vipDiscountPercent > 0) {
                vipDiscount = Math.floor((gross * vipDiscountPercent) / 100);
            }
        }

        const rawDiscount = qtyRes.discount + couponDiscount + vipDiscount;
        const minPayable = gross > 0 ? Math.min(gross, 1000) : 0;
        const finalAmount = Math.max(minPayable, gross - rawDiscount);
        const totalDiscount = Math.max(0, gross - finalAmount);
        const displayCurrency = product.currency || "VND";
        const displayFinalUsd = Number((finalAmount / usdVndRate).toFixed(4));
        const flashPct = Number(product.flashPct) || 0;
        const flashListUnitPrice = Number(product.priceBeforeFlash ?? product.price) || 0;
        const flashListAmount = flashPct
            ? toVndAmount(flashListUnitPrice, product.currency, { rate: usdVndRate }) * qty
            : 0;

        return {
            ok: true,
            product,
            quantity: qty,
            unitPriceVnd: unitPrice,
            grossVnd: gross,
            quantityDiscountVnd: qtyRes.discount,
            quantityDiscountPercent: qtyRes.discountPercent,
            coupon: coupon ? { id: coupon.id, code: coupon.code, discountVnd: couponDiscount } : null,
            couponError,
            vipDiscountPercent,
            vipDiscountVnd: vipDiscount,
            flashPct,
            flashSaleId: product.flashOffer?.saleId || null,
            flashListAmount,
            flashDiscountAmount: flashListAmount ? Math.max(0, flashListAmount - gross) : 0,
            discountVnd: totalDiscount,
            finalAmountVnd: finalAmount,
            displayCurrency,
            displayUnitPrice: Number(product.price || 0),
            displayFinalUsd,
            usdVndRate,
            requiresWalletTopup: isUsdCurrency(displayCurrency),
        };
    }

    router.post("/orders/quote", tmaAuth, async (req, res) => {
        try {
            const { productId, quantity = 1, couponCode = "" } = req.body || {};
            if (!productId) return res.status(400).json({ error: "Thiếu productId" });
            const rawProduct = await prisma.product.findUnique({ where: { id: String(productId) } });
            const [quote, balance] = await Promise.all([
                computeProductQuote({ rawProduct, user: req.tmaUser, quantity, couponCode }),
                getBalance(req.tmaUser.telegramId),
            ]);
            if (!quote.ok) return res.status(quote.status || 400).json(quote);

            res.json({
                ok: true,
                productId: quote.product.id,
                productName: quote.product.name,
                quantity: quote.quantity,
                unitPriceVnd: quote.unitPriceVnd,
                grossVnd: quote.grossVnd,
                quantityDiscountVnd: quote.quantityDiscountVnd,
                quantityDiscountPercent: quote.quantityDiscountPercent,
                vipDiscountVnd: quote.vipDiscountVnd,
                vipDiscountPercent: quote.vipDiscountPercent,
                coupon: quote.coupon,
                couponError: quote.couponError,
                flashPct: quote.flashPct,
                discountVnd: quote.discountVnd,
                finalAmountVnd: quote.finalAmountVnd,
                finalUsd: Number(quote.displayFinalUsd.toFixed(2)),
                usdVndRate: quote.usdVndRate,
                balanceVnd: balance,
                canPayWallet: balance >= quote.finalAmountVnd,
                shortfallVnd: Math.max(0, quote.finalAmountVnd - balance),
                requiresWalletTopup: quote.requiresWalletTopup,
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * Dựng thông tin hướng dẫn thanh toán cho đơn PENDING (VietQR / USDT / CryptoPay)
     */
    async function buildPendingPaymentInstructions({ order, productName, paymentMethod }) {
        const method = String(paymentMethod || "").toLowerCase();
        const bot = getBot();

        if (method === "vietqr") {
            const checkout = await createCheckout({
                orderId: order.id,
                amount: order.finalAmount,
                productName,
                quantity: order.quantity,
            });
            await prisma.order.update({
                where: { id: order.id },
                data: { paymentRef: checkout.transferContent, expiresAt: checkout.expiresAt },
            });
            const qrDataUrl = await generateLocalVietQrDataUrl({
                bankCode: checkout.bankInfo?.bankCode,
                accountNumber: checkout.bankInfo?.accountNumber,
                amount: checkout.amount,
                content: checkout.transferContent,
            });
            return {
                kind: "vietqr",
                amountVnd: checkout.amount,
                transferContent: checkout.transferContent,
                qrUrl: checkout.qrUrl,
                qrDataUrl,
                bankInfo: checkout.bankInfo,
                expiresAt: checkout.expiresAt,
            };
        }

        if (method.startsWith("crypto_")) {
            const network = method.replace(/^crypto_/, "");
            if (!getEnabledCryptoNetworks().includes(network)) {
                throw new Error(`Mạng thanh toán ${network.toUpperCase()} hiện không khả dụng.`);
            }
            const checkout = createCryptoCheckout({
                orderId: order.id,
                amount: order.finalAmount,
                productName,
                quantity: order.quantity,
                network,
                takenAmounts: await getTakenCryptoAmounts(network),
            });
            await prisma.order.update({
                where: { id: order.id },
                data: {
                    paymentRef: buildCryptoPaymentRef(checkout),
                    cryptoNetwork: checkout.network,
                    cryptoAmount: checkout.amountToken,
                    cryptoAddress: checkout.address,
                    cryptoToken: checkout.token,
                    cryptoUsdVndRate: checkout.usdVndRate,
                    expiresAt: checkout.expiresAt,
                },
            });
            const qrSupported = cryptoNetworkSupportsQr(checkout.network);
            const qrDataUrl = qrSupported ? await generateTextQrDataUrl(checkout.address) : null;
            return {
                kind: "crypto",
                network: checkout.network,
                networkLabel: checkout.networkLabel,
                token: checkout.token,
                amountToken: checkout.amountToken,
                address: checkout.address,
                qrSupported,
                qrDataUrl,
                expiresAt: checkout.expiresAt,
            };
        }

        if (method === "cryptopay") {
            if (!isCryptoPayConfigured()) {
                throw new Error("Cổng CryptoPay hiện chưa được bật.");
            }
            const usdVndRate = Number(order.cryptoUsdVndRate || getUsdVndRate());
            const amountUsdt = Math.max(0.1, Number((order.finalAmount / usdVndRate).toFixed(2)));
            const cfg = getCryptoPayConfig();
            const cryptoAsset = cfg.asset || "USDT";
            const me = await bot?.telegram?.getMe?.().catch(() => null);
            const botUrl = me?.username ? `https://t.me/${me.username}` : undefined;
            const expireMinutes = cfg.expireMinutes || getExpireMinutes();

            const invoice = await createCryptoPayInvoice({
                orderId: order.id,
                amount: amountUsdt.toFixed(2),
                asset: cryptoAsset,
                description: `${productName} (#${formatOrderCode(order.id)})`,
                paidBtnUrl: botUrl,
                expiresIn: expireMinutes * 60,
            });
            const payUrl = invoice.mini_app_invoice_url || invoice.bot_invoice_url || invoice.pay_url;
            const expiresAt = new Date(Date.now() + expireMinutes * 60_000);

            await prisma.order.update({
                where: { id: order.id },
                data: {
                    paymentRef: `CRYPTOPAY:INVOICE:${invoice.invoice_id}`,
                    cryptoNetwork: "cryptopay",
                    cryptoToken: cryptoAsset,
                    cryptoAmount: amountUsdt,
                    cryptoAddress: payUrl,
                    expiresAt,
                },
            });

            return {
                kind: "cryptopay",
                asset: cryptoAsset,
                amountToken: amountUsdt,
                payUrl,
                invoiceId: invoice.invoice_id,
                expiresAt,
            };
        }

        throw new Error("Phương thức thanh toán không hợp lệ.");
    }

    router.post("/orders/checkout", tmaAuth, requireChannelJoin, async (req, res) => {
        try {
            const {
                productId,
                quantity = 1,
                couponCode = "",
                paymentMethod = "wallet",
                clientRef = "",
            } = req.body || {};

            if (!productId) return res.status(400).json({ error: "Thiếu productId" });
            const method = String(paymentMethod || "wallet").toLowerCase();
            const cleanRef = String(clientRef || "").trim().slice(0, 100);
            const user = req.tmaUser;
            const tgId = user.telegramId;

            await withUserLock(tgId, async () => {
                if (cleanRef) {
                    const dup = await prisma.order.findFirst({
                        where: { odelegramId: tgId, source: "miniapp", oderId: cleanRef },
                    });
                    if (dup && dup.status !== "CANCELED") {
                        return res.json({
                            ok: true,
                            duplicate: true,
                            orderId: dup.id,
                            shortId: formatOrderCode(dup.id),
                            status: dup.status,
                            deliveryContent: dup.status === "DELIVERED" ? (dup.deliveryContent || null) : null,
                        });
                    }
                }

                const rawProduct = await prisma.product.findUnique({ where: { id: String(productId) } });
                const quote = await computeProductQuote({ rawProduct, user, quantity, couponCode });
                if (!quote.ok) {
                    return res.status(quote.status || 400).json(quote);
                }
                if (couponCode && quote.couponError) {
                    return res.status(400).json({ error: quote.couponError, code: "INVALID_COUPON" });
                }

                if (quote.requiresWalletTopup && !["wallet", "cryptopay"].includes(method)) {
                    return res.status(400).json({
                        error: "Sản phẩm niêm yết USD chỉ hỗ trợ thanh toán bằng Số dư Ví hoặc CryptoPay (vui lòng nạp Ví trước).",
                        code: "USD_WALLET_ONLY",
                    });
                }

                if (method === "wallet") {
                    balanceCache.invalidate(tgId);
                    invalidateWalletCache(tgId);
                    const balance = await getBalance(tgId);
                    if (balance < quote.finalAmountVnd) {
                        return res.status(400).json({
                            error: `Số dư ví không đủ. Cần ${quote.finalAmountVnd.toLocaleString("vi-VN")}đ, hiện có ${balance.toLocaleString("vi-VN")}đ.`,
                            code: "INSUFFICIENT_BALANCE",
                            requiredVnd: quote.finalAmountVnd,
                            balanceVnd: balance,
                            shortfallVnd: quote.finalAmountVnd - balance,
                        });
                    }
                }

                const order = await prisma.order.create({
                    data: {
                        odelegramId: tgId,
                        chatId: tgId,
                        productId: quote.product.id,
                        quantity: quote.quantity,
                        amount: quote.grossVnd,
                        discount: quote.discountVnd,
                        finalAmount: quote.finalAmountVnd,
                        currency: "VND",
                        cryptoUsdVndRate: quote.usdVndRate,
                        displayCurrency: quote.displayCurrency,
                        displayUnitPrice: quote.displayUnitPrice,
                        displayFinalUsd: quote.displayFinalUsd,
                        flashSaleId: quote.flashSaleId,
                        flashDiscountPct: quote.flashPct,
                        flashListAmount: quote.flashListAmount,
                        flashDiscountAmount: quote.flashDiscountAmount,
                        status: "PENDING",
                        paymentMethod: method,
                        couponId: quote.coupon?.id || null,
                        userId: user.id,
                        source: "miniapp",
                        oderId: cleanRef || null,
                    },
                });

                if (quote.coupon?.id) {
                    const reservation = await reserveCouponForOrder(order.id, quote.coupon.id);
                    if (!reservation.reserved) {
                        await prisma.order.update({
                            where: { id: order.id },
                            data: { status: "CANCELED", couponId: null, cancelReason: "coupon_used_up" },
                        }).catch(() => {});
                        return res.status(409).json({
                            error: "Mã giảm giá vừa hết lượt sử dụng. Vui lòng thử lại.",
                            code: "COUPON_USED_UP",
                        });
                    }
                }

                if (method === "wallet") {
                    const paid = await walletPurchase(
                        tgId,
                        quote.finalAmountVnd,
                        order.id,
                        `Mini App: Mua ${quote.product.name} x${quote.quantity}`,
                    );
                    if (!paid.success) {
                        await prisma.order.update({ where: { id: order.id }, data: { status: "CANCELED" } }).catch(() => {});
                        await releaseOrderCoupon(order.id).catch(() => {});
                        return res.status(400).json({ error: paid.error || "Không thể trừ số dư ví." });
                    }

                    const settlement = await promoteSettledWalletOrder(order.id);
                    if (!settlement.settled || !SETTLED_ORDER_STATUSES.includes(settlement.order?.status)) {
                        return res.status(202).json({
                            ok: true,
                            processing: true,
                            orderId: order.id,
                            shortId: formatOrderCode(order.id),
                            status: "PAID",
                            newBalance: paid.newBalance,
                        });
                    }
                    order.status = settlement.order.status;
                    order.paymentRef = settlement.order.paymentRef || paid.transaction?.id || `WALLET:${order.id}`;

                    const dmState = { customerDmSkipped: false };
                    const safeTg = buildCustomerTolerantTelegram(getBot()?.telegram || null, tgId, dmState);

                    try {
                        await deliverOrderFn({ prisma, telegram: safeTg, order });
                    } catch (delivErr) {
                        console.error(`[tma/checkout] deliverOrder error ${order.id}:`, delivErr?.message);
                    }

                    const freshOrder = await prisma.order.findUnique({ where: { id: order.id } });
                    const freshBalance = await getBalance(tgId);

                    if (freshOrder?.status === "CANCELED") {
                        return res.status(409).json({
                            error: "Sản phẩm vừa hết hàng trong tích tắc. Hệ thống đã hoàn lại 100% tiền vào Ví của bạn!",
                            refunded: true,
                            orderId: order.id,
                            shortId: formatOrderCode(order.id),
                            newBalance: freshBalance,
                        });
                    }

                    sendLog(
                        "ORDER",
                        `✅ [Mini App] User ${tgId} mua ${quote.product.name} x${quote.quantity} (Ví) — ${quote.finalAmountVnd.toLocaleString("vi-VN")}đ`,
                    );

                    return res.json({
                        ok: true,
                        orderId: order.id,
                        shortId: formatOrderCode(order.id),
                        status: freshOrder?.status || "PAID",
                        productName: quote.product.name,
                        deliveryMode: quote.product.deliveryMode,
                        deliveryContent: freshOrder?.deliveryContent || null,
                        customerDmSkipped: dmState.customerDmSkipped,
                        newBalance: freshBalance,
                    });
                }

                // Thanh toán trả sau (VietQR / Crypto / CryptoPay)
                try {
                    const payment = await buildPendingPaymentInstructions({
                        order,
                        productName: quote.product.name,
                        paymentMethod: method,
                    });
                    return res.json({
                        ok: true,
                        orderId: order.id,
                        shortId: formatOrderCode(order.id),
                        status: "PENDING",
                        productName: quote.product.name,
                        finalAmountVnd: quote.finalAmountVnd,
                        payment,
                    });
                } catch (payErr) {
                    await prisma.order.update({ where: { id: order.id }, data: { status: "CANCELED" } }).catch(() => {});
                    if (order.couponId) await releaseOrderCoupon(order.id).catch(() => {});
                    return res.status(400).json({ error: payErr.message || "Không thể khởi tạo cổng thanh toán." });
                }
            });
        } catch (err) {
            const status = err.statusCode || 500;
            res.status(status).json({ error: err.message, code: err.code });
        }
    });

    // ─── 3. PORTAL API KEY (GPT2API: MUA MỚI, MY KEYS, GIA HẠN TẠI CHỖ) ────────

    async function computeApikeyFlashOrVip(user, listPriceUsd, profileId) {
        const plain = {
            priceUsd: listPriceUsd,
            flashPct: 0,
            flashSaleId: null,
            flashExpiresAt: null,
            flashListUsd: listPriceUsd,
            isVip: false,
        };
        const product = await getApiKeyProduct().catch(() => null);
        if (!product) return plain;

        const offer = await getActiveFlashOffer(user.telegramId, product.id, {
            isAdmin: false,
            profileId,
        });
        let pct = Number(offer?.discountPct) || 0;
        const isFlash = pct > 0;
        const saleId = offer?.saleId || null;
        const expiresAt = offer?.expiresAt || null;

        if (!pct && user.vipLevel > 0) {
            const vipPct = await getVipDiscount(user.id).catch(() => 0);
            if (vipPct > 0) pct = vipPct;
        }
        if (!pct) return plain;

        const discounted = discountedUsdTotal(listPriceUsd, pct);
        if (!(discounted < Number(listPriceUsd))) return plain;

        return {
            priceUsd: discounted,
            flashPct: pct,
            flashSaleId: saleId,
            flashExpiresAt: expiresAt,
            flashListUsd: Number(listPriceUsd),
            isVip: !isFlash,
        };
    }

    function buildApikeyFlashOrderFields(flash, priceUsd, priceVnd, rate) {
        const pct = Number(flash?.flashPct) || 0;
        if (!pct) {
            return {
                displayUnitPrice: priceUsd,
                displayFinalUsd: priceUsd,
                flashSaleId: null,
                flashDiscountPct: 0,
                flashListAmount: 0,
                flashDiscountAmount: 0,
            };
        }
        const listVnd = Math.round(Number(flash.flashListUsd) * rate);
        return {
            displayUnitPrice: Number(flash.flashListUsd),
            displayFinalUsd: priceUsd,
            flashSaleId: flash.flashSaleId,
            flashDiscountPct: pct,
            flashListAmount: listVnd,
            flashDiscountAmount: Math.max(0, listVnd - priceVnd),
        };
    }

    router.get("/apikey/profiles", tmaAuth, async (req, res) => {
        try {
            const [profiles, usdVndRate] = await Promise.all([
                getProfiles(),
                Promise.resolve(getUsdVndRate()),
            ]);
            const enabledProfiles = (profiles || [])
                .filter((p) => p.enabled !== false && p.shopEnabled !== false && p.configured)
                .map((p) => ({
                    profileId: p.profileId,
                    name: p.profileName,
                    usdPerMtoken: Number(p.usdPerMtoken) || 0,
                    maxBuyTokens: Number(p.maxBuyTokens) || MAX_BUY_TOKENS,
                    defaultRpm: Number(p.rpm) || 100,
                    defaultTpm: Number(p.tpm) || DEFAULT_KEY_TPM,
                    defaultValidDays: Number(p.validDays) || 0,
                    buyPresetsM: Array.isArray(p.buyPresetsM) && p.buyPresetsM.length ? p.buyPresetsM : DEFAULT_BUY_PRESETS_M,
                    rpmPresets: Array.isArray(p.rpmPresets) && p.rpmPresets.length ? p.rpmPresets : DEFAULT_RPM_PRESETS,
                    daysPresets: Array.isArray(p.daysPresets) && p.daysPresets.length ? p.daysPresets : DEFAULT_DAYS_PRESETS,
                    rpmIncluded: Number(p.rpmIncluded) || 100,
                    rpmSurchargePct: Number(p.rpmSurchargePct) || 0,
                    daySurchargePct: Number(p.daySurchargePct) || 0,
                    noExpiryMult: Number(p.noExpiryMult) || 1,
                    models: Array.isArray(p.models) ? p.models : [],
                }));

            res.json({
                ok: true,
                usdVndRate,
                limits: {
                    minTokens: MIN_BUY_TOKENS,
                    maxTokens: MAX_BUY_TOKENS,
                    minRpm: MIN_KEY_RPM,
                    maxRpm: MAX_KEY_RPM,
                    minDays: MIN_KEY_DAYS,
                    maxDays: MAX_KEY_DAYS,
                },
                profiles: enabledProfiles,
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    async function quoteNewApiKey({ user, body }) {
        const b = body || {};
        const profileId = (b.profileId === undefined || b.profileId === null || b.profileId === "")
            ? null
            : (Math.floor(Number(b.profileId)) || null);

        const cfg = await getProfileConfig(profileId).catch(() => null);
        if (!cfg?.configured || !cfg?.enabled) {
            return { ok: false, status: 400, error: "Máy chủ API Key hiện đang đóng hoặc chưa cấu hình." };
        }

        const parsedTok = parseTokenAmount(b.tokens, {
            min: MIN_BUY_TOKENS,
            max: Number(cfg.maxBuyTokens) || MAX_BUY_TOKENS,
        });
        if (!parsedTok.ok) {
            return { ok: false, status: 400, error: "Số lượng token không hợp lệ." };
        }
        const tokens = parsedTok.tokens;

        const effectiveRpm = (b.rpm !== undefined && b.rpm !== null && String(b.rpm).trim() !== "")
            ? (() => {
                const r = parseRpmAmount(b.rpm, { min: MIN_KEY_RPM, max: MAX_KEY_RPM });
                return r.ok ? r.rpm : null;
            })()
            : (Number(cfg.rpm) || 100);
        if (effectiveRpm === null) {
            return { ok: false, status: 400, error: `RPM phải nằm trong khoảng ${MIN_KEY_RPM}–${MAX_KEY_RPM}.` };
        }

        const effectiveTpm = (b.tpm !== undefined && b.tpm !== null && String(b.tpm).trim() !== "")
            ? (() => {
                const t = parseTpmAmount(b.tpm, { min: MIN_KEY_TPM, max: MAX_KEY_TPM });
                return t.ok ? t.tpm : null;
            })()
            : (Number(cfg.tpm) || DEFAULT_KEY_TPM);
        if (effectiveTpm === null) {
            return { ok: false, status: 400, error: "TPM không hợp lệ." };
        }

        let effectiveValidDays = Number(cfg.validDays) || 0;
        if (b.validDays !== undefined && b.validDays !== null && String(b.validDays).trim() !== "") {
            const rawDays = Number(b.validDays);
            if (rawDays === 0) {
                effectiveValidDays = 0;
            } else {
                const d = parseDaysAmount(b.validDays, { min: MIN_KEY_DAYS, max: MAX_KEY_DAYS });
                if (!d.ok) {
                    return { ok: false, status: 400, error: `Số ngày phải từ ${MIN_KEY_DAYS}–${MAX_KEY_DAYS} (hoặc 0 = không hết hạn).` };
                }
                effectiveValidDays = d.days;
            }
        }

        const breakdown = priceBreakdown(
            { tokens, rpm: effectiveRpm, validDays: effectiveValidDays },
            cfg.usdPerMtoken,
            cfg,
        );
        const listPriceUsd = priceUsdForKey(
            { tokens, rpm: effectiveRpm, validDays: effectiveValidDays },
            cfg.usdPerMtoken,
            cfg,
        );
        const rate = getUsdVndRate();
        const flash = await computeApikeyFlashOrVip(user, listPriceUsd, cfg.profileId);
        const priceUsd = flash.priceUsd;
        const priceVnd = Math.round(priceUsd * rate);

        return {
            ok: true,
            cfg,
            tokens,
            rpm: effectiveRpm,
            tpm: effectiveTpm,
            validDays: effectiveValidDays,
            breakdown,
            listPriceUsd,
            priceUsd,
            priceVnd,
            rate,
            flash,
        };
    }

    router.post("/apikey/quote", tmaAuth, async (req, res) => {
        try {
            const [quote, balance] = await Promise.all([
                quoteNewApiKey({ user: req.tmaUser, body: req.body }),
                getBalance(req.tmaUser.telegramId),
            ]);
            if (!quote.ok) return res.status(quote.status || 400).json(quote);

            res.json({
                ok: true,
                profile: { id: quote.cfg.profileId, name: quote.cfg.profileName },
                tokens: quote.tokens,
                rpm: quote.rpm,
                tpm: quote.tpm,
                validDays: quote.validDays,
                breakdown: quote.breakdown,
                listPriceUsd: quote.listPriceUsd,
                priceUsd: quote.priceUsd,
                priceVnd: quote.priceVnd,
                usdVndRate: quote.rate,
                discountPct: quote.flash.flashPct || 0,
                discountKind: quote.flash.flashPct ? (quote.flash.isVip ? "vip" : "flash") : null,
                balanceVnd: balance,
                canPayWallet: balance >= quote.priceVnd,
                shortfallVnd: Math.max(0, quote.priceVnd - balance),
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    router.post("/apikey/checkout", tmaAuth, requireChannelJoin, async (req, res) => {
        const tgId = req.tmaUser.telegramId;
        const lockSession = getUserApikeySession(tgId);
        if (isApikeyProcessingActive(lockSession)) {
            return res.status(409).json({
                error: "Đang xử lý yêu cầu API Key trước đó, vui lòng chờ giây lát.",
                code: "APIKEY_BUSY",
            });
        }
        claimApikeyProcessing(lockSession);

        let order = null;
        let priceVnd = 0;
        try {
            const method = String(req.body?.paymentMethod || "wallet").toLowerCase();
            const cleanRef = String(req.body?.clientRef || "").trim().slice(0, 100);

            if (cleanRef) {
                const dup = await prisma.order.findFirst({
                    where: { odelegramId: tgId, source: "miniapp", oderId: cleanRef },
                });
                if (dup && dup.status !== "CANCELED") {
                    let parsedKey = null;
                    try { parsedKey = dup.deliveryContent ? JSON.parse(dup.deliveryContent) : null; } catch {}
                    return res.json({
                        ok: true,
                        duplicate: true,
                        orderId: dup.id,
                        shortId: formatOrderCode(dup.id),
                        status: dup.status,
                        apiKey: parsedKey,
                    });
                }
            }

            const quote = await quoteNewApiKey({ user: req.tmaUser, body: req.body });
            if (!quote.ok) return res.status(quote.status || 400).json(quote);

            priceVnd = quote.priceVnd;
            const product = await getApiKeyProduct();
            if (!product) throw new Error("Không khởi tạo được sản phẩm API Key");

            if (method === "wallet") {
                balanceCache.invalidate(tgId);
                invalidateWalletCache(tgId);
                const balance = await getBalance(tgId);
                if (balance < priceVnd) {
                    return res.status(400).json({
                        error: `Số dư ví không đủ. Cần ${priceVnd.toLocaleString("vi-VN")}đ, hiện có ${balance.toLocaleString("vi-VN")}đ.`,
                        code: "INSUFFICIENT_BALANCE",
                        requiredVnd: priceVnd,
                        balanceVnd: balance,
                        shortfallVnd: priceVnd - balance,
                    });
                }
            }

            const flashFields = buildApikeyFlashOrderFields(quote.flash, quote.priceUsd, priceVnd, quote.rate);
            const grossAmount = flashFields.flashListAmount || priceVnd;

            order = await prisma.order.create({
                data: {
                    odelegramId: tgId,
                    chatId: tgId,
                    productId: product.id,
                    quantity: 1,
                    amount: grossAmount,
                    discount: Math.max(0, grossAmount - priceVnd),
                    finalAmount: priceVnd,
                    currency: "VND",
                    status: "PENDING",
                    paymentMethod: method,
                    userId: req.tmaUser.id,
                    cryptoUsdVndRate: quote.rate,
                    displayCurrency: "USD",
                    source: "miniapp",
                    oderId: cleanRef || null,
                    ...flashFields,
                    apikeyTokens: quote.tokens,
                    apikeyRpm: quote.rpm,
                    apikeyTpm: quote.tpm,
                    apikeyValidDays: quote.validDays,
                    apikeyProfile: quote.cfg.profileId,
                },
            });

            if (method === "wallet") {
                const paid = await walletPurchase(
                    tgId,
                    priceVnd,
                    order.id,
                    `Mini App: Mua API key ${formatTokens(quote.tokens)} token`,
                );
                if (!paid.success) {
                    await prisma.order.update({ where: { id: order.id }, data: { status: "CANCELED" } }).catch(() => {});
                    return res.status(400).json({ error: paid.error || "Không thể trừ số dư ví." });
                }

                await prisma.order.update({
                    where: { id: order.id },
                    data: { status: "PAID", paymentRef: paid.transaction?.id || `WALLET:${order.id}` },
                });
                order.status = "PAID";
                balanceCache.invalidate(tgId);

                const safeTg = buildCustomerTolerantTelegram(getBot()?.telegram || null, tgId);
                try {
                    await deliverOrderFn({ prisma, telegram: safeTg, order });
                } catch (delivErr) {
                    console.error(`[tma/apikey/checkout] deliverOrder error ${order.id}:`, delivErr?.message);
                }

                const freshOrder = await prisma.order.findUnique({ where: { id: order.id } });
                const freshBalance = await getBalance(tgId);

                if (freshOrder?.status === "CANCELED") {
                    return res.status(502).json({
                        error: "Máy chủ nhà cung cấp tạm thời không tạo được key. Hệ thống đã hoàn 100% tiền về Ví của bạn!",
                        refunded: true,
                        orderId: order.id,
                        newBalance: freshBalance,
                    });
                }

                let apiKeyPayload = null;
                try {
                    apiKeyPayload = freshOrder?.deliveryContent ? JSON.parse(freshOrder.deliveryContent) : null;
                } catch {}

                sendLog(
                    "ORDER",
                    `✅ [Mini App] APIKEY (Ví) user ${tgId}: ${formatTokens(quote.tokens)} token — ${priceVnd.toLocaleString("vi-VN")}đ`,
                );

                return res.json({
                    ok: true,
                    orderId: order.id,
                    shortId: formatOrderCode(order.id),
                    status: freshOrder?.status || "PAID",
                    apiKey: apiKeyPayload,
                    newBalance: freshBalance,
                });
            }

            // Trả sau bằng VietQR / USDT / CryptoPay: chỉ tạo đơn PENDING, poller sẽ gọi deliverOrder
            try {
                const payment = await buildPendingPaymentInstructions({
                    order,
                    productName: `API Key ${formatTokens(quote.tokens)}`,
                    paymentMethod: method,
                });
                return res.json({
                    ok: true,
                    orderId: order.id,
                    shortId: formatOrderCode(order.id),
                    status: "PENDING",
                    finalAmountVnd: priceVnd,
                    payment,
                });
            } catch (payErr) {
                await prisma.order.update({ where: { id: order.id }, data: { status: "CANCELED" } }).catch(() => {});
                return res.status(400).json({ error: payErr.message });
            }
        } catch (err) {
            console.error("[tma/apikey/checkout] unexpected:", err);
            if (order?.id && priceVnd > 0 && order.status === "PAID") {
                await walletRefund(tgId, priceVnd, order.id, "Hoàn tiền: lỗi hệ thống khi tạo API key").catch(() => null);
            }
            res.status(500).json({ error: err.message });
        } finally {
            releaseApikeyProcessing(lockSession);
        }
    });

    async function loadKeyStatusesFast(keys) {
        const empty = { ok: false, byId: new Map() };
        const peek = peekKeyStatuses(null);
        if (peek && peek.ageMs < MYKEYS_STALE_MS) {
            return listKeyStatusesCached(null, 60_000, { staleMs: MYKEYS_STALE_MS }).catch(() => empty);
        }
        warmKeyStatuses(null);
        const own = (keys || [])
            .filter((k) => k.externalId)
            .slice(0, 25)
            .map((k) => ({ externalId: k.externalId, profileId: k.profileId ?? null }));
        if (!own.length) return empty;
        return getKeyStatusesFor(own, { concurrency: 3, budgetMs: 3500 }).catch(() => empty);
    }

    async function buildMyKeysPayload({ tgId, requestedFilter, limit = 60, includeRawKey = false }) {
        const scanLimit = Math.max(MYKEYS_SCAN_LIMIT, limit);
        const [keys, cfg] = await Promise.all([
            listIssuedKeys(tgId, scanLimit),
            getGpt2apiConfig().catch(() => ({})),
        ]);
        const statuses = await loadKeyStatusesFast(keys);
        const now = Date.now();
        const statusById = statuses?.byId instanceof Map ? statuses.byId : new Map();
        const decorated = decorateKeys(keys, { statusById, now });
        const arranged = arrangeKeys(decorated, requestedFilter, { limit });
        const quotaRefPrice = cfg.quotaRefPrice ?? 0;

        return {
            ok: true,
            filter: arranged.filter || requestedFilter,
            counts: arranged.counts,
            endpoint: cfg.endpoint || "",
            usageUrl: cfg.usageUrl || "",
            docUrl: cfg.docUrl || "",
            keys: arranged.shown.map((d) => {
                const row = d.key || d.row || {};
                const st = d.st || d.status || null;
                const life = d.life || {};
                const hasSt = Boolean(st && st.ok !== false);
                const totalTokens = (hasSt && st.quotaLimit > 0)
                    ? (toDisplayTokens(st.quotaLimit, quotaRefPrice) || row.quotaTokens || 0)
                    : (row.quotaTokens || 0);
                const usedTokens = (hasSt && st.quotaUsed > 0)
                    ? toDisplayTokens(st.quotaUsed, quotaRefPrice)
                    : 0;
                const canRenew = Boolean(row.externalId) && (!hasSt || (() => {
                    const r = renewability(st);
                    return r.canAddTokens || r.canAddDays;
                })());

                const item = {
                    id: row.id,
                    maskedKey: maskApiKey(row.key),
                    source: row.source || "PURCHASE",
                    profileId: row.profileId ?? null,
                    profileName: row.profileName || "",
                    quotaTokens: totalTokens,
                    usedTokens,
                    usedPct: life?.unlimitedQuota ? 0 : Math.min(100, Math.round(life?.usedPct || 0)),
                    unlimitedQuota: Boolean(life?.unlimitedQuota),
                    rpm: (hasSt && st.rpm > 0) ? st.rpm : (row.rpm || 0),
                    expiresAt: hasSt ? (st.expiresAt || row.expiresAt || null) : (row.expiresAt || null),
                    daysLeft: life?.daysLeft ?? null,
                    stage: life?.stage ?? 0,
                    dead: Boolean(life?.dead),
                    expired: Boolean(life?.expired),
                    exhausted: Boolean(life?.exhausted),
                    canRenew,
                    renewCount: row.renewCount || 0,
                    createdAt: row.createdAt,
                };
                if (includeRawKey) item.key = row.key;
                return item;
            }),
        };
    }

    router.get("/apikey/my-keys", tmaAuth, async (req, res) => {
        try {
            const tgId = req.tmaUser.telegramId;
            const requestedFilter = req.query.filter
                ? normalizeKeyFilter(String(req.query.filter))
                : normalizeKeyFilter(req.tmaUser.keyFilter || (req.tmaUser.hideExpiredKeys ? "active" : "all"));
            const payload = await buildMyKeysPayload({
                tgId,
                requestedFilter,
                limit: 60,
                includeRawKey: false,
            });
            res.json(payload);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    router.get("/apikey/my-keys/export", tmaAuth, async (req, res) => {
        try {
            const tgId = req.tmaUser.telegramId;
            const requestedFilter = req.query.filter
                ? normalizeKeyFilter(String(req.query.filter))
                : "all";
            const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 500));
            const payload = await buildMyKeysPayload({
                tgId,
                requestedFilter,
                limit,
                includeRawKey: true,
            });
            res.json({
                ...payload,
                total: payload.keys.length,
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    router.get("/apikey/keys/:id/reveal", tmaAuth, async (req, res) => {
        try {
            const row = await prisma.issuedApiKey.findUnique({ where: { id: String(req.params.id) } });
            if (!row || String(row.telegramId) !== String(req.tmaUser.telegramId) || row.hiddenAt) {
                return res.status(404).json({ error: "Không tìm thấy API Key." });
            }
            const cfg = await getProfileConfig(row.profileId ?? null).catch(() => ({}));
            res.json({
                ok: true,
                id: row.id,
                key: row.key,
                endpoint: cfg.endpoint || "",
                models: Array.isArray(row.models) && row.models.length ? row.models : (cfg.models || []),
                profileName: row.profileName || cfg.profileName || "",
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    router.get("/developer-api", tmaAuth, async (req, res) => {
        try {
            const host = req.get("host");
            const requestOrigin = host ? `${req.protocol}://${host}` : "";
            const payload = await resolveDeveloperApiPayload({
                user: req.tmaUser,
                requestOrigin,
                deps: {
                    getOrCreateSellerKeyFn: deps.getOrCreateSellerKeyFn,
                    getUserApiKeyFn: deps.getUserApiKeyFn,
                    resolvePublicBaseUrlFn: deps.resolvePublicBaseUrlFn,
                    getBalanceFn: deps.getBalanceFn,
                    sellerUsageSinceFn: deps.sellerUsageSinceFn,
                },
            });
            res.json(payload);
        } catch (err) {
            res.status(err?.statusCode || 500).json({ error: err?.message || "Không thể tải thông tin API kết nối." });
        }
    });

    async function computeRenewKeyQuote({ user, keyId, addM = 0, addDays = 0, wantRpm = 0 }) {
        const row = await prisma.issuedApiKey.findUnique({ where: { id: String(keyId) } }).catch(() => null);
        if (!row || String(row.telegramId) !== String(user.telegramId) || row.hiddenAt) {
            return { ok: false, status: 404, error: "Không tìm thấy API Key của bạn." };
        }
        if (!row.externalId) {
            return { ok: false, status: 400, error: "Key thế hệ cũ không hỗ trợ gia hạn tự động." };
        }
        const cfg = await getProfileConfig(row.profileId ?? null).catch(() => null);
        if (!cfg?.configured) {
            return { ok: false, status: 400, error: "Máy chủ của key này hiện chưa được cấu hình." };
        }
        const status = await getKeyStatus(row.externalId, row.profileId ?? null);
        if (!status?.ok) {
            return { ok: false, status: 502, error: "Tạm thời không đọc được trạng thái key từ máy chủ. Vui lòng thử lại sau." };
        }

        const addTokens = Math.max(0, Math.floor(Number(addM) || 0)) * 1_000_000;
        const days = Math.max(0, Math.floor(Number(addDays) || 0));
        const newRpm = Math.max(0, Math.floor(Number(wantRpm) || 0));
        const keyTokens = toDisplayTokens(status.quotaLimit, cfg.quotaRefPrice ?? 0) || row.quotaTokens;
        const curRpm = status.rpm > 0 ? status.rpm : (row.rpm || 0);
        const life = keyLifecycle(status, Date.now());

        const blocked = renewBlockReason({
            status,
            life,
            addTokens,
            days,
            newRpm,
            curRpm,
            maxRpm: MAX_KEY_RPM,
            maxTokens: cfg.maxBuyTokens,
        });
        if (blocked) {
            return {
                ok: false,
                status: 400,
                code: blocked,
                error: blocked === "expired_need_days"
                    ? "Key đã hết hạn ngày — vui lòng chọn cộng thêm Số ngày (hoặc cả Token + Ngày) để kích hoạt lại."
                    : blocked === "exhausted_need_tokens"
                        ? "Key đã cạn sạch quota — vui lòng nạp thêm Token trước."
                        : blocked === "disabled" || blocked === "locked"
                            ? "Key này đang bị khóa/vô hiệu hóa, không thể gia hạn."
                            : ` Tùy chọn gia hạn chưa hợp lệ (${blocked}).`,
            };
        }

        const can = renewability(status);
        if ((addTokens > 0 && !can.canAddTokens) || (days > 0 && !can.canAddDays)) {
            return { ok: false, status: 400, error: "Key này không hỗ trợ tùy chọn gia hạn đã chọn." };
        }

        const usedTokens = toDisplayTokens(status.quotaUsed, cfg.quotaRefPrice ?? 0);
        const remainingTokens = life.unlimitedQuota ? 0 : Math.max(0, keyTokens - usedTokens);
        const dayBasis = renewDayBasis({ life, keyTokens, remainingTokens });
        const factors = (o) => keyPriceFactors(o, cfg);

        const bd = renewPriceBreakdown({
            addTokens,
            addDays: days,
            keyTokens: dayBasis.tokens,
            usdPerMtoken: cfg.usdPerMtoken,
            rpm: curRpm,
            factors,
            knobs: cfg,
            daysLeft: remainingDaysForPricing(status, Date.now()),
            newRpm,
            remainingTokens,
        });
        bd.dayBasisRemaining = dayBasis.remaining;
        const listPriceUsd = bd.total;
        if (listPriceUsd <= 0) {
            return { ok: false, status: 400, error: "Vui lòng chọn lượng Token, Số ngày hoặc mức RPM cần nâng cấp." };
        }

        const rate = getUsdVndRate();
        let flash = {
            priceUsd: listPriceUsd,
            flashPct: 0,
            flashSaleId: null,
            flashExpiresAt: null,
            flashListUsd: listPriceUsd,
            isVip: false,
        };
        if (days > 0 && addTokens === 0 && newRpm === 0) {
            flash = await computeApikeyFlashOrVip(user, listPriceUsd, row.profileId);
        }

        const priceUsd = flash.priceUsd;
        const priceVnd = Math.round(priceUsd * rate);

        return {
            ok: true,
            row,
            cfg,
            status,
            life,
            can,
            curRpm,
            keyTokens,
            remainingTokens,
            addTokens,
            days,
            newRpm,
            breakdown: bd,
            flash,
            listPriceUsd,
            priceUsd,
            priceVnd,
            rate,
        };
    }

    router.post("/apikey/keys/:id/renew-quote", tmaAuth, async (req, res) => {
        try {
            const { addM = 0, addDays = 0, wantRpm = 0 } = req.body || {};
            const [quote, balance] = await Promise.all([
                computeRenewKeyQuote({
                    user: req.tmaUser,
                    keyId: req.params.id,
                    addM,
                    addDays,
                    wantRpm,
                }),
                getBalance(req.tmaUser.telegramId),
            ]);
            if (!quote.ok) return res.status(quote.status || 400).json(quote);

            res.json({
                ok: true,
                keyId: quote.row.id,
                maskedKey: maskApiKey(quote.row.key),
                curRpm: quote.curRpm,
                keyTokens: quote.keyTokens,
                remainingTokens: quote.remainingTokens,
                addTokens: quote.addTokens,
                addDays: quote.days,
                newRpm: quote.newRpm,
                breakdown: quote.breakdown,
                listPriceUsd: quote.listPriceUsd,
                priceUsd: quote.priceUsd,
                priceVnd: quote.priceVnd,
                usdVndRate: quote.rate,
                discountPct: quote.flash.flashPct || 0,
                discountKind: quote.flash.flashPct ? (quote.flash.isVip ? "vip" : "flash") : null,
                balanceVnd: balance,
                canPayWallet: balance >= quote.priceVnd,
                shortfallVnd: Math.max(0, quote.priceVnd - balance),
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    router.post("/apikey/keys/:id/renew-checkout", tmaAuth, requireChannelJoin, async (req, res) => {
        const tgId = req.tmaUser.telegramId;
        const lockSession = getUserApikeySession(tgId);
        if (isApikeyProcessingActive(lockSession)) {
            return res.status(409).json({
                error: "Đang xử lý yêu cầu gia hạn trước đó, vui lòng chờ giây lát.",
                code: "APIKEY_BUSY",
            });
        }
        claimApikeyProcessing(lockSession);

        try {
            const {
                addM = 0,
                addDays = 0,
                wantRpm = 0,
                paymentMethod = "wallet",
                clientRef = "",
            } = req.body || {};
            const method = String(paymentMethod || "wallet").toLowerCase();
            const cleanRef = String(clientRef || "").trim().slice(0, 100);

            if (cleanRef) {
                const dup = await prisma.order.findFirst({
                    where: { odelegramId: tgId, source: "miniapp", oderId: cleanRef },
                });
                if (dup && dup.status !== "CANCELED") {
                    return res.json({
                        ok: true,
                        duplicate: true,
                        orderId: dup.id,
                        shortId: formatOrderCode(dup.id),
                        status: dup.status,
                    });
                }
            }

            const quote = await computeRenewKeyQuote({
                user: req.tmaUser,
                keyId: req.params.id,
                addM,
                addDays,
                wantRpm,
            });
            if (!quote.ok) return res.status(quote.status || 400).json(quote);

            if (method === "wallet") {
                balanceCache.invalidate(tgId);
                invalidateWalletCache(tgId);
                const balance = await getBalance(tgId);
                if (balance < quote.priceVnd) {
                    return res.status(400).json({
                        error: `Số dư ví không đủ. Cần ${quote.priceVnd.toLocaleString("vi-VN")}đ, hiện có ${balance.toLocaleString("vi-VN")}đ.`,
                        code: "INSUFFICIENT_BALANCE",
                        requiredVnd: quote.priceVnd,
                        balanceVnd: balance,
                        shortfallVnd: quote.priceVnd - balance,
                    });
                }
            }

            const product = await getApiKeyProduct();
            if (!product) throw new Error("Không khởi tạo được sản phẩm API Key");

            const flashFields = buildApikeyFlashOrderFields(
                quote.flash,
                quote.priceUsd,
                quote.priceVnd,
                quote.rate,
            );
            const summaryParts = [
                quote.addTokens > 0 ? `+${formatTokens(quote.addTokens)}` : null,
                quote.days > 0 ? `+${quote.days} ngày` : null,
                quote.newRpm > 0 ? `RPM ${quote.newRpm}` : null,
            ].filter(Boolean).join(" · ");

            const order = await prisma.order.create({
                data: {
                    odelegramId: tgId,
                    chatId: tgId,
                    productId: product.id,
                    quantity: 1,
                    amount: quote.priceVnd,
                    discount: flashFields.flashDiscountAmount || 0,
                    finalAmount: quote.priceVnd,
                    currency: "VND",
                    status: "PENDING",
                    paymentMethod: method,
                    userId: req.tmaUser.id,
                    cryptoUsdVndRate: quote.rate,
                    displayCurrency: "USD",
                    source: "miniapp",
                    oderId: cleanRef || null,
                    ...flashFields,
                    apikeyRenewKeyId: quote.row.id,
                    apikeyAddTokens: quote.addTokens,
                    apikeyAddDays: quote.days,
                    apikeyNewRpm: quote.newRpm,
                    apikeyProfile: quote.row.profileId ?? null,
                },
            });

            if (method === "wallet") {
                const paid = await walletPurchase(
                    tgId,
                    quote.priceVnd,
                    order.id,
                    `Mini App: Gia hạn API key ${summaryParts}`,
                );
                if (!paid.success) {
                    await prisma.order.update({ where: { id: order.id }, data: { status: "CANCELED" } }).catch(() => {});
                    return res.status(400).json({ error: paid.error || "Không thể trừ số dư ví." });
                }

                await prisma.order.update({
                    where: { id: order.id },
                    data: { status: "PAID", paymentRef: paid.transaction?.id || `WALLET:${order.id}` },
                });
                order.status = "PAID";
                balanceCache.invalidate(tgId);

                const safeTg = buildCustomerTolerantTelegram(getBot()?.telegram || null, tgId);
                try {
                    await deliverOrderFn({ prisma, telegram: safeTg, order });
                } catch (delivErr) {
                    console.error(`[tma/renew] deliverOrder error ${order.id}:`, delivErr?.message);
                }

                const freshOrder = await prisma.order.findUnique({ where: { id: order.id } });
                const freshBalance = await getBalance(tgId);

                if (freshOrder?.status === "CANCELED") {
                    return res.status(502).json({
                        error: "Không thể gia hạn key lúc này. Hệ thống đã hoàn 100% tiền về Ví của bạn!",
                        refunded: true,
                        orderId: order.id,
                        newBalance: freshBalance,
                    });
                }

                let renewReceipt = null;
                try {
                    renewReceipt = freshOrder?.deliveryContent ? JSON.parse(freshOrder.deliveryContent) : null;
                } catch {}

                sendLog(
                    "ORDER",
                    `🔄 [Mini App] Gia hạn key user ${tgId}: ${summaryParts} — ${quote.priceVnd.toLocaleString("vi-VN")}đ`,
                );

                return res.json({
                    ok: true,
                    orderId: order.id,
                    shortId: formatOrderCode(order.id),
                    status: freshOrder?.status || "PAID",
                    renewReceipt,
                    newBalance: freshBalance,
                });
            }

            try {
                const payment = await buildPendingPaymentInstructions({
                    order,
                    productName: `Gia hạn Key (${summaryParts})`,
                    paymentMethod: method,
                });
                return res.json({
                    ok: true,
                    orderId: order.id,
                    shortId: formatOrderCode(order.id),
                    status: "PENDING",
                    finalAmountVnd: quote.priceVnd,
                    payment,
                });
            } catch (payErr) {
                await prisma.order.update({ where: { id: order.id }, data: { status: "CANCELED" } }).catch(() => {});
                return res.status(400).json({ error: payErr.message });
            }
        } catch (err) {
            res.status(500).json({ error: err.message });
        } finally {
            releaseApikeyProcessing(lockSession);
        }
    });

    // ─── 4. WALLET & DEPOSITS ─────────────────────────────────────────────────

    router.get("/wallet", tmaAuth, async (req, res) => {
        try {
            const tgId = req.tmaUser.telegramId;
            const limit = Math.min(50, Math.max(5, Number(req.query.limit) || 20));
            const [balance, transactions, presets, maxDeposit] = await Promise.all([
                getBalance(tgId),
                getTransactionHistory(tgId, limit),
                getDepositPresets().catch(() => [50000, 100000, 200000, 500000, 1000000]),
                getMaxDeposit().catch(() => 0),
            ]);

            res.json({
                ok: true,
                balanceVnd: balance,
                usdVndRate: getUsdVndRate(),
                presetsVnd: presets,
                minDepositVnd: 10_000,
                minDepositUsdt: Number(process.env.CRYPTO_MIN_DEPOSIT_USDT || 1),
                maxDepositVnd: maxDeposit || 0,
                transactions: (transactions || []).map((tx) => ({
                    id: tx.id,
                    type: tx.type,
                    amount: tx.amount,
                    status: tx.status,
                    description: tx.description || "",
                    createdAt: tx.createdAt,
                })),
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    router.post("/wallet/deposit", tmaAuth, requireChannelJoin, async (req, res) => {
        try {
            const tgId = req.tmaUser.telegramId;
            const method = String(req.body?.method || "vietqr").toLowerCase();
            const usdVndRate = getUsdVndRate();
            const maxDeposit = await getMaxDeposit().catch(() => 0);

            if (method === "vietqr") {
                const amountVnd = Math.round(Number(req.body?.amountVnd || 0));
                if (!Number.isFinite(amountVnd) || amountVnd < 10_000) {
                    return res.status(400).json({ error: "Số tiền nạp tối thiểu qua ngân hàng là 10.000đ." });
                }
                if (maxDeposit > 0 && amountVnd > maxDeposit) {
                    return res.status(400).json({
                        error: `Số tiền vượt hạn mức nạp tối đa (${maxDeposit.toLocaleString("vi-VN")}đ).`,
                    });
                }

                const tx = await createDeposit(tgId, amountVnd);
                const depositContent = generateDepositContent(tgId, tx.id);
                const qrUrl = generateQRUrl(amountVnd, depositContent);
                const bank = getBankConfigSync();
                const expiresAt = new Date(Date.now() + getExpireMinutes() * 60_000);
                const qrDataUrl = await generateLocalVietQrDataUrl({
                    bankCode: bank.bankCode,
                    accountNumber: bank.accountNumber,
                    amount: amountVnd,
                    content: depositContent,
                });

                return res.json({
                    ok: true,
                    depositId: tx.id,
                    status: tx.status,
                    amountVnd,
                    payment: {
                        kind: "vietqr",
                        amountVnd,
                        transferContent: depositContent,
                        qrUrl,
                        qrDataUrl,
                        bankInfo: {
                            bankName: bank.bankName,
                            bankCode: bank.bankCode,
                            accountNumber: bank.accountNumber,
                            accountName: bank.accountName,
                        },
                        expiresAt,
                    },
                });
            }

            if (method.startsWith("crypto_")) {
                const network = method.replace(/^crypto_/, "");
                if (!getEnabledCryptoNetworks().includes(network)) {
                    return res.status(400).json({ error: `Mạng ${network.toUpperCase()} hiện không khả dụng.` });
                }
                const minUsdt = Number(process.env.CRYPTO_MIN_DEPOSIT_USDT || 1);
                const amountUsdt = Number(req.body?.amountUsdt || 0);
                if (!Number.isFinite(amountUsdt) || amountUsdt < minUsdt) {
                    return res.status(400).json({ error: `Số lượng nạp tối thiểu là ${minUsdt} USDT.` });
                }
                const amountVnd = Math.round(amountUsdt * usdVndRate);
                if (maxDeposit > 0 && amountVnd > maxDeposit) {
                    return res.status(400).json({
                        error: `Vượt hạn mức nạp tối đa (${(maxDeposit / usdVndRate).toFixed(2)} USDT).`,
                    });
                }

                const tx = await createDeposit(tgId, amountVnd);
                const checkout = createCryptoDepositCheckout({
                    transactionId: tx.id,
                    amount: amountVnd,
                    amountUsd: amountUsdt,
                    network,
                    takenAmounts: await getTakenCryptoAmounts(network),
                });

                await prisma.walletTransaction.update({
                    where: { id: tx.id },
                    data: {
                        paymentRef: buildCryptoDepositRef(checkout),
                        cryptoNetwork: checkout.network,
                        cryptoAmount: checkout.amountToken,
                        cryptoAddress: checkout.address,
                        cryptoToken: checkout.token,
                        cryptoUsdVndRate: checkout.usdVndRate,
                        expiresAt: checkout.expiresAt,
                        description: `Mini App: Nạp ${amountUsdt.toFixed(2)} USDT ${checkout.networkLabel} (~${amountVnd.toLocaleString("vi-VN")}đ)`,
                    },
                });

                const qrSupported = cryptoNetworkSupportsQr(checkout.network);
                const qrDataUrl = qrSupported ? await generateTextQrDataUrl(checkout.address) : null;

                return res.json({
                    ok: true,
                    depositId: tx.id,
                    status: "PENDING",
                    amountVnd,
                    payment: {
                        kind: "crypto",
                        network: checkout.network,
                        networkLabel: checkout.networkLabel,
                        token: checkout.token,
                        amountToken: checkout.amountToken,
                        address: checkout.address,
                        qrSupported,
                        qrDataUrl,
                        expiresAt: checkout.expiresAt,
                    },
                });
            }

            if (method === "cryptopay") {
                if (!isCryptoPayConfigured()) {
                    return res.status(400).json({ error: "Cổng CryptoPay hiện chưa được cấu hình." });
                }
                const amountUsdt = Number(req.body?.amountUsdt || 0);
                if (!Number.isFinite(amountUsdt) || amountUsdt < 0.1) {
                    return res.status(400).json({ error: "Số tiền nạp tối thiểu qua CryptoPay là 0.1 USDT." });
                }
                const amountVnd = Math.round(amountUsdt * usdVndRate);
                if (maxDeposit > 0 && amountVnd > maxDeposit) {
                    return res.status(400).json({
                        error: `Vượt hạn mức nạp tối đa (${(maxDeposit / usdVndRate).toFixed(2)} USDT).`,
                    });
                }

                const tx = await createDeposit(tgId, amountVnd);
                const cfg = getCryptoPayConfig();
                const cryptoAsset = cfg.asset || "USDT";
                const expireSeconds = Math.max(60, (cfg.expireMinutes || 30) * 60);
                const me = await getBot()?.telegram?.getMe?.().catch(() => null);
                const botUrl = me?.username ? `https://t.me/${me.username}` : undefined;

                const invoice = await createCryptoPayInvoice({
                    depositId: tx.id,
                    amount: amountUsdt.toFixed(2),
                    asset: cryptoAsset,
                    description: `Nạp ví #${tx.id.slice(-8).toUpperCase()} (~${amountVnd.toLocaleString("vi-VN")}đ)`,
                    paidBtnUrl: botUrl,
                    expiresIn: expireSeconds,
                });

                const payUrl = invoice.mini_app_invoice_url || invoice.bot_invoice_url || invoice.pay_url;
                const expiresAt = new Date(Date.now() + expireSeconds * 1000);

                await prisma.walletTransaction.update({
                    where: { id: tx.id },
                    data: {
                        paymentRef: `CRYPTOPAY:INVOICE:${invoice.invoice_id}`,
                        cryptoNetwork: "cryptopay",
                        cryptoAmount: amountUsdt,
                        cryptoAddress: payUrl,
                        cryptoToken: cryptoAsset,
                        cryptoUsdVndRate: usdVndRate,
                        expiresAt,
                        description: `Mini App: Nạp ${amountUsdt.toFixed(2)} ${cryptoAsset} qua CryptoPay (~${amountVnd.toLocaleString("vi-VN")}đ)`,
                    },
                });

                return res.json({
                    ok: true,
                    depositId: tx.id,
                    status: "PENDING",
                    amountVnd,
                    payment: {
                        kind: "cryptopay",
                        asset: cryptoAsset,
                        amountToken: amountUsdt,
                        payUrl,
                        invoiceId: invoice.invoice_id,
                        expiresAt,
                    },
                });
            }

            res.status(400).json({ error: "Phương thức nạp tiền không hợp lệ." });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    router.get("/wallet/deposit/:id", tmaAuth, async (req, res) => {
        try {
            const tx = await prisma.walletTransaction.findUnique({
                where: { id: String(req.params.id) },
                include: { wallet: true },
            });
            if (!tx || String(tx.wallet?.odelegramId) !== String(req.tmaUser.telegramId)) {
                return res.status(404).json({ error: "Không tìm thấy giao dịch nạp." });
            }
            const balance = tx.status === "SUCCESS"
                ? await getBalance(req.tmaUser.telegramId)
                : undefined;

            res.json({
                ok: true,
                depositId: tx.id,
                status: tx.status,
                amountVnd: tx.amount,
                balanceVnd: balance,
                expiresAt: tx.expiresAt || null,
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    router.post("/wallet/deposit/:id/check", tmaAuth, async (req, res) => {
        try {
            const tgId = req.tmaUser.telegramId;
            const tx = await prisma.walletTransaction.findUnique({
                where: { id: String(req.params.id) },
                include: { wallet: true },
            });
            if (!tx || String(tx.wallet?.odelegramId) !== String(tgId)) {
                return res.status(404).json({ error: "Không tìm thấy giao dịch nạp." });
            }
            if (tx.status === "SUCCESS") {
                return res.json({
                    ok: true,
                    status: "SUCCESS",
                    balanceVnd: await getBalance(tgId),
                });
            }

            const deb = checkScanDebounce(`dep:${tx.id}`);
            if (!deb.ok) {
                return res.status(429).json({
                    error: `Vui lòng chờ ${deb.retryAfterSec} giây trước khi bấm kiểm tra lại.`,
                    retryAfterSec: deb.retryAfterSec,
                });
            }

            if (tx.cryptoNetwork === "cryptopay" && tx.paymentRef?.startsWith("CRYPTOPAY:INVOICE:")) {
                const invoiceId = tx.paymentRef.replace("CRYPTOPAY:INVOICE:", "");
                const list = await getCryptoPayInvoices({ invoiceIds: [invoiceId] }).catch(() => null);
                const inv = Array.isArray(list?.items) ? list.items[0] : (Array.isArray(list) ? list[0] : null);
                if (inv?.status === "paid") {
                    await processCryptoPayInvoicePaid(inv, { telegram: getBot()?.telegram || null });
                }
            } else if (tx.cryptoNetwork) {
                await confirmDepositByCryptoScan(tx.id, tgId).catch(() => null);
            } else {
                await confirmDepositByBankScan(tx.id, tgId).catch(() => null);
            }

            const fresh = await prisma.walletTransaction.findUnique({ where: { id: tx.id } });
            const balanceVnd = await getBalance(tgId);
            res.json({
                ok: true,
                status: fresh?.status || tx.status,
                confirmed: fresh?.status === "SUCCESS",
                balanceVnd,
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ─── 5. ORDERS LIST, DETAIL, CHECK & CANCEL ───────────────────────────────

    router.get("/orders", tmaAuth, async (req, res) => {
        try {
            const tgId = req.tmaUser.telegramId;
            const statusFilter = String(req.query.status || "ALL").toUpperCase();
            const limit = Math.min(50, Math.max(5, Number(req.query.limit) || 25));

            const where = { odelegramId: tgId };
            if (["PENDING", "PAID", "DELIVERED", "CANCELED"].includes(statusFilter)) {
                where.status = statusFilter;
            }

            const orders = await prisma.order.findMany({
                where,
                take: limit,
                orderBy: { createdAt: "desc" },
                include: { product: { select: { name: true, code: true, deliveryMode: true, icon: true } } },
            });

            res.json({
                ok: true,
                orders: orders.map((o) => {
                    const isRenew = Boolean(o.apikeyRenewKeyId);
                    const isApikey = o.product?.code === "__API_KEY__" || o.product?.deliveryMode === "API_KEY";
                    const title = isRenew
                        ? "Gia hạn API Key"
                        : isApikey
                            ? `API Key ${o.apikeyTokens ? formatTokens(o.apikeyTokens) : ""}`.trim()
                            : (o.product?.name || "Sản phẩm");

                    return {
                        id: o.id,
                        shortId: formatOrderCode(o.id),
                        title,
                        productId: o.productId,
                        deliveryMode: isRenew ? "API_KEY_RENEW" : (o.product?.deliveryMode || "TEXT"),
                        quantity: o.quantity,
                        amountVnd: o.finalAmount,
                        displayFinalUsd: o.displayFinalUsd ?? null,
                        status: o.status,
                        paymentMethod: o.paymentMethod || "",
                        hasDeliveryContent: Boolean(o.deliveryContent),
                        expiresAt: o.expiresAt || null,
                        createdAt: o.createdAt,
                    };
                }),
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    router.get("/orders/:id", tmaAuth, async (req, res) => {
        try {
            const tgId = req.tmaUser.telegramId;
            const order = await prisma.order.findUnique({
                where: { id: String(req.params.id) },
                include: { product: { select: { name: true, code: true, deliveryMode: true, description: true } } },
            });
            if (!order || String(order.odelegramId) !== String(tgId)) {
                return res.status(404).json({ error: "Không tìm thấy đơn hàng." });
            }

            let payment = null;
            if (order.status === "PENDING") {
                const method = String(order.paymentMethod || "").toLowerCase();
                if (method === "vietqr" && order.paymentRef) {
                    const bank = getBankConfigSync();
                    const qrUrl = generateQRUrl(order.finalAmount, order.paymentRef);
                    const qrDataUrl = await generateLocalVietQrDataUrl({
                        bankCode: bank.bankCode,
                        accountNumber: bank.accountNumber,
                        amount: order.finalAmount,
                        content: order.paymentRef,
                    });
                    payment = {
                        kind: "vietqr",
                        amountVnd: order.finalAmount,
                        transferContent: order.paymentRef,
                        qrUrl,
                        qrDataUrl,
                        bankInfo: {
                            bankName: bank.bankName,
                            bankCode: bank.bankCode,
                            accountNumber: bank.accountNumber,
                            accountName: bank.accountName,
                        },
                        expiresAt: order.expiresAt || new Date(new Date(order.createdAt).getTime() + getExpireMinutes() * 60_000),
                    };
                } else if (isCryptoPaymentMethod(method) && order.cryptoAddress && order.cryptoAmount) {
                    const restored = restoreCryptoCheckout(order);
                    const qrSupported = cryptoNetworkSupportsQr(order.cryptoNetwork);
                    const qrDataUrl = qrSupported ? await generateTextQrDataUrl(order.cryptoAddress) : null;
                    payment = {
                        kind: "crypto",
                        network: order.cryptoNetwork,
                        networkLabel: restored?.networkLabel || cryptoNetworkLabel(order.cryptoNetwork),
                        token: order.cryptoToken || "USDT",
                        amountToken: order.cryptoAmount,
                        address: order.cryptoAddress,
                        qrSupported,
                        qrDataUrl,
                        expiresAt: order.expiresAt,
                    };
                } else if (method === "cryptopay" && order.cryptoAddress) {
                    payment = {
                        kind: "cryptopay",
                        asset: order.cryptoToken || "USDT",
                        amountToken: order.cryptoAmount,
                        payUrl: order.cryptoAddress,
                        expiresAt: order.expiresAt,
                    };
                }
            }

            const isRenew = Boolean(order.apikeyRenewKeyId);
            const isApikey = order.product?.code === "__API_KEY__" || order.product?.deliveryMode === "API_KEY";
            const title = isRenew
                ? "Gia hạn API Key"
                : isApikey
                    ? `API Key ${order.apikeyTokens ? formatTokens(order.apikeyTokens) : ""}`.trim()
                    : (order.product?.name || "Sản phẩm");

            res.json({
                ok: true,
                order: {
                    id: order.id,
                    shortId: formatOrderCode(order.id),
                    title,
                    productId: order.productId,
                    deliveryMode: isRenew ? "API_KEY_RENEW" : (order.product?.deliveryMode || "TEXT"),
                    quantity: order.quantity,
                    amountVnd: order.finalAmount,
                    discountVnd: order.discount || 0,
                    status: order.status,
                    paymentMethod: order.paymentMethod || "",
                    deliveryContent: order.status === "DELIVERED" ? (order.deliveryContent || null) : null,
                    createdAt: order.createdAt,
                    expiresAt: order.expiresAt || null,
                    payment,
                },
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    router.post("/orders/:id/check", tmaAuth, async (req, res) => {
        try {
            const tgId = req.tmaUser.telegramId;
            const order = await prisma.order.findUnique({ where: { id: String(req.params.id) } });
            if (!order || String(order.odelegramId) !== String(tgId)) {
                return res.status(404).json({ error: "Không tìm thấy đơn hàng." });
            }
            if (order.status === "DELIVERED") {
                return res.json({
                    ok: true,
                    status: "DELIVERED",
                    delivered: true,
                    deliveryContent: order.deliveryContent || null,
                });
            }
            if (order.status === "CANCELED") {
                return res.json({ ok: true, status: "CANCELED", delivered: false });
            }

            const deb = checkScanDebounce(`ord:${order.id}`);
            if (!deb.ok) {
                return res.status(429).json({
                    error: `Vui lòng chờ ${deb.retryAfterSec} giây trước khi kiểm tra lại.`,
                    retryAfterSec: deb.retryAfterSec,
                });
            }

            const method = String(order.paymentMethod || "").toLowerCase();
            const bot = getBot();
            if (method === "cryptopay" && order.paymentRef?.startsWith("CRYPTOPAY:INVOICE:")) {
                const invoiceId = order.paymentRef.replace("CRYPTOPAY:INVOICE:", "");
                const list = await getCryptoPayInvoices({ invoiceIds: [invoiceId] }).catch(() => null);
                const inv = Array.isArray(list?.items) ? list.items[0] : (Array.isArray(list) ? list[0] : null);
                if (inv?.status === "paid") {
                    await processCryptoPayInvoicePaid(inv, { telegram: bot?.telegram || null });
                }
            } else if (isCryptoPaymentMethod(method)) {
                const scan = await confirmOrderByCryptoScan(order.id, tgId).catch(() => null);
                if (scan?.confirmed && scan.order?.status === "PAID") {
                    const safeTg = buildCustomerTolerantTelegram(bot?.telegram || null, tgId);
                    await deliverOrderFn({ prisma, telegram: safeTg, order: scan.order }).catch(() => {});
                }
            } else if (method === "vietqr") {
                const scan = await confirmOrderByBankScan(order.id, tgId).catch(() => null);
                if (scan?.confirmed && scan.order?.status === "PAID") {
                    const safeTg = buildCustomerTolerantTelegram(bot?.telegram || null, tgId);
                    await deliverOrderFn({ prisma, telegram: safeTg, order: scan.order }).catch(() => {});
                }
            }

            const fresh = await prisma.order.findUnique({ where: { id: order.id } });
            res.json({
                ok: true,
                status: fresh?.status || order.status,
                delivered: fresh?.status === "DELIVERED",
                deliveryContent: fresh?.status === "DELIVERED" ? (fresh.deliveryContent || null) : null,
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    router.post("/orders/:id/cancel", tmaAuth, async (req, res) => {
        try {
            const tgId = req.tmaUser.telegramId;
            const order = await prisma.order.findUnique({ where: { id: String(req.params.id) } });
            if (!order || String(order.odelegramId) !== String(tgId)) {
                return res.status(404).json({ error: "Không tìm thấy đơn hàng." });
            }
            if (order.status !== "PENDING") {
                return res.status(400).json({
                    error: order.status === "DELIVERED"
                        ? "Đơn hàng đã giao thành công, không thể hủy."
                        : order.status === "PAID"
                            ? "Đơn hàng đã nhận thanh toán và đang giao, không thể hủy."
                            : "Đơn hàng đã được hủy trước đó.",
                });
            }

            const claimed = await prisma.order.updateMany({
                where: { id: order.id, status: "PENDING" },
                data: { status: "CANCELED", canceledAt: new Date(), cancelReason: "user_canceled_miniapp" },
            });
            if (!claimed.count) {
                const current = await prisma.order.findUnique({ where: { id: order.id } });
                return res.status(409).json({
                    error: "Trạng thái đơn hàng vừa thay đổi, không thể hủy.",
                    status: current?.status,
                });
            }

            if (order.couponId) {
                await releaseOrderCoupon(order.id).catch(() => {});
            }
            if (isPaidUpfrontMethod(order.paymentMethod) && order.walletSettledAt) {
                await walletRefund(tgId, order.finalAmount, order.id, "Hoàn tiền đơn hủy trên Mini App").catch(() => {});
            }

            res.json({ ok: true, status: "CANCELED" });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    router.post("/orders/:id/resend-bot", tmaAuth, async (req, res) => {
        try {
            const tgId = req.tmaUser.telegramId;
            const bot = getBot();
            if (!bot?.telegram) {
                return res.status(503).json({ error: "Bot Telegram hiện chưa sẵn sàng." });
            }
            const order = await prisma.order.findUnique({
                where: { id: String(req.params.id) },
                include: { product: true },
            });
            if (!order || String(order.odelegramId) !== String(tgId)) {
                return res.status(404).json({ error: "Không tìm thấy đơn hàng." });
            }
            if (order.status !== "DELIVERED") {
                return res.status(400).json({ error: "Đơn hàng chưa ở trạng thái đã giao." });
            }

            if (order.deliveryRef === "API_KEY" && order.deliveryContent) {
                const d = JSON.parse(order.deliveryContent);
                await bot.telegram.sendMessage(tgId, apiKeyMessage({
                    key: d.key,
                    quotaTokens: d.quotaTokens,
                    rpm: d.rpm,
                    tpm: d.tpm,
                    models: d.models || [],
                    endpoint: d.endpoint || "",
                    usageUrl: d.usageUrl || "",
                    mykeyCommand: "/mykey",
                    kind: "buy",
                    expiresAt: d.expiresAt,
                    lang: req.tmaUser.language || "vi",
                    icon: iconOf,
                }), { parse_mode: "HTML" });
            } else if (order.deliveryContent) {
                await bot.telegram.sendMessage(
                    tgId,
                    `📦 <b>Nội dung đơn #${escapeHtml(formatOrderCode(order.id))}</b>\n━━━━━━━━━━━━━━━━\n<pre>${escapeHtml(String(order.deliveryContent).slice(0, 3600))}</pre>`,
                    { parse_mode: "HTML" },
                );
            } else {
                return res.status(400).json({ error: "Đơn hàng không có nội dung văn bản để gửi lại." });
            }

            res.json({ ok: true, sent: true });
        } catch (err) {
            const code = Number(err?.code || err?.response?.error_code || 0);
            if (code === 403 || code === 400) {
                return res.status(400).json({
                    error: "Bot chưa thể nhắn tin cho bạn. Hãy mở chat với Bot và bấm /start trước nhé!",
                    code: "BOT_NOT_STARTED",
                });
            }
            res.status(500).json({ error: err.message });
        }
    });

    // ─── 6. GIFTCODE, VIP & REFERRAL V2 ───────────────────────────────────────

    router.post("/giftcode/redeem", tmaAuth, requireChannelJoin, async (req, res) => {
        try {
            const tgId = req.tmaUser.telegramId;
            const rawCode = String(req.body?.code || "").trim();
            if (!rawCode) {
                return res.status(400).json({ error: "Vui lòng nhập mã Giftcode." });
            }

            const out = await redeemGiftCode(tgId, rawCode);
            if (!out.success) {
                const msgMap = {
                    INVALID: "Mã Giftcode không tồn tại hoặc sai định dạng.",
                    INACTIVE: "Mã Giftcode này đang tạm khóa.",
                    EXPIRED: "Mã Giftcode này đã hết hạn.",
                    USED_UP: "Mã Giftcode này đã hết lượt sử dụng.",
                    ALREADY_USED: "Bạn đã sử dụng mã Giftcode này rồi.",
                    VIP_REQUIRED: `Mã Giftcode này yêu cầu hạng VIP ${out.vipLevel || 1} trở lên.`,
                    KEY_FAILED: "Máy chủ AI đang bận, mã của bạn CHƯA bị trừ lượt — vui lòng thử lại sau ít phút!",
                    CREDIT_FAILED: "Không thể cộng ví lúc này, vui lòng thử lại.",
                };
                return res.status(400).json({
                    ok: false,
                    code: out.error,
                    error: msgMap[out.error] || "Không thể đổi Giftcode lúc này.",
                });
            }

            const bot = getBot();
            if (bot?.telegram) {
                broadcastGiftRedeem({ telegram: bot.telegram }, {
                    buyerName: req.tmaUser.username || req.tmaUser.firstName || "",
                    buyerTelegramId: tgId,
                    rewardType: out.rewardType,
                    amount: out.amount,
                    quotaTokens: out.quotaTokens,
                }).catch(() => {});

                if (out.rewardType === GiftRewardType.APIKEY && out.key) {
                    bot.telegram.sendMessage(tgId, apiKeyMessage({
                        key: out.key,
                        quotaTokens: out.quotaTokens,
                        rpm: out.rpm,
                        models: out.models || [],
                        endpoint: out.endpoint || "",
                        usageUrl: out.usageUrl || "",
                        mykeyCommand: "/mykey",
                        kind: "gift",
                        expiresAt: out.expiresAt,
                        lang: req.tmaUser.language || "vi",
                        icon: iconOf,
                    }), { parse_mode: "HTML" }).catch(() => {});
                }
            }

            res.json({
                ok: true,
                rewardType: out.rewardType,
                code: out.code,
                amountVnd: out.amount || 0,
                newBalance: out.newBalance ?? await getBalance(tgId),
                key: out.key || null,
                quotaTokens: out.quotaTokens || 0,
                rpm: out.rpm || 0,
                expiresAt: out.expiresAt || null,
                note: out.note || null,
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    router.get("/vip", tmaAuth, async (req, res) => {
        try {
            const [levels, vipInfo] = await Promise.all([
                getVipLevels(),
                getUserVipInfo(req.tmaUser.id),
            ]);
            res.json({
                ok: true,
                currentLevel: vipInfo?.currentLevel?.level ?? req.tmaUser.vipLevel ?? 0,
                currentName: vipInfo?.currentLevel?.name || "Thường",
                discountPercent: vipInfo?.currentLevel?.discountPercent || 0,
                totalSpent: vipInfo?.user?.totalSpent ?? req.tmaUser.totalSpent ?? 0,
                progress: vipInfo?.progress ?? 100,
                remaining: vipInfo?.remaining ?? 0,
                nextLevel: vipInfo?.nextLevel || null,
                levels: (levels || []).map((l) => ({
                    level: l.level,
                    name: l.name,
                    minSpent: l.minSpent,
                    discountPercent: l.discountPercent,
                    benefits: l.benefits || "",
                })),
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    router.get("/referral", tmaAuth, async (req, res) => {
        try {
            const user = req.tmaUser;
            const bot = getBot();
            const [me, cfg, stats, history, dailyTop, totalLb, topupKeys] = await Promise.all([
                bot?.telegram?.getMe?.().catch(() => null),
                getReferralConfig(),
                getReferralStats(user.id, user),
                getUserReferralHistory(user.telegramId, 15).catch(() => []),
                getDailyReferralLeaderboard({ limit: 10 }).catch(() => ({ rows: [] })),
                getReferralLeaderboard({ limit: 10 }).catch(() => ({ rows: [] })),
                listEligibleTopupKeys(user.telegramId, { limit: 10 }).catch(() => []),
            ]);

            const botUsername = process.env.TELEGRAM_BOT_USERNAME || me?.username || "";
            const shortName = String(process.env.MINI_APP_SHORT_NAME || "").trim();
            const botInviteLink = botUsername
                ? getReferralLink(botUsername, user.telegramId || user.referralCode)
                : "";
            const miniAppInviteLink = (botUsername && shortName)
                ? `https://t.me/${botUsername}/${shortName}?startapp=ref${encodeURIComponent(user.telegramId || user.referralCode)}`
                : "";

            let bonusKeyData = null;
            if (stats?.bonusKey) {
                bonusKeyData = {
                    id: stats.bonusKey.id,
                    key: stats.bonusKey.key,
                    maskedKey: maskApiKey(stats.bonusKey.key),
                    quotaTokens: stats.bonusKey.quotaTokens,
                    rpm: stats.bonusKey.rpm,
                    expiresAt: stats.bonusKey.expiresAt,
                };
            }

            const friendTokensM = Math.round((Number(cfg?.inviteTokenAmount ?? cfg?.tokens) || 0) / 1_000_000);
            const referrerMinM = Math.round((Number(cfg?.inviteReferrerMinTokens) || 2_000_000) / 1_000_000);
            const referrerMaxM = Math.round((Number(cfg?.inviteReferrerMaxTokens) || 7_000_000) / 1_000_000);
            const tokPerPointM = Math.round((Number(cfg?.tokenPerPoint) || 10_000_000) / 1_000_000);
            const maxBatchM = Math.round((Number(cfg?.tokenMaxPerUser) || 0) / 1_000_000);

            res.json({
                ok: true,
                botInviteLink,
                miniAppInviteLink,
                referralCode: user.referralCode,
                points: stats?.referralPoints ?? user.referralPoints ?? 0,
                welcomeCode: (!user.refWelcomeRedeemedAt && user.refWelcomeCode) ? user.refWelcomeCode : null,
                welcomeRedeemed: Boolean(user.refWelcomeRedeemedAt),
                bonusKey: bonusKeyData,
                stats,
                config: {
                    enabled: Boolean(cfg?.enabled),
                    rewardTokensM: friendTokensM,
                    rewardDays: Number(cfg?.inviteTokenDays ?? cfg?.days) || 1,
                    referrerMinM,
                    referrerMaxM,
                    referrerKeyDays: Number(cfg?.inviteReferrerKeyDays) || 30,
                    milestoneEnabled: cfg?.milestoneEnabled !== false,
                    milestone5M: Math.round((Number(cfg?.milestone5Tokens) || 15_000_000) / 1_000_000),
                    milestone10M: Math.round((Number(cfg?.milestone10Tokens) || 25_000_000) / 1_000_000),
                    milestone20M: Math.round((Number(cfg?.milestone20Tokens) || 50_000_000) / 1_000_000),
                    dailyTopEnabled: cfg?.dailyTopEnabled !== false,
                    dailyTop1M: Math.round((Number(cfg?.dailyTop1Tokens) || 50_000_000) / 1_000_000),
                    dailyTop2M: Math.round((Number(cfg?.dailyTop2Tokens) || 30_000_000) / 1_000_000),
                    dailyTop3M: Math.round((Number(cfg?.dailyTop3Tokens) || 15_000_000) / 1_000_000),
                    pointJoinChannel: Number(cfg?.pointJoinChannel) || 0,
                    pointPurchase: Number(cfg?.pointPurchase) || 0,
                    buyerTarget: Number(cfg?.buyerTarget) || 0,
                    personalVoucherPercent: Number(cfg?.personalVoucherPercent) || 0,
                    tokensPerPointM: tokPerPointM,
                    maxBatchM,
                    tokenNewKeyDays: Number(cfg?.tokenNewKeyDays) || 3,
                    minRedeemPoints: 1,
                    channelUrl: cfg?.channelUrl || "",
                },
                eligibleTopupKeys: (topupKeys || []).map((k) => ({
                    id: k.id,
                    maskedKey: maskApiKey(k.key),
                    quotaTokens: k.quotaTokens,
                    expiresAt: k.expiresAt,
                })),
                dailyLeaderboard: (dailyTop?.rows || []).slice(0, 10),
                totalLeaderboard: (totalLb?.rows || []).slice(0, 10),
                history: history || [],
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    router.post("/referral/redeem-welcome", tmaAuth, requireChannelJoin, async (req, res) => {
        try {
            const rawCode = String(req.body?.code || req.tmaUser.refWelcomeCode || "").trim();
            if (!rawCode) {
                return res.status(400).json({ error: "Vui lòng nhập mã quà chào mừng (WEL...)." });
            }
            const out = await redeemWelcomeCode(req.tmaUser.telegramId, rawCode, { bypassJoinCheck: true });
            if (!out?.ok) {
                return res.status(400).json({
                    ok: false,
                    code: out?.error || "REDEEM_FAILED",
                    error: out?.message || "Mã quà chào mừng không hợp lệ hoặc đã được sử dụng.",
                });
            }
            const bot = getBot();
            if (bot?.telegram && out.keyData) {
                sendGrantedKeyOrTopupDm(bot.telegram, out.keyData, {
                    header: `🌟 <b>[QUÀ CHÀO MỪNG BẠN MỚI · ${escapeHtml(rawCode.toUpperCase())}]</b>`,
                    icon: iconOf,
                }).catch(() => {});
            }
            res.json({ ok: true, ...out });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    router.post("/referral/redeem-points", tmaAuth, requireChannelJoin, async (req, res) => {
        try {
            const points = Math.floor(Number(req.body?.points || 0));
            const mode = String(req.body?.mode || "newkey").toLowerCase();
            if (points <= 0) {
                return res.status(400).json({ error: "Số điểm cần đổi phải lớn hơn 0." });
            }

            let out;
            if (mode === "topup") {
                const issuedKeyId = req.body?.issuedKeyId ? String(req.body.issuedKeyId) : null;
                const rawSkKey = (req.body?.rawSkKey || req.body?.rawKey)
                    ? String(req.body.rawSkKey || req.body.rawKey).trim()
                    : null;
                out = await redeemPointsToTopup(req.tmaUser.telegramId, points, {
                    issuedKeyId,
                    rawSkKey,
                });
            } else {
                out = await redeemPointsToNewKey(req.tmaUser.telegramId, points);
            }

            if (!out?.ok) {
                return res.status(400).json({
                    ok: false,
                    code: out?.error || "REDEEM_FAILED",
                    error: out?.message || "Không thể đổi điểm lúc này, vui lòng kiểm tra điều kiện đổi.",
                });
            }

            const bot = getBot();
            if (bot?.telegram && out.keyData) {
                sendGrantedKeyOrTopupDm(bot.telegram, out.keyData, {
                    header: `💎 <b>[ĐỔI ĐIỂM GIỚI THIỆU THÀNH CÔNG]</b>`,
                    icon: iconOf,
                }).catch(() => {});
            }

            res.json({ ok: true, ...out });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    return router;
}

const tmaApiRouter = createTmaApiRouter();
export default tmaApiRouter;
