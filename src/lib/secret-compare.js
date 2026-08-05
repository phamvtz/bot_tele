import { createHash, timingSafeEqual } from "node:crypto";

/**
 * So sánh hai chuỗi bí mật ở thời gian không đổi (M7).
 *
 * `a !== b` của JS thoát ra ở byte đầu tiên khác nhau, nên thời gian phản hồi rò rỉ
 * độ dài prefix đúng. Với một endpoint HTTP có thể gọi tuỳ ý, đó là đủ để dò ra
 * token theo từng byte. `timingSafeEqual` không rò, nhưng đòi hai buffer BẰNG ĐỘ DÀI
 * (khác độ dài là ném lỗi) — nên hash cả hai bên trước: SHA-256 luôn ra 32 byte,
 * vừa cố định độ dài vừa không để lộ độ dài thật của secret.
 *
 * Trả false khi thiếu một trong hai giá trị: không có secret cấu hình thì không ai
 * được coi là đã xác thực.
 */
export function secretEquals(a, b) {
    if (typeof a !== "string" || typeof b !== "string" || !a || !b) return false;
    const ha = createHash("sha256").update(a).digest();
    const hb = createHash("sha256").update(b).digest();
    return timingSafeEqual(ha, hb);
}

export default { secretEquals };
