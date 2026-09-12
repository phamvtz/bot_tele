/**
 * Nhận diện lỗi TRÙNG KHOÁ (unique index) — một module, dùng chung.
 *
 * Vì sao không viết inline ở mỗi chỗ: đây là hàm quyết định "request này đã có người
 * khác xử lý chưa", tức là quyết định CÓ ĐƯỢC GHI TIỀN / CẤP KEY LẦN NỮA hay không.
 * Trước đây nó tồn tại hai bản (`payment-events.js` và `giftcode.js`) với hai tập
 * điều kiện hơi khác nhau — bản nào thiếu một dấu hiệu là đường đó im lặng cấp trùng.
 * Cùng một lớp bug với `isSafeRefundCreateCode` trong delivery.js.
 */

export function isDuplicateKeyError(error) {
    return error?.code === 11000          // MongoDB native driver: E11000
        || error?.code === "P2002"        // Prisma (PostgreSQL): unique constraint
        || /E11000|duplicate key|unique constraint failed/i.test(String(error?.message || ""));
}

export default { isDuplicateKeyError };
