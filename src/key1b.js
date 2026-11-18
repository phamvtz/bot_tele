/**
 * Nhánh 5 — Hệ thống Đổi Key 1.5B (Key dùng chung khóa IP, `rewardType = "key1b"`):
 *   - Phát 1 chuỗi API key dùng chung cho cả đợt (`Setting.key1bKeyValue`), không lộ giá trị
 *     key thật ra endpoint quản trị (`_key1bKeyValue_configured` + bản che `sk-***...`).
 *   - Mỗi user đổi tối đa 1 lần / đợt (`>= key1bResetAt`), trừ `key1bCost` điểm giới thiệu.
 *   - Bắt buộc nhập 1–2 địa chỉ IPv4/IPv6 hợp lệ, không trùng nhau (`note = "ips=..."`).
 *   - Rao mốc slot tự động qua 25%, 50%, 75%, 90% + 1 lần Sold-out (TUYỆT ĐỐI không lộ
 *     con số `used / limit` thật ra ngoài) lên Channel (kèm nút deep-link `?start=key1b`)
 *     và/hoặc Broadcast tới người dùng bot.
 */

import { Markup } from "telegraf";
import { prisma } from "./db.js";
import { userCache } from "./lib/cache.js";
import { isDuplicateKeyError } from "./lib/duplicate-key.js";
import { maskApiKey } from "./lib/mask-secret.js";
import { sendBroadcast } from "./broadcast.js";
import { sendLog } from "./lib/logger.js";
import { escapeHtml } from "./bot-ui/format.js";
import {
    isTooNewForRedeem,
    validateKey1bIps,
    computeKey1bMilestoneAction,
} from "./referral-math.js";

export const KEY1B_SETTING_KEYS = [
    "key1bEnabled",
    "key1bDisplayName",
    "key1bKeyValue",
    "key1bCost",
    "key1bLimit",
    "key1bUnlimited",
    "key1bResetAt",
    "key1bNote",
    "key1bMilestoneEnabled",
    "key1bMilestoneBroadcastUsers",
    "key1bMilestoneChannelEnabled",
    "key1bMilestoneChannelId",
    "key1bMilestoneLog",
    "key1bMilestoneSoldOut",
];

const CFG_TTL_MS = 30_000;
const ADMIN_REDEMPTIONS_MAX = 300;
let _cfgMap = null;
let _cfgTs = 0;

// Tuần tự hóa luồng đổi Key 1.5B trong tiến trình để chốt slot limit chính xác tuyệt đối
let _redeemQueue = Promise.resolve();
function withKey1bLock(fn) {
    const prev = _redeemQueue;
    let release;
    const next = new Promise((r) => { release = r; });
    _redeemQueue = prev.then(() => next, () => next);
    return prev.catch(() => {}).then(fn).finally(() => release());
}

export function invalidateKey1bConfig() {
    _cfgMap = null;
    _cfgTs = 0;
}

function boolOr(val, fallback = false) {
    if (val === undefined || val === null || String(val).trim() === "") return fallback;
    const s = String(val).trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(s)) return true;
    if (["false", "0", "no", "off"].includes(s)) return false;
    return fallback;
}

function intOr(val, fallback, min = 0) {
    if (val === undefined || val === null || String(val).trim() === "") return fallback;
    const n = Math.floor(Number(val));
    return Number.isFinite(n) && n >= min ? n : fallback;
}

function parseDateOrNull(raw) {
    const s = String(raw || "").trim();
    if (!s) return null;
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
}

function parseMilestoneLog(raw) {
    if (!raw) return [];
    const str = String(raw).trim();
    if (!str) return [];
    try {
        const parsed = JSON.parse(str);
        if (Array.isArray(parsed)) {
            return parsed.map((x) => Number(x)).filter((n) => Number.isFinite(n));
        }
    } catch {
        return str
            .split(",")
            .map((x) => Number(x.trim()))
            .filter((n) => Number.isFinite(n));
    }
    return [];
}

async function loadRawKey1bSettings({ force = false } = {}) {
    if (!force && _cfgMap && Date.now() - _cfgTs < CFG_TTL_MS) return _cfgMap;
    try {
        const rows = await prisma.setting.findMany({ where: { key: { in: KEY1B_SETTING_KEYS } } });
        _cfgMap = Object.fromEntries((rows || []).map((r) => [r.key, r.value]));
        _cfgTs = Date.now();
        return _cfgMap;
    } catch (err) {
        console.error("[key1b] loadRawKey1bSettings lỗi:", err.message);
        return _cfgMap || {};
    }
}

/** Đọc cấu hình đầy đủ trên server (CÓ chứa `keyValue` nội bộ — chỉ dùng phía server). */
export async function getKey1bConfig({ force = false } = {}) {
    const m = await loadRawKey1bSettings({ force });
    const keyValue = String(m.key1bKeyValue || "").trim();
    const resetAtRaw = String(m.key1bResetAt || "").trim();
    const resetAt = parseDateOrNull(resetAtRaw);

    return {
        enabled: boolOr(m.key1bEnabled, false),
        displayName: String(m.key1bDisplayName || "Key 1.5B").trim() || "Key 1.5B",
        keyValue,
        keyConfigured: Boolean(keyValue),
        maskedKeyPreview: keyValue ? maskApiKey(keyValue) : "",
        cost: intOr(m.key1bCost, 1, 0),
        limit: intOr(m.key1bLimit, 50, 1),
        unlimited: boolOr(m.key1bUnlimited, false),
        resetAt,
        resetAtRaw,
        note: String(m.key1bNote || "").trim(),
        milestoneEnabled: boolOr(m.key1bMilestoneEnabled, true),
        milestoneBroadcastUsers: boolOr(m.key1bMilestoneBroadcastUsers, false),
        milestoneChannelEnabled: boolOr(m.key1bMilestoneChannelEnabled, true),
        milestoneChannelId: String(
            m.key1bMilestoneChannelId
            || process.env.REQUIRED_GROUP
            || process.env.ORDER_NOTIFY_CHANNEL
            || "",
        ).trim(),
        milestoneLog: parseMilestoneLog(m.key1bMilestoneLog),
        milestoneSoldOut: boolOr(m.key1bMilestoneSoldOut, false),
    };
}

function buildBatchWhere(resetAt, extra = {}) {
    const where = {
        rewardType: "key1b",
        status: "completed",
        ...extra,
    };
    if (resetAt) {
        where.createdAt = { gte: resetAt };
    }
    return where;
}

export function extractIpsFromNote(note) {
    const s = String(note || "");
    const m = /(?:^|\|)ips=([^|]+)/i.exec(s);
    if (!m) return [];
    return m[1].split(",").map((x) => x.trim()).filter(Boolean);
}

/** Trạng thái hiển thị cho khách trên Bot (tuyệt đối không lộ `keyValue` hay tổng `used/limit` thật). */
export async function getKey1bUserView(telegramId) {
    const cfg = await getKey1bConfig();
    const tgId = String(telegramId);
    const [user, used, myClaim] = await Promise.all([
        prisma.user.findUnique({ where: { telegramId: tgId } }),
        prisma.redeemRequest?.count
            ? prisma.redeemRequest.count({ where: buildBatchWhere(cfg.resetAt) }).catch(() => 0)
            : Promise.resolve(0),
        prisma.redeemRequest?.findFirst
            ? prisma.redeemRequest.findFirst({
                where: buildBatchWhere(cfg.resetAt, { telegramId: tgId }),
            }).catch(() => null)
            : Promise.resolve(null),
    ]);

    const soldOut = !cfg.unlimited && used >= cfg.limit;
    let roughAvailability = "available";
    if (!cfg.enabled || !cfg.keyConfigured) roughAvailability = "closed";
    else if (soldOut) roughAvailability = "sold_out";
    else if (!cfg.unlimited && cfg.limit > 0) {
        const pct = (used / cfg.limit) * 100;
        if (pct >= 90) roughAvailability = "almost_gone_90";
        else if (pct >= 75) roughAvailability = "hot_75";
        else if (pct >= 50) roughAvailability = "half_50";
    }

    return {
        enabled: cfg.enabled && cfg.keyConfigured,
        displayName: cfg.displayName,
        cost: cfg.cost,
        unlimited: cfg.unlimited,
        soldOut,
        roughAvailability,
        note: cfg.note,
        userPoints: Number(user?.referralPoints) || 0,
        alreadyClaimed: Boolean(myClaim),
        claimedIps: myClaim ? extractIpsFromNote(myClaim.note) : [],
        claimedAt: myClaim?.createdAt ? new Date(myClaim.createdAt).toISOString() : null,
        // Nếu khách ĐÃ đổi hợp lệ trong chính đợt này thì cho xem lại key của họ
        claimedKeyValue: myClaim && cfg.keyConfigured ? cfg.keyValue : null,
    };
}

/**
 * Thực hiện đổi Key 1.5B cho user:
 *   - 1 lần / user / đợt (`lockKey = "key1b|<batchTag>|<tgId>"`)
 *   - Bắt buộc 1–2 IPv4/IPv6 không trùng nhau
 *   - Chặn clone mới (`isTooNewForRedeem`)
 *   - Trừ `key1bCost` điểm atomic, hoàn điểm nếu có sự cố
 */
export async function redeemKey1b(telegramId, rawIpsInput, { now = Date.now() } = {}) {
    const ipCheck = validateKey1bIps(rawIpsInput);
    if (!ipCheck.ok) {
        return {
            ok: false,
            error: ipCheck.error,
            invalidToken: ipCheck.invalidToken || null,
        };
    }

    return withKey1bLock(async () => {
        const cfg = await getKey1bConfig({ force: true });
        if (!cfg.enabled || !cfg.keyConfigured) {
            return { ok: false, error: "DISABLED" };
        }

        const tgId = String(telegramId);
        const user = await prisma.user.findUnique({ where: { telegramId: tgId } });
        if (!user) return { ok: false, error: "USER_NOT_FOUND" };
        if (user.isBlocked) return { ok: false, error: "BANNED" };
        if (isTooNewForRedeem(user, now)) return { ok: false, error: "TOO_NEW" };

        const curPoints = Number(user.referralPoints) || 0;
        if (curPoints < cfg.cost) {
            return { ok: false, error: "NOT_ENOUGH", currentPoints: curPoints, requiredPoints: cfg.cost };
        }

        const batchTag = cfg.resetAtRaw || "default";
        const lockKey = `key1b|${batchTag}|${tgId}`;

        // Kiểm tra xem user đã đổi trong đợt này chưa
        const existing = await prisma.redeemRequest.findFirst({
            where: buildBatchWhere(cfg.resetAt, { telegramId: tgId }),
        }).catch(() => null);
        if (existing) {
            return {
                ok: false,
                error: "ALREADY_CLAIMED",
                claimedIps: extractIpsFromNote(existing.note),
            };
        }

        // Kiểm tra quota slot trước khi trừ điểm (tính cả các lượt minting còn tươi từ process khác)
        const mintLeaseCutoff = new Date(now - 10 * 60_000);
        const [usedBefore, inflightOthers] = await Promise.all([
            prisma.redeemRequest.count({
                where: buildBatchWhere(cfg.resetAt),
            }).catch(() => 0),
            prisma.redeemRequest.count({
                where: {
                    rewardType: "key1b",
                    status: "minting",
                    telegramId: { not: tgId },
                    createdAt: { gte: cfg.resetAt && cfg.resetAt > mintLeaseCutoff ? cfg.resetAt : mintLeaseCutoff },
                },
            }).catch(() => 0),
        ]);
        if (!cfg.unlimited && usedBefore + inflightOthers >= cfg.limit) {
            return { ok: false, error: "SOLD_OUT" };
        }

        // Chiếm khóa unique `lockKey` (cho phép thu hồi khóa minting bị treo quá 10 phút sau crash)
        let reqRow = null;
        try {
            reqRow = await prisma.redeemRequest.create({
                data: {
                    telegramId: tgId,
                    rewardType: "key1b",
                    pointsUsed: cfg.cost,
                    tokensGranted: 0,
                    status: "minting",
                    note: `ips=${ipCheck.ips.join(",")}`,
                    lockKey,
                    createdAt: new Date(now),
                },
            });
        } catch (err) {
            if (isDuplicateKeyError(err)) {
                const dup = await prisma.redeemRequest.findFirst({ where: { lockKey } }).catch(() => null);
                if (dup?.status === "completed") {
                    return { ok: false, error: "ALREADY_CLAIMED", claimedIps: extractIpsFromNote(dup.note) };
                }
                const dupAgeMs = dup ? now - new Date(dup.updatedAt || dup.createdAt || 0).getTime() : 0;
                const staleMinting = dup?.status === "minting" && dupAgeMs >= 10 * 60_000;
                if (dup && (dup.status === "failed" || staleMinting)) {
                    reqRow = await prisma.redeemRequest.update({
                        where: { id: dup.id },
                        data: {
                            status: "minting",
                            pointsUsed: cfg.cost,
                            note: `ips=${ipCheck.ips.join(",")}`,
                            createdAt: new Date(now),
                        },
                    });
                } else {
                    return { ok: false, error: "BUSY" };
                }
            } else {
                throw err;
            }
        }

        // Trừ điểm atomic
        if (cfg.cost > 0) {
            const deduct = await prisma.user.updateMany({
                where: { id: user.id, referralPoints: { gte: cfg.cost } },
                data: { referralPoints: { increment: -cfg.cost } },
            });
            if (!deduct?.count) {
                await prisma.redeemRequest.update({
                    where: { id: reqRow.id },
                    data: { status: "failed", note: "not_enough_points" },
                }).catch(() => {});
                return { ok: false, error: "NOT_ENOUGH", currentPoints: curPoints, requiredPoints: cfg.cost };
            }
            userCache.invalidate?.(`user:${tgId}`);
        }

        // Chốt completed (nếu DB lỗi bất ngờ sau khi đã trừ điểm → hoàn điểm ngay)
        try {
            await prisma.redeemRequest.update({
                where: { id: reqRow.id },
                data: {
                    status: "completed",
                    pointsUsed: cfg.cost,
                    note: `ips=${ipCheck.ips.join(",")}`,
                },
            });
        } catch (err) {
            if (cfg.cost > 0) {
                await prisma.user.update({
                    where: { id: user.id },
                    data: { referralPoints: { increment: cfg.cost } },
                }).catch(() => {});
                userCache.invalidate?.(`user:${tgId}`);
            }
            throw err;
        }

        const usedAfter = usedBefore + 1;
        const msAction = computeKey1bMilestoneAction({
            used: usedAfter,
            limit: cfg.limit,
            unlimited: cfg.unlimited,
            milestoneEnabled: cfg.milestoneEnabled,
            alreadyLogged: cfg.milestoneLog,
            soldOutLogged: cfg.milestoneSoldOut,
        });

        if (msAction.shouldAnnounce) {
            await Promise.all([
                prisma.setting.upsert({
                    where: { key: "key1bMilestoneLog" },
                    update: { value: JSON.stringify(msAction.nextLog) },
                    create: { key: "key1bMilestoneLog", value: JSON.stringify(msAction.nextLog) },
                }),
                prisma.setting.upsert({
                    where: { key: "key1bMilestoneSoldOut" },
                    update: { value: String(msAction.nextSoldOut) },
                    create: { key: "key1bMilestoneSoldOut", value: String(msAction.nextSoldOut) },
                }),
            ]).catch((e) => console.error("[key1b] lưu mốc milestone lỗi:", e.message));
            invalidateKey1bConfig();
        }

        const freshUser = await prisma.user.findUnique({ where: { id: user.id } }).catch(() => null);
        const remainingPoints = freshUser
            ? Number(freshUser.referralPoints) || 0
            : Math.max(0, curPoints - cfg.cost);

        return {
            ok: true,
            displayName: cfg.displayName,
            keyValue: cfg.keyValue,
            note: cfg.note,
            ips: ipCheck.ips,
            pointsUsed: cfg.cost,
            remainingPoints,
            milestoneAnnouncement: msAction.shouldAnnounce
                ? {
                    kind: msAction.kind,
                    percent: msAction.percent,
                    displayName: cfg.displayName,
                    cost: cfg.cost,
                    channelEnabled: cfg.milestoneChannelEnabled,
                    channelId: cfg.milestoneChannelId,
                    broadcastUsers: cfg.milestoneBroadcastUsers,
                }
                : null,
        };
    });
}

/**
 * Phát thông báo mốc slot tự động (25% / 50% / 75% / 90% / Sold-out).
 * TUYỆT ĐỐI không in con số `used` hay `limit` thật.
 */
export async function announceKey1bMilestone({ telegram, botUsername = "", announcement }) {
    if (!telegram || !announcement) return;

    const name = escapeHtml(announcement.displayName || "Key 1.5B");
    const deepLink = botUsername ? `https://t.me/${botUsername}?start=key1b` : "";
    let text;
    if (announcement.kind === "sold_out") {
        text = `🚨 <b>[EVENT ${name} — ĐÃ HẾT SUẤT!]</b>\n`
            + `━━━━━━━━━━━━━━━━\n`
            + `🔥 Toàn bộ suất đổi <b>${name}</b> của đợt này đã được các thành viên nhanh tay nhận hết!\n`
            + `💡 Hãy tiếp tục mời bạn bè tích lũy điểm ⭐ để sẵn sàng cho đợt mở kho tiếp theo nhé!`;
    } else {
        const pct = announcement.percent;
        const urgency = pct >= 90
            ? "⚡ Chỉ còn những suất cuối cùng trong đợt này!"
            : pct >= 75
                ? "🔥 Số suất còn lại không nhiều — nhanh tay kẻo lỡ!"
                : "🎁 Sự kiện đang diễn ra sôi động!";
        text = `🔥 <b>[EVENT ${name} — ĐÃ QUA MỐC ~${pct}%]</b>\n`
            + `━━━━━━━━━━━━━━━━\n`
            + `📊 Ước tính khoảng <b>~${pct}%</b> tổng số suất của đợt này đã có chủ!\n`
            + `⭐ Chi phí đổi: <b>${announcement.cost} điểm giới thiệu</b> (kèm đăng ký 1–2 IP)\n`
            + `${urgency}`;
    }

    const replyMarkup = announcement.kind !== "sold_out" && deepLink
        ? Markup.inlineKeyboard([[Markup.button.url(`🔑 Đổi ${announcement.displayName} ngay`, deepLink)]])
        : {};

    if (announcement.channelEnabled && announcement.channelId) {
        await telegram.sendMessage(announcement.channelId, text, {
            parse_mode: "HTML",
            disable_web_page_preview: true,
            ...replyMarkup,
        }).catch((e) => console.error("[key1b] gửi rao mốc lên channel lỗi:", e.message));
    }

    if (announcement.broadcastUsers) {
        const userText = announcement.kind !== "sold_out" && deepLink
            ? `${text}\n\n👉 <a href="${escapeHtml(deepLink)}">Bấm vào đây để đổi ${name} ngay!</a>`
            : text;
        sendBroadcast({ telegram }, userText, "system-key1b")
            .catch((e) => console.error("[key1b] broadcast mốc user lỗi:", e.message));
    }

    sendLog("KEY1B", `Rao mốc sự kiện ${announcement.displayName}: ${announcement.kind === "sold_out" ? "SOLD OUT" : `~${announcement.percent}%`}`);
}

// ─── API Quản trị cho trang Admin Key 1.5B (`admin-react/src/pages/Key1b.jsx`) ─

export async function getKey1bAdminStatus({ limit = 200, q = "" } = {}) {
    const cfg = await getKey1bConfig();
    const takeRows = Math.min(ADMIN_REDEMPTIONS_MAX, Math.max(1, Number(limit) || 200));

    const where = buildBatchWhere(cfg.resetAt);
    const term = String(q || "").trim();
    if (term) {
        where.OR = [
            { telegramId: { contains: term } },
            { note: { contains: term, mode: "insensitive" } },
        ];
    }

    const [usedTotal, rows] = await Promise.all([
        prisma.redeemRequest.count({ where: buildBatchWhere(cfg.resetAt) }).catch(() => 0),
        prisma.redeemRequest.findMany({
            where,
            orderBy: { createdAt: "desc" },
            take: takeRows,
        }).catch(() => []),
    ]);

    const tgIds = [...new Set((rows || []).map((r) => String(r.telegramId)).filter(Boolean))];
    const users = tgIds.length
        ? await prisma.user.findMany({
            where: { telegramId: { in: tgIds } },
            select: { telegramId: true, username: true, firstName: true, vipLevel: true, referralPoints: true },
        }).catch(() => [])
        : [];
    const byTg = new Map((users || []).map((u) => [String(u.telegramId), u]));

    const redemptions = (rows || []).map((r) => {
        const u = byTg.get(String(r.telegramId)) || null;
        return {
            id: r.id,
            telegramId: r.telegramId,
            user: u,
            pointsUsed: r.pointsUsed,
            ips: extractIpsFromNote(r.note),
            createdAt: r.createdAt,
        };
    });

    return {
        config: {
            key1bEnabled: cfg.enabled,
            key1bDisplayName: cfg.displayName,
            _key1bKeyValue_configured: cfg.keyConfigured,
            maskedKeyPreview: cfg.maskedKeyPreview,
            key1bCost: cfg.cost,
            key1bLimit: cfg.limit,
            key1bUnlimited: cfg.unlimited,
            key1bResetAt: cfg.resetAtRaw,
            key1bNote: cfg.note,
            key1bMilestoneEnabled: cfg.milestoneEnabled,
            key1bMilestoneBroadcastUsers: cfg.milestoneBroadcastUsers,
            key1bMilestoneChannelEnabled: cfg.milestoneChannelEnabled,
            key1bMilestoneChannelId: cfg.milestoneChannelId,
            key1bMilestoneLog: cfg.milestoneLog,
            key1bMilestoneSoldOut: cfg.milestoneSoldOut,
        },
        stats: {
            used: usedTotal,
            limit: cfg.limit,
            unlimited: cfg.unlimited,
            remaining: cfg.unlimited ? null : Math.max(0, cfg.limit - usedTotal),
            soldOut: !cfg.unlimited && usedTotal >= cfg.limit,
            resetAt: cfg.resetAtRaw || null,
        },
        redemptions,
    };
}

export async function updateKey1bConfig(body = {}) {
    const pairs = [];
    const setBool = (k) => {
        if (body[k] !== undefined) pairs.push([k, String(Boolean(body[k] === true || body[k] === "true" || body[k] === "1"))]);
    };
    const setInt = (k, min = 0, max = 1_000_000) => {
        if (body[k] !== undefined && String(body[k]).trim() !== "") {
            const n = Math.floor(Number(body[k]));
            if (!Number.isFinite(n) || n < min || n > max) {
                throw new Error(`Giá trị không hợp lệ cho ${k}`);
            }
            pairs.push([k, String(n)]);
        }
    };
    const setStr = (k, maxLen = 1000) => {
        if (body[k] !== undefined) {
            pairs.push([k, String(body[k] ?? "").trim().slice(0, maxLen)]);
        }
    };

    setBool("key1bEnabled");
    setStr("key1bDisplayName", 120);
    setInt("key1bCost", 0, 10_000);
    setInt("key1bLimit", 1, 1_000_000);
    setBool("key1bUnlimited");
    setStr("key1bNote", 1500);
    setBool("key1bMilestoneEnabled");
    setBool("key1bMilestoneBroadcastUsers");
    setBool("key1bMilestoneChannelEnabled");
    setStr("key1bMilestoneChannelId", 80);

    // key1bKeyValue là secret: chỉ ghi đè khi gửi chuỗi khác rỗng, hoặc khi clearKey === true
    if (body.clearKey === true) {
        pairs.push(["key1bKeyValue", ""]);
    } else if (typeof body.key1bKeyValue === "string" && body.key1bKeyValue.trim()) {
        pairs.push(["key1bKeyValue", body.key1bKeyValue.trim()]);
    }

    await Promise.all(
        pairs.map(([key, value]) =>
            prisma.setting.upsert({
                where: { key },
                update: { value },
                create: { key, value },
            }),
        ),
    );
    invalidateKey1bConfig();
    return { ok: true, updated: pairs.length };
}

export async function resetKey1bBatch({ now = Date.now() } = {}) {
    const nowIso = new Date(now).toISOString();
    const resets = [
        ["key1bResetAt", nowIso],
        ["key1bMilestoneLog", "[]"],
        ["key1bMilestoneSoldOut", "false"],
    ];
    await Promise.all(
        resets.map(([key, value]) =>
            prisma.setting.upsert({
                where: { key },
                update: { value },
                create: { key, value },
            }),
        ),
    );
    invalidateKey1bConfig();
    return { ok: true, resetAt: nowIso };
}

export default {
    KEY1B_SETTING_KEYS,
    invalidateKey1bConfig,
    getKey1bConfig,
    getKey1bUserView,
    redeemKey1b,
    announceKey1bMilestone,
    getKey1bAdminStatus,
    updateKey1bConfig,
    resetKey1bBatch,
    extractIpsFromNote,
};
