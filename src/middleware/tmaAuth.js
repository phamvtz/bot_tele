import { createHmac } from "node:crypto";
import defaultPrisma from "../lib/prisma.js";
import { secretEquals } from "../lib/secret-compare.js";
import { getOrCreateUser as defaultGetOrCreateUser } from "../referral.js";
import { parseReferralStartParam } from "../referral-math.js";

const DEFAULT_MAX_AGE_SEC = Number(process.env.TMA_AUTH_MAX_AGE_SEC || 86_400);
const DEFAULT_SESSION_TTL_SEC = Number(process.env.TMA_SESSION_TTL_SEC || 7 * 86_400);
const FUTURE_SKEW_SEC = 300;
const SESSION_PREFIX = "tma_sess_v1";

/**
 * Xác thực chuỗi `initData` gốc do Telegram Mini App SDK cung cấp.
 * Thuật toán chính thức của Telegram:
 *   secret_key = HMAC_SHA256("WebAppData", botToken)
 *   expected   = HMAC_SHA256(secret_key, sorted_key_value_lines)
 */
export function verifyTelegramInitData(
    rawInitData,
    botToken,
    { maxAgeSec = DEFAULT_MAX_AGE_SEC, now = Date.now() } = {},
) {
    const raw = String(rawInitData || "").trim();
    const token = String(botToken || "").trim();
    if (!raw) {
        return { ok: false, code: "MISSING_INIT_DATA", error: "Thiếu dữ liệu xác thực Telegram Mini App" };
    }
    if (!token) {
        return { ok: false, code: "BOT_TOKEN_MISSING", error: "Máy chủ chưa cấu hình BOT_TOKEN" };
    }

    let params;
    try {
        params = new URLSearchParams(raw);
    } catch {
        return { ok: false, code: "INVALID_INIT_DATA", error: "Định dạng initData không hợp lệ" };
    }

    const hash = params.get("hash") || "";
    if (!/^[a-f0-9]{64}$/i.test(hash)) {
        return { ok: false, code: "INVALID_HASH", error: "Chữ ký xác thực không hợp lệ" };
    }

    const pairs = [];
    for (const [key, value] of params.entries()) {
        if (key === "hash") continue;
        pairs.push([key, value]);
    }
    pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const dataCheckString = pairs.map(([k, v]) => `${k}=${v}`).join("\n");

    const secretKey = createHmac("sha256", "WebAppData").update(token).digest();
    const expectedHash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

    if (!secretEquals(expectedHash.toLowerCase(), hash.toLowerCase())) {
        return { ok: false, code: "BAD_SIGNATURE", error: "Chữ ký xác thực Telegram không khớp" };
    }

    const authDate = Number(params.get("auth_date") || 0);
    const nowSec = Math.floor(now / 1000);
    if (!Number.isFinite(authDate) || authDate <= 0) {
        return { ok: false, code: "MISSING_AUTH_DATE", error: "Thiếu thời gian xác thực (auth_date)" };
    }
    if (authDate > nowSec + FUTURE_SKEW_SEC) {
        return { ok: false, code: "FUTURE_AUTH_DATE", error: "Thời gian xác thực không hợp lệ" };
    }
    if (maxAgeSec > 0 && nowSec - authDate > maxAgeSec) {
        return { ok: false, code: "EXPIRED_INIT_DATA", error: "Phiên Telegram Mini App đã hết hạn, vui lòng mở lại ứng dụng" };
    }

    const userRaw = params.get("user");
    if (!userRaw) {
        return { ok: false, code: "MISSING_USER", error: "Không tìm thấy thông tin người dùng Telegram" };
    }

    let tgUser;
    try {
        tgUser = JSON.parse(userRaw);
    } catch {
        return { ok: false, code: "INVALID_USER_JSON", error: "Thông tin người dùng không hợp lệ" };
    }

    if (!tgUser?.id || !/^\d+$/.test(String(tgUser.id))) {
        return { ok: false, code: "INVALID_USER_ID", error: "Telegram ID không hợp lệ" };
    }

    const startParam = String(params.get("start_param") || "").trim();
    const queryId = String(params.get("query_id") || "").trim();

    return {
        ok: true,
        user: tgUser,
        telegramId: String(tgUser.id),
        authDate,
        startParam,
        queryId,
    };
}

/**
 * Ký session token ngắn gọn để Mini App giữ phiên khi khách treo màn hình chờ quét QR lâu
 * (tránh việc initData quá hạn giữa lúc polling đơn hàng).
 */
export function signTmaSessionToken(
    payload,
    botToken,
    { ttlSec = DEFAULT_SESSION_TTL_SEC, now = Date.now() } = {},
) {
    const token = String(botToken || "").trim();
    if (!token) throw new Error("Missing BOT_TOKEN for TMA session signing");
    const telegramId = String(payload?.telegramId || "").trim();
    if (!/^\d+$/.test(telegramId)) throw new Error("Invalid telegramId for TMA session");

    const nowSec = Math.floor(now / 1000);
    const body = {
        tid: telegramId,
        iat: nowSec,
        exp: nowSec + Math.max(60, Number(ttlSec) || DEFAULT_SESSION_TTL_SEC),
        prm: Boolean(payload?.isPremium),
    };
    const encoded = Buffer.from(JSON.stringify(body), "utf8").toString("base64url");
    const key = createHmac("sha256", "TmaSessionV1").update(token).digest();
    const sig = createHmac("sha256", key).update(`${SESSION_PREFIX}.${encoded}`).digest("hex");
    return `${SESSION_PREFIX}.${encoded}.${sig}`;
}

export function verifyTmaSessionToken(rawToken, botToken, { now = Date.now() } = {}) {
    const str = String(rawToken || "").trim();
    const token = String(botToken || "").trim();
    if (!str || !token) return { ok: false, code: "MISSING_TOKEN", error: "Thiếu token phiên" };

    const parts = str.split(".");
    if (parts.length !== 3 || parts[0] !== SESSION_PREFIX) {
        return { ok: false, code: "INVALID_FORMAT", error: "Định dạng token phiên không hợp lệ" };
    }

    const [, encoded, sig] = parts;
    if (!/^[a-f0-9]{64}$/i.test(sig)) {
        return { ok: false, code: "INVALID_SIG", error: "Chữ ký phiên không hợp lệ" };
    }

    const key = createHmac("sha256", "TmaSessionV1").update(token).digest();
    const expected = createHmac("sha256", key).update(`${SESSION_PREFIX}.${encoded}`).digest("hex");
    if (!secretEquals(expected.toLowerCase(), sig.toLowerCase())) {
        return { ok: false, code: "BAD_SESSION_SIG", error: "Chữ ký phiên không khớp" };
    }

    let body;
    try {
        body = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    } catch {
        return { ok: false, code: "INVALID_PAYLOAD", error: "Nội dung phiên lỗi" };
    }

    const nowSec = Math.floor(now / 1000);
    if (!body?.tid || !/^\d+$/.test(String(body.tid))) {
        return { ok: false, code: "INVALID_TID", error: "Phiên thiếu định danh người dùng" };
    }
    if (!Number.isFinite(body.exp) || body.exp < nowSec) {
        return { ok: false, code: "SESSION_EXPIRED", error: "Phiên đã hết hạn, vui lòng tải lại Mini App" };
    }

    return {
        ok: true,
        telegramId: String(body.tid),
        isPremium: Boolean(body.prm),
        exp: body.exp,
    };
}

export function extractTmaCredentials(req) {
    const authHeader = String(req.headers?.authorization || "").trim();
    if (/^tma\s+/i.test(authHeader)) {
        return { kind: "initData", value: authHeader.replace(/^tma\s+/i, "").trim() };
    }
    if (/^Bearer\s+tma_sess_v1\./i.test(authHeader)) {
        return { kind: "session", value: authHeader.replace(/^Bearer\s+/i, "").trim() };
    }
    const headerInit = String(req.headers?.["x-telegram-init-data"] || "").trim();
    if (headerInit) {
        return { kind: "initData", value: headerInit };
    }
    const headerSession = String(req.headers?.["x-tma-session"] || "").trim();
    if (headerSession.startsWith(`${SESSION_PREFIX}.`)) {
        return { kind: "session", value: headerSession };
    }
    return null;
}

/**
 * Middleware xác thực người dùng Telegram Mini App.
 * Chỉ chặn tài khoản bị Admin khóa thật sự (`isBanned === true`), KHÔNG chặn khách chỉ
 * có `isBlocked === true` (cờ tự động sinh ra khi bot gặp lỗi 403 Telegram).
 */
export function createTmaAuthMiddleware({
    getBotToken = () => process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || "",
    prisma = defaultPrisma,
    getOrCreateUser = defaultGetOrCreateUser,
    maxAgeSec = DEFAULT_MAX_AGE_SEC,
    nowFn = () => Date.now(),
} = {}) {
    return async function tmaAuth(req, res, next) {
        try {
            const botToken = getBotToken();
            const cred = extractTmaCredentials(req);
            if (!cred) {
                return res.status(401).json({
                    error: "Vui lòng mở cửa hàng bên trong ứng dụng Telegram.",
                    code: "TMA_AUTH_REQUIRED",
                });
            }

            const now = nowFn();
            let user = null;
            let tgUser = null;
            let startParam = "";

            if (cred.kind === "initData") {
                const verified = verifyTelegramInitData(cred.value, botToken, { maxAgeSec, now });
                if (!verified.ok) {
                    // Nếu client gửi kèm x-tma-session còn hạn khi initData vừa quá 24h → fallback sang session
                    const fallbackSession = String(req.headers?.["x-tma-session"] || "").trim();
                    if (verified.code === "EXPIRED_INIT_DATA" && fallbackSession.startsWith(`${SESSION_PREFIX}.`)) {
                        const sess = verifyTmaSessionToken(fallbackSession, botToken, { now });
                        if (sess.ok) {
                            user = await prisma.user.findUnique({ where: { telegramId: sess.telegramId } });
                            tgUser = verified.user || { id: Number(sess.telegramId), is_premium: sess.isPremium };
                        }
                    }
                    if (!user) {
                        return res.status(401).json({ error: verified.error, code: verified.code });
                    }
                } else {
                    tgUser = verified.user;
                    startParam = verified.startParam || String(req.body?.startParam || "").trim();
                    const parsedRef = parseReferralStartParam(startParam);
                    user = await getOrCreateUser(tgUser, parsedRef ? startParam : null);
                }
            } else {
                const sess = verifyTmaSessionToken(cred.value, botToken, { now });
                if (!sess.ok) {
                    return res.status(401).json({ error: sess.error, code: sess.code });
                }
                user = await prisma.user.findUnique({ where: { telegramId: sess.telegramId } });
                tgUser = {
                    id: Number(sess.telegramId),
                    first_name: user?.firstName || "",
                    username: user?.username || "",
                    language_code: user?.language || "vi",
                    is_premium: Boolean(user?.isTelegramPremium || sess.isPremium),
                };
            }

            if (!user) {
                return res.status(401).json({
                    error: "Không tìm thấy hồ sơ người dùng. Vui lòng mở lại Mini App.",
                    code: "USER_NOT_FOUND",
                });
            }

            if (user.isBanned === true) {
                return res.status(403).json({
                    error: "Tài khoản của bạn đã bị khóa bởi quản trị viên.",
                    code: "ACCOUNT_BANNED",
                });
            }

            req.tmaUser = user;
            req.tmaTgUser = tgUser;
            req.tmaStartParam = startParam;
            next();
        } catch (err) {
            console.error("[tmaAuth] error:", err?.message || err);
            res.status(500).json({ error: "Lỗi xác thực hệ thống, vui lòng thử lại." });
        }
    };
}

// ─── Channel Membership Gate (chỉ áp dụng khi Mua hàng / Nạp / Đổi quà) ───────

const _channelVerifyCache = new Map();
const CHANNEL_VERIFY_TTL_MS = 10 * 60 * 1000; // 10 phút cho kết quả ĐÃ THAM GIA

export function invalidateChannelGateCache(telegramId = null) {
    if (telegramId === null || telegramId === undefined) {
        _channelVerifyCache.clear();
        return;
    }
    _channelVerifyCache.delete(String(telegramId));
}

export function getChannelGateConfig() {
    const requiredGroup = String(process.env.REQUIRED_GROUP || process.env.ORDER_NOTIFY_CHANNEL || "").trim();
    const joinUrl = String(
        process.env.REQUIRED_GROUP_URL
        || process.env.SUPPORT_CHANNEL_URL
        || "https://t.me/vpluschannelkh"
    ).trim();
    const enabled = process.env.REQUIRE_GROUP_JOIN !== "false" && Boolean(requiredGroup);
    const failOpen = process.env.GROUP_GATE_FAILOPEN === "true";
    const adminBypass = process.env.GROUP_GATE_ADMIN_BYPASS === "true";
    const adminIds = String(process.env.ADMIN_IDS || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    return { requiredGroup, joinUrl, enabled, failOpen, adminBypass, adminIds };
}

export async function checkRequiredChannelMember({
    telegram,
    telegramId,
    forceFresh = false,
    configOverride = null,
    now = Date.now(),
} = {}) {
    const cfg = configOverride || getChannelGateConfig();
    const tgId = String(telegramId || "").trim();

    if (!cfg.enabled || !cfg.requiredGroup) {
        return { required: false, joined: true, joinUrl: cfg.joinUrl, requiredGroup: cfg.requiredGroup };
    }
    if (cfg.adminBypass && cfg.adminIds.includes(tgId)) {
        return { required: true, joined: true, joinUrl: cfg.joinUrl, requiredGroup: cfg.requiredGroup };
    }

    if (!forceFresh) {
        const cached = _channelVerifyCache.get(tgId);
        if (cached && now - cached.ts < CHANNEL_VERIFY_TTL_MS && cached.joined) {
            return { required: true, joined: true, joinUrl: cfg.joinUrl, requiredGroup: cfg.requiredGroup };
        }
    }

    if (!telegram?.getChatMember) {
        return { required: true, joined: cfg.failOpen, joinUrl: cfg.joinUrl, requiredGroup: cfg.requiredGroup };
    }

    try {
        const member = await telegram.getChatMember(cfg.requiredGroup, Number(tgId));
        const status = member?.status;
        const joined = status === "restricted"
            ? member?.is_member !== false
            : ["creator", "administrator", "member"].includes(status);

        if (joined) {
            _channelVerifyCache.set(tgId, { joined: true, ts: now });
        } else {
            _channelVerifyCache.delete(tgId);
        }
        return { required: true, joined, joinUrl: cfg.joinUrl, requiredGroup: cfg.requiredGroup };
    } catch (err) {
        console.error(
            `[tma-channel-gate] Không kiểm tra được thành viên ${cfg.requiredGroup} cho ${tgId}: ${err?.message || err}`,
        );
        return { required: true, joined: cfg.failOpen, joinUrl: cfg.joinUrl, requiredGroup: cfg.requiredGroup };
    }
}

export function createChannelGateMiddleware({
    getTelegram,
    configFn = getChannelGateConfig,
} = {}) {
    return async function requireChannelJoin(req, res, next) {
        try {
            const tgId = req.tmaUser?.telegramId;
            if (!tgId) {
                return res.status(401).json({ error: "Chưa xác thực người dùng", code: "TMA_AUTH_REQUIRED" });
            }
            const status = await checkRequiredChannelMember({
                telegram: getTelegram?.(),
                telegramId: tgId,
                configOverride: configFn(),
            });
            if (!status.joined) {
                return res.status(403).json({
                    error: "Vui lòng tham gia kênh chính thức của shop trước khi thực hiện giao dịch hoặc nhận quà.",
                    code: "CHANNEL_JOIN_REQUIRED",
                    joinUrl: status.joinUrl,
                    requiredGroup: status.requiredGroup,
                });
            }
            next();
        } catch (err) {
            console.error("[requireChannelJoin] error:", err?.message || err);
            res.status(500).json({ error: "Không kiểm tra được trạng thái tham gia kênh, vui lòng thử lại." });
        }
    };
}
