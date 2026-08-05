# Audit luồng thanh toán USD/USDT — Báo cáo chi tiết

> Phạm vi: toàn bộ luồng thanh toán USDT (TRC20/BEP20) + lớp hiển thị USD trên số tiền VND.
> Trạng thái: phân tích xong; **Giai đoạn 0, 1 và 2 đã thực hiện xong** (xem §6, §7).
> Giai đoạn 3 chưa làm — chờ 1–2 chạy ổn định trên production vài ngày.

---

## 1. Bản đồ luồng hiện tại

### 1.1 Thành phần tham gia

| Lớp | File | Trách nhiệm |
|---|---|---|
| Tỷ giá + matcher + fetcher | `src/payment/crypto.js` (610 dòng) | config network, tỷ giá USD/VND, sinh số tiền unique, gọi explorer API, so khớp transfer |
| Chuyển đổi tiền | `src/payment/amounts.js` | `convertToVnd/Usd`, tolerance khớp số tiền |
| Hiển thị | `src/money-display.js`, `src/bot-ui/messages.js` | format `$x (≈ y đ)` |
| UI + tạo đơn | `src/bot.js` | `sendCryptoCheckout` (3219), tạo order (3311), nạp ví (3730), các action `PAY_CRYPTO`/`DEPOSIT_CRYPTO`/`*_CRYPTO_CHECK`/`SHOW_CRYPTO_PAY` |
| Background job | `src/crypto-poller.js` (373 dòng) | poll 15s, hủy hết hạn, xác nhận, gọi deliver |
| Giao hàng | `src/delivery.js`, `src/delivery-recovery.js` | `deliverOrder`, retry 60s |
| Ví | `src/wallet.js` | `createDeposit`, `confirmDeposit` |
| Rail ngân hàng (đối chiếu) | `src/payment/vietqr.js`, `src/server.js` `/webhook/ipn`, `src/bank-poller.js` | — |

### 1.2 Luồng mua hàng bằng USDT

```
User chọn sản phẩm
 → processPaymentFlow (bot.js:2994) lock tỷ giá vào orderData.usdVndRate
 → action PAY_CRYPTO:(trc20|bep20)  (bot.js:3269)
 → prisma.order.create  status=PENDING, paymentMethod=crypto_trc20
      ghi: currency, cryptoUsdVndRate, displayCurrency, displayUnitPrice, displayFinalUsd
 → applyCoupon (giữ suất dùng coupon)
 → sendCryptoCheckout (bot.js:3219)
      createCryptoCheckout() → amountToken = vndToUniqueUsdt(finalAmount, orderId)
      order.update: paymentRef="CRYPTO:{json}", cryptoNetwork/Amount/Address/Token/UsdVndRate
      gửi tin nhắn + nút [Mở QR] [Kiểm tra] [Hủy]
 ⇩ (song song 2 đường xác nhận)
 A. crypto-poller tick 15s
      getPendingCryptoOrders + getPendingCryptoDeposits
      cancelExpiredOrders / expireCryptoDeposits
      fetchCryptoTransfers(network, sinceMs=minCreatedAt-60s)
      loại bỏ eventKey đã xử lý (cache 5' + batchAlreadyProcessed)
      nếu matches.length > 1 → sendLog ERROR + skip
      processDepositTransfer TRƯỚC → processTransfer
      order.updateMany{status:PENDING → PAID, paymentRef=eventKey}   (compare-and-swap)
      deliverOrder(...)
 B. nút [Kiểm tra] → confirmOrderByCryptoScan (crypto-poller.js:200)
      fetch transfers, yêu cầu matchingPendingPayments().length === 1
      claim PENDING→PAID, KHÔNG deliver
      → bot.js:4079 scheduleOrderDelivery(...)
 ⇩
 deliverOrder: PAID → DELIVERING → (STOCK_LINES/TEXT/FILE) → DELIVERED
      side effects: Promise.allSettled([referral, addSpending→VIP, checkStock, notifyOrderChannel, notifyAdmins])
 ⇩ nếu lỗi: DELIVERING → PAID, delivery-recovery quét lại mỗi 60s
```

### 1.3 Luồng nạp ví bằng USDT

```
User nhập số USDT (bot.js:3730)
 → usdVndRate = getUsdVndRate(); amount = round(amountUsdt * rate)   ← VND chốt tại đây
 → createDeposit() (wallet.js:107): expire deposit PENDING > 15' + tạo tx PENDING
 → createCryptoDepositCheckout() → amountToken
 → walletTransaction.update: paymentRef="CRYPTO:{json,type:deposit}", crypto*
 ⇩
 A. crypto-poller → processDepositTransfer → confirmDeposit(tx.id, eventKey)
      updateMany{status:PENDING → SUCCESS, paymentRef} rồi $inc balance
      nếu $inc lỗi → revert về PENDING + xóa paymentRef để poller thử lại
 B. nút [Kiểm tra] → confirmDepositByCryptoScan
```

### 1.4 Bảng trạng thái

| Model | Giá trị thực tế được ghi | Enum khai báo |
|---|---|---|
| `Order.status` | PENDING, PAID, DELIVERING, DELIVERED, CANCELED, CANCELING | String (không enum) |
| `WalletTransaction.status` | PENDING, SUCCESS, FAILED, **EXPIRED** | comment `// PENDING, SUCCESS, FAILED` — `TxStatus` chỉ có 3 giá trị |

---

## 2. Danh sách vấn đề

### 🔴 CRITICAL

#### C1. `SHOW_CRYPTO_PAY` tính lại số tiền USDT và ghi đè `cryptoAmount` → mất tiền của khách

- **File/function**: `src/bot.js:4118` `SHOW_CRYPTO_PAY` → `sendCryptoCheckout` (3219) → `createCryptoCheckout` → `vndToUniqueUsdt` (`crypto.js:328`)
- **Mô tả**: `SHOW_CRYPTO_PAY` gọi lại nguyên `sendCryptoCheckout` cho đơn PENDING. `vndToUniqueUsdt` đọc **tỷ giá hiện tại**: `base = ceil(finalAmount / rate * 1e6)/1e6`. Offset theo hash orderId là cố định, nhưng `base` thì không. Nếu tỷ giá thay đổi giữa 2 lần xem (cache TTL 5 phút, CoinGecko live), `amountToken` mới ≠ cũ, và `order.update` **ghi đè** `cryptoAmount` + `cryptoUsdVndRate` + `paymentRef`.
- **Vì sao là vấn đề**: khách đã chuyển đúng số tiền hiển thị lần đầu. Sau khi mở lại màn thanh toán, DB chỉ còn số tiền mới. `cryptoTransferMatchesOrder` so khớp với tolerance ≤ 0.00000049 USDT → transfer thật **không bao giờ khớp**. Đơn bị `cancelExpiredOrders` hủy sau 10 phút, tiền đã vào ví shop mà khách không được giao hàng, không có cơ chế tự đối soát.
- **Severity**: **Critical** (mất tiền khách, âm thầm, xảy ra chỉ bằng thao tác bấm lại một nút).
- **Giải pháp**: `sendCryptoCheckout` phải **tái tạo checkout từ dữ liệu đã lưu** khi order đã có `cryptoAmount`, không tính lại. Tách 2 hàm: `createCryptoCheckout` (lần đầu, sinh số) và `restoreCryptoCheckout(order)` (đọc `cryptoNetwork/cryptoAmount/cryptoAddress/cryptoToken/cryptoUsdVndRate`). Chỉ đường sinh mới được `order.update`.

#### C2. Trùng số tiền → thanh toán thật bị treo vĩnh viễn, không cảnh báo cho ai xử lý

- **File/function**: `crypto.js:328` `vndToUniqueUsdt`; `crypto-poller.js:334-338` guard `matches.length > 1`; `crypto-poller.js:218,264` guard `!== 1`
- **Mô tả**: offset = `(hash(orderId) % 9000 + 1000) / 1e6` → chỉ **9000 giá trị**. Hai đơn cùng `finalAmount` và cùng `hash % 9000` sinh `amountToken` giống nhau. Khi có transfer khớp, poller `sendLog("ERROR", ...)` rồi `continue` — **mọi tick sau đều lặp lại y vậy**, không bao giờ tự giải quyết. Nút [Kiểm tra] trả về "Số tiền USDT đang trùng với giao dịch khác, vui lòng liên hệ admin để đối soát".
- **Vì sao là vấn đề**: hai khách hàng chuyển tiền thật đều bị treo; cả hai đơn hết hạn và bị hủy. Xác suất theo birthday paradox không nhỏ khi nhiều đơn cùng mức giá đồng thời (sản phẩm giá cố định là trường hợp phổ biến nhất). Log ERROR đổ vào channel chung, không tạo task đối soát, không notify khách.
- **Severity**: **Critical**
- **Giải pháp**: đảm bảo unique thật thay vì hy vọng hash không trùng — cấp offset bằng cách **truy vấn `cryptoAmount` của các đơn PENDING cùng network** và tăng dần cho tới khi không trùng (giữ trong 1 vòng lặp giới hạn), lưu kèm `cryptoAmount` có index. Đồng thời khi gặp `matches.length > 1`: đánh dấu transfer cần đối soát vào DB (một collection `PaymentConflict` hoặc field trên order) + notify admin một lần duy nhất, không spam mỗi 15s.

---

### 🟠 HIGH

#### H1. `fetchBep20Transfers` bỏ qua `sinceMs` → bỏ sót thanh toán BEP20

- **File/function**: `crypto.js:502` `fetchBep20Transfers(config)`; gọi tại `crypto.js:534` `fetchCryptoTransfers` truyền `sinceMs` nhưng signature không nhận
- **Mô tả**: luôn lấy 100 transfer mới nhất `sort=desc`. `fetchCryptoTransfers` truyền `sinceMs` như đối số thứ 2 → **bị bỏ im lặng**.
- **Vì sao là vấn đề**: ví nhận đông (hoặc bị spam token dust vào cùng contract) đẩy transfer của đơn PENDING ra khỏi cửa sổ 100 → không bao giờ khớp → khách mất tiền. Đường TRC20 có `min_timestamp` nên không bị.
- **Severity**: **High**
- **Giải pháp**: nhận `sinceMs` và dùng `startblock` (hoặc lọc `timestamp >= sinceMs` kèm phân trang cho tới khi vượt mốc). Tối thiểu: lọc client-side + tăng offset và log cảnh báo khi trang đầy mà transfer cũ nhất vẫn > `sinceMs`.

#### H2. IPN webhook fail-open khi thiếu secret

- **File/function**: `src/payment/vietqr.js:120-123` và `:142-145` `verifyIPNWebhook`
- **Mô tả**: không cấu hình `SEPAY_API_KEY` / `IPN_SECRET_TOKEN` → `console.warn` rồi `return true`.
- **Vì sao là vấn đề**: bất kỳ ai POST `/webhook/ipn` với `amount` + `content` đúng format là chuyển được order sang PAID và nhận hàng miễn phí. Một lần deploy quên biến môi trường = shop mở toang. Cấu hình sai phải fail-closed.
- **Severity**: **High** (không thuộc rail USDT nhưng cùng cửa xác nhận thanh toán, nằm trong phạm vi audit bảo mật đã yêu cầu)
- **Giải pháp**: thiếu secret → `throw`. Nếu cần chế độ dev, bắt buộc opt-in tường minh `ALLOW_UNSIGNED_IPN=true` và log ở mức ERROR.

#### H3. `/webhook/ipn` không có chống replay

- **File/function**: `src/server.js:656` (nhánh MBBank ~664-763, nhánh generic ~765-892)
- **Mô tả**: chỉ so sánh token tĩnh trong header. Không nonce, không timestamp, không HMAC theo body.
- **Vì sao là vấn đề**: token lộ (log, proxy, ảnh chụp .env) → attacker replay lại đúng payload cũ. Idempotency dựa vào `paymentRef` + gate `PENDING→PAID` chặn được việc trả 2 lần cho **cùng** một order, nhưng không chặn dùng lại một `transactionId` cho đơn khác nếu nội dung khớp.
- **Severity**: **High**
- **Giải pháp**: HMAC-SHA256 trên raw body + header timestamp, cửa sổ ±5 phút, và lưu `transactionId` đã dùng (unique index) để từ chối tái sử dụng.

#### H4. `deliverOrder` nhận object order đã lỗi thời từ poller

- **File/function**: `crypto-poller.js:151-155`
- **Mô tả**: `deliverOrder({ order: { ...order, status: "PAID", paymentRef: eventKey } })` — object lấy từ `getPendingCryptoOrders()` ở đầu tick, có thể đã cũ vài giây. Đường IPN thì re-fetch (`server.js:753`, `:882`).
- **Vì sao là vấn đề**: `deliverOrder` đọc `order.productId`, `order.userId`, `order.quantity`. Nếu order bị admin sửa (đổi số lượng, gán lại user) giữa lúc đó, giao hàng theo dữ liệu cũ. Gate `PAID→DELIVERING` bảo vệ status nhưng không bảo vệ payload.
- **Severity**: **High**
- **Giải pháp**: re-fetch bằng `findUnique` sau khi claim thành công, giống đường IPN. Chuẩn hóa một helper `markPaidAndDeliver(orderId, eventKey, ctx)` dùng chung cho cả 3 điểm gọi.

#### H5. `formatUsdPrimary` đọc tỷ giá **live** lúc render → khách thấy số tiền khác lúc đặt

- **File/function**: `src/money-display.js:26` `formatUsdPrimary(..., { rate = getUsdVndRate() })`
- **Mô tả**: default parameter lấy tỷ giá hiện tại. Chỉ 3 điểm gọi truyền tỷ giá đã chốt (`bot.js:2254`, `messages.js:455`, `:482` — dùng `order.cryptoUsdVndRate`). Các điểm khác (danh sách sản phẩm, lịch sử, admin) dùng tỷ giá mới.
- **Vì sao là vấn đề**: cùng một đơn hiển thị $9.98 ở màn A và $10.12 ở màn B → khách nghi ngờ, mở ticket. `order.cryptoUsdVndRate` là **nullable** nên `{ rate: order.cryptoUsdVndRate }` với đơn cũ (null) sẽ rơi về default live — im lặng.
- **Severity**: **High** (tin cậy/UX, không mất tiền)
- **Giải pháp**: bỏ default; buộc caller truyền `rate` tường minh. Với đơn cũ thiếu `cryptoUsdVndRate`, fallback về `getConfiguredUsdVndRate()` (tĩnh) chứ không phải tỷ giá live, và tập trung logic đó vào một hàm `orderDisplayRate(order)`.

#### H6. Status `"EXPIRED"` nằm ngoài `TxStatus`

- **File/function**: `crypto-poller.js:120-123` `expireCryptoDeposits`; `wallet.js:112-117` `createDeposit`; enum tại `wallet.js` `TxStatus = {PENDING, SUCCESS, FAILED}`; schema `prisma/schema.prisma:290` comment `// PENDING, SUCCESS, FAILED`
- **Mô tả**: hai chỗ ghi chuỗi literal `"EXPIRED"` không có trong enum, không có trong comment schema.
- **Vì sao là vấn đề**: mọi code lọc theo enum (thống kê ví, lịch sử giao dịch, báo cáo) sẽ **không thấy** các bản ghi EXPIRED — không thuộc SUCCESS cũng không thuộc FAILED, rơi vào vùng mù. Đây là loại bug lặng lẽ nhất: số liệu sai mà không có exception.
- **Severity**: **High**
- **Giải pháp**: thêm `EXPIRED: "EXPIRED"` vào `TxStatus`, cập nhật comment schema, thay 2 literal, rà lại mọi nơi liệt kê status ví để xử lý EXPIRED tường minh. Không cần migration (MongoDB, field là String).

---

### 🟡 MEDIUM

#### M1. `expiresAt` không được lưu → hạn hiển thị và hạn thực tế lệch nhau

- **File/function**: `crypto.js:345,380` (`expiresAt` chỉ nằm trong object checkout); `crypto.js:323` `isCryptoOrderExpired(createdAt)`
- **Mô tả**: hạn thực tế = `createdAt + CRYPTO_EXPIRE_MINUTES hiện hành`. Object checkout thì tính `now + expireMinutes`. Mở lại `SHOW_CRYPTO_PAY` sau 8 phút → tin nhắn nói "còn 10 phút", poller hủy sau 2 phút. Đổi `CRYPTO_EXPIRE_MINUTES` trong admin làm dịch hạn của **mọi** đơn PENDING đang chạy.
- **Severity**: Medium
- **Giải pháp**: lưu `expiresAt` vào Order/WalletTransaction lúc tạo checkout, dùng nó cho cả hiển thị và kiểm tra hết hạn (fallback `createdAt + minutes` cho bản ghi cũ).

#### M2. Nút [Kiểm tra] không debounce → mỗi lần bấm là một lời gọi explorer, chờ tới 30s

- **File/function**: `bot.js:4053` `ORDER_CRYPTO_CHECK`, `bot.js:3918` `DEPOSIT_CRYPTO_CHECK`; `isSpam` định nghĩa `bot.js:178-184` **không được gọi ở đâu** (dead code)
- **Mô tả**: chỉ có rate limit toàn cục 30 req/phút/user (`bot.js:406`). Khách sốt ruột bấm liên tục → 30 lần gọi TronGrid/BscScan mỗi phút mỗi người.
- **Vì sao là vấn đề**: cạn quota API (TronGrid free tier), làm chậm cả poller nền, mỗi request giữ event loop tới 30s.
- **Severity**: Medium
- **Giải pháp**: dùng `isSpam(chatId, 15000)` cho riêng 2 action này (hoặc xóa `isSpam` nếu quyết định không dùng — không để dead code). Thêm cache kết quả fetch theo network trong ~10s dùng chung giữa poller và nút kiểm tra.

#### M3. Ghi đè `paymentRef` làm mất dữ liệu checkout

- **File/function**: `crypto-poller.js:134-140`, `:223-226`; `crypto.js:448` `buildCryptoPaymentRef`
- **Mô tả**: `paymentRef` ban đầu chứa `CRYPTO:{network,amountToken,amountUsd,address,token,rate}`. Khi PAID, bị thay bằng `CRYPTO:<network>:<txid>`.
- **Vì sao là vấn đề**: một field mang **hai nghĩa khác nhau theo thời gian** (bản kê checkout → khóa idempotency). Đối soát về sau chỉ còn dựa vào các column `crypto*` — may là chúng có ghi, nhưng `amountUsd` thì mất hẳn. `parseCryptoPaymentRef` trên đơn đã PAID trả `null` một cách im lặng (`crypto.js:440` bắt cả JSON error).
- **Severity**: Medium
- **Giải pháp**: tách 2 field: `cryptoQuote` (JSON checkout) và `paymentRef` (chỉ khóa idempotency). MongoDB không cần migration; code đọc fallback `paymentRef` cho bản ghi cũ.

#### M4. Side effect sau giao hàng bị nuốt lỗi hoàn toàn

- **File/function**: `src/delivery.js:352-358` `Promise.allSettled([processReferralCommission, addSpending, checkStock, notifyOrderChannel, notifyAdmins])`
- **Mô tả**: không kiểm tra kết quả, không log rejected.
- **Vì sao là vấn đề**: hoa hồng referral không trả, `totalSpent` không cộng → **không nâng VIP**, cảnh báo tồn kho không chạy — tất cả im lặng. Đây là tiền thật của người giới thiệu.
- **Severity**: Medium (nghiêng High nếu referral đang hoạt động)
- **Giải pháp**: duyệt kết quả, `sendLog("ERROR", ...)` cho từng rejected kèm orderId + tên side effect. Với referral/`addSpending` nên có bảng retry riêng thay vì fire-and-forget.

#### M5. Hai nhánh IPN gần như trùng lặp

- **File/function**: `src/server.js` ~664-763 (MBBank) và ~765-892 (generic)
- **Mô tả**: cùng trình tự: hủy đơn hết hạn + `releaseCoupon` → claim `PENDING→PAID` → `sendLog` → `clearPaymentMessages` → re-fetch → `deliverOrder`. Khoảng 130 dòng lặp lại.
- **Vì sao là vấn đề**: sửa bug ở một nhánh dễ quên nhánh kia — đúng loại lỗi khó phát hiện nhất trên đường thanh toán.
- **Severity**: Medium
- **Giải pháp**: gộp thành `confirmBankPayment(items, provider)` chung; nhánh riêng chỉ còn phần parse.

#### M6. `confirmOrderByCryptoScan` không giao hàng, phụ thuộc caller

- **File/function**: `crypto-poller.js:200-239`; caller `bot.js:4079` `scheduleOrderDelivery`
- **Mô tả**: hàm chuyển order sang PAID rồi trả về; giao hàng do bot.js lo. Trong khi đó `processTransfer` (cùng file) tự gọi `deliverOrder`.
- **Vì sao là vấn đề**: hai hàm cùng module, cùng nhiệm vụ "xác nhận thanh toán", hợp đồng khác nhau → caller mới rất dễ quên deliver, order đứng ở PAID. `delivery-recovery` (60s) vớt được nhưng đó là lưới an toàn, không phải thiết kế.
- **Severity**: Medium
- **Giải pháp**: cả hai đường cùng gọi một `markPaidAndDeliver`.

#### M7. `adminAuth` so sánh token không timing-safe

- **File/function**: `src/middleware/adminAuth.js:2-3`
- **Mô tả**: `req.headers["x-admin-token"] !== process.env.ADMIN_TOKEN`.
- **Severity**: Medium
- **Giải pháp**: `crypto.timingSafeEqual` trên buffer cùng độ dài (hash cả hai phía trước khi so sánh để tránh lộ độ dài).

#### M8. Tham số rpm/tokens/days từ `callback_data` không whitelist

- **File/function**: `bot.js:1743-1761` (`CK_RPM`/`CK_TOK`/`CK_DAYS`) → `src/aiplus.js:135-147` `interp`, `:156-164` `computeBasePrice`
- **Mô tả**: giá trị số lấy trực tiếp từ callback_data, không đối chiếu với bảng `presets`. `interp` **ngoại suy** với input ngoài miền.
- **Vì sao là vấn đề**: `callback_data` do client gửi, có thể giả mạo. Ngoại suy có thể cho ra giá rất thấp (hoặc âm) cho cấu hình đắt.
- **Severity**: Medium
- **Giải pháp**: chỉ nhận giá trị có trong `presets`; `interp` clamp về `[min, max]` của bảng thay vì ngoại suy.

---

### 🟢 LOW — dead code, dư thừa, đơn giản hóa

| # | File/function | Vấn đề | Đề xuất |
|---|---|---|---|
| L1 | `crypto.js:334` `cryptoQrUrl(address)` | `return address;` — indirection vô nghĩa, 4 điểm gọi | Xóa, dùng `config.address` trực tiếp |
| L2 | `money-display.js:19` `formatUsdAmount` | `value >= 100 ? 2 : value >= 1 ? 2 : 4` — 2 nhánh đầu giống nhau, nhánh `>= 100` là dead | Rút còn `value >= 1 ? 2 : 4` |
| L3 | `bot.js:178-184` `isSpam` | Định nghĩa, không dùng ở đâu | Dùng cho M2 hoặc xóa |
| L4 | `crypto.js:508-510` vs `:541-547` | `cryptoTransferMatchesOrder` / `...WalletTransaction` giống nhau từng dòng; `getOrderExpectedCrypto` / `getWalletTransactionExpectedCrypto` cũng vậy | Gộp thành `matchesExpected(transfer, expected)` + 2 extractor mỏng |
| L5 | `crypto-poller.js:127-198` | `processTransfer` / `processDepositTransfer` cùng khuôn claim→cache→clearMessages→log | Gộp khuôn, khác biệt để ở callback |
| L6 | `src/payment/provider.js` (38 dòng) | Abstraction 3 hàm chỉ forward sang `vietqr.js`, 1 nơi import; comment nói "VietQR Only" trong khi hệ thống đã có crypto | Hoặc bỏ, hoặc mở rộng thật thành provider registry (khuyến nghị: bỏ — đơn giản hơn) |
| L7 | `crypto.js:338-366` + `:369-402` | Hai builder checkout trùng ~80% | Gộp, tham số hóa `paymentCode` prefix |
| L8 | `crypto.js` `getUsdVndRate` gọi 2 lần trong 1 checkout (`vndToUniqueUsdt` + field `usdVndRate`) | Có thể lệch nếu cache refresh chen giữa → tỷ giá hiển thị ≠ tỷ giá dùng tính số tiền | Đọc 1 lần, truyền xuống |
| L9 | `GET /api/shop/coupon/:code` | Tin `req.query.amount` để tính preview giảm giá | Chỉ hiển thị; giá thật đã tính lại server-side ở `/purchase`. Nên bỏ tham số amount hoặc lấy từ giỏ server |
| L10 | `bot.js:3144` và `:3238` | `cryptoUsdVndRate` ghi 2 lần cho đơn crypto (lần 2 ghi đè) | Chỉ ghi ở một chỗ |
| L11 | Offset USDT (tối đa 0.009) trong nạp ví | Khách gửi thừa, VND cộng theo `tx.amount` — không hụt của shop nhưng không nêu rõ | Nêu trong tin nhắn hoặc bỏ qua (chấp nhận được) |

### Trường DB — kết quả kiểm tra "field không còn dùng"

| Field | Được đọc ở đâu | Kết luận |
|---|---|---|
| `cryptoNetwork`, `cryptoAmount`, `cryptoAddress` | `crypto.js:540-552` | ✅ Dùng |
| `cryptoToken` | **chỉ có write** (`bot.js:3237`, `:3773`) | ⚠️ Write-only — luôn là "USDT". Giữ để đối soát hoặc bỏ |
| `cryptoUsdVndRate` | `bot.js:2254`, `messages.js:455,482` | ✅ Dùng (xem H5) |
| `displayCurrency`, `displayUnitPrice` | `bot.js:3068-3069` (`ensureCheckoutQuoteIsCurrent`) | ✅ Dùng |
| `displayFinalUsd` | `bot.js` chỉ write; `user-api.js:132` tính lại biến cục bộ trùng tên, **không đọc field** | ⚠️ Write-only |

### Đã kiểm tra và **không** phải vấn đề

- Giá được tính lại server-side từ DB ở cả `/purchase` (`user-api.js`) và luồng bot — không tin số tiền từ client trên đường thu tiền thật.
- Cấp `StockItem` an toàn với race: đọc candidate → `updateMany({id:{in}, isSold:false})` → đếm lại sau claim (`delivery.js:497-528`).
- `delivery-recovery.js` không phân biệt payment method → phủ cả đơn USDT.
- Đường USDT và đường ngân hàng cùng đi qua `deliverOrder` → **không thiếu side effect** nào ở đường USDT.
- `confirmDeposit` revert về PENDING **và xóa `paymentRef`** khi credit lỗi → poller thử lại được, không kẹt.
- Cache `_processedKeyCache` có sweeper `setInterval` → không leak.
- `cancelExpiredOrders` chỉ `releaseCoupon` khi `count > 0` → không nhả oan suất coupon của đơn vừa được thanh toán song song.
- Tolerance `min(configured, 0.00000049)` chặn được việc 2 checkout cách nhau 0.000001 khớp cùng transfer.

---

## 3. Đánh giá kiến trúc

**Điểm mạnh** — tác giả rõ ràng đã hiểu rất kỹ giới hạn của MongoDB adapter: mọi chuyển trạng thái quan trọng đều là compare-and-swap một document (`updateMany` với điều kiện status), không dựa vào `$transaction` giả. Idempotency 3 lớp (cache in-memory → `batchAlreadyProcessed` → gate status DB) là thiết kế đúng. Có lưới an toàn (`delivery-recovery`) và đường bù trừ (revert credit) — dấu hiệu của người đã bị bug production dạy.

**Vi phạm chính**

1. **SRP** — `crypto.js` (610 dòng) gánh 5 trách nhiệm: config network, tỷ giá FX, sinh số tiền, HTTP client tới explorer, format tin nhắn Telegram. Nên tách: `crypto/networks.js`, `fx-rate.js`, `crypto/explorer.js`, `crypto/messages.js`.
2. **Rò rỉ tầng** — `crypto-poller.js` (tầng ứng dụng) trực tiếp gọi `telegram.sendMessage` và tự soạn HTML tiếng Việt (`:177-184`). Domain lẫn với presentation. Poller nên phát event/trả kết quả; tầng UI lo tin nhắn.
3. **DRY** — 4 cặp trùng lặp đã nêu (L4, L5, L7, M5). Mỗi cặp là một cơ hội để bản sửa lỗi chỉ áp một nửa.
4. **`bot.js` 4285 dòng** — chứa cả tạo đơn, checkout, kiểm tra thanh toán, nạp ví, pricing aiplus. Business logic thanh toán nên ra khỏi handler; handler chỉ parse input + render.
5. **Không có tầng chống hồi quy cho đường tiền** — 10 file test / 459 dòng, phủ `payment-amounts`, `refund-reversal`, `delivery-recovery`. **Không có test nào cho `vndToUniqueUsdt` (tính unique), matcher, hay idempotency của poller** — đúng những chỗ chứa C1, C2, H1.

---

## 4. Kế hoạch sửa (Refactoring Plan)

Nguyên tắc: ưu tiên đúng đắn và đơn giản; **không** đụng vào phần đang chạy tốt (compare-and-swap, delivery-recovery, cấp stock).

### Giai đoạn 0 — Lưới an toàn trước khi sửa (không đổi hành vi)

| Bước | Việc | File |
|---|---|---|
| 0.1 | Test cho `vndToUniqueUsdt`: xác định trùng số tiền, tính ổn định khi tỷ giá đổi | `test/crypto-unique-amount.test.js` (mới) |
| 0.2 | Test cho matcher: khớp/không khớp theo network, địa chỉ, tolerance, timestamp | `test/crypto-matcher.test.js` (mới) |
| 0.3 | Test idempotency poller: cùng txid 2 lần → chỉ credit 1 lần | `test/crypto-poller-idempotency.test.js` (mới) |

Không có 0.1–0.3 thì không nên chạm C1/C2. Đây là ba test bắt đúng ba bug nặng nhất.

### Giai đoạn 1 — Chặn mất tiền (Critical/High, độc lập nhau)

| Bước | Việc | Rủi ro | Tương thích ngược |
|---|---|---|---|
| 1.1 | **C1**: tách `restoreCryptoCheckout(order)`; `SHOW_CRYPTO_PAY` dùng nó; chỉ đường sinh mới được `order.update` | Thấp | Đơn cũ thiếu `cryptoAmount` → fallback sinh mới (như hiện tại) |
| 1.2 | **H6**: thêm `EXPIRED` vào `TxStatus`, thay 2 literal, cập nhật comment schema | Rất thấp | Không migration (String field) |
| 1.3 | **H1**: `fetchBep20Transfers` tôn trọng `sinceMs` (`startblock`/lọc + cảnh báo khi trang đầy) | Trung bình — đụng API bên ngoài | Không đổi shape trả về |
| 1.4 | **H2**: IPN thiếu secret → throw; cờ `ALLOW_UNSIGNED_IPN` cho dev | **Cao — có thể làm chết luồng thanh toán ngân hàng nếu prod đang thiếu biến** | ⚠️ **Xác minh `IPN_SECRET_TOKEN`/`SEPAY_API_KEY` đã set trên prod TRƯỚC khi deploy** |
| 1.5 | **H4**: re-fetch order sau claim trong poller | Rất thấp | Không |
| 1.6 | **C2**: cấp offset unique có kiểm tra DB + ghi nhận xung đột 1 lần + notify admin | Trung bình — đổi cách sinh số tiền | Đơn PENDING cũ vẫn khớp bằng `cryptoAmount` đã lưu |

Thứ tự trong giai đoạn 1 là **có chủ đích**: 1.1 và 1.2 rẻ và an toàn, làm trước để lấy đà. 1.4 tách riêng và cần kiểm tra prod. 1.6 để cuối vì nó cần các test ở 0.1 đã xanh.

### Giai đoạn 2 — Tin cậy và nhất quán (High/Medium)

| Bước | Việc | Rủi ro |
|---|---|---|
| 2.1 | **H5**: bỏ default `rate`, thêm `orderDisplayRate(order)`, sửa mọi caller | Trung bình — nhiều điểm gọi, dễ sót |
| 2.2 | **M1**: lưu `expiresAt`, dùng cho hiển thị + kiểm tra hết hạn | Thấp (fallback `createdAt`) |
| 2.3 | **M4**: log rejected trong `Promise.allSettled` | Rất thấp |
| 2.4 | **M2**: debounce nút [Kiểm tra] bằng `isSpam` + cache fetch 10s | Thấp |
| 2.5 | **M8**: whitelist rpm/tokens/days theo `presets`, clamp `interp` | Thấp |
| 2.6 | **M7**: `timingSafeEqual` cho adminAuth | Rất thấp |
| 2.7 | **H3**: HMAC + timestamp + unique `transactionId` cho IPN | Cao — cần phối hợp với nhà cung cấp webhook; **có thể phải hoãn** |

2.7 phụ thuộc việc SePay/Casso có hỗ trợ HMAC không. Nếu không, phần khả thi là unique index trên `transactionId` — làm phần đó, ghi nhận phần còn lại là hạn chế đã biết.

### Giai đoạn 3 — Đơn giản hóa (Low, thuần refactor, không đổi hành vi)

L1, L2, L3, L8, L10 (xóa dead code / gộp lời gọi trùng) → L4, L5, L7 (gộp cặp trùng lặp) → M5 (gộp nhánh IPN) → M3 (tách `cryptoQuote`/`paymentRef`) → L6 (bỏ `provider.js`).

Chỉ chạy giai đoạn 3 khi giai đoạn 1–2 đã ổn định trên production ít nhất vài ngày. Gộp code trên đường tiền trước khi bug đã sửa xong là tự tạo rủi ro.

### Chiến lược kiểm thử

**Unit (`node --test`, nối tiếp 10 file hiện có)**
- Sinh số tiền unique: không trùng với tập PENDING; ổn định khi tỷ giá đổi (khóa C1); trùng hash được xử lý (khóa C2).
- Matcher: bảng case network/địa chỉ/tolerance/timestamp.
- `TxStatus.EXPIRED` xuất hiện trong mọi hàm liệt kê status ví.
- Hiển thị: `formatUsdPrimary` với `rate` null → dùng tỷ giá tĩnh, không phải live.
- `verifyIPNWebhook`: thiếu secret → throw (đảo ngược hành vi hiện tại).

**Integration (prisma mock / DB test)**
- Cùng txid vào poller 2 lần → 1 lần credit.
- Order PENDING → xem lại checkout 3 lần → `cryptoAmount` không đổi.
- Hai order cùng `finalAmount` → `cryptoAmount` khác nhau.
- Deposit hết hạn → EXPIRED và không credit về sau.

**Manual trên staging (bắt buộc trước khi lên prod)**
1. Mua bằng TRC20, chuyển đúng số tiền → poller xác nhận + giao hàng.
2. Mua bằng BEP20, tạo 5 transfer nhiễu vào ví trước khi trả → vẫn khớp (khóa H1).
3. Mở lại màn thanh toán 3 lần rồi mới chuyển tiền → vẫn khớp (khóa C1).
4. Hai đơn cùng giá đồng thời → hai số tiền khác nhau, cả hai xác nhận được (khóa C2).
5. Nút [Kiểm tra] trên đơn chưa trả → thông báo đúng, có debounce.
6. Để đơn hết hạn → CANCELED + coupon được nhả.
7. Nạp ví USDT → SUCCESS, số dư đúng, thông báo đúng.
8. IPN không có signature → 401/500, không có đơn nào chuyển PAID.

**Quan sát production sau deploy**
- Đếm log `Crypto payment ambiguous` (phải về 0 sau 1.6).
- Đếm đơn CANCELED có `paymentMethod` crypto (nghi ngờ có tiền vào mà không khớp).
- Đếm order đứng ở PAID > 5 phút (delivery-recovery không vớt được).
- Số transaction ví ở `EXPIRED` (đối chiếu với trước khi sửa).

---

## 5. Tóm tắt

| Mức | Số lượng | Nội dung |
|---|---|---|
| Critical | 2 | C1 ghi đè số tiền khi xem lại checkout; C2 trùng số tiền treo thanh toán |
| High | 6 | H1 BEP20 bỏ `sinceMs`; H2 IPN fail-open; H3 không chống replay; H4 order lỗi thời; H5 tỷ giá live lúc render; H6 status ngoài enum |
| Medium | 8 | M1…M8 |
| Low | 11 | dead code, trùng lặp, 2 field write-only |

Hai lỗi Critical đều dẫn tới **khách chuyển tiền mà không nhận hàng, không có cảnh báo**. Đó là nơi nên bắt đầu.

---

## 6. Phát hiện thêm khi làm Phase 0 (không có trong báo cáo gốc)

**T1 — `npm test` chạy song song làm crash toàn bộ suite (High, đã sửa)**
`package.json` dùng `node --test test/*.test.js`. Node spawn một process cho mỗi
file test; mỗi process load `bson` (qua Prisma/mongodb) và cấp buffer lớn lúc
import, nên trên Node v24 suite chết với `JavaScript heap out of memory` và
`RangeError: Array buffer allocation failed` (`node_modules/bson/lib/bson.cjs:253`).
Từng file chạy riêng đều pass — đây là lỗi harness, không phải lỗi code.
*Sửa:* thêm `--test-concurrency=1`. Không đổi dependency nào.

**T2 — `crypto-poller.js` giữ event loop sống mãi (Medium, đã sửa)**
Sweeper `setInterval` ở scope module không `unref()`, nên chỉ cần `import`
module là process không bao giờ thoát (đo được: `exit=124` do timeout).
Ảnh hưởng thật: mọi script/test import module này bị treo; ngoài ra một
`stop()` của `startCryptoPolling` cũng không dừng được timer này.
*Sửa:* `_cacheSweeper.unref?.()`.

**Phase 0 đã xong** — 3 file test, 19 assertion, `npm test` 53/53 pass:
- `test/crypto-unique-amount.test.js` — ghim C1 (rate đổi → số tiền đổi, lệch xa hơn tolerance) và tiền đề C2 (9000 slot → có collision).
- `test/crypto-matcher.test.js` — bảng match network/address/tolerance/timestamp + fallback `paymentRef`.
- `test/crypto-poller-idempotency.test.js` — cùng txid hai lần chỉ credit một lần; chặn user khác; C2 không bao giờ credit nhầm.

Test 0.3 cần cờ `--experimental-test-module-mocks` (đã thêm vào script `test`)
vì `crypto-poller.js` không nhận dependency injection. Nếu sau này refactor
poller theo hướng nhận `{ prisma, fetchTransfers }` như `delivery-recovery.js`
thì bỏ được cờ này.

---

## 7. Kết quả thực hiện Giai đoạn 1 và 2

Toàn bộ giai đoạn 1 và 2 đã xong. `npm test`: 53 (sau Phase 0) → **122 pass, 0 fail**.
Chưa push lên remote.

### Giai đoạn 1 — chặn mất tiền

| Bước | Commit | Kết quả |
|---|---|---|
| 1.1 C1 · 1.2 H6 · 1.3 H1 | `30ab7af` | Không ghi đè số tiền USDT đã chốt; BEP20 tôn trọng `sinceMs` nên không bỏ sót giao dịch; `EXPIRED` vào `TxStatus` |
| 1.4 H2 | `e5c653a` | IPN thiếu secret → từ chối thay vì bỏ qua; cờ `ALLOW_UNSIGNED_IPN` cho dev |
| 1.5 H4 · 1.6 C2 | `b6f7e5a` | Cấp offset unique có kiểm tra DB; giao hàng theo bản ghi đơn đã re-fetch sau claim |

### Giai đoạn 2 — tin cậy và nhất quán

| Bước | Commit | Kết quả |
|---|---|---|
| 2.1 H5 | `c791c80` | Bỏ default `rate`; hiển thị theo tỷ giá đã chốt của đơn, không đọc tỷ giá live lúc render |
| 2.2 M1 | `9e296fe` | `expiresAt` lưu vào DB; đổi `CRYPTO_EXPIRE_MINUTES` không dịch hạn đơn đang chờ |
| 2.3 M4 | `e7ac837` | Đọc lại kết quả `Promise.allSettled` sau giao hàng; hoa hồng/VIP/thông báo rớt được log kèm tên task + orderId |
| 2.4 M2 | `6b48dfd` | Debounce 15s nút [Kiểm tra] USDT; cache fetch blockchain 10s theo network |
| 2.5 M8 | `7398970` | Chặn cấu hình Claude Key ngoài miền aiplus công bố |
| 2.6 M7 | `b0afb22` | Mọi so sánh bí mật qua `secretEquals` (SHA-256 + `timingSafeEqual`) |
| 2.7 H3 | `53aec2c` | Chống xử lý lại giao dịch ở webhook IPN |

### Hai chỗ làm khác kế hoạch (có chủ đích)

**2.5 (M8) — kiểm theo `options.range`, không theo `presets`.**
Kế hoạch ghi "whitelist rpm/tokens/days theo `presets`". Nhưng UI có nút
"Nhập số khác" cho phép khách nhập giá trị ngoài preset; whitelist theo preset
là giết luôn tính năng đó. Thực tế kiểm theo `options.range` mà aiplus công bố —
vẫn chặn được giá trị bịa ra từ callback data sửa tay. `interp` để nguyên vì nó
đã clamp sẵn ở hai đầu (đã ghim bằng test).

**2.7 (H3) — lớp chống replay dùng chung, KHÔNG thêm unique index.**
Kế hoạch ghi "phần khả thi là unique index trên `transactionId` — làm phần đó".
Sai: `src/admin.js` ghi `paymentRef: "MANUAL:<adminId>"` khi admin xác nhận tay,
giá trị này lặp lại hợp lệ qua nhiều lần xác nhận. Unique index vừa không tạo
được trên dữ liệu sẵn có, vừa làm hỏng chức năng xác nhận tay. Thay vào đó tách
`src/lib/event-idempotency.js` để bank-poller và webhook IPN dùng CHUNG một cache
+ một đường tra DB. Sửa kèm một lỗi tiềm ẩn: IPN trước đây ghi `transactionId`
thô làm `paymentRef`, ngân hàng không trả `transactionId` thì field là `null` và
`batchAlreadyProcessed` không bao giờ khớp — nay ghi `eventKey` (có fallback
`amount:content:when`) giống poller.

Phần HMAC + timestamp của H3 **hoãn**: cần nhà cung cấp webhook (SePay/Casso) ký
request, không làm một phía được. Ghi nhận là hạn chế đã biết.

### Cần xác minh trước khi deploy

Từ 1.4 (H2): production phải có `IPN_SECRET_TOKEN` (hoặc
`THUEAPIBANK_WEBHOOK_SIGNATURE`), và `SEPAY_API_KEY`/`SEPAY_SECRET_KEY` nếu dùng
webhook SePay. Thiếu thì `/webhook/ipn` từ chối mọi request và auto-confirm
chuyển khoản ngân hàng ngừng hoạt động.
