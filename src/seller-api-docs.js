/**
 * Trang tài liệu Seller API — tách riêng để seller-api.js không phình thêm ~200
 * dòng HTML. Cùng phong cách với trang `/api/user/docs`.
 *
 * Trang này nằm SAU sellerAuth (xem route `/docs`), nên nó được phép in ra cấu hình
 * CỦA CHÍNH KEY ĐANG GỌI: tên key, trần cấp theo ngày. Tuyệt đối không in khoá
 * `sk_*` đầy đủ — dùng đúng `maskApiKey`.
 */

import { maskApiKey } from "./lib/mask-secret.js";

const esc = (s) => String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

function ep(method, path, desc) {
    return `<div class="ep"><span class="m ${method.toLowerCase()}">${method}</span>`
        + `<code>${esc(path)}</code><span class="d">${desc}</span></div>`;
}

function row(param, type, required, desc) {
    return `<tr><td><code>${esc(param)}</code></td><td>${esc(type)}</td>`
        + `<td>${required ? "<b>có</b>" : "không"}</td><td>${desc}</td></tr>`;
}

export function sellerDocsHtml({ apiKey = {}, limits = {}, base = "/api/seller" } = {}) {
    const maxKeys = limits.maxKeysPerDay || 0;
    const maxTokens = limits.maxTokensPerDay || 0;

    return `<!doctype html>
<html lang="vi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Seller API</title>
<style>
  :root{color-scheme:dark}
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0b0d12;color:#e5e7eb;margin:0;padding:2rem 1rem;line-height:1.6}
  .wrap{max-width:820px;margin:0 auto}
  h1{font-size:1.5rem;margin:0 0 .25rem}
  h2{font-size:1.05rem;margin:2rem 0 .5rem;color:#a5b4fc}
  p,li{color:#9ca3af}
  code{background:#1a1d27;color:#e5e7eb;padding:.15rem .4rem;border-radius:5px;font-size:.9em}
  pre{background:#12151d;border:1px solid #232838;border-radius:10px;padding:1rem;overflow:auto}
  pre code{background:none;padding:0}
  .ep{display:flex;gap:.6rem;align-items:center;padding:.55rem .75rem;border:1px solid #232838;border-radius:10px;margin:.4rem 0;background:#12151d;flex-wrap:wrap}
  .ep .d{color:#9ca3af;font-size:.88rem;flex:1 1 240px}
  .m{font-weight:700;font-size:.75rem;padding:.15rem .5rem;border-radius:6px}
  .get{background:#064e3b;color:#6ee7b7}.post{background:#3b2f06;color:#fcd34d}
  .patch{background:#1e1b4b;color:#c7d2fe}.delete{background:#450a0a;color:#fca5a5}
  .note{border-left:3px solid #6366f1;padding:.5rem .9rem;background:#12151d;border-radius:0 8px 8px 0;margin:1rem 0}
  .warn{border-left-color:#f59e0b}
  table{border-collapse:collapse;width:100%;margin:.5rem 0}
  th,td{text-align:left;padding:.4rem .5rem;border-bottom:1px solid #232838;font-size:.9rem;vertical-align:top}
  th{color:#a5b4fc;font-weight:600}
  .me{background:#12151d;border:1px solid #232838;border-radius:10px;padding:.75rem 1rem;margin:1rem 0}
</style></head><body><div class="wrap">

<h1>Seller API</h1>
<p>Xác thực bằng header <code>Authorization: Bearer sk_…</code> (hoặc <code>x-api-key</code>). Base: <code>${esc(base)}</code></p>

<div class="me">
  <div>Key đang dùng: <code>${esc(apiKey.name || "")}</code> · <code>${esc(maskApiKey(apiKey.key))}</code></div>
  <div>Trần cấp key: ${maxKeys ? `${maxKeys} key/ngày` : "không giới hạn"} · ${maxTokens ? `${maxTokens.toLocaleString("vi-VN")} token/ngày` : "không giới hạn"}</div>
</div>

<div class="note warn"><b>Chuỗi <code>sk-</code> của key chỉ được trả về MỘT LẦN</b>, trong response của
<code>POST /keys</code>. Mọi endpoint đọc khác trả bản che (<code>sk-abc…wxyz</code>).
Lưu lại ngay lúc tạo — không có cách nào lấy lại.</div>

<h2>Hàng tồn kho</h2>
${ep("GET", "/products", "Sản phẩm đang bán, kèm tồn kho với hàng STOCK_LINES")}
${ep("POST", "/stock", "Nạp hàng — <code>{productId, lines: [\"…\"]}</code>")}
${ep("POST", "/stock/text", "Nạp hàng dạng text — <code>{productId, text}</code>, mỗi dòng một đơn vị")}

<h2>Đơn hàng</h2>
${ep("GET", "/orders", "Đơn gần đây (<code>?status=&limit=</code> ≤ 100). Chỉ trả field công khai, không có dữ liệu đã giao")}
${ep("GET", "/orders/:id", "Chi tiết một đơn, cùng whitelist")}

<h2>Server (profile)</h2>
${ep("GET", "/profiles", "Các server đang mở bán, kèm đơn giá $/1M token, trần mua, preset RPM/ngày")}

<h2>API key</h2>
${ep("POST", "/keys", "Cấp một key <code>sk-*</code> thật — tốn quota, không hoàn lại")}
${ep("GET", "/keys", "Key do chính bạn cấp (<code>?page=&limit=&live=0</code>). <code>live=0</code> bỏ số liệu provider cho nhanh")}
${ep("GET", "/keys/:id", "Chi tiết + trạng thái sống (quota đã dùng, còn mấy ngày, có đang bật không)")}
${ep("PATCH", "/keys/:id", "Gia hạn — <code>{addTokens?, addDays?, clientRef?}</code>")}
${ep("PATCH", "/keys/:id/enabled", "Bật/tắt key — <code>{enabled: false}</code>. Không xoá, mở lại được")}
${ep("DELETE", "/keys/:id", "Thu hồi (<code>?revoke=true</code> mặc định: tắt phía provider + ẩn khỏi /mykey; <code>revoke=false</code> chỉ ẩn, key vẫn dùng được)")}

<h3>POST /keys</h3>
<table>
<tr><th>Tham số</th><th>Kiểu</th><th>Bắt buộc</th><th>Mô tả</th></tr>
${row("tokens", "string|int", true, "Số token. Nhận <code>10000000</code>, <code>10m</code>, <code>10tr</code>, <code>1b</code>. Tối đa = <code>maxBuyTokens</code> của server")}
${row("telegramId", "string", false, "ID Telegram của khách. Có giá trị hợp lệ thì key hiện trong <code>/mykey</code> của người đó; bỏ trống thì chỉ quản lý qua API này")}
${row("rpm", "int", false, "10–10000. Bỏ trống = mặc định của server")}
${row("validDays", "int", false, "1–3650, hoặc <code>0</code> = không hết hạn. Bỏ trống = mặc định của server")}
${row("profileId", "int", false, "Server nào cấp. Lấy từ <code>GET /profiles</code>. Bỏ trống = server đầu tiên đang bật")}
${row("clientRef", "string", false, "<b>Nên gửi.</b> Khoá chống trùng — xem mục Idempotency")}
${row("notify", "bool", false, "<code>true</code> = gửi tin Telegram chứa key cho <code>telegramId</code> (người đó phải đã /start bot)")}
${row("name", "string", false, "Nhãn key phía nhà cung cấp, ≤ 60 ký tự")}
</table>

<pre><code>curl -X POST ${esc(base)}/keys \\
  -H "Authorization: Bearer $SELLER_KEY" -H "Content-Type: application/json" \\
  -d '{"tokens":"10m","validDays":30,"telegramId":"123456789","clientRef":"order-8891"}'</code></pre>

<h3>PATCH /keys/:id (gia hạn)</h3>
${row("addTokens", "int", false, "Cộng THÊM token (không phải đặt lại)")}
${row("addDays", "int", false, "Cộng thêm ngày. Key đã quá hạn thì tính từ bây giờ")}
${row("clientRef", "string", false, "<b>Nên gửi.</b> Gửi lại đúng ref cũ sau khi timeout sẽ nhận biên nhận cũ, không cộng lần hai")}

<div class="note"><b>Key vô hạn không gia hạn được.</b> <code>quota_limit = 0</code> nghĩa là vô hạn trên
provider; cộng token vào sẽ HẠ CẤP nó thành có giới hạn, nên API từ chối
(<code>nothing_to_renew</code>) thay vì âm thầm làm hỏng key của khách.
Kiểm tra trước bằng <code>live.renewability</code> trong <code>GET /keys/:id</code>.</div>

<h2>Idempotency — đọc trước khi retry</h2>
<p>Cả <code>POST /keys</code> và <code>PATCH /keys/:id</code> đều tốn quota thật và
<b>không tự hoàn lại</b>. Nếu request timeout, đừng retry mù:</p>
<ul>
  <li>Gửi kèm <code>clientRef</code> duy nhất cho mỗi nghiệp vụ (mã đơn của bạn là lựa chọn tốt).</li>
  <li>Retry bằng <b>đúng</b> <code>clientRef</code> đó: hoặc nhận key đã tạo (<code>duplicate: true</code>), hoặc nhận biên nhận gia hạn cũ.</li>
  <li>Nhận <code>409 renew_in_progress</code> hoặc <code>retryable: false</code> nghĩa là <b>dừng lại</b> và báo shop đối soát — phía provider có thể đã thay đổi rồi.</li>
</ul>

<h2>Thống kê</h2>
${ep("GET", "/stats", "Tổng quan shop + số key của bạn")}
${ep("GET", "/stats/keys", "Key của bạn theo ngày và trạng thái (<code>?days=30</code>)")}
${ep("GET", "/stats/users/daily", "Mỗi khách tiêu bao nhiêu mỗi ngày (<code>?days=30&top=20&user=u_…</code>)")}

<div class="note"><b>Khách hàng trong thống kê đã được ẩn danh.</b> Mỗi người mua hiện ra dưới dạng
<code>u_xxxxxxxxxxxxxxxxxxxx</code> — ổn định với API key của bạn, không dịch ngược được,
và KHÁC nhau giữa hai API key. Bạn vẫn thấy khách nào chi bao nhiêu mỗi ngày,
nhưng không biết họ là ai trong hệ thống của shop.</div>

<h3>Trạng thái key (<code>live.status</code>)</h3>
<table>
<tr><th>Giá trị</th><th>Nghĩa</th></tr>
<tr><td><code>active</code></td><td>Đang dùng tốt</td></tr>
<tr><td><code>low</code></td><td>Sắp hết (≥80% quota, hoặc còn ≤3 ngày)</td></tr>
<tr><td><code>exhausted</code></td><td>Cạn quota</td></tr>
<tr><td><code>expired</code></td><td>Quá hạn</td></tr>
<tr><td><code>disabled</code></td><td>Đang bị tắt phía provider</td></tr>
<tr><td><code>missing</code></td><td>Không còn bên provider — phải cấp key mới</td></tr>
<tr><td><code>unknown</code></td><td>Không đọc được số liệu sống (xem <code>liveOk: false</code>) — CHƯA kết luận được key chết</td></tr>
</table>

<h2>Mã lỗi</h2>
<table>
<tr><th>HTTP</th><th>Nghĩa</th></tr>
<tr><td><code>400</code></td><td>Tham số sai — response có <code>min</code>/<code>max</code> nếu là lỗi khoảng giá trị</td></tr>
<tr><td><code>401</code></td><td>Thiếu/sai API key</td></tr>
<tr><td><code>404</code></td><td>Không tìm thấy, HOẶC key không thuộc API key này (hai trường hợp cố ý không phân biệt)</td></tr>
<tr><td><code>409</code></td><td>Xung đột trạng thái: server đang ngừng bán, có lượt gia hạn chưa chốt, key không gia hạn được</td></tr>
<tr><td><code>429</code></td><td>Vượt trần cấp key theo ngày</td></tr>
<tr><td><code>502</code></td><td>Nhà cung cấp lỗi. <code>retryable: true</code> thì thử lại được; <code>false</code> thì DỪNG và đối soát</td></tr>
</table>

</div></body></html>`;
}

export default { sellerDocsHtml };
