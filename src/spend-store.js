/**
 * Kéo đơn hàng cho thống kê chi tiêu — tầng DB của `spend-stats.js`.
 *
 * Tách khỏi `spend-stats.js` để module đó giữ đúng nghĩa HÀM THUẦN (test không cần
 * mock prisma), và tách khỏi route để Seller API và web admin dùng CHUNG một luật
 * lấy dữ liệu. Hai route tự query là hai route ra hai con số khác nhau cho cùng
 * một ngày.
 *
 * Vì sao phân trang thay vì một `findMany` trần: khoảng thời gian 30 ngày trên một
 * shop đông khách là hàng chục nghìn document. Đọc hết một lượt là đỉnh bộ nhớ không
 * có trần. Nhưng cũng KHÔNG được dùng `take: N` rồi im lặng — đó đúng là lỗi của
 * hai poller thanh toán: chạm trần thì số liệu thiếu mà không ai biết. Ở đây đọc
 * từng khúc cho tới hết khoảng, có trần cứng và CÓ BÁO khi chạm trần.
 *
 * Phân trang bằng `skip` chứ không bằng cursor `createdAt`: nhiều đơn có thể cùng
 * một mốc createdAt tới từng mili giây, nên cursor `gt: lastCreatedAt` sẽ BỎ SÓT
 * các dòng trùng mốc đó. `skip` chậm hơn nhưng đúng, và đây là endpoint thống kê
 * chứ không phải hot path.
 */

import prisma from "./lib/prisma.js";
import { warnIfScanTruncated } from "./lib/logger.js";
import { SPEND_STATUSES, DEFAULT_TZ_OFFSET_MINUTES, dayRange } from "./spend-stats.js";

const SELECT = {
    odelegramId: true, finalAmount: true, displayFinalUsd: true,
    status: true, createdAt: true, productId: true, paymentMethod: true,
};

export const SPEND_SCAN_CHUNK = 1000;
export const SPEND_SCAN_MAX = 200_000;

/**
 * @returns {Promise<{rows: Array, range: object, truncated: boolean, scanned: number}>}
 *   `truncated: true` nghĩa là ĐÃ DỪNG SỚM vì chạm `SPEND_SCAN_MAX` — con số tổng
 *   trả ra cho người dùng là con số THIẾU và phải được nói rõ là thiếu.
 */
export async function fetchSpendRows({
    days = 30,
    now = Date.now(),
    tzOffsetMinutes = DEFAULT_TZ_OFFSET_MINUTES,
    statuses = SPEND_STATUSES,
    telegramId = null,
    productId = null,
    label = "đơn hàng thống kê chi tiêu",
} = {}) {
    const range = dayRange(days, now, tzOffsetMinutes);
    const base = {
        status: { in: statuses },
        createdAt: { gte: range.from, lt: range.to },
    };
    if (telegramId) base.odelegramId = String(telegramId);
    if (productId) base.productId = String(productId);

    const rows = [];
    let truncated = false;
    for (let skip = 0; rows.length < SPEND_SCAN_MAX; skip += SPEND_SCAN_CHUNK) {
        const chunk = await prisma.order.findMany({
            where: base,
            select: SELECT,
            orderBy: { createdAt: "asc" },
            skip,
            take: SPEND_SCAN_CHUNK,
        });
        rows.push(...chunk);
        if (chunk.length < SPEND_SCAN_CHUNK) break;
        if (rows.length >= SPEND_SCAN_MAX) { truncated = true; break; }
    }

    warnIfScanTruncated(label, rows.length, SPEND_SCAN_MAX, `days=${range.keys.length}`);
    return { rows, range, truncated, scanned: rows.length };
}

export default { fetchSpendRows, SPEND_SCAN_CHUNK, SPEND_SCAN_MAX };
