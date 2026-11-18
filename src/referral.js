import { prisma } from "./db.js";
import { userCache, balanceCache } from "./lib/cache.js";
import { invalidateWalletCache } from "./wallet.js";
import {
    createApiKey,
    renewApiKey,
    getKeyStatus,
    getConfig as getGpt2apiConfig,
    getProfileConfig,
    getSourceProfileId,
    invalidateKeyStatusCache,
    isSafeApiKeyCreateFailure,
} from "./gpt2api.js";
import { KEY_SOURCES } from "./apikey-profiles.js";
import { saveIssuedKey, KeySource } from "./apikey-store.js";
import { keyLifecycle, toDisplayTokens } from "./apikey-renew.js";
import { isDuplicateKeyError } from "./lib/duplicate-key.js";
import { getStockCount } from "./inventory.js";
import {
    REFERRER_KEY_DAYS_CAP,
    GW_RETRY_MAX,
    CLASSIC_REDEEM_COOLDOWN_MS,
    vnDayKey,
    vnDayStartUtc,
    isSameVnDay,
    rollReferrerInviteTokens,
    rollWelcomeTokens,
    estimateTelegramAgeDays,
    evaluateAgeGate,
    isLateClaim,
    isBrandNewForInvite,
    isTooNewForRedeem,
    dueMilestones,
    nextMilestoneProgress,
    rankDailyTopReferrers,
    computeGatewayRetryDelayMs,
    parseReferralStartParam,
    evaluateClassicRedeemCooldown,
} from "./referral-math.js";
import crypto from "crypto";

/**
 * Referral Module v2 — Hệ thống Giới thiệu & Thưởng API Key / Token toàn diện:
 *   1. Tự động tặng token 2 phía:
 *        - Người được mời: Key mới riêng (mặc định 20M token / 1 ngày)
 *        - Người mời: Quay 2M–7M token (có Lucky Protect sau 3 lượt < 6M) cộng dồn
 *          vào 1 Referral Key 30 ngày duy nhất (`referralBonusKeyId`)
 *   2. Thưởng Mốc (5 / 10 / 20 người → +15M / +25M / +50M), Đua Top 1–2–3 ngày
 *      (50M / 30M / 15M lúc 00:05 VN) & Cảnh báo hết hạn Referral Key (3d / 1d)
 *   3. Mã quà chào mừng `WELxxxxxxxx` (random 5M–10M token / 3 ngày) cho bạn mới
 *   4. Tích điểm (`referralPoints`: +1 join kênh cho cả 2 bên, +3 đơn mua đầu tiên,
 *      mốc 3 người mua tặng coupon cá nhân 49%) & Đổi điểm lấy Token API (1đ = 10M,
 *      nạp vào key sẵn có hoặc tạo key mới, trần 100M/đợt, 1 lần/ngày, chặn clone)
 *   5. Lọc tuổi tài khoản Telegram bằng Peer Envelope (7 ngày, miễn TG Premium)
 */

export const REFERRAL_SETTING_KEYS = [
    // Tương thích cũ
    "REFERRAL_REWARD_TOKENS_M",
    "REFERRAL_REWARD_DAYS",
    "REFERRAL_REWARD_RPM",
    "REFERRAL_REWARD_SINCE",
    "REFERRAL_COMMISSION",
    // Công tắc tổng & cổng kênh / tuổi Telegram
    "referralEnabled",
    "referralChannelId",
    "referralChannelUrl",
    "referralAgeFilterEnabled",
    "referralMinTgAgeDays",
    // Điểm giới thiệu & mốc người mua
    "referralPointStartBot",
    "referralPointJoinChannel",
    "referralPointPurchase",
    "referralBuyerTarget",
    "referralPersonalVoucherPercent",
    "referralExtraWarrantyHours",
    // Nhánh 1: Tự động cấp API key / token 2 phía
    "referralInviteTokenEnabled",
    "referralInviteTokenAmount",
    "referralInviteTokenDays",
    "referralInviteReferrerMinTokens",
    "referralInviteReferrerMaxTokens",
    "referralInviteReferrerKeyDays",
    "referralInviteTokenMaxPerReferrer",
    "referralInviteTokenMaxPairsPerDay",
    "referralLuckyProtectEnabled",
    "referralLuckyMinTokens",
    // Nhánh 2: Mốc mời, Cảnh báo hết hạn & Đua Top ngày
    "referralMilestoneEnabled",
    "referralMilestone5Tokens",
    "referralMilestone10Tokens",
    "referralMilestone20Tokens",
    "referralExpiryWarnEnabled",
    "referralDailyTopEnabled",
    "referralDailyTop1Tokens",
    "referralDailyTop2Tokens",
    "referralDailyTop3Tokens",
    "referralDailyTopLastPaidDate",
    // Nhánh 3: Mã quà chào mừng WEL...
    "referralWelcomeKeyEnabled",
    "referralWelcomeTokenMinM",
    "referralWelcomeTokenMaxM",
    "referralWelcomeMaxPerDay",
    // Nhánh 4: Đổi điểm lấy Token API & 4 Tier Account Classic
    "referralRedeemEnabled",
    "referralTokenRedeemEnabled",
    "referralTokenPerPoint",
    "referralTokenMaxPerUser",
    "referralTokenNewKeyRpm",
    "referralTokenNewKeyDays",
    "referralTokenRedeemResetAt",
    "tokenRedeemBroadcastEnabled",
    "tokenRedeemBroadcastChance",
    "tokenRedeemBroadcastCooldownMin",
    "tokenRedeemBroadcastWindowMin",
    "tokenRedeemBroadcastWindowMax",
    "referralRedeemBasicSlug",
    "referralRedeemBh3dSlug",
    "referralRedeemBh7dSlug",
    "referralRedeemGptSlug",
    "referralRedeemBasicPoints",
    "referralRedeemBh3dPoints",
    "referralRedeemBh7dPoints",
    "referralRedeemGptPoints",
];

export const CLASSIC_REDEEM_TIER_DEFS = Object.freeze([
    { key: "basic", slugSetting: "referralRedeemBasicSlug", pointsSetting: "referralRedeemBasicPoints", defaultPoints: 1, label: "Tài khoản Basic", icon: "🎁" },
    { key: "bh3d", slugSetting: "referralRedeemBh3dSlug", pointsSetting: "referralRedeemBh3dPoints", defaultPoints: 2, label: "Tài khoản BH 3 ngày", icon: "🛡️" },
    { key: "bh7d", slugSetting: "referralRedeemBh7dSlug", pointsSetting: "referralRedeemBh7dPoints", defaultPoints: 3, label: "Tài khoản BH 7 ngày", icon: "💎" },
    { key: "gpt", slugSetting: "referralRedeemGptSlug", pointsSetting: "referralRedeemGptPoints", defaultPoints: 5, label: "Tài khoản GPT 7 ngày", icon: "🤖" },
]);

// Lịch sử phát social-proof broadcast trong RAM để kiểm soát cooldown & rolling window
let _tokenBroadcastTimestamps = [];

export function resetTokenBroadcastState() {
    _tokenBroadcastTimestamps = [];
}

export function shouldEmitTokenRedeemBroadcast(cfg, { now = Date.now(), rng = Math.random } = {}) {
    if (!cfg?.tokenRedeemBroadcastEnabled) return false;
    const chance = Math.min(100, Math.max(0, Number(cfg.tokenRedeemBroadcastChance ?? 100)));
    if (chance <= 0) return false;

    const cooldownMs = Math.max(0, Number(cfg.tokenRedeemBroadcastCooldownMin ?? 0)) * 60_000;
    const windowMs = Math.max(1, Number(cfg.tokenRedeemBroadcastWindowMin ?? 30)) * 60_000;
    const windowMax = Math.max(0, Math.floor(Number(cfg.tokenRedeemBroadcastWindowMax ?? 5)));

    _tokenBroadcastTimestamps = _tokenBroadcastTimestamps.filter((ts) => now - ts < windowMs);
    if (cooldownMs > 0 && _tokenBroadcastTimestamps.length > 0) {
        const lastTs = _tokenBroadcastTimestamps[_tokenBroadcastTimestamps.length - 1];
        if (now - lastTs < cooldownMs) return false;
    }
    if (windowMax > 0 && _tokenBroadcastTimestamps.length >= windowMax) return false;
    if (chance < 100 && (Number(rng()) || 0) * 100 >= chance) return false;

    _tokenBroadcastTimestamps.push(now);
    return true;
}

const CFG_TTL = 30_000;
let _cfgRaw = null;
let _cfgTs = 0;

// Cache danh sách peer (telegramId số + createdAtMs) 5 phút cho Peer Envelope Age Gate
const PEER_CACHE_TTL = 5 * 60_000;
let _peerCache = null;
let _peerCacheTs = 0;

// Khóa tuần tự trong tiến trình theo key (chống 2 request của cùng referrer tạo 2 Referral Key)
const _processLocks = new Map();
async function withProcessLock(lockName, fn) {
    const prev = _processLocks.get(lockName) || Promise.resolve();
    let release;
    const next = new Promise((resolve) => { release = resolve; });
    const chain = prev.then(() => next, () => next);
    _processLocks.set(lockName, chain);
    try {
        await prev.catch(() => {});
        return await fn();
    } finally {
        release();
        if (_processLocks.get(lockName) === chain) {
            _processLocks.delete(lockName);
        }
    }
}

export function invalidateReferralConfig() {
    _cfgRaw = null;
    _cfgTs = 0;
}

export function invalidatePeerAgeCache() {
    _peerCache = null;
    _peerCacheTs = 0;
}

async function loadReferralSettings() {
    if (_cfgRaw && Date.now() - _cfgTs < CFG_TTL) return _cfgRaw;
    let map = {};
    try {
        const rows = await prisma.setting.findMany({ where: { key: { in: REFERRAL_SETTING_KEYS } } });
        map = Object.fromEntries((rows || []).map((r) => [r.key, r.value]));
    } catch (err) {
        console.error("[referral] loadReferralSettings thất bại:", err.message);
        map = _cfgRaw || {};
    }
    _cfgRaw = map;
    _cfgTs = Date.now();
    return _cfgRaw;
}

function intOr(value, fallback, min = 0) {
    if (value === undefined || value === null || String(value).trim() === "") return fallback;
    const n = Math.floor(Number(value));
    return Number.isFinite(n) && n >= min ? n : fallback;
}

function boolOr(value, fallback = true) {
    if (value === undefined || value === null || String(value).trim() === "") return fallback;
    const s = String(value).trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(s)) return true;
    if (["false", "0", "no", "off"].includes(s)) return false;
    return fallback;
}

function parseSince(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return null;
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
}

/** Cấu hình HIỆU LỰC đầy đủ (DB Setting > ENV > mặc định theo tài liệu live). */
export async function getReferralConfig() {
    const m = await loadReferralSettings();

    const referralEnabled = boolOr(m.referralEnabled, true);
    const legacyTokensM = m.REFERRAL_REWARD_TOKENS_M ?? process.env.REFERRAL_REWARD_TOKENS_M;
    const legacyDays = m.REFERRAL_REWARD_DAYS ?? process.env.REFERRAL_REWARD_DAYS;
    const legacyRpm = m.REFERRAL_REWARD_RPM ?? process.env.REFERRAL_REWARD_RPM;

    // Nếu admin chỉnh referralInviteTokenAmount (đơn vị token) thì ưu tiên; nếu chỉ có REFERRAL_REWARD_TOKENS_M (triệu) thì quy đổi
    let inviteTokenAmount;
    if (m.referralInviteTokenAmount !== undefined && String(m.referralInviteTokenAmount).trim() !== "") {
        inviteTokenAmount = intOr(m.referralInviteTokenAmount, 20_000_000, 0);
    } else if (legacyTokensM !== undefined && String(legacyTokensM).trim() !== "") {
        inviteTokenAmount = intOr(legacyTokensM, 20, 0) * 1_000_000;
    } else {
        inviteTokenAmount = 20_000_000;
    }

    const tokensM = Math.round(inviteTokenAmount / 1_000_000);
    const inviteTokenDays = m.referralInviteTokenDays !== undefined && String(m.referralInviteTokenDays).trim() !== ""
        ? intOr(m.referralInviteTokenDays, 1, 0)
        : intOr(legacyDays, 1, 0);

    const tokenNewKeyRpm = m.referralTokenNewKeyRpm !== undefined && String(m.referralTokenNewKeyRpm).trim() !== ""
        ? intOr(m.referralTokenNewKeyRpm, 100, 0)
        : intOr(legacyRpm, 100, 0);

    const inviteTokenEnabled = boolOr(m.referralInviteTokenEnabled, true) && inviteTokenAmount > 0;

    const inviteReferrerMinTokens = intOr(m.referralInviteReferrerMinTokens, 2_000_000, 1_000_000);
    const inviteReferrerMaxTokens = Math.max(
        inviteReferrerMinTokens,
        intOr(m.referralInviteReferrerMaxTokens, 7_000_000, 1_000_000),
    );
    const inviteReferrerKeyDays = Math.min(
        REFERRER_KEY_DAYS_CAP,
        Math.max(1, intOr(m.referralInviteReferrerKeyDays, 30, 1)),
    );

    const welcomeMinM = intOr(m.referralWelcomeTokenMinM, 5, 1);
    const welcomeMaxM = Math.max(welcomeMinM, intOr(m.referralWelcomeTokenMaxM, 10, 1));

    return {
        // Trường tương thích ngược
        tokensM,
        tokens: inviteTokenAmount,
        days: inviteTokenDays,
        rpm: tokenNewKeyRpm,
        since: parseSince(m.REFERRAL_REWARD_SINCE ?? process.env.REFERRAL_REWARD_SINCE),
        commissionPercent: intOr(m.REFERRAL_COMMISSION ?? process.env.REFERRAL_COMMISSION, 0, 0),
        enabled: referralEnabled && inviteTokenEnabled,

        // Công tắc tổng & Cổng lọc
        referralEnabled,
        channelId: String(m.referralChannelId || process.env.REQUIRED_GROUP || process.env.ORDER_NOTIFY_CHANNEL || "").trim(),
        channelUrl: String(m.referralChannelUrl || process.env.REQUIRED_GROUP_URL || process.env.SUPPORT_CHANNEL_URL || "https://t.me/vpluschannelkh").trim(),
        ageFilterEnabled: boolOr(m.referralAgeFilterEnabled, true),
        minTgAgeDays: Math.min(90, Math.max(1, intOr(m.referralMinTgAgeDays, 7, 1))),

        // Điểm thưởng & Mốc người mua
        pointStartBot: intOr(m.referralPointStartBot, 0, 0),
        pointJoinChannel: intOr(m.referralPointJoinChannel, 1, 0),
        pointPurchase: intOr(m.referralPointPurchase, 3, 0),
        buyerTarget: intOr(m.referralBuyerTarget, 3, 0),
        personalVoucherPercent: Math.min(95, intOr(m.referralPersonalVoucherPercent, 49, 0)),
        extraWarrantyHours: intOr(m.referralExtraWarrantyHours, 48, 0),

        // Nhánh 1: Tặng token 2 phía & Referral Key 30 ngày
        inviteTokenEnabled,
        inviteTokenAmount,
        inviteTokenDays,
        inviteReferrerMinTokens,
        inviteReferrerMaxTokens,
        inviteReferrerKeyDays,
        inviteMaxPerReferrer: intOr(m.referralInviteTokenMaxPerReferrer, 0, 0),
        inviteMaxPairsPerDay: intOr(m.referralInviteTokenMaxPairsPerDay, 0, 0),
        luckyProtectEnabled: boolOr(m.referralLuckyProtectEnabled, true),
        luckyMinTokens: intOr(m.referralLuckyMinTokens, 6_000_000, 0),

        // Nhánh 2: Mốc 5/10/20, Cảnh báo hết hạn & Đua Top ngày
        milestoneEnabled: boolOr(m.referralMilestoneEnabled, true),
        milestone5Tokens: intOr(m.referralMilestone5Tokens, 15_000_000, 0),
        milestone10Tokens: intOr(m.referralMilestone10Tokens, 25_000_000, 0),
        milestone20Tokens: intOr(m.referralMilestone20Tokens, 50_000_000, 0),
        expiryWarnEnabled: boolOr(m.referralExpiryWarnEnabled, true),
        dailyTopEnabled: boolOr(m.referralDailyTopEnabled, true),
        dailyTop1Tokens: intOr(m.referralDailyTop1Tokens, 50_000_000, 0),
        dailyTop2Tokens: intOr(m.referralDailyTop2Tokens, 30_000_000, 0),
        dailyTop3Tokens: intOr(m.referralDailyTop3Tokens, 15_000_000, 0),
        dailyTopLastPaidDate: String(m.referralDailyTopLastPaidDate || "").trim(),

        // Nhánh 3: Mã quà chào mừng WEL...
        welcomeKeyEnabled: boolOr(m.referralWelcomeKeyEnabled, true),
        welcomeTokenMinM: welcomeMinM,
        welcomeTokenMaxM: welcomeMaxM,
        welcomeMaxPerDay: intOr(m.referralWelcomeMaxPerDay, 0, 0),

        // Nhánh 4: Đổi điểm lấy Token API & 4 Tier Account Classic
        redeemEnabled: boolOr(m.referralRedeemEnabled, true),
        tokenRedeemEnabled: boolOr(m.referralTokenRedeemEnabled, true),
        tokenPerPoint: intOr(m.referralTokenPerPoint, 10_000_000, 1_000_000),
        tokenMaxPerUser: intOr(m.referralTokenMaxPerUser, 100_000_000, 0),
        tokenNewKeyRpm,
        tokenNewKeyDays: intOr(m.referralTokenNewKeyDays, 3, 0),
        tokenRedeemResetAt: parseSince(m.referralTokenRedeemResetAt),
        tokenRedeemResetAtRaw: String(m.referralTokenRedeemResetAt || "").trim(),
        tokenRedeemBroadcastEnabled: boolOr(m.tokenRedeemBroadcastEnabled, true),
        tokenRedeemBroadcastChance: Math.min(100, intOr(m.tokenRedeemBroadcastChance, 100, 0)),
        tokenRedeemBroadcastCooldownMin: intOr(m.tokenRedeemBroadcastCooldownMin, 0, 0),
        tokenRedeemBroadcastWindowMin: intOr(m.tokenRedeemBroadcastWindowMin, 30, 1),
        tokenRedeemBroadcastWindowMax: intOr(m.tokenRedeemBroadcastWindowMax, 5, 0),

        redeemBasicSlug: String(m.referralRedeemBasicSlug || "").trim(),
        redeemBh3dSlug: String(m.referralRedeemBh3dSlug || "").trim(),
        redeemBh7dSlug: String(m.referralRedeemBh7dSlug || "").trim(),
        redeemGptSlug: String(m.referralRedeemGptSlug || "").trim(),
        redeemBasicPoints: intOr(m.referralRedeemBasicPoints, 1, 1),
        redeemBh3dPoints: intOr(m.referralRedeemBh3dPoints, 2, 1),
        redeemBh7dPoints: intOr(m.referralRedeemBh7dPoints, 3, 1),
        redeemGptPoints: intOr(m.referralRedeemGptPoints, 5, 1),
    };
}

/** Thông số quà tóm tắt cho UI (tương thích ngược + thêm thông tin v2). */
export async function getReferralRewardInfo() {
    const cfg = await getReferralConfig();
    return {
        tokens: cfg.inviteTokenAmount,
        days: cfg.inviteTokenDays,
        rpm: cfg.tokenNewKeyRpm,
        enabled: cfg.enabled,
        referrerMinTokens: cfg.inviteReferrerMinTokens,
        referrerMaxTokens: cfg.inviteReferrerMaxTokens,
        referrerKeyDays: cfg.inviteReferrerKeyDays,
        welcomeMinM: cfg.welcomeTokenMinM,
        welcomeMaxM: cfg.welcomeTokenMaxM,
        welcomeEnabled: cfg.welcomeKeyEnabled,
        pointJoinChannel: cfg.pointJoinChannel,
        pointPurchase: cfg.pointPurchase,
        tokenPerPoint: cfg.tokenPerPoint,
    };
}

export function getCommissionPercentSync() {
    return intOr(_cfgRaw?.REFERRAL_COMMISSION ?? process.env.REFERRAL_COMMISSION, 0);
}

export async function warmReferralConfig() {
    await loadReferralSettings().catch(() => {});
}

// ─── Tạo mã & Liên kết User / Referrer ───────────────────────────────────────

function generateCode() {
    return crypto.randomBytes(4).toString("hex").toUpperCase();
}

function generateWelcomeCode() {
    return "WEL" + crypto.randomBytes(4).toString("hex").toUpperCase();
}

async function createUniqueWelcomeCode() {
    for (let i = 0; i < 8; i++) {
        const code = generateWelcomeCode();
        const clash = await prisma.user.findFirst?.({ where: { refWelcomeCode: code } })
            ?? await prisma.user.findUnique?.({ where: { refWelcomeCode: code } }).catch(() => null);
        if (!clash) return code;
    }
    return "WEL" + Date.now().toString(16).toUpperCase().slice(-8);
}

async function ensureReferralRecord(user) {
    if (!user?.id || !user?.referredBy || !prisma.referral?.upsert) return null;
    return prisma.referral.upsert({
        where: { refereeId: user.id },
        update: { referrerId: user.referredBy },
        create: {
            referrerId: user.referredBy,
            refereeId: user.id,
            status: "REGISTERED",
        },
    });
}

async function resolveReferrerFromParam(rawParam, selfTelegramId) {
    if (!rawParam) return null;
    const str = String(rawParam).trim();
    if (!str) return null;

    // Chấp nhận cả tham số thô (`ref7368118922`, `ref_ABCD1234`) lẫn mã đã cắt tiền tố (`ABCD1234`, `7368118922`)
    const parsed = parseReferralStartParam(str)
        || (/^\d{5,16}$/.test(str) ? { kind: "telegramId", value: str } : { kind: "code", value: str.toUpperCase() });

    let referrer = null;
    if (parsed.kind === "telegramId") {
        if (String(parsed.value) === String(selfTelegramId)) return null;
        referrer = await prisma.user.findUnique({ where: { telegramId: String(parsed.value) } }).catch(() => null);
    } else {
        referrer = await prisma.user.findUnique({ where: { referralCode: parsed.value } }).catch(() => null);
    }

    if (!referrer || String(referrer.telegramId) === String(selfTelegramId)) return null;
    return referrer;
}

async function recordReferralEvent({ referrerId = null, referrerTgId, referredUserId, eventType, points = 0, note = null, now = Date.now() }) {
    if (!prisma.referralEvent?.create) return null;
    try {
        return await prisma.referralEvent.create({
            data: {
                referrerId: referrerId ? String(referrerId) : null,
                referrerTgId: String(referrerTgId),
                referredUserId: String(referredUserId),
                eventType: String(eventType),
                points: Math.floor(Number(points) || 0),
                status: "completed",
                note: note ? String(note) : null,
                createdAt: new Date(now),
            },
        });
    } catch (err) {
        console.error("[referral] recordReferralEvent lỗi:", err.message);
        return null;
    }
}

/**
 * Gắn người mời cho user chưa có `referredBy` (hỗ trợ cả lúc mới tạo user VÀ lúc user
 * đã tồn tại nhưng chưa từng có ref — áp luật Late Claim 30 phút).
 */
export async function bindReferrerIfEligible(user, referralParam, { now = Date.now() } = {}) {
    if (!user || user.referredBy || !referralParam) return user;
    const cfg = await getReferralConfig();
    if (!cfg.referralEnabled) return user;

    const referrer = await resolveReferrerFromParam(referralParam, user.telegramId);
    if (!referrer || referrer.id === user.id) return user;
    // Chặn mời chéo vòng tròn A ↔ B (người do chính mình mời quay lại mời ngược mình trong 30p đầu)
    if (referrer.referredBy && String(referrer.referredBy) === String(user.id)) {
        return user;
    }

    const late = isLateClaim(user.createdAt, now);
    const welcomeCode = (!late && cfg.welcomeKeyEnabled && !user.refWelcomeCode)
        ? await createUniqueWelcomeCode()
        : null;

    const updateData = {
        referredBy: referrer.id,
        referralLateClaim: late,
        ...(welcomeCode ? { refWelcomeCode: welcomeCode } : {}),
    };

    if (prisma.user.updateMany) {
        const claim = await prisma.user.updateMany({
            where: { id: user.id, referredBy: null },
            data: updateData,
        });
        if (!claim?.count) return user;
    } else if (prisma.user.update) {
        await prisma.user.update({ where: { id: user.id }, data: updateData });
    }

    const updatedUser = { ...user, ...updateData };
    userCache.set(`user:${user.telegramId}`, updatedUser);
    await ensureReferralRecord(updatedUser);

    // Chỉ tính lượt mời hợp lệ & cộng điểm start_bot khi KHÔNG phải khách cũ (late claim)
    if (!late && prisma.user.update) {
        const refInc = {
            totalSuccessfulReferrals: { increment: 1 },
            ...(cfg.pointStartBot > 0 ? { referralPoints: { increment: cfg.pointStartBot } } : {}),
        };
        await prisma.user.update({ where: { id: referrer.id }, data: refInc }).catch(() => {});
        userCache.invalidate?.(`user:${referrer.telegramId}`);
    }
    await recordReferralEvent({
        referrerId: referrer.id,
        referrerTgId: referrer.telegramId,
        referredUserId: user.telegramId,
        eventType: "start_bot",
        points: late ? 0 : cfg.pointStartBot,
        note: late ? "late_claim" : null,
    });

    return updatedUser;
}

/**
 * Get or create user with referral code/link (cached 60s, chống race E11000 khi bấm /start đúp)
 */
export async function getOrCreateUser(telegramUser, referredByParam = null) {
    const telegramId = String(telegramUser.id);
    const cacheKey = `user:${telegramId}`;
    const isPremium = Boolean(telegramUser.is_premium);

    let user = userCache.get(cacheKey);
    if (!user) {
        user = await prisma.user.findUnique({ where: { telegramId } });
        if (user) userCache.set(cacheKey, user);
    }

    if (!user) {
        let referralCode = generateCode();
        while (await prisma.user.findUnique({ where: { referralCode } })) {
            referralCode = generateCode();
        }

        const cfg = await getReferralConfig();
        let referrer = null;
        if (referredByParam && cfg.referralEnabled) {
            referrer = await resolveReferrerFromParam(referredByParam, telegramId);
        }

        const welcomeCode = (referrer && cfg.welcomeKeyEnabled)
            ? await createUniqueWelcomeCode()
            : undefined;

        let createdFresh = false;
        try {
            user = await prisma.user.create({
                data: {
                    telegramId,
                    username: telegramUser.username,
                    firstName: telegramUser.first_name,
                    isTelegramPremium: isPremium,
                    referralCode,
                    referredBy: referrer ? referrer.id : null,
                    referralLateClaim: false,
                    ...(welcomeCode ? { refWelcomeCode: welcomeCode } : {}),
                },
            });
            createdFresh = true;
        } catch (err) {
            if (!isDuplicateKeyError(err)) throw err;
            // Race condition: 2 update song song của cùng user mới → đọc lại bản ghi vừa thắng cuộc
            user = await prisma.user.findUnique({ where: { telegramId } });
            if (!user) {
                // Xung đột cực hiếm trên referralCode hoặc refWelcomeCode → thử lại 1 lần với mã mới
                const retryCode = generateCode();
                const retryWel = (referrer && cfg.welcomeKeyEnabled) ? await createUniqueWelcomeCode() : undefined;
                user = await prisma.user.create({
                    data: {
                        telegramId,
                        username: telegramUser.username,
                        firstName: telegramUser.first_name,
                        isTelegramPremium: isPremium,
                        referralCode: retryCode,
                        referredBy: referrer ? referrer.id : null,
                        referralLateClaim: false,
                        ...(retryWel ? { refWelcomeCode: retryWel } : {}),
                    },
                });
                createdFresh = true;
            }
        }

        userCache.set(cacheKey, user);
        invalidatePeerAgeCache();

        if (createdFresh && referrer) {
            await ensureReferralRecord(user);
            if (prisma.user.update) {
                await prisma.user.update({
                    where: { id: referrer.id },
                    data: {
                        totalSuccessfulReferrals: { increment: 1 },
                        ...(cfg.pointStartBot > 0 ? { referralPoints: { increment: cfg.pointStartBot } } : {}),
                    },
                }).catch(() => {});
                userCache.invalidate?.(`user:${referrer.telegramId}`);
            }
            await recordReferralEvent({
                referrerId: referrer.id,
                referrerTgId: referrer.telegramId,
                referredUserId: telegramId,
                eventType: "start_bot",
                points: cfg.pointStartBot,
            });
        } else if (!createdFresh && !user.referredBy && referredByParam) {
            user = await bindReferrerIfEligible(user, referredByParam);
        }
    } else {
        const usernameChanged = (user.username || null) !== (telegramUser.username || null);
        const nameChanged = (user.firstName || null) !== (telegramUser.first_name || null);
        const premiumChanged = isPremium && !user.isTelegramPremium;

        if (usernameChanged || nameChanged || premiumChanged) {
            const patch = {
                username: telegramUser.username,
                firstName: telegramUser.first_name,
                ...(premiumChanged ? { isTelegramPremium: true } : {}),
            };
            await prisma.user.update({ where: { id: user.id }, data: patch });
            user = { ...user, ...patch };
            userCache.set(cacheKey, user);
        }

        if (!user.referredBy && referredByParam) {
            user = await bindReferrerIfEligible(user, referredByParam);
        } else if (user.referredBy) {
            await ensureReferralRecord(user);
        }
    }

    return user;
}

// ─── Kiểm tra tuổi Telegram (Peer Envelope) ───────────────────────────────────

async function loadPeersForAgeEnvelope() {
    if (_peerCache && Date.now() - _peerCacheTs < PEER_CACHE_TTL) return _peerCache;
    try {
        const rows = await prisma.user.findMany({
            select: { telegramId: true, createdAt: true },
        });
        _peerCache = (rows || [])
            .map((r) => ({
                tgNum: Number(r.telegramId),
                createdAtMs: r.createdAt ? new Date(r.createdAt).getTime() : 0,
            }))
            .filter((r) => Number.isFinite(r.tgNum) && r.tgNum > 0 && r.createdAtMs > 0);
        _peerCacheTs = Date.now();
        return _peerCache;
    } catch {
        return _peerCache || [];
    }
}

export async function checkTelegramAgeGate(user, { isPremium = false, cfg = null, now = Date.now() } = {}) {
    const conf = cfg || await getReferralConfig();
    const premium = Boolean(isPremium || user?.isTelegramPremium);
    if (!conf.ageFilterEnabled || premium) {
        return { passed: true, minDays: conf.minTgAgeDays, remainingDays: 0, estimatedAgeDays: 999, isPremium: premium };
    }
    const peers = await loadPeersForAgeEnvelope();
    const est = estimateTelegramAgeDays({
        telegramId: user.telegramId,
        userCreatedAt: user.createdAt,
        isPremium: premium,
        peers,
        now,
    });
    const gate = evaluateAgeGate({
        ageFilterEnabled: conf.ageFilterEnabled,
        minTgAgeDays: conf.minTgAgeDays,
        isPremium: premium,
        estimatedAgeDays: est.estimatedAgeDays,
    });
    return { ...est, ...gate };
}

// ─── Khóa Lease nạp cộng dồn IssuedApiKey & Quản lý RedeemRequest ─────────────

const KEY_TOPUP_LEASE_MS = 10 * 60_000;

async function claimIssuedKeyTopupLease(keyId, now = Date.now()) {
    if (!prisma.issuedApiKey?.updateMany) return true;
    const res = await prisma.issuedApiKey.updateMany({
        where: { id: String(keyId), renewWipAt: null },
        data: { renewWipAt: new Date(now) },
    });
    if ((res?.count || 0) > 0) return true;

    // Thu hồi lease bị treo quá 10 phút
    const staleCutoff = new Date(now - KEY_TOPUP_LEASE_MS);
    const stolen = await prisma.issuedApiKey.updateMany({
        where: { id: String(keyId), renewWipAt: { lt: staleCutoff } },
        data: { renewWipAt: new Date(now) },
    }).catch(() => ({ count: 0 }));
    return (stolen?.count || 0) > 0;
}

async function releaseIssuedKeyTopupLease(keyId) {
    if (!prisma.issuedApiKey?.update) return;
    await prisma.issuedApiKey.update({
        where: { id: String(keyId) },
        data: { renewWipAt: null },
    }).catch(() => {});
}

/**
 * Chiếm khóa idempotency `lockKey` trong bảng `RedeemRequest`.
 *   - Đã `completed`: trả `{ state: "already_completed", row }`
 *   - Đang `pending`/`minting` chưa quá 10 phút: trả `{ state: "in_progress", row }`
 *   - `failed` hoặc kẹt > 10 phút: chiếm lại để retry, trả `{ state: "claimed", row }`
 *   - Chưa có: tạo mới, trả `{ state: "claimed", row }`
 */
async function claimRedeemLock({
    lockKey,
    telegramId,
    referrerTgId = null,
    referredTgId = null,
    rewardType,
    pointsUsed = 0,
    tokensGranted = 0,
    note = null,
    now = Date.now(),
}) {
    // Fallback khi chạy trong unit test cũ không mock redeemRequest
    if (!prisma.redeemRequest?.create) {
        return { state: "claimed", row: null };
    }

    try {
        const row = await prisma.redeemRequest.create({
            data: {
                telegramId: String(telegramId),
                referrerTgId: referrerTgId ? String(referrerTgId) : null,
                referredTgId: referredTgId ? String(referredTgId) : null,
                rewardType,
                pointsUsed,
                tokensGranted,
                status: "minting",
                note,
                lockKey,
            },
        });
        return { state: "claimed", row };
    } catch (err) {
        if (!isDuplicateKeyError(err)) throw err;
        const existing = await prisma.redeemRequest.findFirst({ where: { lockKey } });
        if (!existing) return { state: "in_progress", row: null };
        if (existing.status === "completed") return { state: "already_completed", row: existing };

        const updatedMs = existing.updatedAt
            ? new Date(existing.updatedAt).getTime()
            : (existing.createdAt ? new Date(existing.createdAt).getTime() : 0);
        const isStale = now - updatedMs > KEY_TOPUP_LEASE_MS;
        if (existing.status === "failed" || isStale) {
            const reclaim = await prisma.redeemRequest.updateMany({
                where: { id: existing.id, status: existing.status },
                data: { status: "minting", tokensGranted: tokensGranted || existing.tokensGranted },
            });
            if ((reclaim?.count || 0) > 0) {
                return { state: "claimed", row: { ...existing, status: "minting" } };
            }
        }
        return { state: "in_progress", row: existing };
    }
}

async function completeRedeemLock(row, { tokensGranted, issuedKeyId = null, externalId = null, note = undefined } = {}) {
    if (!row?.id || !prisma.redeemRequest?.update) return;
    await prisma.redeemRequest.update({
        where: { id: row.id },
        data: {
            status: "completed",
            ...(tokensGranted !== undefined ? { tokensGranted } : {}),
            ...(issuedKeyId !== undefined ? { issuedKeyId } : {}),
            ...(externalId !== undefined ? { externalId } : {}),
            ...(note !== undefined ? { note } : {}),
            nextRetryAt: null,
        },
    }).catch((e) => console.error("[referral] completeRedeemLock lỗi:", e.message));
}

async function failRedeemLock(row, errorMsg, { retryable = true, now = Date.now() } = {}) {
    if (!row?.id || !prisma.redeemRequest?.update) return;
    const nextCount = (Number(row.retryCount) || 0) + 1;
    const canRetry = retryable && nextCount <= GW_RETRY_MAX;
    await prisma.redeemRequest.update({
        where: { id: row.id },
        data: {
            status: "failed",
            retryCount: nextCount,
            nextRetryAt: canRetry ? new Date(now + computeGatewayRetryDelayMs(nextCount)) : null,
            note: String(errorMsg || "gateway_failed").slice(0, 400),
        },
    }).catch((e) => console.error("[referral] failRedeemLock lỗi:", e.message));
}

// ─── Tạo key mới & Nạp cộng dồn vào Referral Key (30 ngày) ───────────────────

async function resolveReferralServerConfig() {
    const cfg = await getGpt2apiConfig().catch(() => null);
    if (!cfg?.enabled || !cfg.configured) return null;
    const profileId = await getSourceProfileId(KEY_SOURCES.REFERRAL).catch(() => null);
    const keyCfg = (await getProfileConfig(profileId).catch(() => null)) || cfg;
    return { shopCfg: cfg, keyCfg, profileId };
}

async function mintFreshGiftKey({
    user,
    tokens,
    validDays,
    rpm,
    label,
    keyCfg,
    profileId,
    now = Date.now(),
}) {
    const effectiveRpm = rpm > 0 ? rpm : (keyCfg.rpm ?? 100);
    const created = await createApiKey({
        quotaTokens: tokens,
        name: `${label}-${String(user.telegramId).slice(-6)}-${now.toString(36)}`,
        rpm: effectiveRpm,
        validDays,
        models: keyCfg.models,
        profileId,
        allowDisabledProfile: profileId !== null,
    });

    if (!created.ok) {
        return { ok: false, code: created.code, message: created.message, providerMutationPossible: created.providerMutationPossible, verifiedNoKey: created.verifiedNoKey };
    }

    const expiresRaw = created.expiresAt
        || (validDays > 0 ? new Date(now + validDays * 86_400_000) : null);
    const expiresIso = (() => {
        if (!expiresRaw) return null;
        const d = new Date(expiresRaw);
        return Number.isNaN(d.getTime()) ? null : d.toISOString();
    })();

    let saved = null;
    try {
        saved = await saveIssuedKey({
            telegramId: user.telegramId,
            key: created.key,
            quotaTokens: tokens,
            rpm: effectiveRpm,
            source: KeySource.REFERRAL,
            externalId: created.id,
            expiresAt: expiresIso,
            models: keyCfg.models || [],
            profileId: created.profileId ?? profileId ?? null,
            profileName: created.profileName || "",
        });
    } catch (err) {
        console.error("[referral] saveIssuedKey lỗi (key vẫn hợp lệ trên provider):", err.message);
    }

    invalidateKeyStatusCache?.();
    return {
        ok: true,
        mode: "new",
        issuedKeyId: saved?.id || null,
        externalId: created.id || null,
        key: created.key,
        quotaTokens: tokens,
        tokensAdded: tokens,
        totalTokens: tokens,
        rpm: effectiveRpm,
        expiresAt: expiresIso,
        models: keyCfg.models || [],
        endpoint: keyCfg.endpoint || "",
        docUrl: keyCfg.docUrl || "",
        usageUrl: keyCfg.usageUrl || "",
        telegramId: String(user.telegramId),
        language: user.language || "vi",
    };
}

function isTransientStatusFailure(st) {
    if (!st || st.ok) return false;
    const code = String(st.code || "").toLowerCase();
    return code === "network" || code === "rate_limited" || code === "budget" || /^http_5\d\d$/.test(code) || code === "429";
}

// Chỉ những lỗi phát sinh TRƯỚC khi lệnh PATCH rời tiến trình mới an toàn để hoàn điểm / tự động retry nạp cộng dồn.
const SAFE_PRE_PATCH_RENEW_CODES = new Set([
    "key_not_found",
    "not_configured",
    "nothing_to_renew",
    "renew_in_progress",
    "not_found",
    "40400",
    "rate_limited",
    "budget",
    "429",
]);

function isSafePrePatchRenewFailure(code) {
    return SAFE_PRE_PATCH_RENEW_CODES.has(String(code ?? "").toLowerCase());
}

/**
 * Cấp hoặc nạp cộng dồn token vào **Referral Key 30 ngày** (`user.referralBonusKeyId`).
 *   - Lượt đầu tiên (hoặc key cũ đã hết hạn / bị tắt / bị xoá): dùng con trỏ CAS `pending:<ts>:<nonce>`
 *     trên `User.referralBonusKeyId`, gọi provider tạo key 30 ngày mới rồi chốt `issuedKeyId`.
 *   - Các lượt sau khi key còn hạn: nạp cộng dồn token tại chỗ (`addDays = 0`, không đẩy ngày hết hạn).
 */
async function grantToReferrerBonusKey({ referrer, tokensToAdd, cfg, keyCfg, profileId, now = Date.now() }) {
    return withProcessLock(`refbonus:${referrer.telegramId}`, async () => {
        // Đọc lại user mới nhất để lấy đúng referralBonusKeyId sau các lượt trước trong hàng đợi
        const freshRef = (await prisma.user.findUnique({ where: { id: referrer.id } }).catch(() => null)) || referrer;
        const rawPtr = freshRef.referralBonusKeyId ? String(freshRef.referralBonusKeyId) : null;

        // Nếu đang có con trỏ `pending:<ts>:<nonce>` từ instance khác chưa quá 10 phút → báo bận để retry sau
        if (rawPtr && rawPtr.startsWith("pending:")) {
            const parts = rawPtr.split(":");
            const pendingTs = Number(parts[1]) || 0;
            if (now - pendingTs < KEY_TOPUP_LEASE_MS) {
                return { ok: false, code: "lease_busy", message: "Referral Key đang được khởi tạo ở tiến trình khác", retryable: true };
            }
        }

        const bonusKeyId = rawPtr && !rawPtr.startsWith("pending:") ? rawPtr : null;

        if (bonusKeyId && prisma.issuedApiKey?.findUnique && typeof renewApiKey === "function" && typeof getKeyStatus === "function") {
            const keyRow = await prisma.issuedApiKey.findUnique({ where: { id: bonusKeyId } }).catch(() => null);
            if (keyRow && !keyRow.hiddenAt && keyRow.externalId) {
                const localExpMs = keyRow.expiresAt ? new Date(keyRow.expiresAt).getTime() : null;
                const locallyExpired = localExpMs !== null && Number.isFinite(localExpMs) && localExpMs <= now + 60_000;

                if (!locallyExpired) {
                    const st = await getKeyStatus(keyRow.externalId, keyRow.profileId ?? profileId);
                    if (isTransientStatusFailure(st)) {
                        // Lỗi mạng thoáng qua — KHÔNG vứt key 30 ngày đang sống của khách để tạo key mới
                        return { ok: false, code: st.code || "network", message: st.message || "Lỗi kết nối kiểm tra Referral Key", retryable: true };
                    }
                    if (st?.ok) {
                        const remoteExpMs = st.expiresAt ? new Date(st.expiresAt).getTime() : localExpMs;
                        const remoteExpired = remoteExpMs !== null && Number.isFinite(remoteExpMs) && remoteExpMs <= now + 60_000;
                        const usable = st.enabled !== false && !st.lockReason && !remoteExpired && st.quotaLimit !== 0;

                        if (usable) {
                            const leased = await claimIssuedKeyTopupLease(keyRow.id, now);
                            if (!leased) {
                                return { ok: false, code: "lease_busy", message: "Key đang bận nạp cộng dồn, thử lại sau", retryable: true };
                            }
                            try {
                                const renewed = await renewApiKey({
                                    externalId: keyRow.externalId,
                                    addTokens: tokensToAdd,
                                    addDays: 0,
                                    profileId: keyRow.profileId ?? profileId,
                                });
                                if (!renewed?.ok) {
                                    await releaseIssuedKeyTopupLease(keyRow.id);
                                    const safeRetry = isSafePrePatchRenewFailure(renewed?.code);
                                    return { ok: false, code: renewed?.code || "renew_failed", message: renewed?.message || "Nạp cộng dồn thất bại", retryable: safeRetry };
                                }

                                const newTotalTokens = renewed.after?.quotaLimit
                                    ? toDisplayTokens(renewed.after.quotaLimit, renewed.quotaRefPrice || keyCfg.quotaRefPrice || 0)
                                    : (Number(keyRow.quotaTokens) || 0) + tokensToAdd;
                                const finalExpiresIso = renewed.after?.expiresAt || (keyRow.expiresAt ? new Date(keyRow.expiresAt).toISOString() : null);

                                await prisma.issuedApiKey.update({
                                    where: { id: keyRow.id },
                                    data: {
                                        quotaTokens: newTotalTokens,
                                        renewCount: { increment: 1 },
                                        lastRenewAt: new Date(now),
                                        notifyStage: 0,
                                        renewWipAt: null,
                                    },
                                }).catch(() => releaseIssuedKeyTopupLease(keyRow.id));

                                invalidateKeyStatusCache?.();
                                return {
                                    ok: true,
                                    mode: "topup",
                                    issuedKeyId: keyRow.id,
                                    externalId: keyRow.externalId,
                                    key: keyRow.key,
                                    quotaTokens: newTotalTokens,
                                    tokensAdded: tokensToAdd,
                                    totalTokens: newTotalTokens,
                                    rpm: renewed.after?.rpm || keyRow.rpm || cfg.tokenNewKeyRpm,
                                    expiresAt: finalExpiresIso,
                                    models: keyRow.models?.length ? keyRow.models : (keyCfg.models || []),
                                    endpoint: keyCfg.endpoint || "",
                                    docUrl: keyCfg.docUrl || "",
                                    usageUrl: keyCfg.usageUrl || "",
                                    telegramId: String(freshRef.telegramId),
                                    language: freshRef.language || "vi",
                                };
                            } catch (err) {
                                await releaseIssuedKeyTopupLease(keyRow.id);
                                return { ok: false, code: "network", message: err.message, retryable: true };
                            }
                        }
                    }
                }
            }
        }

        // Ghi con trỏ CAS tạm `pending:<ts>:<nonce>` trước khi tạo Referral Key 30 ngày mới
        const pendingPtr = `pending:${now}:${crypto.randomBytes(4).toString("hex")}`;
        if (prisma.user?.update) {
            await prisma.user.update({
                where: { id: freshRef.id },
                data: { referralBonusKeyId: pendingPtr },
            }).catch(() => {});
        }

        // Chưa có Referral Key hoặc key cũ đã hết hạn / bị tắt / bị xoá → Tạo Referral Key 30 ngày mới
        const minted = await mintFreshGiftKey({
            user: freshRef,
            tokens: tokensToAdd,
            validDays: cfg.inviteReferrerKeyDays,
            rpm: cfg.tokenNewKeyRpm,
            label: "ref-bonus",
            keyCfg,
            profileId,
            now,
        });
        if (!minted.ok) {
            if (prisma.user?.update) {
                await prisma.user.update({
                    where: { id: freshRef.id },
                    data: { referralBonusKeyId: bonusKeyId },
                }).catch(() => {});
            }
            return { ...minted, retryable: minted.providerMutationPossible === false || Boolean(minted.verifiedNoKey) || isTransientStatusFailure(minted) };
        }

        if (prisma.user?.update) {
            await prisma.user.update({
                where: { id: freshRef.id },
                data: { referralBonusKeyId: minted.issuedKeyId || null },
            }).catch((e) => console.error("[referral] lưu referralBonusKeyId lỗi:", e.message));
            userCache.invalidate?.(`user:${freshRef.telegramId}`);
        }
        return minted;
    });
}

// ─── Nhánh 1 & 2A: Tặng Token 2 phía + Mốc 5 / 10 / 20 ───────────────────────

async function countCompletedReferrerInvites(referrerTgId) {
    if (!prisma.redeemRequest?.count) return 0;
    return prisma.redeemRequest.count({
        where: {
            referrerTgId: String(referrerTgId),
            rewardType: "ref_invite_token",
            status: "completed",
            note: { startsWith: "referrer" },
        },
    }).catch(() => 0);
}

async function getRecent3ReferrerGrants(referrerTgId) {
    if (!prisma.redeemRequest?.findMany) return [];
    const rows = await prisma.redeemRequest.findMany({
        where: {
            referrerTgId: String(referrerTgId),
            rewardType: "ref_invite_token",
            status: "completed",
            note: { startsWith: "referrer" },
        },
        orderBy: { createdAt: "desc" },
        take: 3,
    }).catch(() => []);
    return (rows || []).map((r) => Number(r.tokensGranted) || 0).filter((n) => n > 0);
}

async function countCompletedPairsTodayVn(now = Date.now()) {
    if (!prisma.redeemRequest?.count) return 0;
    const startUtc = vnDayStartUtc(vnDayKey(now));
    if (!startUtc) return 0;
    return prisma.redeemRequest.count({
        where: {
            rewardType: "ref_invite_token",
            status: "completed",
            note: "referred",
            createdAt: { gte: startUtc },
        },
    }).catch(() => 0);
}

async function grantDueMilestonesForReferrer({ referrer, cfg, keyCfg, profileId, now = Date.now() }) {
    if (!cfg.milestoneEnabled || !prisma.redeemRequest?.create) return [];
    const completedCount = await countCompletedReferrerInvites(referrer.telegramId);
    const due = dueMilestones(completedCount, cfg);
    if (!due.length) return [];

    const grantedMilestones = [];
    for (const m of due) {
        const lockKey = `ref_milestone|ref_milestone|${referrer.telegramId}|${m.count}`;
        const claim = await claimRedeemLock({
            lockKey,
            telegramId: referrer.telegramId,
            referrerTgId: referrer.telegramId,
            rewardType: "ref_milestone",
            tokensGranted: m.tokens,
            note: `milestone_${m.count}`,
            now,
        });
        if (claim.state !== "claimed") continue;

        const res = await grantToReferrerBonusKey({
            referrer,
            tokensToAdd: m.tokens,
            cfg,
            keyCfg,
            profileId,
            now,
        });
        if (res.ok) {
            await completeRedeemLock(claim.row, {
                tokensGranted: m.tokens,
                issuedKeyId: res.issuedKeyId,
                externalId: res.externalId,
                note: `milestone_${m.count}|${res.mode}`,
            });
            grantedMilestones.push({
                milestoneCount: m.count,
                ...res,
            });
        } else {
            await failRedeemLock(claim.row, res.message || res.code, { retryable: res.retryable !== false, now });
        }
    }
    return grantedMilestones;
}

/**
 * Cấp quà mời bạn 2 phía + kiểm tra mốc 5/10/20:
 *   - Người được mời (`referee`): 1 key riêng mới `inviteTokenAmount` (20M) / `inviteTokenDays` (1 ngày).
 *   - Người mời (`referrer`): quay số 2M–7M (có Lucky Protect) nạp vào Referral Key 30 ngày.
 */
export async function grantReferralReward(telegramId, userObj = null, { rng = Math.random, now = Date.now() } = {}) {
    const cfg = await getReferralConfig();
    if (!cfg.enabled) return null;

    const tgId = String(telegramId);
    const referee = userObj && String(userObj.telegramId) === tgId
        ? userObj
        : await prisma.user.findUnique({ where: { telegramId: tgId } });
    if (!referee?.referredBy) return null;

    // Kiểm tra cửa sổ acc mới (nếu có createdAt; thiếu createdAt trong mock test coi như hợp lệ)
    if (referee.createdAt || referee.referralLateClaim || referee.refWelcomeCode) {
        if (!isBrandNewForInvite(referee, now)) return null;
    }

    const referral = await prisma.referral.findFirst({ where: { refereeId: referee.id } });
    if (!referral) return null;
    if (referral.rewardRefereeAt && referral.rewardReferrerAt) return null;
    if (cfg.since && referral.createdAt && new Date(referral.createdAt) < cfg.since) return null;

    const serverInfo = await resolveReferralServerConfig();
    if (!serverInfo) return null;
    const { keyCfg, profileId } = serverInfo;

    const referrer = await prisma.user.findUnique({ where: { id: referee.referredBy } }).catch(() => null);

    // Kiểm tra trần toàn shop theo ngày & trần mỗi người mời (nếu bật > 0)
    if (cfg.inviteMaxPairsPerDay > 0 && !referral.rewardRefereeAt) {
        const pairsToday = await countCompletedPairsTodayVn(now);
        if (pairsToday >= cfg.inviteMaxPairsPerDay) return null;
    }
    if (cfg.inviteMaxPerReferrer > 0 && referrer && !referral.rewardReferrerAt) {
        const refCount = await countCompletedReferrerInvites(referrer.telegramId);
        if (refCount >= cfg.inviteMaxPerReferrer) return null;
    }

    // 1. Cấp key riêng mới cho người được mời (20M / 1 ngày)
    let refereeReward = null;
    if (!referral.rewardRefereeAt) {
        const lockKey = `ref_invite_token|ref_invite|${referee.telegramId}|referred`;
        const lock = await claimRedeemLock({
            lockKey,
            telegramId: referee.telegramId,
            referrerTgId: referrer?.telegramId || null,
            referredTgId: referee.telegramId,
            rewardType: "ref_invite_token",
            tokensGranted: cfg.inviteTokenAmount,
            note: "referred",
            now,
        });
        if (lock.state === "claimed") {
            const claimDoc = await prisma.referral.updateMany({
                where: { id: referral.id, rewardRefereeAt: null },
                data: { rewardRefereeAt: new Date(now) },
            });
            if (claimDoc?.count) {
                const minted = await mintFreshGiftKey({
                    user: referee,
                    tokens: cfg.inviteTokenAmount,
                    validDays: cfg.inviteTokenDays,
                    rpm: cfg.tokenNewKeyRpm,
                    label: "ref-invite",
                    keyCfg,
                    profileId,
                });
                if (minted.ok) {
                    await completeRedeemLock(lock.row, {
                        tokensGranted: cfg.inviteTokenAmount,
                        issuedKeyId: minted.issuedKeyId,
                        externalId: minted.externalId,
                        note: "referred",
                    });
                    refereeReward = minted;
                } else {
                    await prisma.referral.updateMany({
                        where: { id: referral.id },
                        data: { rewardRefereeAt: null },
                    }).catch(() => {});
                    await failRedeemLock(lock.row, minted.message || minted.code, { retryable: true, now });
                }
            } else {
                await completeRedeemLock(lock.row, { note: "referred|synced" });
            }
        }
    }

    // 2. Quay 2M–7M (Lucky Protect) & nạp vào Referral Key 30 ngày cho người mời
    let referrerReward = null;
    let milestones = [];
    if (referrer && !referral.rewardReferrerAt) {
        const lockKey = `ref_invite_token|ref_invite|${referee.telegramId}|referrer`;
        const lock = await claimRedeemLock({
            lockKey,
            telegramId: referrer.telegramId,
            referrerTgId: referrer.telegramId,
            referredTgId: referee.telegramId,
            rewardType: "ref_invite_token",
            tokensGranted: 0,
            note: "referrer",
            now,
        });
        if (lock.state === "claimed") {
            const claimDoc = await prisma.referral.updateMany({
                where: { id: referral.id, rewardReferrerAt: null },
                data: { rewardReferrerAt: new Date(now) },
            });
            if (claimDoc?.count) {
                const recent3 = await getRecent3ReferrerGrants(referrer.telegramId);
                const roll = rollReferrerInviteTokens({
                    minTokens: cfg.inviteReferrerMinTokens,
                    maxTokens: cfg.inviteReferrerMaxTokens,
                    luckyProtectEnabled: cfg.luckyProtectEnabled,
                    luckyMinTokens: cfg.luckyMinTokens,
                    recent3Tokens: recent3,
                    rng,
                });

                const granted = await grantToReferrerBonusKey({
                    referrer,
                    tokensToAdd: roll.tokens,
                    cfg,
                    keyCfg,
                    profileId,
                    now,
                });

                if (granted.ok) {
                    await completeRedeemLock(lock.row, {
                        tokensGranted: roll.tokens,
                        issuedKeyId: granted.issuedKeyId,
                        externalId: granted.externalId,
                        note: `referrer|${granted.mode}${roll.lucky ? "|lucky" : ""}`,
                    });
                    referrerReward = {
                        ...granted,
                        lucky: roll.lucky,
                        rolledMillions: roll.millions,
                    };
                    milestones = await grantDueMilestonesForReferrer({
                        referrer,
                        cfg,
                        keyCfg,
                        profileId,
                        now,
                    });
                } else {
                    await prisma.referral.updateMany({
                        where: { id: referral.id },
                        data: { rewardReferrerAt: null },
                    }).catch(() => {});
                    await failRedeemLock(lock.row, granted.message || granted.code, { retryable: granted.retryable !== false, now });
                }
            } else {
                await completeRedeemLock(lock.row, { note: "referrer|synced" });
            }
        }
    }

    if (!refereeReward && !referrerReward && !milestones.length) return null;
    return {
        referee: refereeReward,
        referrer: referrerReward,
        milestones,
        tokens: cfg.inviteTokenAmount,
        validDays: cfg.inviteTokenDays,
        referrerKeyDays: cfg.inviteReferrerKeyDays,
    };
}

// ─── Nhánh 3: Mã quà chào mừng (`WEL...` / `ref_welcome_key`) ─────────────────

export async function redeemWelcomeCode(telegramId, rawCode, { bypassJoinCheck = false, rng = Math.random, now = Date.now() } = {}) {
    const cfg = await getReferralConfig();
    if (!cfg.referralEnabled || !cfg.welcomeKeyEnabled) {
        return { ok: false, error: "DISABLED" };
    }

    const code = String(rawCode || "").trim().toUpperCase();
    if (!/^WEL[A-Z0-9]{6,16}$/.test(code)) {
        return { ok: false, error: "INVALID_CODE" };
    }

    const tgId = String(telegramId);
    const user = await prisma.user.findUnique({ where: { telegramId: tgId } });
    if (!user || !user.refWelcomeCode || String(user.refWelcomeCode).toUpperCase() !== code) {
        return { ok: false, error: "NOT_YOUR_CODE" };
    }
    if (user.refWelcomeRedeemedAt) {
        return { ok: false, error: "ALREADY_REDEEMED" };
    }
    if (!bypassJoinCheck && !user.hasJoinedChannel) {
        return { ok: false, error: "CHANNEL_REQUIRED" };
    }

    // Kiểm tra trần toàn shop mỗi ngày (nếu > 0)
    if (cfg.welcomeMaxPerDay > 0 && prisma.redeemRequest?.count) {
        const startUtc = vnDayStartUtc(vnDayKey(now));
        const usedToday = await prisma.redeemRequest.count({
            where: {
                rewardType: "ref_welcome_key",
                status: "completed",
                createdAt: { gte: startUtc },
            },
        }).catch(() => 0);
        if (usedToday >= cfg.welcomeMaxPerDay) {
            return { ok: false, error: "DAY_CAP" };
        }
    }

    const serverInfo = await resolveReferralServerConfig();
    if (!serverInfo) {
        return { ok: false, error: "GATEWAY_NOT_READY" };
    }

    // CAS chống bấm đúp
    const lockKey = `ref_welcome_key|welcome|${tgId}`;
    const lock = await claimRedeemLock({
        lockKey,
        telegramId: tgId,
        rewardType: "ref_welcome_key",
        note: code,
        now,
    });
    if (lock.state === "already_completed") return { ok: false, error: "ALREADY_REDEEMED" };
    if (lock.state !== "claimed") return { ok: false, error: "BUSY" };

    const cas = await prisma.user.updateMany({
        where: { id: user.id, refWelcomeRedeemedAt: null },
        data: { refWelcomeRedeemedAt: new Date(now) },
    });
    if (!cas?.count) {
        await completeRedeemLock(lock.row, { note: `${code}|already` });
        return { ok: false, error: "ALREADY_REDEEMED" };
    }

    const rolled = rollWelcomeTokens({
        minM: cfg.welcomeTokenMinM,
        maxM: cfg.welcomeTokenMaxM,
        rng,
    });

    const minted = await mintFreshGiftKey({
        user,
        tokens: rolled.tokens,
        validDays: cfg.tokenNewKeyDays,
        rpm: cfg.tokenNewKeyRpm,
        label: "ref-welcome",
        keyCfg: serverInfo.keyCfg,
        profileId: serverInfo.profileId,
    });

    if (!minted.ok) {
        await prisma.user.updateMany({
            where: { id: user.id },
            data: { refWelcomeRedeemedAt: null },
        }).catch(() => {});
        await failRedeemLock(lock.row, minted.message || minted.code, { retryable: false, now });
        return { ok: false, error: "GATEWAY_FAILED", message: minted.message };
    }

    userCache.invalidate?.(`user:${tgId}`);
    await completeRedeemLock(lock.row, {
        tokensGranted: rolled.tokens,
        issuedKeyId: minted.issuedKeyId,
        externalId: minted.externalId,
        note: code,
    });

    return {
        ok: true,
        code,
        tokens: rolled.tokens,
        validDays: cfg.tokenNewKeyDays,
        keyData: minted,
    };
}

// ─── Pipeline Xác minh Kênh toàn diện (`processReferralOnboarding`) ──────────

/**
 * Gọi khi user ĐÃ Ở TRONG KÊNH bắt buộc (lúc qua cổng onboarding hoặc bấm "Kiểm tra Join"):
 *   1. Đánh dấu `hasJoinedChannel = true`.
 *   2. Nếu lần đầu join & có `refWelcomeCode` → tự động đổi Welcome Key 5M–10M (hoặc trả mã nếu kẹt).
 *   3. Kiểm tra Age Gate (Peer Envelope 7 ngày, miễn TG Premium). Chưa đủ tuổi → hoãn điểm + hoãn invite gift.
 *   4. Đủ tuổi → CAS `channelPointAwarded: false → true`, cộng `pointJoinChannel` cho cả 2 bên.
 *   5. Cấp cặp quà `ref_invite_token` (20M/1d cho bạn mới + 2M–7M cộng dồn cho người mời) + Mốc 5/10/20.
 */
export async function processReferralOnboarding(telegramUserOrId, { isPremium = false, now = Date.now() } = {}) {
    const tgId = typeof telegramUserOrId === "object" ? String(telegramUserOrId.id) : String(telegramUserOrId);
    const premiumFlag = Boolean(isPremium || (typeof telegramUserOrId === "object" && telegramUserOrId?.is_premium));

    let user = await prisma.user.findUnique({ where: { telegramId: tgId } });
    if (!user) return null;

    const priorJoined = Boolean(user.hasJoinedChannel);
    if (!priorJoined || (premiumFlag && !user.isTelegramPremium)) {
        const patch = {
            hasJoinedChannel: true,
            ...(premiumFlag ? { isTelegramPremium: true } : {}),
        };
        await prisma.user.update({ where: { id: user.id }, data: patch }).catch(() => {});
        user = { ...user, ...patch };
        userCache.set(`user:${tgId}`, user);
    }

    const cfg = await getReferralConfig();
    if (!cfg.referralEnabled || !user.referredBy) return null;

    // Khách đã từng /start trước đó quá 30p (late claim) không thuộc diện nhận thưởng / cộng điểm mời bạn
    if (user.referralLateClaim) {
        return {
            welcomeReward: null,
            ageGate: { deferred: false },
            pointsAwarded: null,
            inviteGrants: null,
        };
    }

    const referrer = await prisma.user.findUnique({ where: { id: user.referredBy } }).catch(() => null);
    if (!referrer) return null;

    // 1. Mã quà chào mừng WEL... ở lần xác minh join đầu tiên
    let welcomeReward = null;
    if (cfg.welcomeKeyEnabled && user.refWelcomeCode && !user.refWelcomeRedeemedAt && !priorJoined) {
        const welRes = await redeemWelcomeCode(tgId, user.refWelcomeCode, { bypassJoinCheck: true, now });
        if (welRes.ok) {
            welcomeReward = { status: "redeemed", code: user.refWelcomeCode, keyData: welRes.keyData };
            user = { ...user, refWelcomeRedeemedAt: new Date(now) };
        } else if (["DAY_CAP", "GATEWAY_FAILED", "GATEWAY_NOT_READY"].includes(welRes.error)) {
            welcomeReward = { status: "code_sent", code: user.refWelcomeCode, error: welRes.error };
        }
    }

    // 2. Age Gate Telegram (Peer Envelope)
    if (!user.channelPointAwarded) {
        const gate = await checkTelegramAgeGate(user, { isPremium: premiumFlag || user.isTelegramPremium, cfg, now });
        if (!gate.passed) {
            let firstDeferNotice = false;
            const deferLock = await claimRedeemLock({
                lockKey: `ref_age_defer|${tgId}`,
                telegramId: tgId,
                referrerTgId: referrer.telegramId,
                referredTgId: tgId,
                rewardType: "ref_age_defer",
                note: `min_${gate.minDays}d`,
                now,
            });
            if (deferLock.state === "claimed") {
                await completeRedeemLock(deferLock.row, { note: `deferred_${gate.remainingDays}d` });
                firstDeferNotice = true;
            }
            return {
                welcomeReward,
                ageGate: {
                    deferred: true,
                    remainingDays: gate.remainingDays,
                    minDays: gate.minDays,
                    estimatedAgeDays: gate.estimatedAgeDays,
                    firstDeferNotice,
                    referrerTgId: String(referrer.telegramId),
                    referrerLang: referrer.language || "vi",
                    userTgId: tgId,
                    userLang: user.language || "vi",
                },
                pointsAwarded: null,
                inviteGrants: null,
            };
        }
    }

    // 3. Cộng điểm join_channel (+1 cho cả 2 bên) bằng CAS chống cộng đúp
    let pointsAwarded = null;
    if (!user.channelPointAwarded) {
        const cas = await prisma.user.updateMany({
            where: { id: user.id, channelPointAwarded: { not: true } },
            data: { channelPointAwarded: true },
        });
        if (cas?.count) {
            user = { ...user, channelPointAwarded: true };
            userCache.set(`user:${tgId}`, user);

            const pts = cfg.pointJoinChannel;
            // Luôn ghi sự kiện join_channel để đua Top ngày đếm chính xác lượt mời hợp lệ
            await recordReferralEvent({
                referrerId: referrer.id,
                referrerTgId: referrer.telegramId,
                referredUserId: tgId,
                eventType: "join_channel",
                points: pts,
                now,
            });

            if (pts > 0) {
                await Promise.all([
                    prisma.user.update({ where: { id: referrer.id }, data: { referralPoints: { increment: pts } } }),
                    prisma.user.update({ where: { id: user.id }, data: { referralPoints: { increment: pts } } }),
                    recordReferralEvent({
                        referrerId: user.id,
                        referrerTgId: tgId,
                        referredUserId: tgId,
                        eventType: "join_channel_self",
                        points: pts,
                        now,
                    }),
                ]);
                userCache.invalidate?.(`user:${referrer.telegramId}`);
                userCache.invalidate?.(`user:${tgId}`);
                pointsAwarded = {
                    points: pts,
                    referrerTgId: String(referrer.telegramId),
                    referrerLang: referrer.language || "vi",
                    userTgId: tgId,
                    userLang: user.language || "vi",
                };
            }
        }
    }

    // 4. Cấp cặp quà token 2 phía + Mốc 5/10/20
    const inviteGrants = await grantReferralReward(tgId, user, { now });

    return {
        welcomeReward,
        ageGate: { deferred: false },
        pointsAwarded,
        inviteGrants,
    };
}

// ─── Hậu đơn hàng: Hoa hồng ví + Điểm đơn đầu (+3) + Coupon 3 Buyers ─────────

export async function processReferralCommission(userId, orderId, orderAmount, { telegram = null } = {}) {
    const cfg = await getReferralConfig();
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.referredBy) return null;

    const referrer = await prisma.user.findUnique({ where: { id: user.referredBy } });
    if (!referrer) return null;

    let commissionPaid = 0;

    // A. Hoa hồng % cộng ví (nếu shop bật REFERRAL_COMMISSION > 0)
    if (cfg.commissionPercent > 0 && orderAmount > 0) {
        const referral = await prisma.referral.findFirst({ where: { refereeId: userId } });
        const commission = Math.floor((orderAmount * cfg.commissionPercent) / 100);
        if (referral && commission > 0) {
            let wallet = await prisma.wallet.findUnique({ where: { odelegramId: referrer.telegramId } });
            if (!wallet) {
                wallet = await prisma.wallet.create({ data: { odelegramId: referrer.telegramId, balance: 0 } });
            }
            const alreadyPaid = await prisma.walletTransaction.findFirst({
                where: { walletId: wallet.id, orderId, type: "ADMIN_ADD" },
            });
            if (!alreadyPaid) {
                const updatedWallet = await prisma.wallet.update({
                    where: { id: wallet.id },
                    data: { balance: { increment: commission } },
                });
                await prisma.walletTransaction.create({
                    data: {
                        walletId: wallet.id,
                        type: "ADMIN_ADD",
                        amount: commission,
                        balanceBefore: updatedWallet.balance - commission,
                        balanceAfter: updatedWallet.balance,
                        description: `Hoa hồng giới thiệu #${orderId.slice(-8).toUpperCase()}`,
                        status: "SUCCESS",
                        orderId,
                    },
                });
                balanceCache.invalidate(referrer.telegramId);
                invalidateWalletCache(referrer.telegramId);
                await prisma.referral.update({
                    where: { id: referral.id },
                    data: {
                        orderId,
                        commission: { increment: commission },
                        status: "COMPLETED",
                    },
                });
                commissionPaid = commission;
            }
        }
    }

    // B. Cộng điểm đơn đầu tiên (+3 điểm) & Kiểm tra mốc 3 người mua tặng Coupon cá nhân (chỉ tính khách mới hợp lệ)
    let pointsAdded = 0;
    let personalCoupon = null;
    if (cfg.referralEnabled && orderAmount > 0 && !user.referralLateClaim && !user.referralPurchaseCounted && prisma.user.updateMany) {
        const firstBuyClaim = await prisma.user.updateMany({
            where: { id: user.id, referralPurchaseCounted: { not: true } },
            data: { referralPurchaseCounted: true },
        });
        if (firstBuyClaim?.count) {
            userCache.invalidate?.(`user:${user.telegramId}`);
            pointsAdded = cfg.pointPurchase;

            const updatedRef = await prisma.user.update({
                where: { id: referrer.id },
                data: {
                    totalReferredBuyers: { increment: 1 },
                    ...(pointsAdded > 0 ? { referralPoints: { increment: pointsAdded } } : {}),
                },
            });
            userCache.invalidate?.(`user:${referrer.telegramId}`);

            await recordReferralEvent({
                referrerId: referrer.id,
                referrerTgId: referrer.telegramId,
                referredUserId: user.telegramId,
                eventType: "purchase",
                points: pointsAdded,
                note: orderId,
            });

            // Đánh dấu Referral COMPLETED nếu chưa
            const refDoc = await prisma.referral.findFirst({ where: { refereeId: userId } }).catch(() => null);
            if (refDoc && refDoc.status !== "COMPLETED") {
                await prisma.referral.update({ where: { id: refDoc.id }, data: { orderId, status: "COMPLETED" } }).catch(() => {});
            }

            // Kiểm tra mốc N người được mời mua hàng → tặng mã giảm giá cá nhân (hạn 3 ngày)
            const totalBuyers = Number(updatedRef?.totalReferredBuyers) || 0;
            if (cfg.buyerTarget > 0 && cfg.personalVoucherPercent > 0 && totalBuyers >= cfg.buyerTarget && prisma.coupon?.create) {
                const vLockKey = `buyer_voucher|buyer_target|${referrer.telegramId}|${cfg.buyerTarget}`;
                const vLock = await claimRedeemLock({
                    lockKey: vLockKey,
                    telegramId: referrer.telegramId,
                    referrerTgId: referrer.telegramId,
                    rewardType: "buyer_voucher",
                    note: `${cfg.personalVoucherPercent}%`,
                });
                if (vLock.state === "claimed") {
                    const baseCode = `REF${cfg.personalVoucherPercent}-${referrer.telegramId}`;
                    let finalCode = baseCode;
                    const exists = await prisma.coupon.findUnique({ where: { code: finalCode } }).catch(() => null);
                    if (exists) finalCode = `${baseCode}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;

                    const expiresAt = new Date(Date.now() + 3 * 86_400_000);
                    const createdCoupon = await prisma.coupon.create({
                        data: {
                            code: finalCode,
                            discount: cfg.personalVoucherPercent,
                            discountType: "PERCENT",
                            maxUses: 1,
                            usedCount: 0,
                            vipOnly: 0,
                            expiresAt,
                            isActive: true,
                        },
                    }).catch((e) => {
                        console.error("[referral] tạo coupon mốc buyer lỗi:", e.message);
                        return null;
                    });

                    if (createdCoupon) {
                        const noteSuffix = cfg.extraWarrantyHours > 0
                            ? `${finalCode}|+${cfg.extraWarrantyHours}h_BH`
                            : finalCode;
                        await completeRedeemLock(vLock.row, { note: noteSuffix });
                        personalCoupon = {
                            code: finalCode,
                            percent: cfg.personalVoucherPercent,
                            extraWarrantyHours: cfg.extraWarrantyHours,
                            expiresAt: expiresAt.toISOString(),
                            buyerTarget: cfg.buyerTarget,
                        };
                    } else {
                        await failRedeemLock(vLock.row, "coupon_create_failed", { retryable: true });
                    }
                }
            }

            // Thông báo DM cho người mời nếu caller truyền telegram instance
            if (telegram && (pointsAdded > 0 || personalCoupon)) {
                const lines = [];
                if (pointsAdded > 0) {
                    lines.push(`🎉 <b>Bạn nhận được +${pointsAdded} điểm giới thiệu!</b>`);
                    lines.push(`Một người bạn do bạn giới thiệu vừa hoàn tất đơn hàng đầu tiên.`);
                    lines.push(`⭐ Điểm hiện có: <b>${Number(updatedRef?.referralPoints) || 0} điểm</b> (dùng lệnh /tok hoặc mục Giới thiệu để đổi lấy Token API).`);
                }
                if (personalCoupon) {
                    if (lines.length) lines.push("");
                    lines.push(`🎁 <b>THƯỞNG MỐC ${personalCoupon.buyerTarget} NGƯỜI MUA HÀNG!</b>`);
                    const bhText = personalCoupon.extraWarrantyHours > 0
                        ? ` + <b>${personalCoupon.extraWarrantyHours}h bảo hành cộng thêm</b>`
                        : "";
                    lines.push(`Mã giảm giá cá nhân <b>${personalCoupon.percent}%</b>${bhText} (hạn 3 ngày, 1 lượt dùng):`);
                    lines.push(`<code>${personalCoupon.code}</code>`);
                }
                telegram.sendMessage(referrer.telegramId, lines.join("\n"), { parse_mode: "HTML" }).catch(() => {});
            }
        }
    }

    if (!commissionPaid && !pointsAdded && !personalCoupon) return null;
    return { commission: commissionPaid, pointsAdded, personalCoupon, referrerId: referrer.id };
}

// ─── Nhánh 4: Đổi điểm lấy Token API (`token_newkey` / `token_topup`) ─────────

/** Tổng token đã đổi trong đợt hiện tại (từ `tokenRedeemResetAt`). */
export async function getUserRedeemedTokensInBatch(telegramId, cfg = null, now = Date.now()) {
    const conf = cfg || await getReferralConfig();
    if (!prisma.redeemRequest?.findMany) return 0;
    const where = {
        telegramId: String(telegramId),
        rewardType: { in: ["token_newkey", "token_topup"] },
    };
    if (conf.tokenRedeemResetAt) {
        where.createdAt = { gte: conf.tokenRedeemResetAt };
    }
    const rows = await prisma.redeemRequest.findMany({ where }).catch(() => []);
    const pendingCutoff = now - KEY_TOPUP_LEASE_MS;
    return (rows || []).reduce((sum, r) => {
        if (r.status === "completed") return sum + (Number(r.tokensGranted) || 0);
        if ((r.status === "pending" || r.status === "minting") && new Date(r.createdAt).getTime() >= pendingCutoff) {
            return sum + (Number(r.tokensGranted) || 0);
        }
        return sum;
    }, 0);
}

/** Danh sách tối đa 12 key còn hạn & hữu hạn quota của chính user để nạp cộng dồn. */
export async function listEligibleTopupKeys(telegramId, { limit = 12, now = Date.now() } = {}) {
    const rows = await prisma.issuedApiKey.findMany({
        where: { telegramId: String(telegramId), hiddenAt: null },
        orderBy: { createdAt: "desc" },
        take: 40,
    });
    const candidates = (rows || []).filter((k) => {
        if (!k.externalId || !k.key) return false;
        if (k.expiresAt && new Date(k.expiresAt).getTime() <= now + 60_000) return false;
        return true;
    });
    if (!candidates.length) return [];

    const out = [];
    for (const k of candidates) {
        if (out.length >= limit) break;
        const st = await getKeyStatus(k.externalId, k.profileId ?? null).catch(() => null);
        if (st?.ok) {
            const life = keyLifecycle({ ...st, expiresAt: st.expiresAt ?? k.expiresAt ?? null }, now);
            if (st.enabled === false || st.lockReason || life.expired || life.unlimitedQuota) continue;
            out.push({
                ...k,
                liveQuotaLimit: st.quotaLimit,
                liveQuotaUsed: st.quotaUsed,
                liveExpiresAt: st.expiresAt ?? k.expiresAt,
            });
        } else if (isTransientStatusFailure(st)) {
            // Mạng chập chờn vẫn hiện key chưa hết hạn theo DB, lúc bấm xác nhận sẽ kiểm lại
            out.push(k);
        }
    }
    return out;
}

async function validateAndDeductRedeemPoints(telegramId, pointsToUse, { now = Date.now() } = {}) {
    const cfg = await getReferralConfig();
    if (!cfg.referralEnabled || !cfg.redeemEnabled || !cfg.tokenRedeemEnabled) {
        return { ok: false, error: "DISABLED" };
    }
    const pts = Math.floor(Number(pointsToUse) || 0);
    if (pts < 1) return { ok: false, error: "INVALID_POINTS" };

    const tgId = String(telegramId);
    const user = await prisma.user.findUnique({ where: { telegramId: tgId } });
    if (!user) return { ok: false, error: "USER_NOT_FOUND" };
    if (user.isBlocked) return { ok: false, error: "BANNED" };
    if (isTooNewForRedeem(user, now)) return { ok: false, error: "TOO_NEW" };

    const curPoints = Number(user.referralPoints) || 0;
    if (curPoints < pts) return { ok: false, error: "NOT_ENOUGH", currentPoints: curPoints };

    if (user.lastTokenRedeemAt && isSameVnDay(user.lastTokenRedeemAt, now)) {
        return { ok: false, error: "DAILY_LIMIT" };
    }

    const wantTokens = pts * cfg.tokenPerPoint;
    const usedInBatch = await getUserRedeemedTokensInBatch(tgId, cfg, now);
    if (cfg.tokenMaxPerUser > 0 && usedInBatch + wantTokens > cfg.tokenMaxPerUser) {
        return {
            ok: false,
            error: "CAP_REACHED",
            remainingCapTokens: Math.max(0, cfg.tokenMaxPerUser - usedInBatch),
            maxCapTokens: cfg.tokenMaxPerUser,
        };
    }

    const serverInfo = await resolveReferralServerConfig();
    if (!serverInfo) return { ok: false, error: "GATEWAY_NOT_READY" };

    const prevRedeemAt = user.lastTokenRedeemAt || null;
    const todayStartUtc = vnDayStartUtc(vnDayKey(now));
    const deduct = await prisma.user.updateMany({
        where: {
            id: user.id,
            referralPoints: { gte: pts },
            ...(todayStartUtc
                ? { OR: [{ lastTokenRedeemAt: null }, { lastTokenRedeemAt: { lt: todayStartUtc } }] }
                : {}),
        },
        data: {
            referralPoints: { increment: -pts },
            lastTokenRedeemAt: new Date(now),
        },
    });
    if (!deduct?.count) {
        const latest = await prisma.user.findUnique({ where: { id: user.id } }).catch(() => null);
        if (latest?.lastTokenRedeemAt && isSameVnDay(latest.lastTokenRedeemAt, now)) {
            return { ok: false, error: "DAILY_LIMIT" };
        }
        return { ok: false, error: "NOT_ENOUGH", currentPoints: Number(latest?.referralPoints ?? curPoints) };
    }
    userCache.invalidate?.(`user:${tgId}`);

    return {
        ok: true,
        user,
        cfg,
        serverInfo,
        pts,
        wantTokens,
        prevRedeemAt,
    };
}

async function refundRedeemPoints(user, pts, prevRedeemAt) {
    await prisma.user.update({
        where: { id: user.id },
        data: {
            referralPoints: { increment: pts },
            lastTokenRedeemAt: prevRedeemAt,
        },
    }).catch((e) => console.error("[referral] hoàn điểm lỗi:", e.message));
    userCache.invalidate?.(`user:${user.telegramId}`);
}

/** Đổi điểm → Tạo API Key mới (`token_newkey`). */
export async function redeemPointsToNewKey(telegramId, pointsToUse, { now = Date.now() } = {}) {
    return withProcessLock(`redeem:${String(telegramId)}`, async () => {
        const prep = await validateAndDeductRedeemPoints(telegramId, pointsToUse, { now });
        if (!prep.ok) return prep;

        const { user, cfg, serverInfo, pts, wantTokens, prevRedeemAt } = prep;
        const reqRow = prisma.redeemRequest?.create
            ? await prisma.redeemRequest.create({
                data: {
                    telegramId: String(user.telegramId),
                    rewardType: "token_newkey",
                    pointsUsed: pts,
                    tokensGranted: wantTokens,
                    status: "minting",
                },
            })
            : null;

        const minted = await mintFreshGiftKey({
            user,
            tokens: wantTokens,
            validDays: cfg.tokenNewKeyDays,
            rpm: cfg.tokenNewKeyRpm,
            label: "referral-token",
            keyCfg: serverInfo.keyCfg,
            profileId: serverInfo.profileId,
            now,
        });

        if (!minted.ok) {
            if (isSafeApiKeyCreateFailure(minted)) {
                await refundRedeemPoints(user, pts, prevRedeemAt);
                await failRedeemLock(reqRow, minted.message || minted.code, { retryable: false, now });
                return { ok: false, error: "GATEWAY_FAILED", message: minted.message };
            }
            // Lỗi mạng mơ hồ sau khi request đã rời process — không hoàn điểm tự động tránh cấp đúp
            await failRedeemLock(reqRow, `ambiguous_newkey:${minted.code || "unknown"}`, { retryable: false, now });
            return { ok: false, error: "AMBIGUOUS_GATEWAY", message: "Kết nối nhà cung cấp gián đoạn khi tạo key; vui lòng kiểm tra /mykey hoặc liên hệ Admin đối soát." };
        }

        await completeRedeemLock(reqRow, {
            tokensGranted: wantTokens,
            issuedKeyId: minted.issuedKeyId,
            externalId: minted.externalId,
            note: "newkey",
        });

        const updatedUser = await prisma.user.findUnique({ where: { id: user.id } }).catch(() => null);
        const shouldBroadcast = shouldEmitTokenRedeemBroadcast(cfg, { now });
        return {
            ok: true,
            mode: "newkey",
            pointsUsed: pts,
            remainingPoints: Number(updatedUser?.referralPoints) ?? Math.max(0, (Number(user.referralPoints) || 0) - pts),
            tokensGranted: wantTokens,
            validDays: cfg.tokenNewKeyDays,
            broadcastSocialProof: shouldBroadcast,
            keyData: minted,
        };
    });
}

// ─── Nhánh 4B: 4 Tier Đổi Account / Sản phẩm Cổ điển (`basic`/`bh3d`/`bh7d`/`gpt`) ─

async function resolveClassicTierProduct(slugOrCode) {
    const clean = String(slugOrCode || "").trim();
    if (!clean || !prisma.product?.findUnique) return null;

    let prod = await prisma.product.findUnique({ where: { code: clean } }).catch(() => null);
    if (!prod && clean.toUpperCase() !== clean) {
        prod = await prisma.product.findUnique({ where: { code: clean.toUpperCase() } }).catch(() => null);
    }
    if (!prod && prisma.product.findFirst) {
        prod = await prisma.product.findFirst({
            where: { code: { equals: clean, mode: "insensitive" } },
        }).catch(() => null);
    }
    if (!prod) {
        prod = await prisma.product.findUnique({ where: { id: clean } }).catch(() => null);
    }
    if (!prod || !prod.isActive) return null;
    return prod;
}

/**
 * Liệt kê các Tier đổi Account/Sản phẩm cổ điển đang được cấu hình khác rỗng.
 * Khi cả 4 slug = `""`, trả mảng rỗng để Bot tự ẩn toàn bộ 4 nút.
 */
export async function listAvailableClassicRedeemTiers(cfgOverride = null) {
    const cfg = cfgOverride || await getReferralConfig();
    if (!cfg.referralEnabled || !cfg.redeemEnabled) return [];

    const tiers = [
        { key: "basic", slug: cfg.redeemBasicSlug, cost: cfg.redeemBasicPoints, defaultLabel: "Tài khoản Basic", icon: "🎁" },
        { key: "bh3d", slug: cfg.redeemBh3dSlug, cost: cfg.redeemBh3dPoints, defaultLabel: "Tài khoản BH 3 ngày", icon: "🛡️" },
        { key: "bh7d", slug: cfg.redeemBh7dSlug, cost: cfg.redeemBh7dPoints, defaultLabel: "Tài khoản BH 7 ngày", icon: "💎" },
        { key: "gpt", slug: cfg.redeemGptSlug, cost: cfg.redeemGptPoints, defaultLabel: "Tài khoản GPT 7 ngày", icon: "🤖" },
    ].filter((t) => Boolean(t.slug));

    if (!tiers.length) return [];

    const resolved = [];
    for (const t of tiers) {
        const prod = await resolveClassicTierProduct(t.slug);
        if (!prod) continue;
        let stockCount = null;
        let inStock = true;
        if (prod.deliveryMode === "STOCK_LINES" && typeof getStockCount === "function") {
            stockCount = await getStockCount(prod.id).catch(() => 0);
            inStock = (Number(stockCount) || 0) > 0;
        }
        resolved.push({
            key: t.key,
            icon: t.icon,
            label: prod.name || t.defaultLabel,
            cost: t.cost,
            slug: t.slug,
            productId: prod.id,
            productCode: prod.code,
            productName: prod.name,
            deliveryMode: prod.deliveryMode,
            stockCount,
            inStock,
        });
    }
    return resolved;
}

/**
 * Đổi điểm lấy sản phẩm ở 1 trong 4 tier cổ điển (`basic`, `bh3d`, `bh7d`, `gpt`):
 *   - Cooldown 3 ngày kiểm tra trên `User.lastRedeemAt` (tách riêng khỏi `lastTokenRedeemAt`)
 *   - Chặn clone mới (`isTooNewForRedeem`)
 *   - Tạo `Order` giá `0đ` (`paymentMethod = "referral_points"`) và gọi `deliverFn` để xuất kho tự động;
 *     nếu kho vừa hết hoặc giao lỗi thì tự động hoàn điểm & khôi phục `lastRedeemAt`.
 */
export async function redeemPointsToClassicProduct(
    telegramId,
    tierKey,
    { deliverFn = null, now = Date.now() } = {},
) {
    return withProcessLock(`redeem:${String(telegramId)}`, async () => {
        const cfg = await getReferralConfig();
        if (!cfg.referralEnabled || !cfg.redeemEnabled) {
            return { ok: false, error: "DISABLED" };
        }

        const tierMap = {
            basic: { slug: cfg.redeemBasicSlug, cost: cfg.redeemBasicPoints },
            bh3d: { slug: cfg.redeemBh3dSlug, cost: cfg.redeemBh3dPoints },
            bh7d: { slug: cfg.redeemBh7dSlug, cost: cfg.redeemBh7dPoints },
            gpt: { slug: cfg.redeemGptSlug, cost: cfg.redeemGptPoints },
        };
        const tierInfo = tierMap[String(tierKey || "").toLowerCase()];
        if (!tierInfo || !tierInfo.slug) {
            return { ok: false, error: "TIER_NOT_CONFIGURED" };
        }

        const product = await resolveClassicTierProduct(tierInfo.slug);
        if (!product) {
            return { ok: false, error: "PRODUCT_UNAVAILABLE" };
        }

        const tgId = String(telegramId);
        const user = await prisma.user.findUnique({ where: { telegramId: tgId } });
        if (!user) return { ok: false, error: "USER_NOT_FOUND" };
        if (user.isBlocked) return { ok: false, error: "BANNED" };
        if (isTooNewForRedeem(user, now)) return { ok: false, error: "TOO_NEW" };

        const cd = evaluateClassicRedeemCooldown(user.lastRedeemAt, now);
        if (!cd.ready) {
            return {
                ok: false,
                error: "COOLDOWN",
                remainingHours: cd.remainingHours,
                nextAvailableAt: cd.nextAvailableAt,
            };
        }

        const cost = Math.max(1, Math.floor(Number(tierInfo.cost) || 1));
        const curPoints = Number(user.referralPoints) || 0;
        if (curPoints < cost) {
            return { ok: false, error: "NOT_ENOUGH", currentPoints: curPoints, requiredPoints: cost };
        }

        if (product.deliveryMode === "STOCK_LINES" && typeof getStockCount === "function") {
            const stock = await getStockCount(product.id).catch(() => 0);
            if ((Number(stock) || 0) < 1) {
                return { ok: false, error: "OUT_OF_STOCK" };
            }
        }

        const prevLastRedeemAt = user.lastRedeemAt || null;
        const cooldownCutoff = new Date(now - CLASSIC_REDEEM_COOLDOWN_MS);
        const deduct = await prisma.user.updateMany({
            where: {
                id: user.id,
                referralPoints: { gte: cost },
                OR: [{ lastRedeemAt: null }, { lastRedeemAt: { lte: cooldownCutoff } }],
            },
            data: {
                referralPoints: { increment: -cost },
                lastRedeemAt: new Date(now),
            },
        });
        if (!deduct?.count) {
            const latest = await prisma.user.findUnique({ where: { id: user.id } }).catch(() => null);
            const latestCd = evaluateClassicRedeemCooldown(latest?.lastRedeemAt, now);
            if (!latestCd.ready) {
                return {
                    ok: false,
                    error: "COOLDOWN",
                    remainingHours: latestCd.remainingHours,
                    nextAvailableAt: latestCd.nextAvailableAt,
                };
            }
            return { ok: false, error: "NOT_ENOUGH", currentPoints: Number(latest?.referralPoints ?? curPoints), requiredPoints: cost };
        }
        userCache.invalidate?.(`user:${tgId}`);

        const rewardType = `classic_${String(tierKey).toLowerCase()}`;
        const reqRow = prisma.redeemRequest?.create
            ? await prisma.redeemRequest.create({
                data: {
                    telegramId: tgId,
                    rewardType,
                    pointsUsed: cost,
                    tokensGranted: 0,
                    status: "minting",
                    note: product.code || product.id,
                },
            })
            : null;

        let order = null;
        try {
            order = await prisma.order.create({
                data: {
                    odelegramId: tgId,
                    chatId: tgId,
                    userId: user.id,
                    productId: product.id,
                    quantity: 1,
                    amount: 0,
                    discount: 0,
                    finalAmount: 0,
                    currency: product.currency || "VND",
                    status: "PAID",
                    paymentMethod: "referral_points",
                },
            });

            let deliverRes = null;
            if (typeof deliverFn === "function") {
                deliverRes = await deliverFn({ orderId: order.id, order, product });
            }

            const freshOrder = await prisma.order.findUnique({ where: { id: order.id } }).catch(() => order);
            if (freshOrder?.status === "CANCELED" || deliverRes?.deliveryRef === "OUT_OF_STOCK") {
                await prisma.user.update({
                    where: { id: user.id },
                    data: { referralPoints: { increment: cost }, lastRedeemAt: prevLastRedeemAt },
                }).catch(() => {});
                userCache.invalidate?.(`user:${tgId}`);
                await failRedeemLock(reqRow, "out_of_stock", { retryable: false, now });
                return { ok: false, error: "OUT_OF_STOCK" };
            }

            await completeRedeemLock(reqRow, {
                tokensGranted: 0,
                externalId: order.id,
                note: `${product.code || product.name}|order:${order.id}`,
            });

            const updatedUser = await prisma.user.findUnique({ where: { id: user.id } }).catch(() => null);
            return {
                ok: true,
                tierKey: String(tierKey).toLowerCase(),
                productId: product.id,
                productCode: product.code,
                productName: product.name,
                orderId: order.id,
                pointsUsed: cost,
                remainingPoints: Number(updatedUser?.referralPoints) ?? Math.max(0, curPoints - cost),
            };
        } catch (err) {
            await prisma.user.update({
                where: { id: user.id },
                data: { referralPoints: { increment: cost }, lastRedeemAt: prevLastRedeemAt },
            }).catch(() => {});
            userCache.invalidate?.(`user:${tgId}`);
            if (order?.id && prisma.order?.update) {
                await prisma.order.update({
                    where: { id: order.id },
                    data: { status: "CANCELED", cancelReason: "referral_delivery_failed" },
                }).catch(() => {});
            }
            await failRedeemLock(reqRow, err.message, { retryable: false, now });
            return { ok: false, error: "DELIVERY_FAILED", message: err.message };
        }
    });
}

/** Đổi điểm → Nạp cộng dồn vào key sẵn có (`token_topup`, `addDays = 0`). */
export async function redeemPointsToTopup(telegramId, pointsToUse, { issuedKeyId = null, rawSkKey = null, now = Date.now() } = {}) {
    return withProcessLock(`redeem:${String(telegramId)}`, async () => {
        const tgId = String(telegramId);
        let keyRow = null;
        if (issuedKeyId) {
            keyRow = await prisma.issuedApiKey.findFirst({
                where: { id: String(issuedKeyId), telegramId: tgId, hiddenAt: null },
            });
        } else if (rawSkKey) {
            const cleanSk = String(rawSkKey).trim();
            keyRow = await prisma.issuedApiKey.findFirst({
                where: { key: cleanSk, telegramId: tgId, hiddenAt: null },
            });
        }
        if (!keyRow || !keyRow.externalId) {
            return { ok: false, error: "KEY_NOT_FOUND" };
        }
        if (keyRow.expiresAt && new Date(keyRow.expiresAt).getTime() <= now + 60_000) {
            return { ok: false, error: "KEY_EXPIRED" };
        }

        const st = await getKeyStatus(keyRow.externalId, keyRow.profileId ?? null);
        if (!st?.ok) return { ok: false, error: "KEY_STATUS_UNAVAILABLE", message: st?.message };
        const life = keyLifecycle({ ...st, expiresAt: st.expiresAt ?? keyRow.expiresAt ?? null }, now);
        if (st.enabled === false || st.lockReason) return { ok: false, error: "KEY_DISABLED" };
        if (life.expired) return { ok: false, error: "KEY_EXPIRED" };
        if (life.unlimitedQuota) return { ok: false, error: "KEY_UNLIMITED" };

        const prep = await validateAndDeductRedeemPoints(tgId, pointsToUse, { now });
        if (!prep.ok) return prep;

        const { user, serverInfo, pts, wantTokens, prevRedeemAt } = prep;
        const reqRow = prisma.redeemRequest?.create
            ? await prisma.redeemRequest.create({
                data: {
                    telegramId: tgId,
                    rewardType: "token_topup",
                    pointsUsed: pts,
                    tokensGranted: wantTokens,
                    issuedKeyId: keyRow.id,
                    externalId: keyRow.externalId,
                    status: "minting",
                },
            })
            : null;

        const leased = await claimIssuedKeyTopupLease(keyRow.id, now);
        if (!leased) {
            await refundRedeemPoints(user, pts, prevRedeemAt);
            await failRedeemLock(reqRow, "lease_busy", { retryable: false, now });
            return { ok: false, error: "KEY_BUSY" };
        }

        try {
            const renewed = await renewApiKey({
                externalId: keyRow.externalId,
                addTokens: wantTokens,
                addDays: 0,
                profileId: keyRow.profileId ?? null,
            });
            if (!renewed?.ok) {
                await releaseIssuedKeyTopupLease(keyRow.id);
                if (isSafePrePatchRenewFailure(renewed?.code)) {
                    await refundRedeemPoints(user, pts, prevRedeemAt);
                    await failRedeemLock(reqRow, renewed?.message || renewed?.code, { retryable: false, now });
                    return { ok: false, error: "GATEWAY_FAILED", message: renewed?.message };
                }
                // Lỗi sau khi PATCH có thể đã cộng quota trên provider — không hoàn điểm mù quáng
                await failRedeemLock(reqRow, `ambiguous_topup:${renewed?.code || "unknown"}`, { retryable: false, now });
                return { ok: false, error: "AMBIGUOUS_GATEWAY", message: "Đã gửi lệnh nạp nhưng phản hồi nhà cung cấp không chắc chắn; vui lòng kiểm tra /mykey hoặc liên hệ Admin." };
            }

            const profCfg = await getProfileConfig(keyRow.profileId ?? null).catch(() => serverInfo.keyCfg);
            const newTotalTokens = renewed.after?.quotaLimit
                ? toDisplayTokens(renewed.after.quotaLimit, renewed.quotaRefPrice || profCfg?.quotaRefPrice || 0)
                : (Number(keyRow.quotaTokens) || 0) + wantTokens;
            const finalExpiresIso = renewed.after?.expiresAt || (keyRow.expiresAt ? new Date(keyRow.expiresAt).toISOString() : null);

            await prisma.issuedApiKey.update({
                where: { id: keyRow.id },
                data: {
                    quotaTokens: newTotalTokens,
                    renewCount: { increment: 1 },
                    lastRenewAt: new Date(now),
                    notifyStage: 0,
                    renewWipAt: null,
                },
            }).catch(() => releaseIssuedKeyTopupLease(keyRow.id));

            invalidateKeyStatusCache?.();
            await completeRedeemLock(reqRow, {
                tokensGranted: wantTokens,
                issuedKeyId: keyRow.id,
                externalId: keyRow.externalId,
                note: `topup|${keyRow.id}`,
            });

            const updatedUser = await prisma.user.findUnique({ where: { id: user.id } }).catch(() => null);
            return {
                ok: true,
                mode: "topup",
                pointsUsed: pts,
                remainingPoints: Number(updatedUser?.referralPoints) ?? Math.max(0, (Number(user.referralPoints) || 0) - pts),
                tokensGranted: wantTokens,
                totalTokens: newTotalTokens,
                keyData: {
                    key: keyRow.key,
                    quotaTokens: newTotalTokens,
                    tokensAdded: wantTokens,
                    totalTokens: newTotalTokens,
                    rpm: renewed.after?.rpm || keyRow.rpm,
                    expiresAt: finalExpiresIso,
                    models: keyRow.models || [],
                    endpoint: profCfg?.endpoint || serverInfo.keyCfg.endpoint || "",
                    docUrl: profCfg?.docUrl || serverInfo.keyCfg.docUrl || "",
                    usageUrl: profCfg?.usageUrl || serverInfo.keyCfg.usageUrl || "",
                    telegramId: tgId,
                    language: user.language || "vi",
                },
            };
        } catch (err) {
            await releaseIssuedKeyTopupLease(keyRow.id);
            await failRedeemLock(reqRow, `ambiguous_topup_exc:${err.message}`, { retryable: false, now });
            return { ok: false, error: "AMBIGUOUS_GATEWAY", message: err.message };
        }
    });
}

// ─── Nhánh 2B & 2C: Cron Đua Top Ngày, Cảnh báo hết hạn & Tự phục hồi ─────────

/**
 * Phát thưởng cho 1 người thắng Top ngày:
 *   - Có sẵn key còn hạn & hữu hạn quota → nạp cộng dồn (`addDays = 0`).
 *   - Chưa có → tạo key mới hạn `cfg.inviteTokenDays` (1 ngày).
 */
async function grantDailyTopPrizeToWinner({ winnerTgId, rank, dayKey, tokens, cfg, serverInfo, now = Date.now() }) {
    const lockKey = `ref_daily_top|daily_top|${dayKey}|rank${rank}`;
    const lock = await claimRedeemLock({
        lockKey,
        telegramId: winnerTgId,
        referrerTgId: winnerTgId,
        rewardType: "ref_daily_top",
        tokensGranted: tokens,
        note: `${dayKey}|rank${rank}`,
        now,
    });
    if (lock.state === "already_completed") return { outcome: "already_completed", prize: null };
    if (lock.state !== "claimed") return { outcome: "transient_failure", prize: null };

    const user = await prisma.user.findUnique({ where: { telegramId: String(winnerTgId) } });
    if (!user) {
        await failRedeemLock(lock.row, "user_not_found", { retryable: false, now });
        return { outcome: "permanent_skip", prize: null };
    }

    // Ưu tiên nạp vào key còn hạn dài nhất của người thắng
    const eligible = await listEligibleTopupKeys(winnerTgId, { limit: 10, now });
    eligible.sort((a, b) => new Date(b.liveExpiresAt || b.expiresAt || 0).getTime() - new Date(a.liveExpiresAt || a.expiresAt || 0).getTime());

    if (eligible.length > 0) {
        const target = eligible[0];
        const leased = await claimIssuedKeyTopupLease(target.id, now);
        if (leased) {
            const renewed = await renewApiKey({
                externalId: target.externalId,
                addTokens: tokens,
                addDays: 0,
                profileId: target.profileId ?? null,
            });
            if (renewed?.ok) {
                const profCfg = await getProfileConfig(target.profileId ?? null).catch(() => serverInfo.keyCfg);
                const newTotal = renewed.after?.quotaLimit
                    ? toDisplayTokens(renewed.after.quotaLimit, renewed.quotaRefPrice || profCfg?.quotaRefPrice || 0)
                    : (Number(target.quotaTokens) || 0) + tokens;
                const expIso = renewed.after?.expiresAt || (target.expiresAt ? new Date(target.expiresAt).toISOString() : null);
                await prisma.issuedApiKey.update({
                    where: { id: target.id },
                    data: {
                        quotaTokens: newTotal,
                        renewCount: { increment: 1 },
                        lastRenewAt: new Date(now),
                        notifyStage: 0,
                        renewWipAt: null,
                    },
                }).catch(() => releaseIssuedKeyTopupLease(target.id));
                invalidateKeyStatusCache?.();
                await completeRedeemLock(lock.row, {
                    tokensGranted: tokens,
                    issuedKeyId: target.id,
                    externalId: target.externalId,
                    note: `${dayKey}|rank${rank}|topup`,
                });
                return {
                    outcome: "granted",
                    prize: {
                        rank,
                        mode: "topup",
                        telegramId: String(winnerTgId),
                        language: user.language || "vi",
                        tokensAdded: tokens,
                        totalTokens: newTotal,
                        key: target.key,
                        expiresAt: expIso,
                        rpm: renewed.after?.rpm || target.rpm,
                        endpoint: profCfg?.endpoint || serverInfo.keyCfg.endpoint || "",
                        docUrl: profCfg?.docUrl || serverInfo.keyCfg.docUrl || "",
                    },
                };
            }
            await releaseIssuedKeyTopupLease(target.id);
        }
    }

    // Chưa có key còn hạn → tạo key mới hạn inviteTokenDays (mặc định 1 ngày)
    const minted = await mintFreshGiftKey({
        user,
        tokens,
        validDays: cfg.inviteTokenDays,
        rpm: cfg.tokenNewKeyRpm,
        label: `ref-top${rank}`,
        keyCfg: serverInfo.keyCfg,
        profileId: serverInfo.profileId,
    });
    if (!minted.ok) {
        await failRedeemLock(lock.row, minted.message || minted.code, { retryable: true, now });
        return { outcome: "transient_failure", prize: null };
    }

    await completeRedeemLock(lock.row, {
        tokensGranted: tokens,
        issuedKeyId: minted.issuedKeyId,
        externalId: minted.externalId,
        note: `${dayKey}|rank${rank}|newkey`,
    });
    return {
        outcome: "granted",
        prize: {
            rank,
            mode: "new",
            ...minted,
        },
    };
}

/** Chạy trả thưởng Đua Top 1–2–3 của ngày hôm qua (giờ Việt Nam). */
export async function payReferralDailyTopPrizes({ dayKey = null, now = Date.now() } = {}) {
    const cfg = await getReferralConfig();
    if (!cfg.referralEnabled || !cfg.dailyTopEnabled) return { skipped: "disabled", winners: [] };

    const targetDayKey = dayKey || vnDayKey(now - 86_400_000);
    if (!dayKey && cfg.dailyTopLastPaidDate === targetDayKey) {
        return { skipped: "already_paid", dayKey: targetDayKey, winners: [] };
    }

    const startUtc = vnDayStartUtc(targetDayKey);
    if (!startUtc) return { skipped: "bad_date", winners: [] };
    const endUtc = new Date(startUtc.getTime() + 86_400_000);

    const serverInfo = await resolveReferralServerConfig();
    if (!serverInfo) return { skipped: "gateway_not_ready", winners: [] };

    const events = await prisma.referralEvent.findMany({
        where: {
            eventType: "join_channel",
            createdAt: { gte: startUtc, lt: endUtc },
        },
    }).catch(() => []);

    const ranked = rankDailyTopReferrers(events).slice(0, 3);
    const prizes = [cfg.dailyTop1Tokens, cfg.dailyTop2Tokens, cfg.dailyTop3Tokens];
    const winners = [];
    let hadTransientFailure = false;

    for (let i = 0; i < ranked.length; i++) {
        const prize = prizes[i] || 0;
        if (prize <= 0) continue;
        const out = await grantDailyTopPrizeToWinner({
            winnerTgId: ranked[i].referrerTgId,
            rank: i + 1,
            dayKey: targetDayKey,
            tokens: prize,
            cfg,
            serverInfo,
            now,
        });
        if (out?.outcome === "granted" && out.prize) {
            winners.push({ ...out.prize, inviteCount: ranked[i].count, dayKey: targetDayKey });
        } else if (out?.outcome === "transient_failure") {
            hadTransientFailure = true;
        }
    }

    // Chỉ chốt mốc ngày khi TẤT CẢ hạng đã xử lý xong (từng hạng đã có lockKey riêng chống phát trùng)
    if (!hadTransientFailure) {
        await prisma.setting.upsert({
            where: { key: "referralDailyTopLastPaidDate" },
            update: { value: targetDayKey },
            create: { key: "referralDailyTopLastPaidDate", value: targetDayKey },
        });
        invalidateReferralConfig();
    }

    return {
        skipped: hadTransientFailure ? "partial_retry_pending" : null,
        dayKey: targetDayKey,
        winners,
    };
}

/** Quét các Referral Key 30 ngày còn <= 3 ngày hoặc <= 1 ngày để gửi DM cảnh báo đúng 1 lần. */
export async function collectExpiringReferralBonusWarnings({ now = Date.now() } = {}) {
    const cfg = await getReferralConfig();
    if (!cfg.referralEnabled || !cfg.expiryWarnEnabled) return [];

    const users = await prisma.user.findMany({
        where: { referralBonusKeyId: { not: null } },
        select: { id: true, telegramId: true, language: true, referralBonusKeyId: true },
    }).catch(() => []);
    if (!users?.length) return [];

    const alerts = [];
    for (const u of users) {
        if (!u.referralBonusKeyId || String(u.referralBonusKeyId).startsWith("pending:")) continue;
        const keyRow = await prisma.issuedApiKey.findUnique({ where: { id: String(u.referralBonusKeyId) } }).catch(() => null);
        if (!keyRow || keyRow.hiddenAt || !keyRow.expiresAt) continue;

        const expMs = new Date(keyRow.expiresAt).getTime();
        if (!Number.isFinite(expMs) || expMs <= now) continue;
        const daysLeft = (expMs - now) / 86_400_000;

        let threshold = null;
        if (daysLeft <= 1) threshold = 1;
        else if (daysLeft <= 3) threshold = 3;
        if (!threshold) continue;

        const lockKey = `ref_expiry_warn|${keyRow.id}|${threshold}`;
        const claim = await claimRedeemLock({
            lockKey,
            telegramId: u.telegramId,
            rewardType: "ref_expiry_warn",
            issuedKeyId: keyRow.id,
            note: `${threshold}d`,
            now,
        });
        if (claim.state !== "claimed") continue;

        await completeRedeemLock(claim.row, { note: `${threshold}d` });
        alerts.push({
            telegramId: String(u.telegramId),
            language: u.language || "vi",
            thresholdDays: threshold,
            daysLeft: Math.max(0.1, Number(daysLeft.toFixed(1))),
            key: keyRow.key,
            quotaTokens: Number(keyRow.quotaTokens) || 0,
            expiresAt: new Date(keyRow.expiresAt).toISOString(),
        });
    }
    return alerts;
}

/** Dọn lease kẹt > 10 phút & retry các lượt tặng `ref_invite_token` bị lỗi mạng tạm thời. */
export async function resumeStuckReferralGrants({ now = Date.now(), budget = 5 } = {}) {
    const maxRows = Math.max(1, Math.min(50, Number(budget) || 5));
    if (prisma.issuedApiKey?.updateMany) {
        const staleLeaseCutoff = new Date(now - KEY_TOPUP_LEASE_MS);
        await prisma.issuedApiKey.updateMany({
            where: { renewWipAt: { lt: staleLeaseCutoff } },
            data: { renewWipAt: null },
        }).catch(() => {});
    }

    if (!prisma.redeemRequest?.findMany) return [];
    const failedRows = await prisma.redeemRequest.findMany({
        where: {
            rewardType: { in: ["ref_invite_token", "ref_milestone"] },
            status: "failed",
            retryCount: { lt: GW_RETRY_MAX },
            nextRetryAt: { lte: new Date(now) },
        },
        orderBy: { createdAt: "asc" },
        take: maxRows,
    }).catch(() => []);

    const recovered = [];
    for (const row of failedRows || []) {
        if (row.rewardType === "ref_milestone") {
            const refTg = row.referrerTgId || row.telegramId;
            const referrer = refTg ? await prisma.user.findUnique({ where: { telegramId: String(refTg) } }).catch(() => null) : null;
            const serverInfo = referrer ? await resolveReferralServerConfig() : null;
            const cfg = await getReferralConfig();
            if (referrer && serverInfo) {
                const ms = await grantDueMilestonesForReferrer({
                    referrer,
                    cfg,
                    keyCfg: serverInfo.keyCfg,
                    profileId: serverInfo.profileId,
                    now,
                }).catch(() => []);
                if (ms.length) recovered.push({ referee: null, referrer: null, milestones: ms });
            } else if (!referrer) {
                await failRedeemLock(row, "referrer_not_found", { retryable: false, now });
            }
            await new Promise((r) => setTimeout(r, 400));
            continue;
        }

        if (!row.referredTgId) {
            await failRedeemLock(row, "missing_referred_tg_id", { retryable: false, now });
            continue;
        }
        const res = await grantReferralReward(row.referredTgId, null, { now }).catch(() => null);
        if (res) {
            recovered.push(res);
        } else {
            // Chống Head-of-Line Blocking: nếu grantReferralReward thoát sớm (hết hạn 48h, chạm trần, tắt ref, hoặc đã phát xong)
            // mà không đụng tới row, cập nhật trạng thái/backoff để không giữ kẹt slot đầu hàng đợi mãi mãi.
            const after = row.lockKey && prisma.redeemRequest?.findFirst
                ? await prisma.redeemRequest.findFirst({ where: { lockKey: row.lockKey } }).catch(() => null)
                : null;
            const unchanged = !after || (after.status === "failed" && Number(after.retryCount || 0) === Number(row.retryCount || 0));
            if (unchanged) {
                const referee = await prisma.user.findUnique({ where: { telegramId: String(row.referredTgId) } }).catch(() => null);
                const refDoc = referee
                    ? await prisma.referral.findFirst({ where: { refereeId: referee.id } }).catch(() => null)
                    : null;
                if (refDoc?.rewardRefereeAt && refDoc?.rewardReferrerAt) {
                    await completeRedeemLock(row, { note: `${row.note || "invite"}|synced` });
                } else {
                    const unrecoverable = !referee || !referee.referredBy || !isBrandNewForInvite(referee, now);
                    await failRedeemLock(
                        row,
                        unrecoverable ? "ineligible_or_expired" : (row.note || "deferred_early_exit"),
                        { retryable: !unrecoverable, now },
                    );
                }
            }
        }
        await new Promise((r) => setTimeout(r, 400)); // Pacing 400ms tránh dồn 429 lên provider
    }
    return recovered;
}

// ─── Admin Bonus Điểm (`/refbonus` & Web Admin) ───────────────────────────────

export async function adminAdjustReferralPoints({ target, deltaPoints, reason = "", adminId = "admin" }) {
    const rawTarget = String(target || "").trim();
    const numDelta = Number(deltaPoints);
    if (!rawTarget || !Number.isFinite(numDelta) || !Number.isInteger(numDelta) || numDelta === 0) {
        return { ok: false, error: "Số điểm phải là số nguyên khác 0" };
    }
    const delta = numDelta;

    let initialUser = null;
    if (rawTarget.startsWith("@")) {
        const uname = rawTarget.slice(1).trim();
        initialUser = await prisma.user.findFirst({
            where: { username: { equals: uname, mode: "insensitive" } },
        }).catch(() => null);
    } else if (/^\d+$/.test(rawTarget)) {
        initialUser = await prisma.user.findUnique({ where: { telegramId: rawTarget } });
    }
    if (!initialUser) {
        initialUser = await prisma.user.findUnique({ where: { id: rawTarget } }).catch(() => null);
    }
    if (!initialUser) return { ok: false, error: "Không tìm thấy người dùng" };

    return withProcessLock(`redeem:${String(initialUser.telegramId)}`, async () => {
        const user = await prisma.user.findUnique({ where: { id: initialUser.id } }).catch(() => initialUser) || initialUser;
        const cur = Number(user.referralPoints) || 0;
        const nextPts = Math.max(0, cur + delta);
        const actualDelta = nextPts - cur;

        const updateData = typeof user.referralPoints === "number" && actualDelta !== 0
            ? { referralPoints: { increment: actualDelta } }
            : { referralPoints: nextPts };
        const updated = await prisma.user.update({
            where: { id: user.id },
            data: updateData,
        });
        userCache.invalidate?.(`user:${user.telegramId}`);

        await recordReferralEvent({
            referrerId: user.id,
            referrerTgId: user.telegramId,
            referredUserId: "ADMIN_BONUS",
            eventType: "admin_bonus",
            points: actualDelta,
            note: reason ? `${adminId}: ${reason}` : String(adminId),
        });

        return {
            ok: true,
            user: updated,
            previousPoints: cur,
            newPoints: Number(updated?.referralPoints ?? nextPts),
            delta: actualDelta,
            reason,
        };
    });
}

// ─── Thống kê User, Bảng xếp hạng & Đối soát Admin ────────────────────────────

export function getReferralLink(botUsername, codeOrTelegramId) {
    const val = String(codeOrTelegramId || "").trim();
    // Nếu truyền Telegram ID số → tạo link chuẩn ?start=ref<tgId>; nếu mã hex cũ → ?start=ref_<code>
    if (/^\d{5,16}$/.test(val)) {
        return `https://t.me/${botUsername}?start=ref${val}`;
    }
    return `https://t.me/${botUsername}?start=ref_${val}`;
}

export async function getReferralStats(userId, userObj = null) {
    const [user, referrals, cfg, serverInfo] = await Promise.all([
        userObj && userObj.id === userId ? userObj : prisma.user.findUnique({ where: { id: userId } }),
        prisma.referral.findMany({ where: { referrerId: userId } }),
        getReferralConfig(),
        resolveReferralServerConfig().catch(() => null),
    ]);
    if (!user) return null;

    const totalCommission = referrals.reduce((sum, r) => sum + (Number(r.commission) || 0), 0);
    const referralCount = Math.max(referrals.length, Number(user.totalSuccessfulReferrals) || 0);
    const completedCount = referrals.filter((r) => r.status === "COMPLETED").length;
    const rewardedCount = referrals.filter((r) => r.rewardReferrerAt).length;
    const buyersCount = Math.max(completedCount, Number(user.totalReferredBuyers) || 0);

    const [bonusKeyRow, usedTokensInBatch, inviterUser, joinEvents] = await Promise.all([
        user.referralBonusKeyId && !String(user.referralBonusKeyId).startsWith("pending:") && prisma.issuedApiKey?.findUnique
            ? prisma.issuedApiKey.findUnique({ where: { id: String(user.referralBonusKeyId) } }).catch(() => null)
            : Promise.resolve(null),
        getUserRedeemedTokensInBatch(user.telegramId, cfg),
        user.referredBy && prisma.user?.findUnique
            ? prisma.user.findUnique({
                where: { id: user.referredBy },
                select: { username: true, firstName: true, telegramId: true },
            }).catch(() => null)
            : Promise.resolve(null),
        prisma.referralEvent?.findMany
            ? prisma.referralEvent.findMany({
                where: { referrerTgId: String(user.telegramId), eventType: "join_channel" },
                select: { referrerTgId: true, referredUserId: true, eventType: true },
            }).catch(() => [])
            : Promise.resolve([]),
    ]);

    let bonusKey = null;
    if (bonusKeyRow && !bonusKeyRow.hiddenAt) {
        const expMs = bonusKeyRow.expiresAt ? new Date(bonusKeyRow.expiresAt).getTime() : null;
        const expired = expMs !== null && Number.isFinite(expMs) && expMs <= Date.now();
        if (!expired) {
            bonusKey = {
                id: bonusKeyRow.id,
                key: bonusKeyRow.key,
                quotaTokens: Number(bonusKeyRow.quotaTokens) || 0,
                rpm: bonusKeyRow.rpm,
                expiresAt: bonusKeyRow.expiresAt ? new Date(bonusKeyRow.expiresAt).toISOString() : null,
            };
        }
    }

    let referredByDisplay = null;
    if (inviterUser) {
        if (inviterUser.username) referredByDisplay = `@${inviterUser.username}`;
        else if (inviterUser.firstName) referredByDisplay = inviterUser.firstName;
        else if (inviterUser.telegramId) referredByDisplay = `User ***${String(inviterUser.telegramId).slice(-4)}`;
    }

    const joinedSet = new Set(
        (joinEvents || [])
            .filter((e) => String(e.referrerTgId) === String(user.telegramId) && e.eventType === "join_channel" && e.referredUserId)
            .map((e) => String(e.referredUserId)),
    );
    const joinedChannelCount = Math.max(rewardedCount, joinedSet.size);

    const rawProfileName = String(serverInfo?.keyCfg?.profileName || "").trim();
    const serverName = rawProfileName && rawProfileName !== "Mặc định" ? rawProfileName : "";

    const milestone = nextMilestoneProgress(rewardedCount, cfg);
    const classicCooldown = evaluateClassicRedeemCooldown(user.lastRedeemAt);

    return {
        telegramId: user.telegramId,
        referralCode: user.referralCode,
        balance: user.balance,
        referralPoints: Number(user.referralPoints) || 0,
        hasJoinedChannel: Boolean(user.hasJoinedChannel),
        channelPointAwarded: Boolean(user.channelPointAwarded),
        referredBy: user.referredBy || null,
        referredByDisplay,
        refWelcomeCode: user.refWelcomeCode || null,
        refWelcomeRedeemedAt: user.refWelcomeRedeemedAt || null,
        lastRedeemAt: user.lastRedeemAt || null,
        classicCooldown,
        totalCommission,
        referralCount,
        completedCount,
        buyersCount,
        rewardedCount,
        joinedChannelCount,
        pipeline: {
            startedCount: referralCount,
            joinedChannelCount,
            buyersCount,
        },
        serverName,
        commissionPercent: cfg.commissionPercent,
        bonusKey,
        milestone,
        usedTokensInBatch,
        maxTokensPerBatch: cfg.tokenMaxPerUser,
        reward: {
            tokens: cfg.inviteTokenAmount,
            days: cfg.inviteTokenDays,
            rpm: cfg.tokenNewKeyRpm,
            enabled: cfg.enabled,
            referrerMinTokens: cfg.inviteReferrerMinTokens,
            referrerMaxTokens: cfg.inviteReferrerMaxTokens,
            referrerKeyDays: cfg.inviteReferrerKeyDays,
            inviteMaxPerReferrer: cfg.inviteMaxPerReferrer,
            pointJoinChannel: cfg.pointJoinChannel,
            pointPurchase: cfg.pointPurchase,
            buyerTarget: cfg.buyerTarget,
            personalVoucherPercent: cfg.personalVoucherPercent,
            extraWarrantyHours: cfg.extraWarrantyHours,
            tokenPerPoint: cfg.tokenPerPoint,
            tokenNewKeyDays: cfg.tokenNewKeyDays,
            redeemMenuEnabled: cfg.redeemEnabled,
            redeemEnabled: cfg.redeemEnabled && cfg.tokenRedeemEnabled,
            welcomeEnabled: cfg.welcomeKeyEnabled,
            dailyTopEnabled: cfg.dailyTopEnabled,
            dailyTopPrizes: [cfg.dailyTop1Tokens, cfg.dailyTop2Tokens, cfg.dailyTop3Tokens],
            milestoneEnabled: cfg.milestoneEnabled,
            milestoneTokens: [cfg.milestone5Tokens, cfg.milestone10Tokens, cfg.milestone20Tokens],
        },
    };
}

/** Danh sách người được mời gần nhất của 1 user (hiển thị ở nút 📊 Xem chi tiết). */
export async function getUserReferralDetails(userId, { limit = 12 } = {}) {
    if (!userId || !prisma.referral?.findMany) return [];
    const referrals = await prisma.referral.findMany({
        where: { referrerId: userId },
        orderBy: { createdAt: "desc" },
        take: Math.min(30, Math.max(1, Number(limit) || 12)),
    }).catch(() => []);
    if (!referrals?.length) return [];

    const refereeIds = [...new Set(referrals.map((r) => r.refereeId).filter(Boolean))];
    const users = refereeIds.length && prisma.user?.findMany
        ? await prisma.user.findMany({
            where: { id: { in: refereeIds } },
            select: {
                id: true,
                telegramId: true,
                username: true,
                firstName: true,
                hasJoinedChannel: true,
                channelPointAwarded: true,
                referralPurchaseCounted: true,
                referralLateClaim: true,
                createdAt: true,
            },
        }).catch(() => [])
        : [];
    const byId = new Map((users || []).map((u) => [String(u.id), u]));

    return referrals.map((r) => {
        const u = byId.get(String(r.refereeId)) || null;
        const displayName = u?.username
            ? `@${u.username}`
            : (u?.firstName || (u?.telegramId ? `User ***${String(u.telegramId).slice(-4)}` : "Người dùng"));
        return {
            id: r.id,
            displayName,
            hasJoinedChannel: Boolean(u?.hasJoinedChannel),
            channelPointAwarded: Boolean(u?.channelPointAwarded),
            rewarded: Boolean(r.rewardReferrerAt),
            purchased: Boolean(u?.referralPurchaseCounted) || r.status === "COMPLETED",
            lateClaim: Boolean(u?.referralLateClaim),
            commission: Number(r.commission) || 0,
            createdAt: (r.createdAt || u?.createdAt) ? new Date(r.createdAt || u.createdAt).toISOString() : null,
        };
    });
}

const ALL_HISTORY_REWARD_TYPES = [
    "ref_invite_token",
    "ref_milestone",
    "ref_daily_top",
    "ref_welcome_key",
    "token_newkey",
    "token_topup",
    "buyer_voucher",
    "key1b",
    "classic_basic",
    "classic_bh3d",
    "classic_bh7d",
    "classic_gpt",
];

/** Lịch sử nhận thưởng gần nhất của 1 user (hiển thị ở nút Lịch sử thưởng trên Bot). */
export async function getUserReferralHistory(telegramId, limit = 15) {
    if (!prisma.redeemRequest?.findMany) return [];
    const maxItems = Math.max(1, Math.min(100, Number(limit) || 15));
    const rows = await prisma.redeemRequest.findMany({
        where: {
            telegramId: String(telegramId),
            status: "completed",
            rewardType: { in: ALL_HISTORY_REWARD_TYPES },
        },
        orderBy: { createdAt: "desc" },
        take: maxItems,
    }).catch(() => []);
    return rows || [];
}

/** Bảng xếp hạng Top hôm nay (giờ VN) để hiển thị đua Top ngày trên Bot & Admin. */
export async function getDailyReferralLeaderboard({ dayKey = null, limit = 10, now = Date.now() } = {}) {
    if (!prisma.referralEvent?.findMany) return { dayKey: vnDayKey(now), rows: [] };
    const targetDay = dayKey || vnDayKey(now);
    const startUtc = vnDayStartUtc(targetDay);
    if (!startUtc) return { dayKey: targetDay, rows: [] };
    const endUtc = new Date(startUtc.getTime() + 86_400_000);

    const events = await prisma.referralEvent.findMany({
        where: {
            eventType: "join_channel",
            createdAt: { gte: startUtc, lt: endUtc },
        },
    }).catch(() => []);

    const ranked = rankDailyTopReferrers(events).slice(0, limit);
    if (!ranked.length) return { dayKey: targetDay, rows: [] };

    const users = await prisma.user.findMany({
        where: { telegramId: { in: ranked.map((r) => r.referrerTgId) } },
        select: { telegramId: true, username: true, firstName: true, vipLevel: true },
    }).catch(() => []);
    const byTg = new Map((users || []).map((u) => [String(u.telegramId), u]));

    return {
        dayKey: targetDay,
        rows: ranked.map((r, idx) => {
            const u = byTg.get(r.referrerTgId);
            return {
                rank: idx + 1,
                telegramId: r.referrerTgId,
                username: u?.username || null,
                firstName: u?.firstName || null,
                vipLevel: u?.vipLevel ?? 0,
                count: r.count,
                lastAt: r.lastAt ? new Date(r.lastAt).toISOString() : null,
            };
        }),
    };
}

export async function getTopReferrers(limit = 10) {
    const board = await getReferralLeaderboard({ limit });
    return board.rows;
}

export async function getReferralLeaderboard({ limit = 50 } = {}) {
    const [referrals, rewardKeys, allUsersWithPoints, redeemRows] = await Promise.all([
        prisma.referral.findMany({}),
        prisma.issuedApiKey.findMany({
            where: { source: KeySource.REFERRAL },
            select: { telegramId: true, quotaTokens: true },
        }).catch(() => []),
        prisma.user.findMany({
            where: { referralPoints: { gt: 0 } },
            select: { id: true, referralPoints: true },
        }).catch(() => []),
        prisma.redeemRequest?.findMany
            ? prisma.redeemRequest.findMany({
                where: { status: "completed" },
                select: { rewardType: true, tokensGranted: true, pointsUsed: true },
            }).catch(() => [])
            : Promise.resolve([]),
    ]);

    const breakdown = {
        inviteTokens: 0,
        milestoneTokens: 0,
        dailyTopTokens: 0,
        welcomeTokens: 0,
        redeemedTokens: 0,
        pointsRedeemed: 0,
    };
    for (const r of redeemRows || []) {
        const tok = Number(r.tokensGranted) || 0;
        if (r.rewardType === "ref_invite_token") breakdown.inviteTokens += tok;
        else if (r.rewardType === "ref_milestone") breakdown.milestoneTokens += tok;
        else if (r.rewardType === "ref_daily_top") breakdown.dailyTopTokens += tok;
        else if (r.rewardType === "ref_welcome_key") breakdown.welcomeTokens += tok;
        else if (r.rewardType === "token_newkey" || r.rewardType === "token_topup") {
            breakdown.redeemedTokens += tok;
            breakdown.pointsRedeemed += Number(r.pointsUsed) || 0;
        } else if (r.rewardType === "key1b" || String(r.rewardType || "").startsWith("classic_")) {
            breakdown.pointsRedeemed += Number(r.pointsUsed) || 0;
        }
    }

    const totalPointsActive = (allUsersWithPoints || []).reduce((s, u) => s + (Number(u.referralPoints) || 0), 0);

    const totals = {
        inviters: 0,
        invited: referrals.length,
        rewarded: referrals.filter((r) => r.rewardReferrerAt).length,
        commission: referrals.reduce((s, r) => s + (Number(r.commission) || 0), 0),
        tokensGiven: rewardKeys.reduce((s, k) => s + (Number(k.quotaTokens) || 0), 0),
        keysGiven: rewardKeys.length,
        totalPointsActive,
        breakdown,
    };
    if (!referrals.length) return { rows: [], totals };

    const byReferrer = new Map();
    for (const r of referrals) {
        const id = String(r.referrerId || "");
        if (!id) continue;
        const row = byReferrer.get(id) || { referrerId: id, invited: 0, rewarded: 0, buyers: 0, commission: 0, lastInviteAt: null };
        row.invited += 1;
        if (r.rewardReferrerAt) row.rewarded += 1;
        if (r.status === "COMPLETED") row.buyers += 1;
        row.commission += Number(r.commission) || 0;
        const at = r.createdAt ? new Date(r.createdAt) : null;
        if (at && (!row.lastInviteAt || at > row.lastInviteAt)) row.lastInviteAt = at;
        byReferrer.set(id, row);
    }
    totals.inviters = byReferrer.size;

    const users = await prisma.user.findMany({
        where: { id: { in: [...byReferrer.keys()] } },
        select: {
            id: true,
            telegramId: true,
            username: true,
            firstName: true,
            vipLevel: true,
            totalSpent: true,
            referralPoints: true,
            totalReferredBuyers: true,
        },
    });
    const userById = new Map((users || []).map((u) => [String(u.id), u]));

    const tokensByTg = new Map();
    for (const k of rewardKeys) {
        const tg = String(k.telegramId);
        tokensByTg.set(tg, (tokensByTg.get(tg) || 0) + (Number(k.quotaTokens) || 0));
    }

    const rows = [...byReferrer.values()]
        .map((row) => {
            const u = userById.get(row.referrerId);
            return {
                ...row,
                telegramId: u?.telegramId || null,
                username: u?.username || null,
                firstName: u?.firstName || null,
                vipLevel: u?.vipLevel ?? 0,
                totalSpent: u?.totalSpent ?? 0,
                referralPoints: u?.referralPoints ?? 0,
                buyers: Math.max(row.buyers, Number(u?.totalReferredBuyers) || 0),
                tokensEarned: u ? (tokensByTg.get(String(u.telegramId)) || 0) : 0,
                lastInviteAt: row.lastInviteAt ? row.lastInviteAt.toISOString() : null,
            };
        })
        .sort((a, b) => b.rewarded - a.rewarded || b.invited - a.invited
            || (b.lastInviteAt || "").localeCompare(a.lastInviteAt || ""))
        .slice(0, Math.min(500, Math.max(1, Number(limit) || 50)));

    return { rows, totals };
}

/** Danh sách sự kiện điểm cho Web Admin đối soát. */
export async function listReferralEventsAdmin({ limit = 100, eventType = "", q = "" } = {}) {
    if (!prisma.referralEvent?.findMany) return [];
    const where = {};
    if (eventType) where.eventType = String(eventType);
    const term = String(q || "").trim();
    if (term) {
        where.OR = [
            { referrerTgId: { contains: term } },
            { referredUserId: { contains: term } },
        ];
    }
    const rows = await prisma.referralEvent.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: Math.min(300, Math.max(1, Number(limit) || 100)),
    }).catch(() => []);

    const tgIds = [...new Set((rows || []).flatMap((r) => [r.referrerTgId, r.referredUserId]).filter((x) => x && /^\d+$/.test(x)))];
    const users = tgIds.length
        ? await prisma.user.findMany({
            where: { telegramId: { in: tgIds } },
            select: { telegramId: true, firstName: true, username: true },
        }).catch(() => [])
        : [];
    const byTg = new Map((users || []).map((u) => [String(u.telegramId), u]));

    return (rows || []).map((r) => ({
        ...r,
        referrerUser: byTg.get(String(r.referrerTgId)) || null,
        referredUser: byTg.get(String(r.referredUserId)) || null,
    }));
}

/** Danh sách nhật ký phát thưởng Key / Token (`RedeemRequest`) cho Web Admin. */
export async function listReferralGrantsAdmin({ limit = 100, rewardType = "", status = "", q = "" } = {}) {
    if (!prisma.redeemRequest?.findMany) return [];
    const where = {};
    if (rewardType) where.rewardType = String(rewardType);
    else {
        where.rewardType = { in: ALL_HISTORY_REWARD_TYPES };
    }
    if (status) where.status = String(status);
    const term = String(q || "").trim();
    if (term) {
        where.OR = [
            { telegramId: { contains: term } },
            { referrerTgId: { contains: term } },
            { referredTgId: { contains: term } },
            { note: { contains: term, mode: "insensitive" } },
        ];
    }

    const rows = await prisma.redeemRequest.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: Math.min(300, Math.max(1, Number(limit) || 100)),
    }).catch(() => []);

    const tgIds = [...new Set((rows || []).flatMap((r) => [r.telegramId, r.referrerTgId, r.referredTgId]).filter(Boolean))];
    const users = tgIds.length
        ? await prisma.user.findMany({
            where: { telegramId: { in: tgIds } },
            select: { telegramId: true, firstName: true, username: true },
        }).catch(() => [])
        : [];
    const byTg = new Map((users || []).map((u) => [String(u.telegramId), u]));

    return (rows || []).map((r) => ({
        ...r,
        user: byTg.get(String(r.telegramId)) || null,
        referrerUser: r.referrerTgId ? (byTg.get(String(r.referrerTgId)) || null) : null,
    }));
}

/**
 * Ghép cặp thưởng mời bạn (`invited / referrer / referredStatus / referrerStatus / milestone`)
 * phục vụ đối soát trên Admin Dashboard (theo §5.3 của tài liệu đặc tả).
 */
export async function listInviteTokenPairsAdmin({ limit = 100, q = "" } = {}) {
    if (!prisma.redeemRequest?.findMany) return [];
    const scanMax = Math.min(400, Math.max(20, (Number(limit) || 100) * 3));
    const where = { rewardType: "ref_invite_token" };
    const term = String(q || "").trim();
    if (term) {
        where.OR = [
            { telegramId: { contains: term } },
            { referrerTgId: { contains: term } },
            { referredTgId: { contains: term } },
        ];
    }

    const rows = await prisma.redeemRequest.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: scanMax,
    }).catch(() => []);

    const pairMap = new Map();
    for (const r of rows || []) {
        const invitedTg = String(r.referredTgId || r.telegramId || "");
        if (!invitedTg) continue;
        let p = pairMap.get(invitedTg);
        if (!p) {
            p = {
                invitedTgId: invitedTg,
                referrerTgId: r.referrerTgId ? String(r.referrerTgId) : null,
                referredStatus: null,
                referredTokens: 0,
                referrerStatus: null,
                referrerTokens: 0,
                referrerMode: null,
                lucky: false,
                createdAt: r.createdAt,
            };
            pairMap.set(invitedTg, p);
        }
        if (r.referrerTgId && !p.referrerTgId) p.referrerTgId = String(r.referrerTgId);
        const isReferredSide = String(r.note || "").startsWith("referred") || String(r.lockKey || "").endsWith("|referred");
        if (isReferredSide) {
            p.referredStatus = r.status;
            p.referredTokens = Number(r.tokensGranted) || 0;
        } else {
            p.referrerStatus = r.status;
            p.referrerTokens = Number(r.tokensGranted) || 0;
            p.referrerMode = String(r.note || "").includes("topup") ? "topup" : "new";
            p.lucky = String(r.note || "").includes("lucky");
        }
        if (r.createdAt && (!p.createdAt || new Date(r.createdAt) > new Date(p.createdAt))) {
            p.createdAt = r.createdAt;
        }
    }

    const pairs = [...pairMap.values()].slice(0, Math.min(200, Math.max(1, Number(limit) || 100)));
    const tgIds = [...new Set(pairs.flatMap((p) => [p.invitedTgId, p.referrerTgId]).filter(Boolean))];
    const users = tgIds.length
        ? await prisma.user.findMany({
            where: { telegramId: { in: tgIds } },
            select: { telegramId: true, firstName: true, username: true },
        }).catch(() => [])
        : [];
    const byTg = new Map((users || []).map((u) => [String(u.telegramId), u]));

    return pairs.map((p) => ({
        ...p,
        invitedUser: byTg.get(p.invitedTgId) || null,
        referrerUser: p.referrerTgId ? (byTg.get(p.referrerTgId) || null) : null,
    }));
}

export default {
    REFERRAL_SETTING_KEYS,
    CLASSIC_REDEEM_TIER_DEFS,
    getOrCreateUser,
    bindReferrerIfEligible,
    checkTelegramAgeGate,
    processReferralOnboarding,
    processReferralCommission,
    grantReferralReward,
    redeemWelcomeCode,
    getUserRedeemedTokensInBatch,
    listEligibleTopupKeys,
    redeemPointsToNewKey,
    redeemPointsToTopup,
    listAvailableClassicRedeemTiers,
    redeemPointsToClassicProduct,
    shouldEmitTokenRedeemBroadcast,
    resetTokenBroadcastState,
    payReferralDailyTopPrizes,
    collectExpiringReferralBonusWarnings,
    resumeStuckReferralGrants,
    adminAdjustReferralPoints,
    getReferralConfig,
    getReferralRewardInfo,
    getCommissionPercentSync,
    invalidateReferralConfig,
    invalidatePeerAgeCache,
    warmReferralConfig,
    getReferralStats,
    getUserReferralDetails,
    getUserReferralHistory,
    getDailyReferralLeaderboard,
    getReferralLink,
    getTopReferrers,
    getReferralLeaderboard,
    listReferralEventsAdmin,
    listReferralGrantsAdmin,
    listInviteTokenPairsAdmin,
};
