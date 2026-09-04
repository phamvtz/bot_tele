import { prisma } from "./db.js";
import { userCache, balanceCache } from "./lib/cache.js";
import { invalidateWalletCache } from "./wallet.js";
import { createApiKey, getConfig as getGpt2apiConfig } from "./gpt2api.js";
import { saveIssuedKey, KeySource } from "./apikey-store.js";
import crypto from "crypto";

/**
 * Referral Module
 * Handles referral code generation and commission tracking
 */

// ── Cấu hình chương trình mời bạn ────────────────────────────────────────────
// Mời 1 người → CẢ HAI bên nhận 1 API key miễn phí (mặc định 20M token, hạn 1 ngày).
// Nguồn cấu hình: bảng Setting (web admin) THẮNG ENV — đổi trong panel là ăn ngay,
// không cần restart. Cache 30s giống gpt2api.js.
export const REFERRAL_SETTING_KEYS = [
    "REFERRAL_REWARD_TOKENS_M",  // số token mỗi key, đơn vị triệu. 0 = tắt quà
    "REFERRAL_REWARD_DAYS",      // số ngày key sống. 0 = không hết hạn theo thời gian
    "REFERRAL_REWARD_RPM",       // RPM của key quà (mặc định 100); 0 = theo RPM shop
    "REFERRAL_REWARD_SINCE",     // chỉ phát cho lượt mời từ ngày này; rỗng = cả referral cũ
    "REFERRAL_COMMISSION",       // hoa hồng %/đơn. 0 = TẮT (mặc định)
];

const CFG_TTL = 30_000;
let _cfgRaw = null;   // map Setting thô, dùng cho getter sync
let _cfgTs = 0;

export function invalidateReferralConfig() { _cfgRaw = null; _cfgTs = 0; }

async function loadReferralSettings() {
    if (_cfgRaw && Date.now() - _cfgTs < CFG_TTL) return _cfgRaw;
    let map = {};
    try {
        const rows = await prisma.setting.findMany({ where: { key: { in: REFERRAL_SETTING_KEYS } } });
        map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    } catch (err) {
        // Giữ cache cũ: một lỗi DB thoáng qua không được làm quà nhảy về ENV.
        console.error("[referral] loadReferralSettings thất bại:", err.message);
        map = _cfgRaw || {};
    }
    _cfgRaw = map;
    _cfgTs = Date.now();
    return _cfgRaw;
}

/** Số nguyên >= min từ Setting/ENV; rỗng hoặc vô lý → fallback. */
function intOr(value, fallback, min = 0) {
    if (value === undefined || value === null || String(value).trim() === "") return fallback;
    const n = Math.floor(Number(value));
    return Number.isFinite(n) && n >= min ? n : fallback;
}

function parseSince(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return null;
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
}

/** Cấu hình HIỆU LỰC (DB Setting > ENV > mặc định). */
export async function getReferralConfig() {
    const m = await loadReferralSettings();
    const tokensM = intOr(m.REFERRAL_REWARD_TOKENS_M ?? process.env.REFERRAL_REWARD_TOKENS_M, 20);
    return {
        tokensM,
        tokens: tokensM * 1_000_000,
        days: intOr(m.REFERRAL_REWARD_DAYS ?? process.env.REFERRAL_REWARD_DAYS, 1),
        // Key quà chạy RPM riêng (mặc định 100), thấp hơn key bán để đỡ tốn tài
        // nguyên provider. Đặt 0 trong panel = theo RPM của cửa hàng API key.
        rpm: intOr(m.REFERRAL_REWARD_RPM ?? process.env.REFERRAL_REWARD_RPM, 100),
        since: parseSince(m.REFERRAL_REWARD_SINCE ?? process.env.REFERRAL_REWARD_SINCE),
        commissionPercent: intOr(m.REFERRAL_COMMISSION ?? process.env.REFERRAL_COMMISSION, 0),
        enabled: tokensM > 0,
    };
}

/** Thông số quà để dựng text UI (màn Giới thiệu, bài Hỗ trợ). */
export async function getReferralRewardInfo() {
    const cfg = await getReferralConfig();
    return { tokens: cfg.tokens, days: cfg.days, rpm: cfg.rpm, enabled: cfg.enabled };
}

/**
 * Hoa hồng % — bản SYNC cho chỗ không await được (formatVipInfo).
 * Cache nguội thì trả ENV; warmReferralConfig() ở lúc boot làm nóng sẵn.
 */
export function getCommissionPercentSync() {
    return intOr(_cfgRaw?.REFERRAL_COMMISSION ?? process.env.REFERRAL_COMMISSION, 0);
}

/** Nạp sẵn cấu hình lúc boot để getter sync không phải đoán. */
export async function warmReferralConfig() {
    await loadReferralSettings().catch(() => {});
}

/**
 * Generate a unique referral code
 */
function generateCode() {
    return crypto.randomBytes(4).toString("hex").toUpperCase();
}

/**
 * Get or create user with referral code (cached 60s)
 */
export async function getOrCreateUser(telegramUser, referredByCode = null) {
    const telegramId = String(telegramUser.id);
    const cacheKey = `user:${telegramId}`;

    let user = userCache.get(cacheKey);
    if (!user) {
        user = await prisma.user.findUnique({ where: { telegramId } });
        if (user) userCache.set(cacheKey, user);
    }

    if (!user) {
        // Create new user
        let referralCode = generateCode();

        // Ensure unique code
        while (await prisma.user.findUnique({ where: { referralCode } })) {
            referralCode = generateCode();
        }

        // Find referrer if code provided
        let referredBy = null;
        if (referredByCode) {
            const referrer = await prisma.user.findUnique({
                where: { referralCode: referredByCode },
            });
            if (referrer && referrer.telegramId !== telegramId) {
                referredBy = referrer.id;
            }
        }

        user = await prisma.user.create({
            data: {
                telegramId,
                username: telegramUser.username,
                firstName: telegramUser.first_name,
                referralCode,
                referredBy,
            },
        });
        userCache.set(cacheKey, user);

        // Create referral record if referred by someone
        if (referredBy) {
            await prisma.referral.create({
                data: {
                    referrerId: referredBy,
                    refereeId: user.id,
                    status: "REGISTERED",
                },
            });
        }
    } else {
        // Chỉ update nếu username/firstName đổi để tránh write DB không cần thiết
        const usernameChanged = (user.username || null) !== (telegramUser.username || null);
        const nameChanged = (user.firstName || null) !== (telegramUser.first_name || null);
        if (usernameChanged || nameChanged) {
            await prisma.user.update({
                where: { id: user.id },
                data: {
                    username: telegramUser.username,
                    firstName: telegramUser.first_name,
                },
            });
            user = { ...user, username: telegramUser.username, firstName: telegramUser.first_name };
            userCache.set(cacheKey, user);
        }
    }

    return user;
}

/**
 * Process referral commission for an order
 */
export async function processReferralCommission(userId, orderId, orderAmount) {
    // Hoa hồng tắt (0%) là mặc định — chương trình mời bạn trả bằng API key.
    // Kiểm TRƯỚC mọi query để đơn hàng không tốn round-trip DB vô ích.
    const { commissionPercent } = await getReferralConfig();
    if (commissionPercent <= 0) return null;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.referredBy) return null;

    const referral = await prisma.referral.findFirst({ where: { refereeId: userId } });
    if (!referral) return null;

    const commission = Math.floor((orderAmount * commissionPercent) / 100);
    if (commission <= 0) return null;

    const referrer = await prisma.user.findUnique({ where: { id: user.referredBy } });
    if (!referrer) return null;

    // Get or create referrer wallet
    let wallet = await prisma.wallet.findUnique({ where: { odelegramId: referrer.telegramId } });
    if (!wallet) {
        wallet = await prisma.wallet.create({ data: { odelegramId: referrer.telegramId, balance: 0 } });
    }

    // Idempotency: skip if this orderId already has a commission transaction
    const alreadyPaid = await prisma.walletTransaction.findFirst({
        where: { walletId: wallet.id, orderId, type: "ADMIN_ADD" },
    });
    if (alreadyPaid) return null;

    // KHÔNG dùng $transaction để giữ nhất quán: adapter MongoDB ở lib/prisma.js chỉ
    // Promise.all các operation, không atomic, không rollback (xem chú thích ở đó).
    //
    // Thứ tự an toàn: increment ví TRƯỚC (atomic $inc, không lost-update khi 2 referee
    // của cùng người giới thiệu thanh toán đồng thời), rồi mới ghi transaction với
    // balanceAfter thật lấy từ kết quả increment. Trước đây code tính
    // `newBalance = wallet.balance + commission` từ bản đọc cũ rồi GHI ĐÈ absolute —
    // hai hoa hồng song song thì một cái bị mất.
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

    return { commission, referrerId: user.referredBy };
}

/**
 * Quà giới thiệu — mời 1 người thì CẢ HAI bên nhận một API key miễn phí
 * (mặc định 20M token, hạn 1 ngày).
 *
 * Gọi khi người ĐƯỢC MỜI hoàn tất onboarding (đã qua cổng vào nhóm), không phải
 * lúc tạo user: /start bằng link ref rồi bỏ đi giữa chừng thì không phát quà.
 *
 * Chống phát trùng: mỗi bên có một mốc thời gian riêng trên document Referral
 * (`rewardRefereeAt` / `rewardReferrerAt`). Claim bằng updateMany có điều kiện
 * `field: null` (atomic trong Mongo, khớp cả doc cũ chưa có field) — hai lần bấm
 * song song thì chỉ một cái qua được. Tạo key thất bại → nhả mốc để lần sau thử lại.
 *
 * @param {string|number} telegramId — người ĐƯỢC MỜI
 * @param {object|null} userObj — user đã fetch sẵn (khỏi query lại trên hot-path /start)
 * @returns {null | { referee, referrer, tokens, validDays }} — mỗi bên là
 *          { key, quotaTokens, rpm, expiresAt, models, endpoint, docUrl, telegramId, language }
 *          hoặc null nếu bên đó đã nhận rồi / cấp key lỗi.
 */
export async function grantReferralReward(telegramId, userObj = null) {
    const reward = await getReferralConfig();
    if (!reward.enabled) return null;

    const tgId = String(telegramId);
    const referee = userObj && String(userObj.telegramId) === tgId
        ? userObj
        : await prisma.user.findUnique({ where: { telegramId: tgId } });
    // Không phải người được mời → không có gì để phát (thoát sớm, đây là hot-path).
    if (!referee?.referredBy) return null;

    const referral = await prisma.referral.findFirst({ where: { refereeId: referee.id } });
    if (!referral) return null;
    if (referral.rewardRefereeAt && referral.rewardReferrerAt) return null; // đã phát đủ
    // Lượt mời có trước khi bật chương trình → không trả bù.
    if (reward.since && referral.createdAt && new Date(referral.createdAt) < reward.since) return null;

    const cfg = await getGpt2apiConfig().catch(() => null);
    // Chưa cấu hình GPT2API thì KHÔNG claim mốc — để khi admin cấu hình xong,
    // lần /start sau vẫn phát được quà.
    if (!cfg?.enabled || !cfg.configured) return null;

    const referrer = await prisma.user.findUnique({ where: { id: referee.referredBy } }).catch(() => null);

    const [refereeReward, referrerReward] = await Promise.all([
        issueReferralKey(referral, "rewardRefereeAt", referee, cfg, reward, "ref-new"),
        referrer ? issueReferralKey(referral, "rewardReferrerAt", referrer, cfg, reward, "ref-inv") : Promise.resolve(null),
    ]);

    if (!refereeReward && !referrerReward) return null;
    return {
        referee: refereeReward,
        referrer: referrerReward,
        tokens: reward.tokens,
        validDays: reward.days,
    };
}

/** Cấp key cho MỘT bên. Trả null nếu bên đó đã nhận rồi hoặc provider lỗi. */
async function issueReferralKey(referral, field, user, cfg, reward, label) {
    if (referral[field]) return null;

    // Claim mốc TRƯỚC khi gọi provider — nếu gọi trước rồi mới đánh dấu thì hai
    // request song song sẽ tạo hai key cho cùng một người.
    const claim = await prisma.referral.updateMany({
        where: { id: referral.id, [field]: null },
        data: { [field]: new Date() },
    });
    if (!claim.count) return null;

    const rpm = reward.rpm > 0 ? reward.rpm : (cfg.rpm ?? 300);
    const created = await createApiKey({
        quotaTokens: reward.tokens,
        name: `${label}-${String(user.telegramId).slice(-6)}-${Date.now().toString(36)}`,
        rpm,
        validDays: reward.days,
    });

    if (!created.ok) {
        // Nhả mốc để lần onboarding/start sau thử lại khi provider hồi phục.
        await prisma.referral.updateMany({ where: { id: referral.id }, data: { [field]: null } })
            .catch((e) => console.error(`[referral] nhả mốc ${field} thất bại:`, e.message));
        console.error(`[referral] cấp key quà cho ${user.telegramId} thất bại:`, created.message);
        return null;
    }

    // Key đã tồn tại bên provider — từ đây KHÔNG rollback nữa, nhả mốc là tặng thêm key.
    const expiresRaw = created.expiresAt
        || (reward.days > 0 ? new Date(Date.now() + reward.days * 86_400_000) : null);
    const expiresIso = (() => {
        if (!expiresRaw) return null;
        const d = new Date(expiresRaw);
        return Number.isNaN(d.getTime()) ? null : d.toISOString();
    })();

    await saveIssuedKey({
        telegramId: user.telegramId,
        key: created.key,
        quotaTokens: reward.tokens,
        rpm,
        source: KeySource.REFERRAL,
        externalId: created.id,
        expiresAt: expiresIso,
        models: cfg.models || [],
        // Quà mời bạn không cho chọn server — ghi lại cái createApiKey đã dùng.
        profileId: created.profileId ?? null,
        profileName: created.profileName || "",
    }).catch((e) => console.error("[referral] lưu key quà thất bại (key vẫn hợp lệ):", e.message));

    return {
        key: created.key,
        quotaTokens: reward.tokens,
        rpm,
        expiresAt: expiresIso,
        models: cfg.models || [],
        endpoint: cfg.endpoint || "",
        docUrl: cfg.docUrl || "",
        usageUrl: cfg.usageUrl || "",
        telegramId: String(user.telegramId),
        language: user.language || "vi",
    };
}

/**
 * Get user's referral stats
 */
// userObj: nếu caller đã có sẵn User object (đủ field referralCode + balance) thì
// truyền vào để KHỎI fetch lại — tránh 1 query thừa trên hot-path bấm nút Giới thiệu.
export async function getReferralStats(userId, userObj = null) {
    const [user, referrals, cfg] = await Promise.all([
        userObj && userObj.id === userId ? userObj : prisma.user.findUnique({ where: { id: userId } }),
        prisma.referral.findMany({ where: { referrerId: userId } }),
        getReferralConfig(),
    ]);
    if (!user) return null;

    const totalCommission = referrals.reduce((sum, r) => sum + r.commission, 0);
    const referralCount = referrals.length;
    const completedCount = referrals.filter((r) => r.status === "COMPLETED").length;
    // Số lượt đã thực sự nhận key quà (người được mời đã qua onboarding).
    const rewardedCount = referrals.filter((r) => r.rewardReferrerAt).length;

    return {
        referralCode: user.referralCode,
        balance: user.balance,
        totalCommission,
        referralCount,
        completedCount,
        rewardedCount,
        commissionPercent: cfg.commissionPercent,
        reward: { tokens: cfg.tokens, days: cfg.days, rpm: cfg.rpm, enabled: cfg.enabled },
    };
}

/**
 * Get referral link
 */
export function getReferralLink(botUsername, referralCode) {
    return `https://t.me/${botUsername}?start=ref_${referralCode}`;
}

/**
 * Get top referrers
 */
export async function getTopReferrers(limit = 10) {
    const referrers = await prisma.user.findMany({
        where: { balance: { gt: 0 } },
        orderBy: { balance: "desc" },
        take: limit,
        select: {
            telegramId: true,
            username: true,
            firstName: true,
            balance: true,
        },
    });

    return referrers;
}

/**
 * Bảng xếp hạng người mời — dữ liệu cho web admin.
 *
 * Gộp bằng JS chứ không dùng groupBy: adapter Mongo cũng đọc hết rồi gộp trong bộ
 * nhớ, mà làm tay thì ghép thêm được số token đã tặng (lấy từ IssuedApiKey nguồn
 * REFERRAL) — con số admin thật sự quan tâm khi tính chi phí chương trình.
 *
 * @returns {{ rows: object[], totals: object }}
 */
export async function getReferralLeaderboard({ limit = 50 } = {}) {
    const [referrals, rewardKeys] = await Promise.all([
        prisma.referral.findMany({}),
        prisma.issuedApiKey.findMany({
            where: { source: KeySource.REFERRAL },
            select: { telegramId: true, quotaTokens: true },
        }).catch(() => []),
    ]);

    const totals = {
        inviters: 0,
        invited: referrals.length,
        rewarded: referrals.filter((r) => r.rewardReferrerAt).length,
        commission: referrals.reduce((s, r) => s + (Number(r.commission) || 0), 0),
        tokensGiven: rewardKeys.reduce((s, k) => s + (Number(k.quotaTokens) || 0), 0),
        keysGiven: rewardKeys.length,
    };
    if (!referrals.length) return { rows: [], totals };

    const byReferrer = new Map();
    for (const r of referrals) {
        const id = String(r.referrerId || "");
        if (!id) continue;
        const row = byReferrer.get(id) || { referrerId: id, invited: 0, rewarded: 0, commission: 0, lastInviteAt: null };
        row.invited += 1;
        if (r.rewardReferrerAt) row.rewarded += 1;
        row.commission += Number(r.commission) || 0;
        const at = r.createdAt ? new Date(r.createdAt) : null;
        if (at && (!row.lastInviteAt || at > row.lastInviteAt)) row.lastInviteAt = at;
        byReferrer.set(id, row);
    }
    totals.inviters = byReferrer.size;

    const users = await prisma.user.findMany({
        where: { id: { in: [...byReferrer.keys()] } },
        select: { id: true, telegramId: true, username: true, firstName: true, vipLevel: true, totalSpent: true },
    });
    const userById = new Map(users.map((u) => [String(u.id), u]));

    // Token quà mỗi người ĐÃ NHẬN (chỉ tính key nguồn REFERRAL của chính họ).
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
                tokensEarned: u ? (tokensByTg.get(String(u.telegramId)) || 0) : 0,
                lastInviteAt: row.lastInviteAt ? row.lastInviteAt.toISOString() : null,
            };
        })
        // Xếp theo số lượt ĐÃ PHÁT QUÀ trước (mời thật, đã qua onboarding), rồi mới
        // tới tổng lượt mời — tránh người spam link nhưng không ai vào leo lên đầu.
        .sort((a, b) => b.rewarded - a.rewarded || b.invited - a.invited
            || (b.lastInviteAt || "").localeCompare(a.lastInviteAt || ""))
        .slice(0, Math.min(500, Math.max(1, Number(limit) || 50)));

    return { rows, totals };
}

export default {
    getOrCreateUser,
    processReferralCommission,
    grantReferralReward,
    getReferralConfig,
    getReferralRewardInfo,
    getCommissionPercentSync,
    invalidateReferralConfig,
    warmReferralConfig,
    getReferralStats,
    getReferralLink,
    getTopReferrers,
    getReferralLeaderboard,
};
