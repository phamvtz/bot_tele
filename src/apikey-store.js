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
        },
    });
}

export async function listIssuedKeys(telegramId, limit = 20) {
    return prisma.issuedApiKey.findMany({
        where: { telegramId: String(telegramId) },
        orderBy: { createdAt: "desc" },
        take: limit,
    });
}

export async function countIssuedKeys(telegramId) {
    return prisma.issuedApiKey.count({ where: { telegramId: String(telegramId) } });
}

/** Tổng quota đã cấp cho một khách — admin dùng để soi khách lạm dụng giftcode. */
export async function sumIssuedQuota(telegramId) {
    const rows = await prisma.issuedApiKey.findMany({
        where: { telegramId: String(telegramId) },
        select: { quotaTokens: true },
    });
    return rows.reduce((sum, r) => sum + (Number(r.quotaTokens) || 0), 0);
}

export default { KeySource, saveIssuedKey, listIssuedKeys, countIssuedKeys, sumIssuedQuota };
