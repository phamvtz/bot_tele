/**
 * Thuật toán thuần cho hệ thống Referral v2:
 *   - Quay số có trọng số 2M–7M + Bảo hiểm xui (Lucky Protect)
 *   - Quay số mã quà chào mừng WEL (5M–10M)
 *   - Ước lượng tuổi Telegram bằng Peer Envelope (Age Gate)
 *   - Cửa sổ Late Claim (30 phút), Invite Gift (48h), Anti-clone đổi điểm
 *   - Mốc thưởng 5 / 10 / 20 & Xếp hạng Top 1–2–3 ngày (giờ Việt Nam UTC+7)
 *
 * TOÀN BỘ file là hàm THUẦN — không I/O, không đọc DB/ENV, mọi mốc thời gian
 * truyền từ ngoài vào để test định hướng 100%.
 */

import { isIP } from "node:net";

export const VN_OFFSET_MS = 7 * 3_600_000; // Asia/Ho_Chi_Minh (UTC+7, không có DST)
export const LATE_CLAIM_MAX_AGE_MS = 30 * 60 * 1000; // 30 phút
export const NEW_USER_MAX_AGE_MS = 48 * 3_600 * 1000; // 48 giờ
export const CLASSIC_REDEEM_COOLDOWN_MS = 3 * 86_400_000; // Cooldown 3 ngày cho 4 tier đổi Account classic
export const MIN_TG_ID_FOR_REDEEM = 8_500_000_000;
export const MIN_SHOP_AGE_DAYS_FOR_REDEEM = 3;
export const REFERRER_KEY_DAYS_CAP = 400;
export const GW_RETRY_MAX = 8;
export const KEY1B_MILESTONES = Object.freeze([25, 50, 75, 90]);

/** Trọng số chuẩn cho dải 2M–7M (tổng = 100): 2M:25%, 3M:22%, 4M:20%, 5M:18%, 6M:10%, 7M:5%. */
export const HOST_ROLL_WEIGHTS = Object.freeze({
    2: 25,
    3: 22,
    4: 20,
    5: 18,
    6: 10,
    7: 5,
});

// ─── Múi giờ Việt Nam (UTC+7) ─────────────────────────────────────────────────

export function vnDayKey(ms = Date.now()) {
    const t = typeof ms === "number" ? ms : new Date(ms).getTime();
    const vn = new Date(t + VN_OFFSET_MS);
    const y = vn.getUTCFullYear();
    const m = String(vn.getUTCMonth() + 1).padStart(2, "0");
    const d = String(vn.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

export function vnDayStartUtc(dayKey) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dayKey || "").trim());
    if (!m) return null;
    const utcMs = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0) - VN_OFFSET_MS;
    return new Date(utcMs);
}

export function isSameVnDay(a, b) {
    if (!a || !b) return false;
    const ta = new Date(a).getTime();
    const tb = new Date(b).getTime();
    if (!Number.isFinite(ta) || !Number.isFinite(tb)) return false;
    return vnDayKey(ta) === vnDayKey(tb);
}

export function vnClockParts(nowMs = Date.now()) {
    const vn = new Date(nowMs + VN_OFFSET_MS);
    const dayKey = vnDayKey(nowMs);
    const yesterdayKey = vnDayKey(nowMs - 86_400_000);
    return {
        dayKey,
        yesterdayKey,
        hour: vn.getUTCHours(),
        minute: vn.getUTCMinutes(),
    };
}

// ─── Quay số thưởng người mời & Bảo hiểm xui (Lucky Protect) ──────────────────

export function shouldTriggerLuckyProtect(recent3Tokens = [], luckyMinTokens = 6_000_000) {
    if (!Array.isArray(recent3Tokens) || recent3Tokens.length < 3) return false;
    const minTok = Math.max(0, Number(luckyMinTokens) || 0);
    if (minTok <= 0) return false;
    const last3 = recent3Tokens.slice(0, 3).map((x) => Number(x) || 0);
    return last3.every((tok) => tok > 0 && tok < minTok);
}

export function rollReferrerInviteTokens({
    minTokens = 2_000_000,
    maxTokens = 7_000_000,
    luckyProtectEnabled = true,
    luckyMinTokens = 6_000_000,
    recent3Tokens = [],
    rng = Math.random,
} = {}) {
    let minM = Math.max(1, Math.round(Number(minTokens) / 1_000_000) || 2);
    let maxM = Math.max(minM, Math.round(Number(maxTokens) / 1_000_000) || 7);

    const allSteps = [];
    for (let m = minM; m <= maxM; m++) {
        allSteps.push({ m, weight: HOST_ROLL_WEIGHTS[m] ?? 1 });
    }

    let lucky = false;
    let pool = allSteps;
    if (luckyProtectEnabled && shouldTriggerLuckyProtect(recent3Tokens, luckyMinTokens)) {
        const highPool = allSteps.filter((s) => s.m * 1_000_000 >= luckyMinTokens);
        if (highPool.length > 0) {
            pool = highPool;
            lucky = true;
        }
    }

    const totalWeight = pool.reduce((sum, s) => sum + s.weight, 0);
    let r = Math.max(0, Math.min(0.999999999, Number(rng()) || 0)) * totalWeight;
    let chosen = pool[pool.length - 1].m;
    for (const step of pool) {
        if (r < step.weight) {
            chosen = step.m;
            break;
        }
        r -= step.weight;
    }

    return {
        tokens: chosen * 1_000_000,
        millions: chosen,
        lucky,
    };
}

export function rollWelcomeTokens({ minM = 5, maxM = 10, rng = Math.random } = {}) {
    const lo = Math.max(1, Math.floor(Number(minM) || 5));
    const hi = Math.max(lo, Math.floor(Number(maxM) || 10));
    const count = hi - lo + 1;
    const chosenM = lo + Math.min(count - 1, Math.floor(Math.max(0, Number(rng()) || 0) * count));
    return {
        tokens: chosenM * 1_000_000,
        millions: chosenM,
    };
}

// ─── Lọc tuổi Telegram (Peer Envelope) & Chống Clone ─────────────────────────

/**
 * Thuật toán Peer Envelope:
 * Lọc các user trong shop có telegramId > ứng_viên (so sánh SỐ), xếp createdAt tăng dần,
 * lấy mốc cũ thứ 3 (nếu >= 3 peer; hoặc thứ 2 / thứ 1 nếu ít hơn) làm peerAge,
 * rồi lấy max(peerAge, shopAge).
 */
export function estimateTelegramAgeDays({
    telegramId,
    userCreatedAt,
    isPremium = false,
    peers = [],
    now = Date.now(),
} = {}) {
    const candidateNum = Number(telegramId);
    const createdMs = userCreatedAt ? new Date(userCreatedAt).getTime() : now;
    const shopAgeDays = Number.isFinite(createdMs) ? Math.max(0, (now - createdMs) / 86_400_000) : 0;

    if (!Number.isFinite(candidateNum) || candidateNum <= 0) {
        return {
            estimatedAgeDays: shopAgeDays,
            peerAgeDays: 0,
            shopAgeDays,
            higherPeerCount: 0,
            isPremium: Boolean(isPremium),
        };
    }

    const higherCreatedMs = [];
    for (const p of peers) {
        const pNum = p.tgNum !== undefined ? p.tgNum : Number(p.telegramId);
        if (!Number.isFinite(pNum) || pNum <= candidateNum) continue;
        const pMs = p.createdAtMs !== undefined ? p.createdAtMs : new Date(p.createdAt).getTime();
        if (Number.isFinite(pMs) && pMs > 0) higherCreatedMs.push(pMs);
    }

    higherCreatedMs.sort((a, b) => a - b); // cũ nhất đứng đầu

    let anchorMs = null;
    if (higherCreatedMs.length >= 3) anchorMs = higherCreatedMs[2];
    else if (higherCreatedMs.length === 2) anchorMs = higherCreatedMs[1];
    else if (higherCreatedMs.length === 1) anchorMs = higherCreatedMs[0];

    const peerAgeDays = anchorMs !== null ? Math.max(0, (now - anchorMs) / 86_400_000) : 0;
    const estimatedAgeDays = Math.max(peerAgeDays, shopAgeDays);

    return {
        estimatedAgeDays,
        peerAgeDays,
        shopAgeDays,
        higherPeerCount: higherCreatedMs.length,
        isPremium: Boolean(isPremium),
    };
}

export function evaluateAgeGate({
    ageFilterEnabled = true,
    minTgAgeDays = 7,
    isPremium = false,
    estimatedAgeDays = 0,
} = {}) {
    const minDays = Math.min(90, Math.max(1, Math.floor(Number(minTgAgeDays) || 7)));
    if (!ageFilterEnabled || isPremium || estimatedAgeDays >= minDays) {
        return { passed: true, minDays, remainingDays: 0 };
    }
    return {
        passed: false,
        minDays,
        remainingDays: Math.max(1, Math.ceil(minDays - estimatedAgeDays)),
    };
}

export function isLateClaim(userCreatedAt, now = Date.now()) {
    if (!userCreatedAt) return false;
    const ms = new Date(userCreatedAt).getTime();
    if (!Number.isFinite(ms)) return false;
    return now - ms > LATE_CLAIM_MAX_AGE_MS;
}

export function isBrandNewForInvite(user, now = Date.now()) {
    if (!user) return false;
    if (user.referralLateClaim) return false;
    if (user.refWelcomeCode) return true;
    const createdMs = user.createdAt ? new Date(user.createdAt).getTime() : NaN;
    if (!Number.isFinite(createdMs)) return false;
    return now - createdMs <= NEW_USER_MAX_AGE_MS;
}

export function isTooNewForRedeem(user, now = Date.now()) {
    if (!user) return true;
    const tgNum = Number(user.telegramId);
    if (!Number.isFinite(tgNum) || tgNum <= MIN_TG_ID_FOR_REDEEM) return false;
    const createdMs = user.createdAt ? new Date(user.createdAt).getTime() : now;
    if (!Number.isFinite(createdMs)) return true;
    return now - createdMs < MIN_SHOP_AGE_DAYS_FOR_REDEEM * 86_400_000;
}

// ─── Mốc thưởng 5/10/20 & Đua Top Ngày ────────────────────────────────────────

export function getMilestoneDefs(cfg = {}) {
    return [
        { count: 5, tokens: Math.max(0, Number(cfg.milestone5Tokens ?? 15_000_000) || 0) },
        { count: 10, tokens: Math.max(0, Number(cfg.milestone10Tokens ?? 25_000_000) || 0) },
        { count: 20, tokens: Math.max(0, Number(cfg.milestone20Tokens ?? 50_000_000) || 0) },
    ].filter((m) => m.tokens > 0);
}

export function dueMilestones(completedCount, cfg = {}) {
    if (cfg.milestoneEnabled === false) return [];
    const n = Math.max(0, Math.floor(Number(completedCount) || 0));
    return getMilestoneDefs(cfg).filter((m) => n >= m.count);
}

export function nextMilestoneProgress(completedCount, cfg = {}) {
    const n = Math.max(0, Math.floor(Number(completedCount) || 0));
    const defs = getMilestoneDefs(cfg);
    if (!defs.length || cfg.milestoneEnabled === false) return null;
    const next = defs.find((m) => n < m.count);
    const target = next ? next.count : defs[defs.length - 1].count;
    const filled = Math.min(10, Math.round((Math.min(n, target) / target) * 10));
    const bar = "▓".repeat(filled) + "░".repeat(10 - filled);
    return {
        current: n,
        target,
        bonusTokens: next ? next.tokens : 0,
        allDone: !next,
        bar,
    };
}

/**
 * Xếp hạng Top người mời trong ngày từ danh sách ReferralEvent (join_channel).
 * Đếm theo tập `referredUserId` duy nhất cho mỗi `referrerTgId`; bằng điểm thì ai
 * cán mốc cuối SỚM HƠN xếp trên (`a.lastAt - b.lastAt`).
 */
export function rankDailyTopReferrers(events = []) {
    const byRef = new Map();
    for (const ev of events) {
        if (!ev || ev.eventType !== "join_channel") continue;
        const refTg = String(ev.referrerTgId || "").trim();
        const invitedTg = String(ev.referredUserId || "").trim();
        if (!refTg || !invitedTg || refTg === invitedTg) continue;
        const atMs = ev.createdAt ? new Date(ev.createdAt).getTime() : 0;
        let row = byRef.get(refTg);
        if (!row) {
            row = { referrerTgId: refTg, seen: new Set(), count: 0, lastAt: 0 };
            byRef.set(refTg, row);
        }
        if (row.seen.has(invitedTg)) continue;
        row.seen.add(invitedTg);
        row.count += 1;
        if (atMs > row.lastAt) row.lastAt = atMs;
    }

    return [...byRef.values()]
        .filter((r) => r.count > 0)
        .map(({ referrerTgId, count, lastAt }) => ({ referrerTgId, count, lastAt }))
        .sort((a, b) => b.count - a.count || a.lastAt - b.lastAt || a.referrerTgId.localeCompare(b.referrerTgId));
}

export function computeGatewayRetryDelayMs(retryCount = 0) {
    const n = Math.max(0, Math.min(4, Math.floor(Number(retryCount) || 0)));
    return Math.min(30 * 60_000, 2 * 60_000 * Math.pow(2, n));
}

/** Parse tham số /start: hỗ trợ CẢ `ref7368118922` (theo spec mới) VÀ `ref_ABCD1234` (link cũ). */
export function parseReferralStartParam(startParam) {
    const raw = String(startParam || "").trim();
    if (!raw) return null;
    if (raw.startsWith("ref_")) {
        const body = raw.slice(4).trim();
        if (!body) return null;
        if (/^\d{5,16}$/.test(body)) return { kind: "telegramId", value: body };
        return { kind: "code", value: body.toUpperCase() };
    }
    if (/^ref(\d{5,16})$/i.test(raw)) {
        return { kind: "telegramId", value: raw.slice(3) };
    }
    return null;
}

// ─── Cooldown 3 ngày cho 4 Tier Account Classic & Hỗ trợ Key 1.5B ─────────────

export function evaluateClassicRedeemCooldown(lastRedeemAt, now = Date.now()) {
    if (!lastRedeemAt) return { ready: true, remainingHours: 0, nextAvailableAt: null };
    const lastMs = new Date(lastRedeemAt).getTime();
    if (!Number.isFinite(lastMs) || lastMs <= 0) return { ready: true, remainingHours: 0, nextAvailableAt: null };
    const nextMs = lastMs + CLASSIC_REDEEM_COOLDOWN_MS;
    if (now >= nextMs) return { ready: true, remainingHours: 0, nextAvailableAt: null };
    return {
        ready: false,
        remainingHours: Math.max(1, Math.ceil((nextMs - now) / 3_600_000)),
        nextAvailableAt: new Date(nextMs).toISOString(),
    };
}

/**
 * Kiểm tra 1 hoặc 2 địa chỉ IPv4 / IPv6 hợp lệ, không trùng nhau (dùng cho Key 1.5B).
 * Chấp nhận phân tách bằng dấu phẩy, khoảng trắng, xuống dòng hoặc chấm phẩy.
 */
export function validateKey1bIps(rawInput) {
    const raw = String(rawInput || "").trim();
    if (!raw) return { ok: false, error: "EMPTY_IPS" };

    const tokens = raw
        .split(/[\s,;]+/)
        .map((s) => s.trim())
        .filter(Boolean);

    if (tokens.length < 1) return { ok: false, error: "EMPTY_IPS" };
    if (tokens.length > 2) return { ok: false, error: "TOO_MANY_IPS", count: tokens.length };

    const normalized = [];
    const seen = new Set();
    for (const tok of tokens) {
        const ver = isIP(tok);
        if (ver !== 4 && ver !== 6) {
            return { ok: false, error: "INVALID_IP", invalidToken: tok };
        }
        const clean = ver === 6 ? tok.toLowerCase() : tok;
        if (seen.has(clean)) {
            return { ok: false, error: "DUPLICATE_IP", invalidToken: tok };
        }
        seen.add(clean);
        normalized.push(clean);
    }

    return { ok: true, ips: normalized };
}

/**
 * Xác định thông báo rao mốc slot tự động cho Key 1.5B (25%, 50%, 75%, 90% + sold-out).
 * TUYỆT ĐỐI không trả số `used` / `limit` thô ra thông báo công khai — chỉ trả mốc % ước lượng.
 */
export function computeKey1bMilestoneAction({
    used = 0,
    limit = 50,
    unlimited = false,
    milestoneEnabled = true,
    alreadyLogged = [],
    soldOutLogged = false,
} = {}) {
    const usedCount = Math.max(0, Math.floor(Number(used) || 0));
    const maxSlots = Math.max(0, Math.floor(Number(limit) || 0));
    const prevSet = new Set(
        (Array.isArray(alreadyLogged) ? alreadyLogged : [])
            .map((n) => Number(n))
            .filter((n) => KEY1B_MILESTONES.includes(n)),
    );

    if (unlimited || !milestoneEnabled || maxSlots <= 0) {
        return {
            shouldAnnounce: false,
            kind: null,
            percent: null,
            nextLog: [...prevSet].sort((a, b) => a - b),
            nextSoldOut: Boolean(soldOutLogged),
        };
    }

    if (usedCount >= maxSlots) {
        for (const m of KEY1B_MILESTONES) prevSet.add(m);
        const nextLog = [...prevSet].sort((a, b) => a - b);
        if (soldOutLogged) {
            return { shouldAnnounce: false, kind: null, percent: 100, nextLog, nextSoldOut: true };
        }
        return {
            shouldAnnounce: true,
            kind: "sold_out",
            percent: 100,
            nextLog,
            nextSoldOut: true,
        };
    }

    const ratioPct = (usedCount / maxSlots) * 100;
    const newlyCrossed = KEY1B_MILESTONES.filter((m) => ratioPct >= m && !prevSet.has(m));
    if (!newlyCrossed.length) {
        return {
            shouldAnnounce: false,
            kind: null,
            percent: null,
            nextLog: [...prevSet].sort((a, b) => a - b),
            nextSoldOut: Boolean(soldOutLogged),
        };
    }

    for (const m of newlyCrossed) prevSet.add(m);
    const highestMilestone = newlyCrossed[newlyCrossed.length - 1];
    return {
        shouldAnnounce: true,
        kind: "milestone",
        percent: highestMilestone,
        nextLog: [...prevSet].sort((a, b) => a - b),
        nextSoldOut: Boolean(soldOutLogged),
    };
}

export default {
    VN_OFFSET_MS,
    LATE_CLAIM_MAX_AGE_MS,
    NEW_USER_MAX_AGE_MS,
    CLASSIC_REDEEM_COOLDOWN_MS,
    MIN_TG_ID_FOR_REDEEM,
    MIN_SHOP_AGE_DAYS_FOR_REDEEM,
    REFERRER_KEY_DAYS_CAP,
    GW_RETRY_MAX,
    KEY1B_MILESTONES,
    HOST_ROLL_WEIGHTS,
    vnDayKey,
    vnDayStartUtc,
    isSameVnDay,
    vnClockParts,
    shouldTriggerLuckyProtect,
    rollReferrerInviteTokens,
    rollWelcomeTokens,
    estimateTelegramAgeDays,
    evaluateAgeGate,
    isLateClaim,
    isBrandNewForInvite,
    isTooNewForRedeem,
    getMilestoneDefs,
    dueMilestones,
    nextMilestoneProgress,
    rankDailyTopReferrers,
    computeGatewayRetryDelayMs,
    parseReferralStartParam,
    evaluateClassicRedeemCooldown,
    validateKey1bIps,
    computeKey1bMilestoneAction,
};
