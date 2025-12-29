# 🛒 Telegram Shop Bot v2

Bot Telegram bán hàng tự động với thanh toán và giao hàng tức thì.

## ✨ Tính Năng

- 🛍️ **Bán hàng tự động** - Khách mua và nhận hàng không cần admin
- 💳 **Đa cổng thanh toán** - Stripe, VNPay, MoMo, chuyển khoản
- 📦 **3 chế độ giao hàng** - Text, File, Stock (tài khoản)
- 🎫 **Mã giảm giá** - Coupon theo % hoặc số tiền
- 👥 **Giới thiệu bạn bè** - Referral nhận hoa hồng
- 📊 **Thống kê chi tiết** - Doanh thu, đơn hàng, biểu đồ
- 🌐 **Đa ngôn ngữ** - Tiếng Việt, English
- 💾 **Auto backup** - Sao lưu tự động mỗi ngày

---

## 🚀 Cài Đặt

### 1. Clone và cài dependencies

```bash
cd "d:\bot telegram"
npm install
```

### 2. Tạo file `.env`

Copy từ `.env.example` và điền thông tin:

```bash
cp .env.example .env
```

**Cấu hình bắt buộc:**
```
BOT_TOKEN=your_bot_token      # Lấy từ @BotFather
ADMIN_IDS=your_telegram_id    # Lấy từ @userinfobot
```

### 3. Khởi tạo database

```bash
npx prisma migrate dev
```

### 4. Chạy bot

```bash
npm start
```

---

## 📱 Hướng Dẫn Sử Dụng

### 👤 Dành cho Khách Hàng

1. **Mở bot** - Tìm bot trên Telegram và bấm Start
2. **Xem sản phẩm** - Bấm "🛒 Sản phẩm"
3. **Chọn sản phẩm** - Bấm vào sản phẩm muốn mua
4. **Chọn số lượng** - 1, 2, 3, 5, hoặc 10
5. **Nhập mã giảm giá** - (hoặc bấm Bỏ qua)
6. **Chọn thanh toán** - Stripe/VNPay/MoMo/Chuyển khoản
7. **Thanh toán** - Làm theo hướng dẫn
8. **Nhận hàng** - Tự động gửi sau khi thanh toán

**Các lệnh:**
- `/start` - Menu chính
- `/order [mã]` - Tra cứu đơn hàng

### 🔧 Dành cho Admin

Gõ `/admin` để mở Admin Panel.

#### 📦 Quản lý Sản phẩm

1. `/admin` → Sản phẩm → Thêm sản phẩm
2. Điền theo từng bước:
   - **Mã code**: netflix, spotify, vip...
   - **Tên**: Netflix Premium 1 tháng
   - **Giá**: 50000 (không có dấu)
   - **Mode**: TEXT / FILE / STOCK_LINES

3. **Nạp stock** (nếu mode = STOCK_LINES):
   - Sản phẩm → Nạp stock → Chọn SP
   - Paste danh sách (mỗi dòng 1 tài khoản):
   ```
   user1@email.com|password1
   user2@email.com|password2
   ```

#### 🎫 Tạo Mã Giảm Giá

1. `/admin` → Mã giảm giá → Thêm mã
2. Nhập format: `CODE|DISCOUNT|TYPE|MAX_USES`

**Ví dụ:**
```
SALE50|50|PERCENT|100      # Giảm 50%, tối đa 100 lượt
GIAM10K|10000|FIXED|50     # Giảm 10.000đ, tối đa 50 lượt
```

#### 💰 Xác nhận Chuyển khoản

1. `/admin` → Đơn hàng → Chờ thanh toán
2. Kiểm tra ngân hàng đã nhận tiền
3. Bấm "✅ Xác nhận" để giao hàng

#### 📊 Xem Thống kê

1. `/admin` → Thống kê
2. Chọn: Hôm nay / 7 ngày / 30 ngày / Biểu đồ

#### 💾 Backup

1. `/admin` → Backup → Tạo backup ngay
2. Bot sẽ gửi file JSON chứa toàn bộ dữ liệu

---

## 💳 Cấu Hình Thanh Toán

### Stripe (Thẻ quốc tế)
```env
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
```

### VNPay
```env
VNPAY_TMN_CODE=xxx
VNPAY_HASH_SECRET=xxx
```

### MoMo
```env
MOMO_PARTNER_CODE=xxx
MOMO_ACCESS_KEY=xxx
MOMO_SECRET_KEY=xxx
```

### Chuyển khoản Ngân hàng
```env
BANK_NAME=Vietcombank
BANK_CODE=VCB
BANK_ACCOUNT=1234567890
BANK_ACCOUNT_NAME=NGUYEN VAN A
```

---

## 📁 Cấu Trúc Project

```
bot-telegram/
├── .env                 # Cấu hình (không commit)
├── .env.example         # Template cấu hình
├── package.json
├── prisma/
│   └── schema.prisma    # Database schema
└── src/
    ├── server.js        # Entry point
    ├── bot.js           # Bot logic
    ├── admin.js         # Admin commands
    ├── delivery.js      # Giao hàng
    ├── inventory.js     # Quản lý stock
    ├── stats.js         # Thống kê
    ├── coupon.js        # Mã giảm giá
    ├── referral.js      # Giới thiệu
    ├── ratelimit.js     # Chống spam
    ├── backup.js        # Sao lưu
    ├── db.js            # Database
    ├── i18n/            # Ngôn ngữ
    │   ├── vi.js
    │   └── en.js
    └── payment/         # Thanh toán
        ├── provider.js
        ├── stripe.js
        ├── vnpay.js
        ├── momo.js
        └── bank.js
```

---

## ❓ FAQ

**Q: Làm sao lấy BOT_TOKEN?**
A: Chat với @BotFather → /newbot → Làm theo hướng dẫn

**Q: Làm sao lấy ADMIN_IDS?**
A: Chat với @userinfobot → Copy số ID

**Q: Webhook không hoạt động?**
A: Cần domain HTTPS. Dùng ngrok để test local:
```bash
ngrok http 3000
```

**Q: Lỗi "EADDRINUSE"?**
A: Port đang bị chiếm. Chạy:
```powershell
Get-NetTCPConnection -LocalPort 3000 | Stop-Process -Force
```

---

## 📞 Hỗ Trợ

- Telegram: @your_username
- Email: your@email.com

---

## 📜 License

MIT
