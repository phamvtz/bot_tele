/**
 * Kho key API đã cấp cho từng khách — nguồn dữ liệu cho /mykey.
 *
 * Vì sao là collection riêng chứ không nhét vào Setting JSON như bản aiplus cũ:
 * key là tài sản khách đã trả tiền (hoặc nhận quà). Setting JSON là một document
 * duy nhất — hai request cấp key cùng lúc sẽ ghi đè nhau và mất key của một
 * người. Collection riêng thì mỗi key là một document, không có lost-update.
 */

import prisma from "./lib/prisma.js";

export const KeySource = {
    GIFTCODE: "GIFTCODE",
    PURCHASE: "PURCHASE",
    ADMIN: "ADMIN",
    REFERRAL: "REFERRAL", // quà mời bạn — cấp cho cả người mời lẫn người được mời
};

export async function saveIssuedKey({
    telegramId,
    key,
    quotaTokens,
    rpm = 0,
    source = KeySource.PURCHASE,
    giftCodeId = null,
    orderId = null,
    priceUsd = null,
    externalId = null,
    expiresAt = null,
    models = [],
    profileId = null,
    profileName = "",
}) {
    return prisma.issuedApiKey.create({
        data: {
            telegramId: String(telegramId),
            key,
            quotaTokens: Math.max(0, Math.floor(Number(quotaTokens) || 0)),
            rpm: Math.max(0, Math.floor(Number(rpm) || 0)),
            source,
            giftCodeId,
            orderId,
            priceUsd: priceUsd === null ? null : Number(priceUsd),
            externalId: externalId === null ? null : String(externalId),
            expiresAt: expiresAt ? new Date(expiresAt) : null,
            models: Array.isArray(models) ? models : [],
            // Server nào cấp. Lưu cả TÊN chứ không chỉ id: admin đổi tên hay xoá
            // profile thì lịch sử vẫn đọc được key này ra từ đâu.
            profileId: profileId === null || profileId === undefined ? null : Math.floor(Number(profileId)) || null,
            profileName: String(profileName || ""),
        },
    });
}

export async function listIssuedKeys(telegramId, limit = 20) {
    return prisma.issuedApiKey.findMany({
        // hiddenAt: null khớp cả doc chưa từng có field này (key cũ) — admin ẩn
        // key nào thì key đó biến khỏi /mykey, không thu hồi được phía provider.
        where: { telegramId: String(telegramId), hiddenAt: null },
        orderBy: { createdAt: "desc" },
        take: limit,
    });
}

export async function countIssuedKeys(telegramId) {
    return prisma.issuedApiKey.count({ where: { telegramId: String(telegramId) } });
}

// ─── Admin: xem TẤT CẢ key đã cấp ────────────────────────────────────────────
const ADMIN_LIST_MAX = 100;

function buildAdminWhere({ source = "", q = "" } = {}) {
    const where = {};
    if (source) where.source = source;
    const term = String(q || "").trim();
    if (term) {
        where.OR = [
            { telegramId: term },
            { orderId: term },
            { giftCodeId: term },
            { key: { contains: term, mode: "insensitive" } },
            { externalId: { contains: term, mode: "insensitive" } },
        ];
    }
    return where;
}

export async function listAllIssuedKeys({ limit = 50, skip = 0, source = "", q = "" } = {}) {
    return prisma.issuedApiKey.findMany({
        where: buildAdminWhere({ source, q }),
        orderBy: { createdAt: "desc" },
        take: Math.min(ADMIN_LIST_MAX, Math.max(1, Number(limit) || 50)),
        skip: Math.max(0, Number(skip) || 0),
    });
}

export async function countAllIssuedKeys({ source = "", q = "" } = {}) {
    return prisma.issuedApiKey.count({ where: buildAdminWhere({ source, q }) });
}

/** Ẩn / hiện lại một key khỏi /mykey. KHÔNG đụng gì phía GPT2API. */
export async function setIssuedKeyHidden(id, hidden) {
    return prisma.issuedApiKey.update({
        where: { id },
        data: { hiddenAt: hidden ? new Date() : null },
    });
}

/** Tổng quota đã cấp cho một khách — admin dùng để soi khách lạm dụng giftcode. */
export async function sumIssuedQuota(telegramId) {
    const rows = await prisma.issuedApiKey.findMany({
        where: { telegramId: String(telegramId) },
        select: { quotaTokens: true },
    });
    return rows.reduce((sum, r) => sum + (Number(r.quotaTokens) || 0), 0);
}

export default {
    KeySource, saveIssuedKey, listIssuedKeys, countIssuedKeys, sumIssuedQuota,
    listAllIssuedKeys, countAllIssuedKeys, setIssuedKeyHidden,
};
