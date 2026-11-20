/**
 * Kho key API đã cấp cho từng khách — nguồn dữ liệu cho /mykey.
 *
 * Vì sao là collection riêng chứ không nhét vào Setting JSON như bản aiplus cũ:
 * key là tài sản khách đã trả tiền (hoặc nhận quà). Setting JSON là một document
 * duy nhất — hai request cấp key cùng lúc sẽ ghi đè nhau và mất key của một
 * người. Collection riêng thì mỗi key là một document, không có lost-update.
 */

import prisma from "./lib/prisma.js";
import { isDuplicateKeyError } from "./lib/duplicate-key.js";

export const KeySource = {
    GIFTCODE: "GIFTCODE",
    PURCHASE: "PURCHASE",
    ADMIN: "ADMIN",
    REFERRAL: "REFERRAL", // quà mời bạn — cấp cho cả người mời lẫn người được mời
    // Cấp qua Seller API (`POST /api/seller/keys`) — một supplier/reseller bên ngoài
    // tự cấp key cho khách của họ. Tách khỏi ADMIN vì admin bảng web là người của
    // shop, còn seller là bên thứ ba giữ một API key: hai mức tin cậy khác nhau và
    // cần đếm/doanh thu riêng.
    SELLER: "SELLER",
};

export async function saveIssuedKey({
    telegramId,
    key,
    quotaTokens,
    rpm = 0,
    tpm = 0,
    source = KeySource.PURCHASE,
    giftCodeId = null,
    orderId = null,
    priceUsd = null,
    externalId = null,
    expiresAt = null,
    models = [],
    profileId = null,
    profileName = "",
    // Ai cấp qua Seller API. Dùng để scope: seller nào chỉ thấy/quản lý key do CHÍNH
    // seller đó cấp, không thấy key của seller khác hay của shop.
    sellerKeyId = null,
    sellerKeyName = null,
}) {
    return prisma.issuedApiKey.create({
        data: {
            telegramId: String(telegramId),
            key,
            quotaTokens: Math.max(0, Math.floor(Number(quotaTokens) || 0)),
            rpm: Math.max(0, Math.floor(Number(rpm) || 0)),
            tpm: Math.max(0, Math.floor(Number(tpm) || 0)),
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
            sellerKeyId: sellerKeyId === null || sellerKeyId === undefined ? null : String(sellerKeyId),
            sellerKeyName: String(sellerKeyName || ""),
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

function buildAdminWhere({ source = "", q = "", telegramIds = [] } = {}) {
    const where = {};
    if (source) where.source = source;
    const term = String(q || "").trim();
    if (term) {
        where.OR = [
            { telegramId: term },
            { orderId: term },
            // Admin nhìn thấy MÃ ĐƠN (8 ký tự cuối, viết hoa) chứ không phải id
            // đầy đủ — gõ đúng cái mình thấy trên bảng mà không ra gì thì bảng
            // coi như không tìm được.
            { orderId: { contains: term, mode: "insensitive" } },
            { giftCodeId: term },
            { key: { contains: term, mode: "insensitive" } },
            { externalId: { contains: term, mode: "insensitive" } },
            { profileName: { contains: term, mode: "insensitive" } },
            // Tìm theo TÊN khách: caller đã tra ra telegramId từ bảng User.
            ...(telegramIds.length ? [{ telegramId: { in: telegramIds } }] : []),
        ];
    }
    return where;
}

export async function listAllIssuedKeys({ limit = 50, skip = 0, source = "", q = "", telegramIds = [] } = {}) {
    return prisma.issuedApiKey.findMany({
        where: buildAdminWhere({ source, q, telegramIds }),
        orderBy: { createdAt: "desc" },
        take: Math.min(ADMIN_LIST_MAX, Math.max(1, Number(limit) || 50)),
        skip: Math.max(0, Number(skip) || 0),
    });
}

export async function countAllIssuedKeys({ source = "", q = "", telegramIds = [] } = {}) {
    return prisma.issuedApiKey.count({ where: buildAdminWhere({ source, q, telegramIds }) });
}

/**
 * Quét nhiều dòng một lượt để lọc theo TRẠNG THÁI SỐNG (còn quota / hết hạn…).
 * Trạng thái đó nằm ở provider chứ không ở DB, nên không viết được thành `where`
 * — phải kéo về rồi lọc trong bộ nhớ, và vì thế phải có trần.
 */
export const ADMIN_STATUS_SCAN_MAX = 3000;
export async function scanIssuedKeysForStatus({ source = "", q = "", telegramIds = [] } = {}) {
    return prisma.issuedApiKey.findMany({
        where: buildAdminWhere({ source, q, telegramIds }),
        orderBy: { createdAt: "desc" },
        take: ADMIN_STATUS_SCAN_MAX,
    });
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

// ─── Seller API: cấp & quản lý key theo từng seller ──────────────────────────
//
// Seller là BÊN THỨ BA giữ một API key, không phải admin của shop. Hai hệ quả:
//   1. Mọi truy vấn phải scope theo `sellerKeyId` — seller A không được thấy hay
//      sửa key của seller B hoặc của shop.
//   2. Endpoint này gọi được từ internet và client của seller có thể RETRY. Tạo key
//      và gia hạn đều tốn quota thật, chạy hai lần là cấp hai lần. Vì vậy cả hai
//      đều có khoá idempotency (`clientRef`) và/hoặc claim atomic (`renewWipAt`).

/**
 * Namespace clientRef theo seller để một unique index một field là đủ.
 * Trả `null` khi seller không gửi clientRef — không được bịa ra một giá trị mặc
 * định, vì mọi key không-có-clientRef sẽ đụng nhau trên unique index.
 *
 * `SELLER_CLIENT_REF_MAX` là trần caller PHẢI tự kiểm và từ chối: cắt ngắn ở đây
 * chỉ là lưới an toàn cuối, và nó KHÔNG vô hại — hai clientRef khác nhau quá 120
 * ký tự sẽ ra cùng một giá trị, request thứ hai nhận `duplicate: true` và không bao
 * giờ có key, trong khi seller tưởng đã cấp xong. Im lặng sai còn tệ hơn báo lỗi.
 */
export const SELLER_CLIENT_REF_MAX = 100;

export function namespacedClientRef(sellerKeyId, clientRef) {
    const ref = String(clientRef ?? "").trim();
    if (!ref) return null;
    return `${String(sellerKeyId || "")}:${ref.slice(0, 120)}`;
}

/**
 * GIỮ CHỖ trước khi gọi provider.
 *
 * Insert một dòng `IssuedApiKey` có `key: ""` và `hiddenAt` đã set. Hai việc cùng lúc:
 *   - `clientRef` unique index làm nhiệm vụ claim: hai request song song chỉ một
 *     cái insert được, cái kia nhận `existing` và KHÔNG gọi provider lần hai.
 *   - `hiddenAt` khác null để dòng tạm KHÔNG hiện trong `/mykey` của khách. Thiếu
 *     bước này là khách thấy một key rỗng trong lúc provider đang tạo.
 *
 * Nếu process chết giữa chừng thì dòng này nằm lại, vẫn ẩn, và admin thấy nó trong
 * bảng "Key đã cấp" (bảng đó không lọc hiddenAt) để xoá. Thà để lại một dòng rác
 * nhìn thấy được còn hơn một key mồ côi bên provider không ai biết.
 */
export async function claimSellerKeySlot({ telegramId, quotaTokens, sellerKeyId, sellerKeyName, clientRef = null, profileId = null }) {
    const ref = namespacedClientRef(sellerKeyId, clientRef);
    const data = {
        telegramId: String(telegramId),
        key: "",
        quotaTokens: Math.max(0, Math.floor(Number(quotaTokens) || 0)),
        source: KeySource.SELLER,
        sellerKeyId: String(sellerKeyId || ""),
        sellerKeyName: String(sellerKeyName || ""),
        profileId: profileId === null || profileId === undefined ? null : Math.floor(Number(profileId)) || null,
        hiddenAt: new Date(),
        externalId: null,
        priceUsd: null,
        issuedAt: null,
        wipError: null,
        renewWipAt: null,
    };
    if (ref) data.clientRef = ref;

    try {
        const row = await prisma.issuedApiKey.create({ data });
        return { claimed: true, row, clientRef: ref };
    } catch (err) {
        if (!isDuplicateKeyError(err)) throw err;
        // Có người thắng rồi. Đọc lại dòng của họ — KHÔNG tạo key thứ hai.
        const existing = ref ? await prisma.issuedApiKey.findFirst({ where: { clientRef: ref } }) : null;
        return { claimed: false, duplicate: true, row: existing, clientRef: ref };
    }
}

/**
 * Điền kết quả provider vào dòng đã claim, và MỞ khoá cho khách thấy.
 * Trả null nếu dòng không còn (admin xoá giữa chừng) — caller phải log chứ không
 * được im lặng coi như thành công.
 */
export async function finalizeSellerKeySlot(id, {
    key, externalId = null, expiresAt = null, quotaTokens = null, rpm = 0,
    models = [], profileId = null, profileName = "", priceUsd = null,
}) {
    const data = {
        key,
        hiddenAt: null,
        issuedAt: new Date(),
        wipError: null,
        rpm: Math.max(0, Math.floor(Number(rpm) || 0)),
        models: Array.isArray(models) ? models : [],
        profileName: String(profileName || ""),
        externalId: externalId === null ? null : String(externalId),
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        priceUsd: priceUsd === null ? null : Number(priceUsd),
    };
    if (quotaTokens !== null && quotaTokens !== undefined) {
        const qt = Math.max(0, Math.floor(Number(quotaTokens)));
        data.quotaTokens = qt;
        data.initialTokens = qt;
    }
    if (profileId !== null && profileId !== undefined) data.profileId = Math.floor(Number(profileId)) || null;
    return prisma.issuedApiKey.update({ where: { id }, data });
}

/** Provider từ chối tạo key → xoá dòng giữ chỗ, không để rác. */
export async function discardSellerKeySlot(id) {
    return prisma.issuedApiKey.delete({ where: { id } });
}

/** Đọc MỘT key, chỉ khi nó thuộc đúng seller đang gọi. */
export async function getSellerIssuedKey(id, sellerKeyId) {
    return prisma.issuedApiKey.findFirst({
        where: { id: String(id), sellerKeyId: String(sellerKeyId || "") },
    });
}

export async function listSellerIssuedKeys({ sellerKeyId, limit = 50, skip = 0 } = {}) {
    return prisma.issuedApiKey.findMany({
        where: { sellerKeyId: String(sellerKeyId || "") },
        orderBy: { createdAt: "desc" },
        take: Math.min(SELLER_LIST_MAX, Math.max(1, Number(limit) || 50)),
        skip: Math.max(0, Number(skip) || 0),
    });
}

export async function countSellerIssuedKeys(sellerKeyId) {
    return prisma.issuedApiKey.count({ where: { sellerKeyId: String(sellerKeyId || "") } });
}

export const SELLER_LIST_MAX = 100;

/**
 * Trần cho việc lọc theo TRẠNG THÁI SỐNG. Trạng thái đó nằm ở provider chứ không ở
 * DB nên không viết thành `where` được — phải kéo về rồi lọc trong bộ nhớ.
 */
export const SELLER_STATUS_SCAN_MAX = 1000;

export async function scanSellerIssuedKeysForStatus(sellerKeyId) {
    return prisma.issuedApiKey.findMany({
        where: { sellerKeyId: String(sellerKeyId || "") },
        orderBy: { createdAt: "desc" },
        take: SELLER_STATUS_SCAN_MAX,
    });
}

/**
 * Claim lượt gia hạn bằng `updateMany` CÓ ĐIỀU KIỆN `renewWipAt: null`.
 *
 * `quota_limit` bên provider là số TUYỆT ĐỐI và `renewApiKey` đọc-rồi-cộng, nên chạy
 * hai lần là tặng khách thêm một lần token miễn phí. Đây là lớp chặn duy nhất của
 * Seller API (bot có tới ba lớp vì nó đi qua Order).
 *
 * Trả `count` từ `modifiedCount` — giá trị đổi từ null → Date nên count === 1 nghĩa
 * là claim được thật.
 */
export async function claimSellerKeyRenew(id, sellerKeyId, ref = null, wipTokens = 0) {
    const where = { id: String(id), sellerKeyId: String(sellerKeyId || ""), renewWipAt: null };
    const res = await prisma.issuedApiKey.updateMany({
        where,
        data: {
            renewWipAt: new Date(),
            renewWipTokens: Math.max(0, Math.floor(Number(wipTokens) || 0)),
            lastRenewRef: ref ? String(ref) : null,
        },
    });
    return (res?.count || 0) > 0;
}

export async function releaseSellerKeyRenew(id) {
    return prisma.issuedApiKey.update({
        where: { id: String(id) },
        data: { renewWipAt: null, renewWipTokens: 0 },
    });
}

/**
 * Chốt lượt gia hạn: ghi quota/hạn MỚI, tăng `renewCount`, xoá cờ WIP.
 * `lastRenewRef` GIỮ LẠI (không xoá) — đó là bằng chứng để lần retry sau với cùng
 * clientRef nhận ra "đã làm rồi" mà không gọi provider lần nữa.
 */
export async function finalizeSellerKeyRenew(id, {
    quotaTokens = null, expiresAt = null, renewRef = null, addedTokens = 0,
} = {}) {
    const now = new Date();
    const data = {
        renewWipAt: null,
        renewWipTokens: 0,
        renewCount: { increment: 1 },
        lastRenewAt: now,
    };
    if (quotaTokens !== null && quotaTokens !== undefined) data.quotaTokens = Math.max(0, Math.floor(Number(quotaTokens)));
    if (expiresAt !== undefined) data.expiresAt = expiresAt ? new Date(expiresAt) : null;
    if (renewRef) data.lastRenewRef = String(renewRef);

    const added = Math.max(0, Math.floor(Number(addedTokens) || 0));
    if (added > 0) {
        const existing = await prisma.issuedApiKey.findFirst({
            where: { id: String(id) },
            select: { renewLogs: true },
        }).catch(() => null);
        const cutoff = now.getTime() - 35 * 86_400_000;
        const prevLogs = Array.isArray(existing?.renewLogs)
            ? existing.renewLogs.filter((e) => e && Number(e.tokens) > 0 && new Date(e.at).getTime() >= cutoff).slice(-99)
            : [];
        data.renewLogs = [...prevLogs, { at: now.toISOString(), tokens: added }];
    }
    return prisma.issuedApiKey.update({ where: { id: String(id) }, data });
}

/** Số key + tổng token một seller đã cấp kể từ `since` — để áp trần theo ngày. */
export async function sellerUsageSince(sellerKeyId, since) {
    const sid = String(sellerKeyId || "");
    const sinceMs = since instanceof Date ? since.getTime() : new Date(since).getTime();
    const [rows, renewedRows, wipRenewRows] = await Promise.all([
        prisma.issuedApiKey.findMany({
            where: { sellerKeyId: sid, createdAt: { gte: since } },
            select: {
                id: true, quotaTokens: true, initialTokens: true, hiddenAt: true,
                externalId: true, priceUsd: true, issuedAt: true, wipError: true, renewLogs: true,
            },
        }),
        prisma.issuedApiKey.findMany({
            where: { sellerKeyId: sid, lastRenewAt: { gte: since } },
            select: { id: true, renewLogs: true },
        }).catch(() => []),
        prisma.issuedApiKey.findMany({
            where: { sellerKeyId: sid, renewWipAt: { gte: new Date(Date.now() - 10 * 60_000) } },
            select: { renewWipTokens: true },
        }).catch(() => []),
    ]);

    // Dòng đã được finalize sẽ giữ dấu `issuedAt` / `externalId` / `priceUsd` ngay cả khi
    // Seller gọi DELETE /keys/:id?revoke=false (chỉ đặt `hiddenAt`). Nhờ vậy xóa/ẩn key
    // không thể xóa dấu vết để reset trần ngày. Còn slot WIP chưa finalize (`key === ""`,
    // `hiddenAt != null` và không có dấu finalize) vẫn chỉ tính vào `pending`/`inFlight`.
    const isFinalized = (r) => Boolean(!r.hiddenAt || r.issuedAt || r.externalId || r.priceUsd !== null);
    const real = rows.filter(isFinalized);
    const pendingRows = rows.filter((r) => !isFinalized(r));

    let renewTokensSince = 0;
    const seenRenewRowIds = new Set();
    const accumulateRenewLogs = (r, fallbackIdx) => {
        const key = r.id ? String(r.id) : `idx_${fallbackIdx}`;
        if (seenRenewRowIds.has(key)) return 0;
        seenRenewRowIds.add(key);
        if (!Array.isArray(r.renewLogs)) return 0;
        let sum = 0;
        for (const item of r.renewLogs) {
            const atMs = item?.at ? new Date(item.at).getTime() : NaN;
            if (Number.isFinite(atMs) && atMs >= sinceMs) {
                sum += Math.max(0, Math.floor(Number(item.tokens) || 0));
            }
        }
        return sum;
    };

    const createdTokens = real.reduce((sum, r, idx) => {
        const loggedRenewSum = accumulateRenewLogs(r, idx);
        renewTokensSince += loggedRenewSum;
        if (r.initialTokens !== undefined && r.initialTokens !== null) {
            return sum + Math.max(0, Math.floor(Number(r.initialTokens) || 0));
        }
        const qt = Math.max(0, Math.floor(Number(r.quotaTokens) || 0));
        return sum + (loggedRenewSum > 0 && qt >= loggedRenewSum ? qt - loggedRenewSum : qt);
    }, 0);

    for (let i = 0; i < (renewedRows || []).length; i++) {
        renewTokensSince += accumulateRenewLogs(renewedRows[i], `rn_${i}`);
    }

    const activePending = pendingRows.filter((r) => !r.wipError);
    const inFlightCreateTokens = activePending.reduce((s, r) => s + Math.max(0, Number(r.quotaTokens) || 0), 0);
    const inFlightRenewTokens = (wipRenewRows || []).reduce((s, r) => s + Math.max(0, Number(r.renewWipTokens) || 0), 0);

    return {
        keys: real.length,
        tokens: createdTokens + renewTokensSince,
        pending: pendingRows.length,
        inFlightKeys: activePending.length,
        inFlightTokens: inFlightCreateTokens + inFlightRenewTokens,
    };
}

export default {
    KeySource, saveIssuedKey, listIssuedKeys, countIssuedKeys, sumIssuedQuota,
    listAllIssuedKeys, countAllIssuedKeys, setIssuedKeyHidden, scanIssuedKeysForStatus,
    namespacedClientRef, claimSellerKeySlot, finalizeSellerKeySlot, discardSellerKeySlot,
    getSellerIssuedKey, listSellerIssuedKeys, countSellerIssuedKeys, scanSellerIssuedKeysForStatus,
    claimSellerKeyRenew, releaseSellerKeyRenew, finalizeSellerKeyRenew, sellerUsageSince,
    SELLER_LIST_MAX, SELLER_STATUS_SCAN_MAX, SELLER_CLIENT_REF_MAX,
};
