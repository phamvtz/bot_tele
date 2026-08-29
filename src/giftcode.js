import prisma from "./lib/prisma.js";
import { creditWallet, TxType } from "./wallet.js";
import { createApiKey, getConfig as getGpt2apiConfig } from "./gpt2api.js";
import { saveIssuedKey, KeySource } from "./apikey-store.js";
import { buildFreeQuotaTable, rollFreeQuota, FREE_MIN_M, FREE_MAX_M } from "./apikey-pricing.js";

/**
 * Giftcode Module — mã quà tặng, hai loại phần thưởng:
 *
 *   rewardType = "WALLET"  → cộng tiền vào ví (mặc định)
 *   rewardType = "APIKEY"  → cấp một API key sk-* miễn phí; quota random có
 *                            trọng số (số càng lớn càng hiếm — xem apikey-pricing.js)
 *
 * Khác Coupon: coupon giảm giá cho MỘT đơn hàng, giftcode cho tiền/hàng thật.
 *
 * Chống dùng lại / double-submit (áp dụng cho CẢ HAI loại):
 *   - Mỗi lần đổi tạo 1 doc `giftCodeRedemption` với `redeemKey` UNIQUE
 *     (`{giftCodeId}:{telegramId}:{lần thứ n}`) → 2 request song song thì chỉ 1 doc
 *     insert được, doc kia lỗi E11000 và bị từ chối.
 *   - Suất dùng toàn cục claim bằng updateMany có điều kiện `usedCount < maxUses`
 *     (atomic trong Mongo) — giống applyCoupon, không lost-update.
 *   - Phát thưởng XONG mới đánh redemption SUCCESS; phát thưởng fail thì rollback
 *     cả usedCount và redemption để mã không bị "cháy" oan.
 */

const CODE_RE = /^[A-Z0-9_-]{3,32}$/;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // bỏ I,O,0,1 cho dễ đọc

export const GiftRewardType = {
    WALLET: "WALLET",
    APIKEY: "APIKEY",
};

export const GiftCodeError = {
    INVALID: "INVALID",
    INACTIVE: "INACTIVE",
    EXPIRED: "EXPIRED",
    USED_UP: "USED_UP",
    ALREADY_USED: "ALREADY_USED",
    VIP_REQUIRED: "VIP_REQUIRED",
    CREDIT_FAILED: "CREDIT_FAILED",
    KEY_FAILED: "KEY_FAILED",
};

export function normalizeGiftCode(input) {
    return String(input || "").trim().toUpperCase().replace(/\s+/g, "");
}

export function generateGiftCode(prefix = "GIFT", length = 8) {
    let body = "";
    for (let i = 0; i < length; i++) {
        body += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    return normalizeGiftCode(`${prefix}${body}`).slice(0, 32);
}

function isDuplicateKeyError(err) {
    return err?.code === 11000 || /E11000|duplicate key/i.test(err?.message || "");
}

/**
 * Đổi giftcode → cộng ví hoặc cấp API key tuỳ `rewardType` của mã.
 * @returns { success, rewardType, amount?, newBalance?, key?, quotaTokens?, rpm?, error? }
 */
export async function redeemGiftCode(telegramId, rawCode) {
    const code = normalizeGiftCode(rawCode);
    if (!CODE_RE.test(code)) return { success: false, error: GiftCodeError.INVALID };

    const tgId = String(telegramId);
    const gift = await prisma.giftCode.findUnique({ where: { code } });

    if (!gift) return { success: false, error: GiftCodeError.INVALID };
    if (!gift.isActive) return { success: false, error: GiftCodeError.INACTIVE };
    if (gift.expiresAt && new Date(gift.expiresAt) < new Date()) {
        return { success: false, error: GiftCodeError.EXPIRED };
    }
    if (gift.maxUses && gift.usedCount >= gift.maxUses) {
        return { success: false, error: GiftCodeError.USED_UP };
    }

    const rewardType = gift.rewardType === GiftRewardType.APIKEY
        ? GiftRewardType.APIKEY
        : GiftRewardType.WALLET;
    // Mã ví phải có số tiền; mã API key thì amount không dùng (quota random).
    if (rewardType === GiftRewardType.WALLET && !(gift.amount > 0)) {
        return { success: false, error: GiftCodeError.INVALID };
    }

    if (gift.vipOnly > 0) {
        const user = await prisma.user.findUnique({
            where: { telegramId: tgId },
            select: { vipLevel: true },
        });
        if (!user || (user.vipLevel ?? 0) < gift.vipOnly) {
            return { success: false, error: GiftCodeError.VIP_REQUIRED, vipLevel: gift.vipOnly };
        }
    }

    const perUserLimit = Math.max(1, gift.perUserLimit || 1);
    const usedByUser = await prisma.giftCodeRedemption.count({
        where: { giftCodeId: gift.id, telegramId: tgId },
    });
    if (usedByUser >= perUserLimit) {
        return { success: false, error: GiftCodeError.ALREADY_USED, perUserLimit };
    }

    // 1. Claim suất của user — unique index trên redeemKey là hàng rào thật sự,
    //    check count ở trên chỉ để trả lỗi đẹp cho trường hợp thường.
    let redemption;
    try {
        redemption = await prisma.giftCodeRedemption.create({
            data: {
                giftCodeId: gift.id,
                telegramId: tgId,
                redeemKey: `${gift.id}:${tgId}:${usedByUser + 1}`,
                amount: rewardType === GiftRewardType.WALLET ? gift.amount : 0,
                rewardType,
                status: "PENDING",
            },
        });
    } catch (err) {
        if (isDuplicateKeyError(err)) {
            return { success: false, error: GiftCodeError.ALREADY_USED, perUserLimit };
        }
        throw err;
    }

    // 2. Claim suất toàn cục (atomic). maxUses null = không giới hạn.
    const claim = await prisma.giftCode.updateMany({
        where: gift.maxUses ? { id: gift.id, usedCount: { lt: gift.maxUses } } : { id: gift.id },
        data: { usedCount: { increment: 1 } },
    });
    if (!claim.count) {
        await rollbackRedemption(redemption.id, null, code);
        return { success: false, error: GiftCodeError.USED_UP };
    }

    // 3. Phát thưởng
    if (rewardType === GiftRewardType.APIKEY) {
        return grantApiKeyReward({ gift, code, telegramId, redemption });
    }

    const credit = await creditWallet(telegramId, gift.amount, {
        type: TxType.GIFTCODE,
        description: `Giftcode ${code}`,
    });

    if (!credit.success) {
        await rollbackRedemption(redemption.id, gift.id, code);
        return { success: false, error: GiftCodeError.CREDIT_FAILED, detail: credit.error };
    }

    await prisma.giftCodeRedemption.update({
        where: { id: redemption.id },
        data: { status: "SUCCESS", transactionId: credit.transaction?.id || null },
    }).catch(() => {});

    return {
        success: true,
        rewardType: GiftRewardType.WALLET,
        code,
        amount: gift.amount,
        newBalance: credit.newBalance,
        note: gift.note || null,
    };
}

/**
 * Rollback khi phát thưởng thất bại.
 *
 * Thứ tự: xoá redemption TRƯỚC (mở lại suất cho user retry), rồi mới nhả suất
 * toàn cục. Nếu bước sau fail thì mã chỉ bị tính thừa 1 lượt — đỡ hơn là user bị
 * chặn vĩnh viễn vì redemption còn treo. giftId = null nghĩa là chưa claim suất
 * toàn cục nên không cần nhả.
 */
async function rollbackRedemption(redemptionId, giftId, code) {
    await prisma.giftCodeRedemption.delete({ where: { id: redemptionId } })
        .catch((e) => console.error(`[giftcode] rollback redemption ${redemptionId} thất bại:`, e.message));
    if (!giftId) return;
    await prisma.giftCode.updateMany({
        where: { id: giftId },
        data: { usedCount: { increment: -1 } },
    }).catch((e) => console.error(`[giftcode] rollback usedCount ${code} thất bại:`, e.message));
}

/**
 * Cấp API key miễn phí. Quota random có trọng số trong miền của mã
 * (mặc định 5M–100M, số càng lớn càng hiếm).
 */
async function grantApiKeyReward({ gift, code, telegramId, redemption }) {
    const cfg = await getGpt2apiConfig().catch(() => null);
    const minM = gift.quotaMinM > 0 ? gift.quotaMinM : FREE_MIN_M;
    const maxM = gift.quotaMaxM > 0 ? gift.quotaMaxM : FREE_MAX_M;
    const table = buildFreeQuotaTable({ minM, maxM, alpha: gift.quotaAlpha > 0 ? gift.quotaAlpha : undefined });
    const quotaTokens = rollFreeQuota(Math.random(), table);
    const rpm = gift.keyRpm > 0 ? gift.keyRpm : (cfg?.rpm ?? 300);

    const created = await createApiKey({
        quotaTokens,
        name: `gift-${code}-${String(telegramId).slice(-6)}`,
        rpm,
        validDays: gift.keyValidDays > 0 ? gift.keyValidDays : undefined,
    });

    if (!created.ok) {
        // Chưa cấp được key → nhả cả suất user và suất toàn cục để khách đổi lại
        // được khi provider hồi phục. Mã KHÔNG bị cháy.
        await rollbackRedemption(redemption.id, gift.id, code);
        return {
            success: false,
            error: GiftCodeError.KEY_FAILED,
            detail: created.message,
            code: created.code,
        };
    }

    // Key đã tạo bên GPT2API — từ đây trở đi KHÔNG rollback nữa: nhả suất mà key
    // vẫn tồn tại là cho khách đổi thêm lần nữa và lấy thêm key miễn phí.
    const saved = await saveIssuedKey({
        telegramId,
        key: created.key,
        quotaTokens,
        rpm,
        source: KeySource.GIFTCODE,
        giftCodeId: gift.id,
        externalId: created.id,
        models: cfg?.models || [],
    }).catch((e) => {
        console.error(`[giftcode] lưu key đã cấp thất bại (key vẫn hợp lệ):`, e.message);
        return null;
    });

    await prisma.giftCodeRedemption.update({
        where: { id: redemption.id },
        data: {
            status: "SUCCESS",
            issuedKeyId: saved?.id || null,
            quotaTokens,
        },
    }).catch(() => {});

    return {
        success: true,
        rewardType: GiftRewardType.APIKEY,
        code,
        key: created.key,
        quotaTokens,
        rpm,
        models: cfg?.models || [],
        endpoint: cfg?.endpoint || "",
        docUrl: cfg?.docUrl || "",
        note: gift.note || null,
    };
}

export async function createGiftCode(data) {
    const code = data.code ? normalizeGiftCode(data.code) : generateGiftCode(data.prefix || "GIFT");
    if (!CODE_RE.test(code)) {
        throw new Error("Mã không hợp lệ (3-32 ký tự A-Z, 0-9, gạch ngang/gạch dưới)");
    }

    const rewardType = String(data.rewardType || GiftRewardType.WALLET).toUpperCase() === GiftRewardType.APIKEY
        ? GiftRewardType.APIKEY
        : GiftRewardType.WALLET;

    let amount = 0;
    if (rewardType === GiftRewardType.WALLET) {
        amount = Number(data.amount);
        if (!Number.isFinite(amount) || amount <= 0) {
            throw new Error("Số tiền phải là số dương");
        }
        amount = Math.floor(amount);
    }

    // Miền quota cho mã API key. Kiểm ngay lúc tạo — sai ở đây thì mọi lần đổi
    // sau đều rơi vào bảng trọng số rỗng.
    const quotaMinM = rewardType === GiftRewardType.APIKEY
        ? toBoundedInt(data.quotaMinM, FREE_MIN_M, 1, 100_000)
        : 0;
    const quotaMaxM = rewardType === GiftRewardType.APIKEY
        ? toBoundedInt(data.quotaMaxM, FREE_MAX_M, 1, 100_000)
        : 0;
    if (rewardType === GiftRewardType.APIKEY && quotaMaxM < quotaMinM) {
        throw new Error(`Quota tối đa (${quotaMaxM}M) phải >= quota tối thiểu (${quotaMinM}M)`);
    }

    const existing = await prisma.giftCode.findUnique({ where: { code } });
    if (existing) throw new Error(`Mã ${code} đã tồn tại`);

    return prisma.giftCode.create({
        data: {
            code,
            rewardType,
            amount,
            quotaMinM,
            quotaMaxM,
            quotaAlpha: rewardType === GiftRewardType.APIKEY ? toPositiveFloat(data.quotaAlpha, 0) : 0,
            keyRpm: rewardType === GiftRewardType.APIKEY ? toBoundedInt(data.keyRpm, 0, 0, 100_000) : 0,
            keyValidDays: rewardType === GiftRewardType.APIKEY ? toBoundedInt(data.keyValidDays, 0, 0, 3650) : 0,
            maxUses: data.maxUses ? Number(data.maxUses) : null,
            perUserLimit: data.perUserLimit ? Number(data.perUserLimit) : 1,
            vipOnly: data.vipOnly ? Number(data.vipOnly) : 0,
            expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
            note: data.note || null,
            createdBy: data.createdBy ? String(data.createdBy) : null,
            isActive: true,
        },
    });
}

function toBoundedInt(value, fallback, min, max) {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n) || n < min || n > max) return fallback;
    return n;
}

function toPositiveFloat(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Tạo nhiều mã ngẫu nhiên cùng cấu hình (dùng cho event, tặng lẻ từng người).
 */
export async function createGiftCodeBatch(count, data) {
    const total = Math.min(200, Math.max(1, Number(count) || 1));
    const created = [];
    for (let i = 0; i < total; i++) {
        try {
            created.push(await createGiftCode({ ...data, code: null }));
        } catch (err) {
            // Trùng mã ngẫu nhiên → thử lại 1 lần, vẫn lỗi thì bỏ qua mã đó.
            try {
                created.push(await createGiftCode({ ...data, code: null }));
            } catch {
                console.warn("[giftcode] bỏ qua 1 mã do lỗi:", err.message);
            }
        }
    }
    return created;
}

export async function listGiftCodes(limit = 30) {
    return prisma.giftCode.findMany({ orderBy: { createdAt: "desc" }, take: limit });
}

export async function getGiftCode(code) {
    return prisma.giftCode.findUnique({ where: { code: normalizeGiftCode(code) } });
}

export async function toggleGiftCode(code) {
    const gift = await getGiftCode(code);
    if (!gift) return null;
    return prisma.giftCode.update({
        where: { id: gift.id },
        data: { isActive: !gift.isActive },
    });
}

export async function deleteGiftCode(code) {
    const gift = await getGiftCode(code);
    if (!gift) return null;
    // Giữ lại lịch sử redeem: là chứng từ đối soát tiền đã cộng vào ví, xoá đi
    // thì không tra được vì sao số dư khách tăng.
    return prisma.giftCode.delete({ where: { id: gift.id } });
}

export async function getGiftCodeRedemptions(code, limit = 20) {
    const gift = await getGiftCode(code);
    if (!gift) return { giftCode: null, redemptions: [] };
    const redemptions = await prisma.giftCodeRedemption.findMany({
        where: { giftCodeId: gift.id },
        orderBy: { createdAt: "desc" },
        take: limit,
    });
    return { giftCode: gift, redemptions };
}

export default {
    GiftCodeError,
    GiftRewardType,
    normalizeGiftCode,
    generateGiftCode,
    redeemGiftCode,
    createGiftCode,
    createGiftCodeBatch,
    listGiftCodes,
    getGiftCode,
    toggleGiftCode,
    deleteGiftCode,
    getGiftCodeRedemptions,
};
