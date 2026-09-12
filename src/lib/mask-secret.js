/**
 * Che chuỗi bí mật để hiện ra UI/log mà không lộ giá trị dùng được.
 *
 * Nằm ở `lib/` chứ không phải trong `seller-api.js`: trang tài liệu Seller API cũng
 * cần nó, và để nó import ngược từ seller-api.js thì thành một vòng import
 * (seller-api → seller-api-docs → seller-api). ESM chịu được vòng nếu mọi thứ là
 * hàm gọi lúc runtime, nhưng "chịu được" không phải lý do để viết như vậy.
 *
 * Giữ 7 ký tự đầu (`sk-` + 4) và 4 ký tự cuối: đủ để người dùng nhận ra key nào
 * trong danh sách, không đủ để dùng. Key ngắn bất thường thì che gần hết.
 */
export function maskSecret(value, { head = 7, tail = 4, minLength = 12 } = {}) {
    const s = String(value ?? "");
    if (!s) return null;
    if (s.length <= minLength) return `${s.slice(0, 2)}…${s.slice(-2)}`;
    return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

/** Bí danh đọc đúng ngữ cảnh key API. */
export const maskApiKey = maskSecret;

export default { maskSecret, maskApiKey };
