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
| `WalletTransaction` | Lịch sử giao dịch ví (DEPOSIT/PURCHASE/REFUND/ADMIN_ADD/ADMIN_DEDUCT) |
| `Coupon` | Mã giảm giá, có `maxUses`, `expiresAt`, `vipOnly` |
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
| `GET /admin/seed` | Seed database (cần auth) |

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
