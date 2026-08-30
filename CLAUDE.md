# CLAUDE.md — Telegram Shop Bot

## Tổng quan dự án

Bot bán hàng Telegram viết bằng Node.js (Telegraf + Express + Prisma). Hỗ trợ thanh toán VietQR, ví nội bộ, tự động xác nhận giao dịch ngân hàng MB Bank, hệ thống VIP 4 bậc, giới thiệu referral, coupon, và nhiều tính năng quản lý admin.

## Tech Stack

- **Runtime**: Node.js 20
- **Bot**: Telegraf 4.16.3
- **Server**: Express 4.21.1
- **ORM**: Prisma 5.22.0
- **DB chính**: PostgreSQL (`DATABASE_URL`)
- **DB dự phòng**: MongoDB (`MONGODB_URI`)
- **Layer tương thích**: `src/lib/prisma.js` — wrap Prisma để hỗ trợ cả Mongo và PG

## Cấu trúc thư mục

```
src/
  bot.js           # Logic bot chính, handler lệnh, quản lý state
  admin.js         # Panel admin: CRUD sản phẩm, thống kê, quản lý user
  server.js        # Express server, webhook, API catalog
  wallet.js        # Hệ thống ví nội bộ
  delivery.js      # Giao hàng (STOCK_LINES / TEXT / FILE)
  category.js      # Danh mục sản phẩm
  bank-poller.js   # Tự động kiểm tra giao dịch MB Bank mỗi 15s
  bank-history.js  # Gọi API MB Bank lấy lịch sử giao dịch
  vip.js           # Hệ thống VIP 4 bậc
  coupon.js        # Mã giảm giá
  giftcode.js      # Giftcode — cộng ví hoặc cấp API key miễn phí
  gpt2api.js       # Client GPT2API Admin Public API (tạo key sk-*)
  apikey-pricing.js # Hàm thuần: quota random có trọng số, parser token, tính giá
  apikey-store.js  # Kho key đã cấp cho khách (/mykey)
  referral.js      # Hệ thống giới thiệu + hoa hồng
  audit.js         # Log hành động admin
  broadcast.js     # Gửi tin nhắn hàng loạt
  stats.js         # Thống kê doanh thu
  backup.js        # Xuất/backup dữ liệu
  export.js        # Xuất CSV
  ratelimit.js     # Chống spam (800ms giữa các lần bấm)
  inventory.js     # Cảnh báo tồn kho thấp, auto-disable
  i18n/            # Đa ngôn ngữ (vi / en)
  lib/
    prisma.js      # Compatibility layer PG + Mongo
    db.js          # Kết nối DB
    logger.js      # Log về Telegram channel
  bot-ui/
    format.js      # Format tiền tệ, emoji, text
    messages.js    # Template tin nhắn
    keyboards.js   # Inline keyboard / reply keyboard
    safe.js        # Safe editMessageText / editMessageReplyMarkup
  payment/
    vietqr.js      # Tạo QR chuyển khoản VietQR
    provider.js    # Abstraction layer thanh toán
prisma/
  schema.prisma    # Schema database đầy đủ
  migrations/      # 3 phiên bản migration (init → v2 → v3)
public/shop/       # Web storefront (HTML/CSS/JS)
scripts/           # Script maintenance
```

## Models quan trọng (Prisma)

| Model | Mô tả |
|-------|-------|
| `User` | Người dùng Telegram, có `vipLevel`, `totalSpent`, `referralCode` |
| `Product` | Sản phẩm, `deliveryMode` = STOCK_LINES / TEXT / FILE |
| `StockItem` | Dòng tài khoản/mã, gắn với Product, `isSold` khi đã bán |
| `Order` | Đơn hàng, status: PENDING → PAID → DELIVERED / CANCELED |
| `Wallet` | Ví nội bộ per user |
| `WalletTransaction` | Lịch sử giao dịch ví (DEPOSIT/PURCHASE/REFUND/ADMIN_ADD/ADMIN_DEDUCT/GIFTCODE) |
| `Coupon` | Mã giảm giá, có `maxUses`, `expiresAt`, `vipOnly` |
| `GiftCode` | Mã quà tặng. `rewardType`=WALLET (cộng ví) hoặc APIKEY (cấp key free) |
| `GiftCodeRedemption` | Lịch sử đổi giftcode; `redeemKey` unique chống đổi lại |
| `IssuedApiKey` | Key sk-* đã cấp cho khách (từ giftcode hoặc mua) — nguồn cho `/mykey` |
| `Referral` | Quan hệ giới thiệu + hoa hồng |
| `VipLevel` | Config 4 bậc VIP |
| `AuditLog` | Log hành động admin |
| `Setting` | Key-value config |

## Luồng thanh toán

```
User chọn hàng
  → Tạo Order (PENDING)
  → Chọn phương thức:
      [VietQR]  → Hiện QR → Chuyển khoản ngân hàng
                   → bank-poller.js match giao dịch → xác nhận
      [Wallet]  → Trừ số dư ví ngay lập tức
  → Order PAID → delivery.js giao hàng → Order DELIVERED
  → Tính hoa hồng referral (nếu có)
  → Cập nhật totalSpent → kiểm tra nâng VIP
```

## Hệ thống bank-poller

- Chạy mỗi 15s, gọi `bank-history.js` để lấy lịch sử MB Bank
- Match giao dịch theo: số tiền + nội dung (chứa order ID hoặc telegram ID)
- Hai loại: **nạp ví** (deposit) và **thanh toán đơn hàng**
- Order hết hạn sau 10 phút (poller tự hủy)

## Quản lý state bot

State lưu trong memory (Map), không persist qua restart:

```js
// bot.js
const chatState = new Map(); // chatId → { lastMenuId, tempMessages, lastActionAt }
```

- `lastMenuId`: ID tin nhắn menu cũ để xóa khi chuyển màn
- `tempMessages`: Tin nhắn tạm, tự xóa sau TTL
- `lastActionAt`: Dùng cho rate limiting

## Delivery modes

| Mode | Cách hoạt động |
|------|---------------|
| `STOCK_LINES` | Lấy `StockItem` chưa bán, đánh dấu `isSold`, gửi file/text chứa thông tin |
| `TEXT` | Gửi `product.payload` trực tiếp |
| `FILE` | Gửi file từ đường dẫn trong `product.payload` |

## Các biến ENV quan trọng

```env
BOT_TOKEN / TELEGRAM_BOT_TOKEN   # Token bot Telegram
ADMIN_IDS                         # Danh sách admin ID, phân cách bởi dấu phẩy
DATABASE_URL                      # PostgreSQL connection string
MONGODB_URI / MONGODB_DB          # MongoDB (dự phòng)
BANK_CODE / BANK_ACCOUNT          # Thông tin tài khoản ngân hàng
MBBANK_API_TOKEN                  # Token API MB Bank
MBBANK_HISTORY_BASE               # Base URL API MB Bank
IPN_SECRET_TOKEN                  # Xác thực webhook IPN
SHOP_NAME                         # Tên cửa hàng hiển thị
LOG_BOT_TOKEN / LOG_CHANNEL_ID    # Bot log Telegram
PORT                              # Default 3001
```

## Các điểm hay gặp bug

### 1. DB Compatibility Layer (`src/lib/prisma.js`)
File này wrap Prisma để tương thích cả Mongo và PG. Khi query bị lỗi, kiểm tra xem hàm wrapper có map đúng field/relation không.

### 2. State mất sau restart
`chatState` (Map) không persist. Sau restart, user đang ở giữa flow sẽ bị mất trạng thái. Cần xử lý graceful fallback về `/start`.

### 3. Bank polling race condition
Nếu hai request bank history về cùng lúc, có thể confirm một giao dịch hai lần. Kiểm tra `paymentRef` unique trước khi xử lý.

### 4. Order expiration
Orders hết hạn 10 phút. Cần đảm bảo poller chạy ổn định; nếu poller crash thì orders sẽ không bị hủy đúng hạn.

### 5. StockItem allocation
Khi nhiều user cùng mua, cần transaction DB để tránh cấp cùng một `StockItem` cho hai đơn hàng khác nhau.

### 6. safe.js (bot-ui)
Dùng `safe.editMessageText` thay vì gọi trực tiếp Telegram API để tránh lỗi "message is not modified" làm crash handler.

### 7. Telegram message deletion
Tin nhắn cũ được xóa qua `lastMenuId`. Nếu xóa thất bại (message đã bị xóa manually), cần catch và bỏ qua lỗi.

## API Endpoints

| Endpoint | Mô tả |
|----------|-------|
| `GET /health` | Health check |
| `GET /api/shop/catalog` | Catalog sản phẩm (JSON) |
| `GET /shop` | Web storefront |
| `POST /webhook/ipn` | Webhook xác nhận thanh toán |
| `GET /api/admin/giftcodes` | Danh sách giftcode (cần `secret`) |
| `POST /api/admin/giftcodes` | Tạo 1 mã, hoặc `count > 1` để sinh loạt mã ngẫu nhiên |
| `GET/PUT /api/admin/gpt2api-config` | Cấu hình cửa hàng API key (token adm_* bị che khi GET) |
| `GET /admin/seed` | Seed database (cần auth) |

## Giftcode

Mã quà tặng — khác Coupon (giảm giá một đơn hàng cụ thể). Hai loại phần thưởng:

| `rewardType` | Phần thưởng |
|--------------|-------------|
| `WALLET` | Cộng `amount` VND vào ví |
| `APIKEY` | Cấp API key `sk-*` miễn phí, quota random 3–20M token |

- Khách đổi qua nút **GIFTCODE ở menu chính**, nút trong màn Ví, hoặc `/giftcode <MÃ>`.
  `/cancel` thoát flow nhập mã.
- Admin tạo qua panel bot (`ADMIN:GIFTCODES` — có riêng nút "Tạo mã ví" và
  "Tạo mã API key") hoặc web admin (tab Giftcode, dropdown chọn loại)
- Chống đổi lại: `GiftCodeRedemption.redeemKey` là unique index
  (`{giftCodeId}:{telegramId}:{lần thứ n}`) — hai request song song thì chỉ một
  cái insert được
- Suất dùng toàn cục claim bằng `updateMany` có điều kiện `usedCount < maxUses`
  (atomic trong Mongo), không lost-update
- Phát thưởng fail (cộng ví lỗi HOẶC provider không cấp được key) → rollback cả
  redemption và `usedCount` → mã không bị cháy oan, khách đổi lại được

## Cửa hàng API key (GPT2API)

Bán API key token qua Admin Public API của GPT2API (`POST /api/admin-pub/keys`).

- Nút **"Tạo API key"** ở menu chính, hoặc `/apikey`. `/mykey` xem key đã có.
- Giá mặc định **$0.01 / 1 triệu token**, đặt qua `GPT2API_USD_PER_MTOKEN`.
  Giá CHỈ phụ thuộc số token — RPM và số ngày là tuỳ chọn kỹ thuật, không đổi giá.
- Luồng mua 3 bước: **token → RPM → số ngày → thanh toán**. Mỗi bước có nút bấm
  sẵn kèm nút "nhập khác" để tự gõ:
  - Bước 1 token: gói sẵn `GPT2API_BUY_PRESETS_M` hoặc tự nhập.
    Parser nhận `3000000`, `3m`, `3M`, `3tr`, `1.5m`, `3.000.000`, `3,000,000`.
    Miền hợp lệ: 1.000.000 – 100.000.000 token.
  - Bước 2 RPM: `DEFAULT_RPM_PRESETS` (100/300/600/1200) + RPM cấu hình shop luôn
    có mặt và được gắn nhãn "Mặc định". Miền 10 – 10.000.
  - Bước 3 số ngày: `DEFAULT_DAYS_PRESETS` (7/30/90/365) + nút **"Không hết hạn"**
    (= 0) + tự nhập. Miền 1 – 3650, hoặc 0.
- **`validDays = 0` là lựa chọn hợp lệ**, không phải "chưa chọn": `buildCreateKeyBody`
  bỏ hẳn `expires_in_days` → key chỉ hết khi cạn quota. Vì 0 là falsy, `delivery.js`
  phải kiểm `=== undefined || === null` chứ KHÔNG dùng `||`, nếu không "không hết
  hạn" bị âm thầm biến thành số ngày mặc định của shop.
- Callback data mang toàn bộ state (`APIKEY_DAYS:<tokens>:<rpm>:<days>`) vì session
  chết sau restart; regex dùng `\d+` nên mọi giá trị nhúng phải là số nguyên.
- Ngày hết hạn: ưu tiên `expires_at` provider trả về, không có thì tự cộng từ số
  ngày khách chọn, `null` khi không hết hạn. Lưu vào `IssuedApiKey.expiresAt` để
  `/mykey` hiện lại.
- **CHỈ THANH TOÁN BẰNG VÍ.** Key tính giá USD → theo luật sẵn có của repo, hàng
  giá USD không trả trực tiếp bằng QR/USDT (hai kênh đó chỉ để nạp ví).
- Đơn dùng Product ẩn `code=__API_KEY__`, `deliveryMode=API_KEY`. Token/RPM/số ngày
  nằm TRÊN order (`order.apikeyTokens`, `order.apikeyRpm`, `order.apikeyValidDays`)
  chứ không phải Setting JSON — bản aiplus cũ dùng map trong một Setting document
  nên hai đơn đồng thời ghi đè nhau.
- Tạo key lỗi sau khi trừ ví → `delivery.js` tự hoàn tiền + huỷ đơn (refund keyed
  theo `order.id` nên idempotent).
- Quota giftcode random theo luật lũy thừa nghịch `weight(n) ∝ 1/n²` trên miền
  mặc định 3–20M: 3–5M ≈ 55%, 6–10M ≈ 26%, 11–15M ≈ 11%, 16–20M ≈ 6%. Miền mặc
  định là `FREE_MIN_M`/`FREE_MAX_M` trong `apikey-pricing.js`; từng mã có thể
  override bằng `quotaMinM`/`quotaMaxM`. Hàm thuần, có test.
- **Model Fallback / Allowed Groups**: server ĐÒI `fallback_allowed_groups` —
  thiếu field thì trả HTTP 200 + `code 40000` "pick at least one fallback group"
  và đơn bị hoàn tiền. `GET /api/admin-pub/model-groups` có thật (trái với tài
  liệu), trả `data.list[].public_id`. Nên `createApiKey` tự gọi `listModelGroups()`
  lấy TẤT CẢ group khi `GPT2API_FALLBACK_GROUPS` để trống; muốn giới hạn thì dán
  id vào biến đó. Danh sách group cache 5 phút, danh sách RỖNG không cache (một
  lỗi mạng thoáng qua không được làm cả 5 phút không bán được key).
  Lấy group thất bại → trả lỗi NGAY, không gửi request tạo key.
- Hai nút menu tự ẩn khi thiếu `GPT2API_BASE` / `GPT2API_ADMIN_TOKEN` /
  `GPT2API_USER_ID` — không hiện nút dẫn tới màn báo lỗi.

## Quy ước code

- Vietnamese comments và log messages
- Emoji trong UI messages (từ `bot-ui/format.js`)
- Admin actions phải được log qua `audit.js`
- Mọi edit message Telegram đi qua `bot-ui/safe.js`
- i18n qua `src/i18n/index.js` — key string, fallback về `vi`

## Lệnh phát triển

```bash
# Chạy development
npm run dev

# Generate Prisma client
npx prisma generate

# Migrate database
npx prisma migrate dev

# Seed dữ liệu
node prisma/seed-categories.js

# Kiểm tra DB
node check-db.js
```
