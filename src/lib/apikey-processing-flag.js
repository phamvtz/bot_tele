/**
 * Cờ "đang tạo key" CÓ TTL cho các flow mua / gia hạn API key.
 *
 * Vấn đề của một cờ boolean trần: session của bot được persist xuống Mongo
 * (collection `botSessions`, TTL 30 ngày) và memCache của session-store trả về ĐÚNG
 * object mà Telegraf đang mutate. Nên khi một update khác của cùng session chạy xong
 * giữa lúc đơn đang giao — khách sốt ruột bấm Menu, gửi /start — middleware session
 * ghi luôn `apikeyProcessing: true` xuống DB. Nếu process bị kill sau đó (deploy,
 * OOM) thì `finally` không bao giờ chạy, mà cờ thì đã nằm trong Mongo: /start không
 * xoá, không có nút admin nào reset. Khách bấm bất cứ nút nào của cửa hàng key cũng
 * chỉ nhận "Đang tạo key, vui lòng đợi..." — khoá cứng cho tới khi document session
 * hết hạn 30 ngày.
 *
 * Một lượt xử lý thật không bao giờ lâu hơn vài phút (createApiKey timeout 30s, gửi
 * tin retry tối đa ~90s), nên cờ cũ hơn TTL chắc chắn là cờ mồ côi và phải được nhả.
 *
 * Giữ nguyên tên field cũ (`apikeyProcessing`) là CÓ CHỦ Ý: session do bản trước ghi
 * lại có cờ true mà KHÔNG có mốc thời gian, nên `isApikeyProcessingActive` trả false
 * cho chúng — mọi khách đang bị khoá cứng tự động được nhả ngay lần deploy này, không
 * phải sửa tay từng document trong `botSessions`.
 *
 * Tách ra module thuần, nhận `now` làm tham số, để test được — đây là chốt chống
 * khoá khách vĩnh viễn, không phải thứ để tin bằng đọc code.
 */

export const APIKEY_PROCESSING_TTL_MS = 3 * 60_000;

/**
 * Cờ còn hiệu lực không?
 *
 * Cờ true mà KHÔNG có mốc thời gian hợp lệ → false (mồ côi, nhả). KHÔNG được trả
 * true ở nhánh đó: trả true là giữ nguyên bug khoá 30 ngày cho mọi session đang tồn
 * tại lúc deploy.
 */
export function isApikeyProcessingActive(session, now = Date.now(), ttlMs = APIKEY_PROCESSING_TTL_MS) {
    if (!session || session.apikeyProcessing !== true) return false;
    const at = Number(session.apikeyProcessingAt);
    if (!Number.isFinite(at) || at <= 0) return false;
    const ttl = Number(ttlMs);
    if (!Number.isFinite(ttl) || ttl <= 0) return false;
    return now - at < ttl;
}

/**
 * Claim cờ kèm mốc thời gian. Hai lệnh gán liền nhau, KHÔNG được await ở giữa —
 * claim phải xong đồng bộ trước mọi await, kể cả answerCallback (xem bot.js).
 */
export function claimApikeyProcessing(session, now = Date.now()) {
    if (!session) return;
    session.apikeyProcessing = true;
    session.apikeyProcessingAt = now;
}

/** Nhả cờ. Gọi trong `finally` của mọi handler mua / gia hạn key. */
export function releaseApikeyProcessing(session) {
    if (!session) return;
    session.apikeyProcessing = false;
    session.apikeyProcessingAt = 0;
}

export default {
    APIKEY_PROCESSING_TTL_MS,
    isApikeyProcessingActive,
    claimApikeyProcessing,
    releaseApikeyProcessing,
};
