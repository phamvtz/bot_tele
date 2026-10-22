# Telegram Local Bot API server

Chạy `telegram-bot-api` (server Bot API mã nguồn mở của Telegram) ngay trong mạng Docker của shop, bot nói chuyện với nó thay vì `https://api.telegram.org`.

Trạng thái trong repo:

| Thành phần | Chỗ nằm |
|---|---|
| Service `telegram-bot-api` (image `aiogram/telegram-bot-api`, pin digest, `expose: 8081`, volume `./telegram-bot-api-data`) | `docker-compose.yml` (trên VPS, không có trong workspace local — xem skill `shop-architecture`) |
| `api_id` / `api_hash` | `./.env.botapi` trên VPS (chmod 600) — **không commit, không paste vào chat** |
| Bot đọc gốc URL | `backend/src/config/index.js` → `config.bot.apiRoot` ← env `TELEGRAM_API_ROOT` |
| Dùng trong Telegraf | `backend/src/bot/index.js`: `new Telegraf(token, { telegram: { apiRoot } })` |
| Dùng cho tải file/emoji | `backend/src/services/telegramEmojiLibrary.js` (`TELEGRAM_ORIGIN`) |

Bỏ biến `TELEGRAM_API_ROOT` = tự quay về `https://api.telegram.org`.

> Storefront bot của reseller (`storefrontBot.js`) hiện tạo `new Telegraf(token)` **không** truyền `apiRoot` → luôn đi qua api.telegram.org. Muốn chúng đi local phải sửa riêng (xem mục 7).

---

## 1. Vì sao dùng local server

| Lợi ích | Ghi chú |
|---|---|
| Bớt 1 chặng mạng tới Telegram | Backend → container cùng mạng Docker; server local giữ kết nối tới DC của Telegram |
| Upload file tới **2000 MB** (thay vì 50 MB) | Cần `--local` |
| Tải file lớn không giới hạn 20 MB | `getFile` trả **đường dẫn tuyệt đối trên đĩa**, đọc trực tiếp từ volume |
| Webhook trỏ `http://`, IP/port bất kỳ | Không cần HTTPS hợp lệ |
| `max_webhook_connections` tới 100000 | |

Cái giá: thêm 1 container phải sống; hỏng là **tất cả bot đang trỏ vào nó chết**.

## 2. Lấy `api_id` / `api_hash`

1. Đăng nhập <https://my.telegram.org> bằng số điện thoại của chủ shop.
2. **API development tools** → tạo app → copy `api_id`, `api_hash`.
3. Ghi vào `.env.botapi` trên VPS:

```env
TELEGRAM_API_ID=<api_id>
TELEGRAM_API_HASH=<api_hash>
# Bật local mode (bắt buộc cho upload 2GB, getFile trả path tuyệt đối)
TELEGRAM_LOCAL=1
```

```bash
chmod 600 .env.botapi
```

`TELEGRAM_LOCAL` là biến của image `aiogram/telegram-bot-api` (tương đương flag `--local`). Kiểm tra lại env thực tế trên VPS trước khi giả định đã bật.

## 3. Compose

```yaml
  telegram-bot-api:
    image: aiogram/telegram-bot-api@sha256:92efd31add8e6252d45030717c849786fd4dff54e5410c6d70f3059334a4dd16
    container_name: shop_telegram_bot_api
    restart: unless-stopped
    env_file:
      - ./.env.botapi
    volumes:
      - ./telegram-bot-api-data:/var/lib/telegram-bot-api
    expose:
      - "8081"          # chỉ trong shop_net, KHÔNG dùng `ports:`
    networks:
      - shop_net
```

Giữ `expose`, không `ports`: server này nhận **bot token trong URL** (`/bot<TOKEN>/method`) — mở ra internet là lộ cổng điều khiển bot.

## 4. Chuyển một bot sang local (an toàn)

Telegram chỉ cho **một** server phục vụ một bot tại một thời điểm. Chuyển trực tiếp mà không `logOut` → lỗi/độ trễ.

**Thứ tự bắt buộc:**

1. Dừng mọi tiến trình dùng token đó (không chạy bot local bằng `BOT_TOKEN` live → 409).
2. Gọi `logOut` trên server **cũ** (cloud):
   ```bash
   curl "https://api.telegram.org/bot<TOKEN>/logOut"
   ```
   Sau `logOut`, bot không đăng nhập lại được trên cloud trong ~10 phút.
3. Thêm vào `.env` của bot:
   ```env
   TELEGRAM_API_ROOT=http://telegram-bot-api:8081
   ```
4. Recreate container backend (restart thôi **không** nạp env mới / image mới):
   ```bash
   docker compose up -d --force-recreate backend
   ```
5. Kiểm tra:
   ```bash
   docker exec shop_backend sh -c 'wget -qO- "$TELEGRAM_API_ROOT/bot$BOT_TOKEN/getMe"'
   ```
   Không echo token ra log/chat.

Hai bot (Yingz + Kenmmo) đổi **từng bot một**, mỗi bot có `logOut` riêng. Đừng reboot cả hai cùng lúc (landmine #8: SQLite locked).

## 5. Quay về cloud

1. Gọi `close` trên server local:
   ```bash
   docker exec shop_backend sh -c 'wget -qO- --post-data="" "$TELEGRAM_API_ROOT/bot$BOT_TOKEN/close"'
   ```
   Chờ ~10 phút.
2. Xoá `TELEGRAM_API_ROOT` khỏi `.env`.
3. `docker compose up -d --force-recreate backend`.

## 6. Vận hành

| Việc | Cách |
|---|---|
| Log | `docker logs shop_telegram_bot_api --tail 100` |
| Dung lượng | `telegram-bot-api-data/` chứa file đã tải + DB phiên; dọn định kỳ file cũ, **không xoá thư mục khi bot đang chạy** |
| Mất volume | Mất state đăng nhập bot → phải `logOut` cloud + login lại như mục 4 |
| Health | Container sống ≠ bot polling sống. `/api/health` luôn 200 dù bot chết (landmine #11) — kiểm tra bằng `getMe` hoặc gửi `/start` |
| Nâng version image | Đổi digest, `up -d telegram-bot-api`; làm lúc ít khách |
| 409 Conflict | Có hai process cùng long-poll một token (hoặc còn bot local dev). Tìm và tắt process thừa |

## 7. Storefront (bot reseller) đi qua local server

Hiện `createStorefrontBot` không truyền `apiRoot`. Muốn thống nhất, đổi:

```js
// backend/src/bot/storefrontBot.js, createStorefrontBot
const bot = new Telegraf(token, { telegram: { apiRoot: config.bot.apiRoot } });
```

Nhưng bot reseller **chưa từng login vào local server**. Mỗi token mới phải đi đúng bước `logOut` cloud (mục 4.2) trước, nếu không sẽ lỗi. Bot do `managed_bot` tạo mới thì chưa gắn với server nào nên dùng thẳng được; bot cũ cần `logOut`. Đây là thay đổi code + deploy → chỉ làm khi được yêu cầu.

## 8. Webhook với local server

Storefront nhận update qua `POST /storefront-webhooks/:storefrontId` (header `X-Telegram-Bot-Api-Secret-Token`, so khớp timing-safe với secret mã hoá trong DB). Với local server, `setWebhook` có thể trỏ URL `http://` nội bộ, nhưng cấu hình shop hiện **bắt buộc** `STOREFRONT_WEBHOOK_ORIGIN` là `https:` (`loadStorefrontConfig`), nên cứ giữ HTTPS qua nginx.

## 9. Checklist trước khi bật

- [ ] `.env.botapi` có `api_id`/`api_hash`, `chmod 600`, không nằm trong git
- [ ] `docker compose ps` thấy `shop_telegram_bot_api` Up
- [ ] Không có `ports:` cho service này
- [ ] Đã `logOut` cloud cho bot sắp chuyển
- [ ] Chỉ một bot đổi mỗi lần; xong gửi `/start` thử trước khi đổi bot kế
- [ ] Có sẵn đường lui (mục 5)
