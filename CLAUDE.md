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
  apikey-profiles.js # Hàm thuần: nhiều "server" trên cùng 1 kết nối (chuẩn hoá + gộp knob)
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
| `IssuedApiKey` | Key sk-* đã cấp cho khách (từ giftcode hoặc mua) — nguồn cho `/mykey`. `profileId`/`profileName` = "server" đã cấp |
| `Referral` | Quan hệ giới thiệu; `rewardRefereeAt`/`rewardReferrerAt` = mốc đã phát quà mời bạn |
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
| `PUT /api/admin/giftcodes/:code` | Sửa cấu hình mã đã tạo (miền quota/RPM/lượt dùng…); không đổi `code`/`rewardType`, không thu hồi key đã cấp |
| `GET/PUT /api/admin-react/gpt2api/config` | Cấu hình cửa hàng API key (React admin; token adm_* bị che khi GET, gửi rỗng = giữ nguyên) |
| `GET/PUT /api/admin-react/referral/config` | Cấu hình quà mời bạn (token/ngày/RPM/mốc ngày/hoa hồng) |
| `GET /api/admin-react/referral/leaderboard` | Bảng xếp hạng người mời + tổng token đã tặng |
| `POST /api/admin-react/gpt2api/test` | Kiểm tra token/base GPT2API còn sống (gọi model-groups) |
| `GET /admin/seed` | Seed database (cần auth) |

## Giftcode

Mã quà tặng — khác Coupon (giảm giá một đơn hàng cụ thể). Hai loại phần thưởng:

| `rewardType` | Phần thưởng |
|--------------|-------------|
| `WALLET` | Cộng `amount` VND vào ví |
| `APIKEY` | Cấp API key `sk-*` miễn phí, quota random 3–50M token |

- Khách đổi qua nút **GIFTCODE ở menu chính**, nút trong màn Ví, hoặc `/giftcode <MÃ>`.
  `/cancel` thoát flow nhập mã.
- Admin tạo qua panel bot (`ADMIN:GIFTCODES` — có riêng nút "Tạo mã ví" và
  "Tạo mã API key") hoặc web admin (tab Giftcode, dropdown chọn loại)
- Web admin có nút **"Sửa"** mỗi mã → `updateGiftCode()` / `PUT /api/admin/giftcodes/:code`:
  đổi được miền quota / RPM / số ngày / lượt dùng / VIP / hết hạn / ghi chú (hoặc
  `amount` với mã ví). KHÔNG đổi `code` hay `rewardType`, không đụng `usedCount`,
  không thu hồi key đã cấp — chỉ ảnh hưởng lượt đổi sau. Field bỏ trống với
  `maxUses`/`vipOnly`/`expiresAt`/`note` = xoá về mặc định. Bot chưa có nút này.
  **Lưu ý miền quota được "đóng băng" lúc tạo mã** (createGiftCode resolve blank →
  `FREE_MIN_M`/`FREE_MAX_M` hiện tại), nên đổi hằng số không sửa mã cũ — phải dùng
  nút Sửa hoặc `scripts/fix-giftcode-quota.mjs`.
- Chống đổi lại: `GiftCodeRedemption.redeemKey` là unique index
  (`{giftCodeId}:{telegramId}:{lần thứ n}`) — hai request song song thì chỉ một
  cái insert được
- Suất dùng toàn cục claim bằng `updateMany` có điều kiện `usedCount < maxUses`
  (atomic trong Mongo), không lost-update
- Phát thưởng fail (cộng ví lỗi HOẶC provider không cấp được key) → rollback cả
  redemption và `usedCount` → mã không bị cháy oan, khách đổi lại được

## Mời bạn (referral)

Mời **1 người** → **CẢ HAI bên** nhận một API key miễn phí (mặc định **20M token,
hạn 1 ngày**). Đây là phần thưởng chính; hoa hồng %/đơn đã TẮT (`REFERRAL_COMMISSION=0`).

- **Cấu hình chỉnh trong web admin**: React admin → "Mời bạn / Affiliate" → tab
  **"Cài đặt quà"** (`GET/PUT /api/admin-react/referral/config`). Bảng Setting
  THẮNG ENV, cache 30s, có hiệu lực ngay không cần restart. 5 khoá (cũng là tên
  biến ENV, xem `REFERRAL_SETTING_KEYS`):
  `REFERRAL_REWARD_TOKENS_M` (20 — đặt 0 là tắt hẳn quà, màn Giới thiệu tự ẩn dòng
  ưu đãi), `REFERRAL_REWARD_DAYS` (1 — 0 = không hết hạn),
  `REFERRAL_REWARD_RPM` (100 — key quà chạy RPM riêng, thấp hơn key bán; đặt 0 để
  theo `GPT2API_KEY_RPM` của shop),
  `REFERRAL_COMMISSION` (0 = tắt hoa hồng; > 0 nếu muốn chạy song song cả hai),
  và **`REFERRAL_REWARD_SINCE`** (ngày bật chương trình): referral tạo TRƯỚC mốc
  này không được trả bù — bỏ trống thì mọi cặp giới thiệu cũ (từ thời hoa hồng %)
  nhận key ngay lần `/start` kế tiếp, tốn quota hàng loạt.
- `getReferralConfig()` async (dùng ở mọi hot-path); `getCommissionPercentSync()`
  là bản đồng bộ cho `formatVipInfo` — `warmReferralConfig()` ở `server.js` làm
  nóng cache lúc boot để màn VIP đầu tiên không hiện số theo ENV.
- **Bảng xếp hạng người mời**: tab "Bảng xếp hạng" (`GET /api/admin-react/referral/
  leaderboard`) — `getReferralLeaderboard()` gộp `Referral` theo `referrerId` bằng
  JS và ghép tổng quota từ `IssuedApiKey` nguồn `REFERRAL`. Xếp theo số lượt ĐÃ
  PHÁT QUÀ trước, rồi mới tới tổng lượt mời (người spam link mà không ai vào thì
  không leo lên đầu). `totals` cho biết chi phí chương trình: số key + tổng token.
- **Thời điểm phát**: khi người ĐƯỢC MỜI qua xong cổng onboarding (chọn ngôn ngữ +
  vào nhóm) — `deliverReferralRewards()` gọi từ `finishOnboarding` và từ `/start`
  khi cổng đã mở sẵn. Vào bằng link ref rồi bỏ đi giữa chừng thì KHÔNG có quà.
  Chạy nền (không await) vì tạo 2 key mất vài giây, không được chặn menu.
- **Chống phát trùng**: mỗi bên có mốc riêng trên document `Referral`
  (`rewardRefereeAt` / `rewardReferrerAt`). Claim bằng `updateMany` điều kiện
  `field: null` (atomic trong Mongo, khớp cả doc cũ chưa có field) TRƯỚC khi gọi
  provider — hai lần bấm song song chỉ một cái qua. Tạo key lỗi → nhả mốc để lần
  /start sau thử lại; key đã tạo rồi thì KHÔNG rollback (nhả mốc = tặng thêm key).
- Key lưu vào `IssuedApiKey` với `source = "REFERRAL"` → hiện trong `/mykey`
  ("quà mời bạn") và tab "Key đã cấp" của web admin (badge "Mời bạn").
- Chưa cấu hình GPT2API → `grantReferralReward` thoát sớm, KHÔNG claim mốc, để khi
  admin cấu hình xong khách vẫn nhận được quà ở lần /start sau.
- Text màn Giới thiệu + bài Hỗ trợ lấy số token/số ngày từ cấu hình thật
  (`getReferralRewardInfo()`), đổi ENV không phải sửa i18n.

## Cửa hàng API key (GPT2API)

Bán API key token qua Admin Public API của GPT2API (`POST /api/admin-pub/keys`).

- Cấu hình kết nối (base, token adm_*, user_id, models, fallback groups, endpoint,
  doc/usage URL, bật/tắt) sửa ở **React admin → "Cửa hàng API key" → tab Kết nối**
  (`/api/admin-react/gpt2api/config`). DB Setting thắng ENV. Nút "Kiểm tra kết nối"
  gọi model-groups để xác nhận token còn sống.
- Nút **"Tạo API key"** ở menu chính, hoặc `/apikey`. `/mykey` xem key đã có.
- **Giá cuối = giá_token × hệ_số_RPM × hệ_số_ngày** (`priceUsdForKey` trong
  `apikey-pricing.js`, dùng ở màn xác nhận + lúc trừ ví):
  - giá_token = `(token / 1tr) × GPT2API_USD_PER_MTOKEN` (mặc định $0.01/1tr).
    `priceUsdForTokens` (chỉ token) vẫn dùng cho nhãn nút gói ở bước 1.
  - hệ_số_RPM = `1 + (RPM vượt GPT2API_RPM_INCLUDED)/GPT2API_RPM_INCLUDED × GPT2API_RPM_SURCHARGE_PCT%`
    (mặc định: gồm sẵn 300 RPM, mỗi 300 thừa +20%).
  - hệ_số_ngày = `validDays>0 ? 1 + validDays/30 × GPT2API_DAY_SURCHARGE_PCT%` (mặc định +5%/30 ngày)
    `: GPT2API_NO_EXPIRY_MULT` (mặc định ×1.5 — key vĩnh viễn đắt hơn).
  - Tắt phụ phí: đặt 2 PCT về 0 và `NO_EXPIRY_MULT` về 1. Làm tròn LÊN cent.
  - Màn xác nhận hiện `(+X%)` cạnh dòng RPM / số ngày để khách hiểu.
  - **4 hằng phụ phí + trần mua + preset RPM/ngày + miền quota giftcode giờ chỉnh
    trong web admin** (tab "Cửa hàng API key" → "Giá & giới hạn", DB thắng ENV,
    không cần restart). `getConfig()` trả `rpmIncluded/rpmSurchargePct/
    daySurchargePct/noExpiryMult/maxBuyTokens/rpmPresets/daysPresets/freeMinM/
    freeMaxM/freeAlpha`; `keyPriceFactors(opts, knobs)` và
    `priceUsdForKey(opts, usdPerM, knobs)` nhận `knobs = cfg` (bỏ trống = hằng
    trong `apikey-pricing.js`, mọi test cũ vẫn đúng).
### Nhiều "server" (profile) trên CÙNG một kết nối

Shop chỉ có 1 tài khoản xpiki (1 base + 1 token adm_* + 1 user_id) nhưng bán được
nhiều "server" khác nhau. Cái khác nhau giữa chúng là **danh sách + thứ tự nhóm
model fallback** gửi kèm lúc tạo key, kèm **bộ knob giá riêng**.

- Lưu trong MỘT Setting `GPT2API_PROFILES` = JSON mảng. Mỗi phần tử chỉ chứa knob
  admin THỰC SỰ đặt riêng; knob bỏ trống = **kế thừa** giá trị chung của shop
  (các khoá `GPT2API_*` phẳng đang có). Chuẩn hoá + gộp ở `apikey-profiles.js`
  (hàm thuần, có test).
- **Setting rỗng = một profile mặc định** dựng từ cấu hình phẳng → shop chưa bật
  tính năng này chạy y như trước, không cần migration.
- Sửa ở **React admin → "Cửa hàng API key" → tab Kết nối → khối "Server"**. Nút
  "Tách thành nhiều server" seed profile đầu bằng nhóm fallback đang dùng.
- `getProfiles({onlyEnabled})` và `getProfileConfig(id)` trong `gpt2api.js`.
  `createApiKey({ profileId })` — bỏ trống = **server đầu tiên đang bật** (giftcode,
  quà mời bạn, đơn cũ đều rơi vào đây).
- Knob override được: giá $/1M, RPM/TPM/ngày mặc định, 4 hằng phụ phí, trần mua,
  3 bộ preset, miền quota giftcode, quy đổi quota, allowed-models mode, models.
  **Không** override được: base / token / user_id / endpoint / doc / usage —
  đó chính là nghĩa "cùng một kết nối".
- `profileEnabled` (cờ riêng từng server) TÁCH khỏi `enabled` (công tắc cả cửa
  hàng). Gộp hai cái là tắt một server sẽ không có tác dụng gì.
- **Luồng mua thành 4 bước khi có ≥2 server** (server → token → RPM → ngày); còn
  một server thì bot bỏ hẳn bước 0 và vẫn hiện "Bước n/3".
- **Mọi callback data mang profile id ở vị trí ĐẦU**: `APIKEY_SRV:<pid>`,
  `APIKEY_BUY_TOK:<pid>:<tokens>`, `APIKEY_RPM:<pid>:<t>:<rpm>`,
  `APIKEY_DAYS:<pid>:<t>:<rpm>:<d>`, `APIKEY_PAY:<pid>:<t>:<rpm>:<d>`.
  pendingAction cũng vậy (`APIKEY_TOKENS:<pid>`…). id là **số nguyên** vì regex
  dùng `\d+`. Callback đời cũ (thiếu pid, còn trong lịch sử chat) có một handler
  gộp đưa về đầu luồng — KHÔNG đoán server vì giá mỗi server một khác.
- Đơn mang `order.apikeyProfile`; `deliverApiKey` đọc lại nó để cấp key đúng nhóm
  model kể cả sau restart. Key lưu `IssuedApiKey.profileId` + `profileName`
  (lưu cả tên: admin đổi tên/xoá server thì lịch sử vẫn đọc được).
- `pickProfile` không tìm thấy id (admin xoá server sau khi khách bấm nút) →
  trả server đầu tiên ĐANG BẬT chứ không null: đơn đã trừ tiền phải giao được.

- Luồng mua 3 bước: **token → RPM → số ngày → thanh toán** (4 bước khi shop mở
  nhiều server — xem mục trên). Mỗi bước có nút bấm sẵn kèm nút "nhập khác" để tự gõ:
  - Bước 1 token: gói sẵn `GPT2API_BUY_PRESETS_M` hoặc tự nhập.
    Parser nhận `3000000`, `3m`, `3M`, `3tr`, `1.5m`, `3.000.000`, `3,000,000`,
    và hậu tố tỷ: `3b`/`3B`/`3tỷ`/`3tỉ`/`3ty`/`3ti`/`3billion` = 3.000.000.000.
    Miền: 1tr – `GPT2API_MAX_BUY_M`×1tr (mặc định 1 nghìn tỷ ≈ không giới hạn).
  - Bước 2 RPM: `DEFAULT_RPM_PRESETS` (100/300/600/1200) + RPM cấu hình shop luôn
    có mặt và được gắn nhãn "Mặc định". Miền 10 – 10.000.
  - Bước 3 số ngày: `GPT2API_DAYS_PRESETS` (mặc định `DEFAULT_DAYS_PRESETS` =
    1/3/7/30/90/365) + nút **"Không hết hạn"** (= 0) + tự nhập. Miền 1 – 3650, hoặc 0.
- **`validDays = 0` là lựa chọn hợp lệ**, không phải "chưa chọn": `buildCreateKeyBody`
  bỏ hẳn `expires_in_days` → key chỉ hết khi cạn quota. Vì 0 là falsy, `delivery.js`
  phải kiểm `=== undefined || === null` chứ KHÔNG dùng `||`, nếu không "không hết
  hạn" bị âm thầm biến thành số ngày mặc định của shop.
- Callback data mang toàn bộ state (`APIKEY_DAYS:<tokens>:<rpm>:<days>`) vì session
  chết sau restart; regex dùng `\d+` nên mọi giá trị nhúng phải là số nguyên.
- Ngày hết hạn: ưu tiên `expires_at` provider trả về, không có thì tự cộng từ số
  ngày khách chọn, `null` khi không hết hạn. Lưu vào `IssuedApiKey.expiresAt` để
  `/mykey` hiện lại.
- **Quy đổi quota (xpiki)**: xpiki lưu `credit = quota_limit / 10.000`, panel hiện
  `token = credit / giá_Opus5 × 1tr` (giá Opus 5 /1M hiện = 15 → panel = `quota_limit
  × 6.667`). Để số token trên bot = số trong panel xpiki, `buildCreateKeyBody` gửi
  `quota_limit = round(token × GPT2API_QUOTA_REF_PRICE / 100)` (mặc định 15). VD bot
  "10M token" → gửi `quota_limit = 1.500.000` → xpiki hiện đúng "≈ 10M". `DB.quotaTokens`
  vẫn là số hiển thị (Opus 5). Đặt `GPT2API_QUOTA_REF_PRICE=0` để gửi token thô.
  Key cấp trước 2026-08-31 đã được `scripts/fix-issued-quota.mjs` chỉnh lại
  `quota_limit` trên xpiki cho khớp.
- **Allowed models**: `GPT2API_ALLOWED_MODELS_MODE=all` (mặc định) → KHÔNG gửi
  `allowed_models`, key xài mọi model group cho phép. `restrict` → giới hạn theo
  `GPT2API_MODELS`. Danh sách model vẫn hiện trong tin cấp key như gợi ý.
- **CHỈ THANH TOÁN BẰNG VÍ.** Key tính giá USD → theo luật sẵn có của repo, hàng
  giá USD không trả trực tiếp bằng QR/USDT (hai kênh đó chỉ để nạp ví).
- Đơn dùng Product ẩn `code=__API_KEY__`, `deliveryMode=API_KEY`. Token/RPM/số ngày
  nằm TRÊN order (`order.apikeyTokens`, `order.apikeyRpm`, `order.apikeyValidDays`)
  chứ không phải Setting JSON — bản aiplus cũ dùng map trong một Setting document
  nên hai đơn đồng thời ghi đè nhau.
- Tạo key lỗi sau khi trừ ví → `delivery.js` tự hoàn tiền + huỷ đơn (refund keyed
  theo `order.id` nên idempotent).
- Quota giftcode random theo luật lũy thừa nghịch `weight(n) ∝ 1/n²` trên miền
  mặc định 3–50M: 3–5M ≈ 57%, 6–10M ≈ 23%, 11–20M ≈ 12%, 21–50M ≈ 8%. Miền mặc
  định lấy từ `getConfig()` (`GPT2API_FREE_MIN_M/MAX_M/ALPHA` chỉnh trong web admin,
  fallback về hằng `FREE_MIN_M`/`FREE_MAX_M` trong `apikey-pricing.js`).
  `createGiftCode` "đóng băng" miền này vào mã lúc tạo nếu ô quota để trống;
  `grantApiKeyReward` dùng nó làm fallback cho mã cũ có `quotaMinM = 0`. Từng mã
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
