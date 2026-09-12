import prisma from "./prisma.js";
import { isDuplicateKeyError as duplicateKey } from "./duplicate-key.js";

/**
 * Claim bền vững một giao dịch bên ngoài trước khi cộng ví/giao đơn.
 * `_id`/eventKey unique giúp hai worker hoặc hai luồng scan không thể dùng cùng
 * một transaction cho hai mục tiêu khác nhau.
 */
export async function claimPaymentEvent(eventKey, { kind, targetId, metadata = null } = {}, db = prisma) {
    const key = String(eventKey || "").trim();
    if (!key) return { claimed: false, conflict: true, error: "Missing payment event key" };

    // Chặn cả giao dịch đã xử lý trước khi collection paymentEvents được triển khai.
    // Nếu không back-check paymentRef cũ, txid lịch sử có thể bị tái sử dụng một lần
    // ngay sau deploy.
    const [legacyOrders, legacyWalletTxs] = await Promise.all([
        db.order?.findMany?.({ where: { paymentRef: { in: [key] } }, select: { id: true, paymentRef: true } }) || [],
        db.walletTransaction?.findMany?.({ where: { paymentRef: { in: [key] } }, select: { id: true, paymentRef: true } }) || [],
    ]);
    if (legacyOrders.length || legacyWalletTxs.length) {
        const wantedTarget = String(targetId || "");
        const orderTarget = kind?.includes("ORDER")
            && legacyOrders.some((row) => String(row.id || "") === wantedTarget);
        const depositTarget = kind?.includes("DEPOSIT")
            && legacyWalletTxs.some((row) => String(row.id || "") === wantedTarget);
        const sameTarget = Boolean(orderTarget || depositTarget);

        // Dữ liệu lịch sử có thể đã bị trùng paymentRef từ trước khi có unique
        // ledger. Chỉ cần MỘT bản ghi khác target là phải coi là xung đột; không
        // được nhận phần tử đầu tiên rồi vô tình cho cùng txid chạy tiếp.
        const hasOtherTarget = legacyOrders.some((row) => !(kind?.includes("ORDER") && String(row.id || "") === wantedTarget))
            || legacyWalletTxs.some((row) => !(kind?.includes("DEPOSIT") && String(row.id || "") === wantedTarget));
        return {
            claimed: false,
            conflict: !sameTarget || hasOtherTarget,
            alreadyClaimed: sameTarget && !hasOtherTarget,
            legacyPaymentRef: true,
        };
    }

    // Tương thích mock/test và rolling deploy cũ. Production adapter mới luôn có
    // paymentEvent; fallback này chỉ best-effort, không thay thế unique ledger.
    if (!db.paymentEvent?.create) {
        return { claimed: true, conflict: false, legacyFallback: true };
    }

    try {
        const row = await db.paymentEvent.create({
            data: {
                eventKey: key,
                kind: String(kind || "UNKNOWN"),
                targetId: String(targetId || ""),
                status: "CLAIMED",
                metadata: metadata == null
                    ? null
                    : (typeof metadata === "string" ? metadata : JSON.stringify(metadata)),
            },
        });
        return { claimed: true, event: row };
    } catch (error) {
        if (!duplicateKey(error)) throw error;
        const existing = await db.paymentEvent.findUnique({ where: { eventKey: key } }).catch(() => null);
        const sameTarget = existing
            && String(existing.kind) === String(kind || "UNKNOWN")
            && String(existing.targetId) === String(targetId || "");
        return { claimed: false, conflict: !sameTarget, alreadyClaimed: sameTarget, event: existing };
    }
}

export async function completePaymentEvent(eventKey, { status = "PROCESSED", metadata } = {}, db = prisma) {
    if (!db.paymentEvent?.update) return null;
    const data = { status };
    if (metadata !== undefined) {
        data.metadata = metadata == null
            ? null
            : (typeof metadata === "string" ? metadata : JSON.stringify(metadata));
    }
    return db.paymentEvent.update({ where: { eventKey: String(eventKey) }, data });
}

/**
 * Chỉ nhả claim khi chắc chắn chưa có tác động tài chính/nghiệp vụ nào xảy ra.
 * Lỗi timeout sau request tới provider/ngân hàng KHÔNG được gọi hàm này.
 */
export async function releasePaymentEvent(eventKey, { kind, targetId } = {}, db = prisma) {
    if (!db.paymentEvent?.findUnique) return false;
    const existing = await db.paymentEvent.findUnique({ where: { eventKey: String(eventKey) } }).catch(() => null);
    if (!existing) return false;
    if (kind && String(existing.kind) !== String(kind)) return false;
    if (targetId && String(existing.targetId) !== String(targetId)) return false;
    await db.paymentEvent.delete({ where: { id: existing.id } });
    return true;
}

/**
 * Trạng thái nghĩa là "giao dịch mang `eventKey` này ĐÃ được ghi nhận cho đơn".
 *
 * `DELIVERING` bắt buộc phải có mặt: đó là trạng thái đơn đang ở giữa lúc giao hàng,
 * tức là tiền đã được ghi nhận rồi. Năm chỗ trong repo cùng hỏi đúng câu này, và
 * trước đây mỗi chỗ tự liệt kê — `confirmOrderByCryptoScan` thiếu `DELIVERING` nên
 * khi khách bấm "Tôi đã chuyển, kiểm tra" đúng lúc đơn đang giao, nó rơi xuống nhánh
 * `releasePaymentEvent`: XOÁ sổ cái của một giao dịch đã hoàn tất và báo khách
 * "không thể xác nhận đơn hàng" trong khi hàng đang trên đường tới.
 *
 * Đây cùng lớp bug với `isSafeRefundCreateCode` trong delivery.js: một luật tài chính
 * bị nhân bản thì sớm muộn cũng có một bản lệch.
 */
export const SETTLED_ORDER_STATUSES = ["PAID", "DELIVERING", "DELIVERED"];

/**
 * Đơn này đã được thanh toán bằng ĐÚNG giao dịch `eventKey` chưa?
 *
 * Gộp cả hai điều kiện (paymentRef khớp VÀ trạng thái đã ghi nhận) vì năm call site
 * đều cần cả hai; tách ra là có chỗ quên một nửa.
 */
export function isOrderSettledBy(order, eventKey) {
    return !!order
        && !!eventKey
        && order.paymentRef === eventKey
        && SETTLED_ORDER_STATUSES.includes(order.status);
}

export default { claimPaymentEvent, completePaymentEvent, releasePaymentEvent, SETTLED_ORDER_STATUSES, isOrderSettledBy };