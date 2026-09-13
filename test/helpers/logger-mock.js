/**
 * Mock ĐỦ bộ export của `src/lib/logger.js` — KHÔNG phải một test.
 *
 * `mock.module` THAY CẢ MODULE, nên một mock chỉ khai báo `sendLog` làm nổ ngay lúc
 * load (`SyntaxError: does not provide an export named 'warnOnce'`) cho bất kỳ file src
 * nào import thêm một tên khác — kể cả khi file đó chỉ nằm TRONG ĐỒ THỊ IMPORT một cách
 * gián tiếp. Ba test delivery chết đúng kiểu đó khi `delivery.js` bắt đầu import
 * `flash-sale.js` (file này cần `warnOnce`), dù chẳng test nào trong ba cái đụng tới
 * flash sale. Thêm một export vào logger.js là vỡ thêm một loạt test nữa, nên gom về đây.
 *
 * `warnOnce` KHÔNG no-op: nó trả giá trị và `bank-poller.js` có `return warnOnce(...)`.
 * Ở đây giữ đúng ngữ nghĩa thật — mỗi `key` một lần trong đời mock, và nội dung được
 * đẩy vào cùng mảng `logs` mà `sendLog` ghi — nên test đếm tin báo vẫn thấy cảnh báo.
 */
export function loggerExports({ sendLog } = {}) {
    const sink = sendLog ?? (() => {});
    const warned = new Set();
    const warnOnce = (key, type, message) => {
        if (warned.has(key)) return false;
        warned.add(key);
        sink(type, message);
        return true;
    };
    return {
        sendLog: sink,
        warnOnce,
        warnIfScanTruncated: (label, count, cap, where = "") => {
            if (!(Number(count) >= Number(cap))) return false;
            return warnOnce(`scan-cap:${label}`, "ERROR", `⚠️ Quét ${label} chạm trần ${cap} dòng${where ? ` (${where})` : ""}`);
        },
        resetWarnOnce: () => { warned.clear(); },
    };
}

export default { loggerExports };
