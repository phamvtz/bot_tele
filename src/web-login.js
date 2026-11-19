import { randomBytes } from "node:crypto";
import { Router } from "express";
import defaultPrisma from "./lib/prisma.js";
import { secretEquals } from "./lib/secret-compare.js";
import { signTmaSessionToken } from "./middleware/tmaAuth.js";
import { verifyUserApiKey as defaultVerifyUserApiKey } from "./user-api.js";

const DEFAULT_TTL_MS = 5 * 60_000;
const DEFAULT_MAX_PENDING = 1000;
const TOKEN_RE = /^[A-Za-z0-9_-]{12,48}$/;

function isValidToken(token) {
    return TOKEN_RE.test(String(token || ""));
}

/**
 * Kho quản lý phiên đăng nhập Web Storefront qua Telegram Deep-Link.
 * Trình duyệt tạo challenge ngẫu nhiên, user bấm Xác nhận trong Telegram Bot,
 * rồi trình duyệt poll một lần để nhận `tma_sess_v1` JWT/HMAC token.
 */
export function createWebLoginStore({
    ttlMs = DEFAULT_TTL_MS,
    maxPending = DEFAULT_MAX_PENDING,
    nowFn = () => Date.now(),
} = {}) {
    const entries = new Map();

    function prune(now) {
        for (const [k, row] of entries.entries()) {
            if (!row || row.expiresAt <= now) {
                entries.delete(k);
            }
        }
        while (entries.size > maxPending) {
            const oldestKey = entries.keys().next().value;
            if (oldestKey === undefined) break;
            entries.delete(oldestKey);
        }
    }

    return {
        startSession() {
            const now = nowFn();
            prune(now);
            const token = randomBytes(18).toString("base64url");
            const expiresAt = now + ttlMs;
            entries.set(token, {
                token,
                status: "pending",
                createdAt: now,
                expiresAt,
                telegramId: null,
                sessionToken: null,
            });
            return { token, expiresAt };
        },

        getChallenge(token) {
            if (!isValidToken(token)) return null;
            const now = nowFn();
            const row = entries.get(token);
            if (!row) return null;
            if (row.expiresAt <= now) {
                entries.delete(token);
                return null;
            }
            if (row.status !== "pending") return null;
            return { token: row.token, expiresAt: row.expiresAt, status: row.status };
        },

        approve(token, { telegramId, sessionToken }) {
            if (!isValidToken(token)) return { ok: false, reason: "invalid_token" };
            const now = nowFn();
            const row = entries.get(token);
            if (!row) return { ok: false, reason: "not_found" };
            if (row.expiresAt <= now) {
                entries.delete(token);
                return { ok: false, reason: "expired" };
            }
            if (row.status !== "pending") return { ok: false, reason: "already_handled" };
            row.status = "approved";
            row.telegramId = String(telegramId);
            row.sessionToken = String(sessionToken);
            return { ok: true };
        },

        reject(token) {
            if (!isValidToken(token)) return { ok: false, reason: "invalid_token" };
            const now = nowFn();
            const row = entries.get(token);
            if (!row) return { ok: false, reason: "not_found" };
            if (row.expiresAt <= now) {
                entries.delete(token);
                return { ok: false, reason: "expired" };
            }
            if (row.status !== "pending") return { ok: false, reason: "already_handled" };
            row.status = "rejected";
            return { ok: true };
        },

        poll(token) {
            if (!isValidToken(token)) return { status: "expired" };
            const now = nowFn();
            const row = entries.get(token);
            if (!row) return { status: "expired" };
            if (row.expiresAt <= now) {
                entries.delete(token);
                return { status: "expired" };
            }
            if (row.status === "approved") {
                const sessionToken = row.sessionToken;
                entries.delete(token);
                return { status: "approved", sessionToken };
            }
            if (row.status === "rejected") {
                entries.delete(token);
                return { status: "rejected" };
            }
            return { status: "pending", expiresAt: row.expiresAt };
        },
    };
}

export const webLoginStore = createWebLoginStore();

function createIpRateLimiter({ windowMs, max }) {
    const hits = new Map();
    return (ip) => {
        const now = Date.now();
        if (hits.size > 5000) {
            for (const [k, v] of hits.entries()) {
                if (now - v.start >= windowMs) hits.delete(k);
            }
        }
        const key = String(ip || "unknown");
        let rec = hits.get(key);
        if (!rec || now - rec.start >= windowMs) {
            rec = { start: now, count: 0 };
        }
        if (rec.count >= max) return false;
        rec.count += 1;
        hits.set(key, rec);
        return true;
    };
}

/**
 * Router xác thực Web Storefront `/api/shop/auth/*`.
 * Hỗ trợ 2 phương thức không cần HTTPS widget:
 *   1. POST /start + GET /poll  -> Đăng nhập 1 chạm qua Telegram Bot (?start=weblogin_<token>)
 *   2. POST /apikey             -> Đăng nhập tức thì bằng API Key cá nhân (/api -> sk_u_v2_... hoặc Seller key)
 */
export function createWebAuthRouter({
    store = webLoginStore,
    prisma = defaultPrisma,
    getBotToken = () => process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || "",
    getBotUsername = () => process.env.TELEGRAM_BOT_USERNAME || "",
    verifyUserApiKey = defaultVerifyUserApiKey,
    getSellerKeys = async () => [],
} = {}) {
    const router = Router();
    const allowStart = createIpRateLimiter({ windowMs: 10 * 60_000, max: 30 });
    const allowApiKey = createIpRateLimiter({ windowMs: 10 * 60_000, max: 20 });

    router.post("/start", async (req, res) => {
        res.setHeader("Cache-Control", "no-store");
        if (!allowStart(req.ip)) {
            return res.status(429).json({ error: "Bạn thao tác quá nhanh, vui lòng thử lại sau ít phút." });
        }
        const botToken = String(getBotToken() || "").trim();
        if (!botToken) {
            return res.status(503).json({ error: "Máy chủ chưa cấu hình BOT_TOKEN." });
        }
        const botUsername = String((await Promise.resolve(getBotUsername()).catch(() => "")) || "")
            .replace(/^@/, "")
            .trim();
        const { token, expiresAt } = store.startSession();
        const deepLink = botUsername
            ? `https://t.me/${botUsername}?start=weblogin_${token}`
            : null;
        res.json({
            ok: true,
            token,
            expiresAt,
            botUsername: botUsername || null,
            deepLink,
        });
    });

    router.get("/poll", (req, res) => {
        res.setHeader("Cache-Control", "no-store");
        const token = String(req.query.token || "").trim();
        const out = store.poll(token);
        res.json({ ok: true, ...out });
    });

    router.post("/apikey", async (req, res) => {
        res.setHeader("Cache-Control", "no-store");
        if (!allowApiKey(req.ip)) {
            return res.status(429).json({ error: "Quá nhiều lần thử sai, vui lòng chờ ít phút." });
        }
        try {
            const rawKey = String(req.body?.apiKey || "").trim();
            if (!rawKey) {
                return res.status(400).json({ error: "Vui lòng nhập API Key cá nhân (lấy bằng lệnh /api trong bot)." });
            }

            let telegramId = null;
            try {
                const checked = verifyUserApiKey(rawKey);
                if (checked?.ok && checked.telegramId) {
                    telegramId = checked.telegramId;
                }
            } catch {
                // Bỏ qua nếu USER_API_SECRET chưa cấu hình; tiếp tục thử khớp seller key.
            }

            if (!telegramId) {
                const sellerKeys = await Promise.resolve(getSellerKeys()).catch(() => []);
                const matched = Array.isArray(sellerKeys)
                    ? sellerKeys.find((k) => k?.active !== false && k?.telegramId && secretEquals(String(k.key || ""), rawKey))
                    : null;
                if (matched?.telegramId) {
                    telegramId = String(matched.telegramId);
                }
            }

            if (!telegramId) {
                return res.status(401).json({
                    error: "API Key không hợp lệ. Hãy mở Bot gõ /api để lấy đúng API Key cá nhân.",
                });
            }

            const user = await prisma.user.findUnique({ where: { telegramId } });
            if (!user) {
                return res.status(401).json({ error: "Không tìm thấy tài khoản Telegram tương ứng." });
            }
            if (user.isBanned === true) {
                return res.status(403).json({ error: "Tài khoản của bạn đã bị khóa bởi quản trị viên." });
            }

            const botToken = String(getBotToken() || "").trim();
            if (!botToken) {
                return res.status(503).json({ error: "Máy chủ chưa cấu hình BOT_TOKEN." });
            }
            const sessionToken = signTmaSessionToken(
                { telegramId: user.telegramId, isPremium: Boolean(user.isTelegramPremium) },
                botToken,
            );
            res.json({
                ok: true,
                sessionToken,
                user: {
                    telegramId: user.telegramId,
                    firstName: user.firstName || "",
                    username: user.username || "",
                },
            });
        } catch (err) {
            console.error("[web-auth/apikey] error:", err);
            res.status(500).json({ error: "Lỗi xác thực API Key, vui lòng thử lại." });
        }
    });

    return router;
}
