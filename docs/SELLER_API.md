# Seller API — Tài liệu tích hợp

API dành cho đối tác (seller) kết nối trực tiếp vào shop: nạp hàng, cấp và quản lý API key `sk-*`, và xem thống kê.

- **Base URL**: `http://18.142.51.173:3001/api/seller`
- **Định dạng**: JSON (request và response). Gửi `Content-Type: application/json`.
- **Xác thực**: mọi endpoint đều bắt buộc.

```
Authorization: Bearer API_KEY_CỦA_BẠN
```

Hoặc dùng header thay thế: `x-api-key: API_KEY_CỦA_BẠN`

API key do shop cấp, có dạng `sk_` + 48 ký tự hex (tổng 51 ký tự). Thiếu key hoặc key sai → `401`.

> **Hai loại key khác nhau, đừng lẫn:**
>
> | Loại | Dạng | Là gì |
> |---|---|---|
> | **Key xác thực của bạn** | `sk_9f3a2b1c…` (gạch **dưới**) | Shop cấp cho bạn. Gửi trong header `Authorization`. |
> | **Key bạn tạo cho khách** | `sk-8f3a2b1c…` (gạch **ngang**) | `POST /keys` trả về. Đây là key API thật khách dùng để gọi model. |
>
> Trong tài liệu này, bản che luôn có dạng *7 ký tự đầu + `…` + 4 ký tự cuối*.

> **Giữ key tuyệt mật.** Key này cho phép **cấp key thật (tốn tiền)** và **nạp hàng** vào shop. Đừng commit vào Git, đừng đặt trong code phía trình duyệt, đừng gửi qua chat. Nếu nghi lộ, báo shop thu hồi ngay.

---

## Mục lục

1. [Quy tắc chung](#quy-tắc-chung)
2. [Idempotency — `clientRef`](#idempotency--clientref) *(đọc trước khi viết code tạo key)*
3. [Cấp & quản lý API key](#cấp--quản-lý-api-key)
   - [POST /keys — tạo key](#post-keys--tạo-key)
   - [GET /keys — danh sách key](#get-keys--danh-sách-key)
   - [GET /keys/:id — chi tiết một key](#get-keysid--chi-tiết-một-key)
   - [PATCH /keys/:id — gia hạn](#patch-keysid--gia-hạn)
   - [PATCH /keys/:id/enabled — bật/tắt](#patch-keysidenabled--bậttắt)
   - [DELETE /keys/:id — thu hồi](#delete-keysid--thu-hồi)
4. [Thống kê](#thống-kê)
   - [GET /stats — tổng quan](#get-stats--tổng-quan)
   - [GET /stats/keys — key theo ngày](#get-statskeys--key-theo-ngày)
   - [GET /stats/users/daily — khách tiêu bao nhiêu mỗi ngày](#get-statsusersdaily--khách-tiêu-bao-nhiêu-mỗi-ngày)
5. [Nạp hàng & đơn hàng](#nạp-hàng--đơn-hàng)
   - [GET /products](#get-products)
   - [POST /stock](#post-stock)
   - [POST /stock/text](#post-stocktext)
   - [GET /orders](#get-orders)
   - [GET /orders/:id](#get-ordersid)
6. [Cấu hình server](#cấu-hình-server)
   - [GET /profiles](#get-profiles)
7. [Trang tài liệu động](#trang-tài-liệu-động)
8. [Bảng mã lỗi](#bảng-mã-lỗi)

---

## Quy tắc chung

**Response thành công** luôn có `ok: true` (các endpoint key) hoặc trả thẳng dữ liệu.

**Response lỗi** luôn có `error` là chuỗi mô tả tiếng Việt:

```json
{ "error": "tokens không hợp lệ (vượt giới hạn)", "min": 1000000, "max": 5000000000 }
```

**Múi giờ**: mọi mốc ngày trong thống kê tính theo **giờ Việt Nam (UTC+7)**, không theo giờ máy chủ. Trường `tzOffsetMinutes: 420` cho biết điều đó.

**Số tiền**: `revenueVnd` / `totalVnd` là số nguyên VND. `revenueUsd` / `valueUsd` / `priceUsd` là số thực USD, làm tròn 6 chữ số (riêng `valueUsd` làm tròn 2 chữ số).

**Phạm vi dữ liệu**: key và thống kê key chỉ trả về những gì **chính API key của bạn** tạo ra. Bạn không thấy key của seller khác hay key shop tự cấp.

---

## Idempotency — `clientRef`

Đây là phần quan trọng nhất khi tích hợp. **Hãy đọc trước khi viết code tạo key.**

Mạng có thể timeout **sau khi** server đã tạo key. Nếu bạn retry mà không có gì để server nhận ra "đây là cùng một yêu cầu", mỗi lần retry sẽ tạo thêm **một key thật nữa** — và bạn phải trả tiền cho những key không ai dùng.

`clientRef` là chuỗi **do bạn tự chọn** để đánh dấu một yêu cầu duy nhất (thường là mã đơn hàng phía bạn).

| Tình huống | Kết quả |
|---|---|
| Gửi lần đầu với `clientRef = "DH-1001"` | Tạo key, trả về **chuỗi key đầy đủ** |
| Gửi lại **đúng** `clientRef = "DH-1001"` | `200` + `duplicate: true`, key trả về **đã che** |
| Gửi với `clientRef` khác (hoặc không gửi) | Tạo **một key mới** |

Ví dụ response khi trùng:

```json
{
  "ok": true,
  "duplicate": true,
  "id": "...",
  "key": "sk-8f3a…d7e8",
  "pending": false,
  "note": "clientRef này đã được dùng. Key đầy đủ chỉ trả về ở lần tạo đầu tiên."
}
```

> ⚠️ **Chuỗi key đầy đủ chỉ được trả về ĐÚNG MỘT LẦN**, ở response của lần tạo đầu tiên. Các lần gọi sau — kể cả `GET /keys` — chỉ trả bản che (`sk-8f3a…d7e8`). **Bạn phải lưu lại key ngay khi nhận được.** Shop không thể lấy lại chuỗi thật cho bạn; nếu mất thì phải thu hồi key cũ và cấp key mới.

Quy tắc `clientRef`:

- Tối đa **100 ký tự**. Dài hơn → `400` với `code: "client_ref_too_long"` (server **không** tự cắt ngắn, vì hai chuỗi dài khác nhau cắt ra có thể trùng nhau).
- Phân biệt theo API key: `clientRef` của bạn không đụng với `clientRef` giống hệt của seller khác.
- Dùng được cho cả `POST /keys` (tạo) và `PATCH /keys/:id` (gia hạn).

**Luôn gửi `clientRef`.** Chi phí là một chuỗi, lợi ích là không bao giờ tạo trùng key.

---

## Cấp & quản lý API key

### `POST /keys` — tạo key

Cấp một key `sk-*` thật. **Tốn tiền.**

**Body**

| Trường | Kiểu | Bắt buộc | Mặc định | Ghi chú |
|---|---|---|---|---|
| `tokens` | number \| string | **Có** | — | Số token (quota). Tối thiểu `1.000.000`, tối đa theo `maxBuyTokens` của server (xem `GET /profiles`). Nhận cả chuỗi dạng `"20m"`, `"1.5m"`, `"3tr"`, `"3.000.000"`. |
| `telegramId` | string | Không | `""` | ID Telegram của khách. Để trống = key không gắn với ai, chỉ quản lý qua API này. Có giá trị = key hiện trong `/mykey` của khách đó. Phải là chuỗi **chỉ gồm chữ số**, ≥ 3 ký tự. |
| `rpm` | number | Không | theo server | Giới hạn request/phút. Miền `10` – `10.000`. |
| `validDays` | number | Không | theo server | Số ngày hết hạn. Miền `1` – `3.650`. Gửi `0` = **không hết hạn** (key chỉ chết khi cạn quota). |
| `profileId` | number | Không | server đầu tiên đang mở | Chọn "server" (nhóm model). Xem `GET /profiles`. |
| `clientRef` | string | Không | — | **Khuyến nghị gửi.** Xem [Idempotency](#idempotency--clientref). |
| `name` | string | Không | tự sinh | Nhãn key, tối đa 60 ký tự. |
| `notify` | boolean | Không | `false` | `true` = gửi tin nhắn Telegram chứa key thẳng cho `telegramId`. Chỉ hoạt động khi có `telegramId`. |

**Ví dụ**

```bash
curl -X POST http://18.142.51.173:3001/api/seller/keys \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "tokens": 20000000,
    "rpm": 300,
    "validDays": 30,
    "telegramId": "123456789",
    "clientRef": "DH-1001",
    "name": "Khách A - gói 20M"
  }'
```

**Response `200`**

```json
{
  "ok": true,
  "id": "6a1b2c3d4e5f6a7b8c9d0e1f",
  "key": "sk-8f3a2b1c9d4e5f60718293a4b5c6d7e8",
  "keyMasked": "sk-8f3a…d7e8",
  "externalId": "public-id-phía-nhà-cung-cấp",
  "telegramId": "123456789",
  "quotaTokens": 20000000,
  "rpm": 300,
  "validDays": 30,
  "expiresAt": "2026-10-13T06:00:00.000Z",
  "profileId": 1,
  "profileName": "Mặc định",
  "models": ["claude", "gpt"],
  "endpoint": "https://...",
  "usageUrl": "https://...",
  "priceUsd": 0.35,
  "notified": true,
  "notifySkipped": null
}
```

| Trường | Ý nghĩa |
|---|---|
| `id` | ID của key trong hệ thống shop. **Dùng giá trị này cho mọi endpoint `/keys/:id` về sau.** |
| `key` | Chuỗi thật. Chỉ xuất hiện ở đây, một lần. Lưu lại ngay. |
| `keyMasked` | Bản che, dùng để hiển thị cho khách. |
| `externalId` | ID phía nhà cung cấp. `null` nếu provider không trả về. |
| `expiresAt` | `null` = không hết hạn. |
| `priceUsd` | Giá vốn của key theo đơn giá server — dùng để đối soát. |
| `notified` | Đã gửi tin Telegram cho khách thành công. |
| `notifySkipped` | `null`, `"no_telegram_id"` hoặc `"send_failed"`. |

**Lỗi thường gặp**

| HTTP | `code` | `retryable` | Nên làm gì |
|---|---|---|---|
| `400` | — | — | Tham số sai (`tokens`/`rpm`/`validDays`/`telegramId` ngoài miền, hoặc shop chưa cấu hình). Sửa rồi gửi lại. |
| `400` | `client_ref_too_long` | — | Rút ngắn `clientRef` xuống ≤ 100 ký tự. |
| `409` | `disabled` | `true` | Server này đang **ngừng bán**. Chọn `profileId` khác. |
| `429` | — | — | Vượt trần ngày của API key bạn. Xem [Giới hạn theo ngày](#giới-hạn-theo-ngày). |
| `502` | `network` / khác | `true` | Lỗi **trước khi** yêu cầu tới nhà cung cấp. Chưa có key nào được tạo — **an toàn gửi lại đúng `clientRef` đó**. |
| `502` | `network` / khác | `false` | **Không xác định được** key đã tạo hay chưa. Xem ngay bên dưới. |

> 🚨 **Khi `retryable: false`** — response kèm `reconcileId`:
> ```json
> {
>   "error": "Không xác định được key đã được tạo hay chưa",
>   "code": "network",
>   "retryable": false,
>   "reconcileId": "6a1b...",
>   "note": "Yêu cầu có thể đã tạo key phía nhà cung cấp. ĐỪNG retry bằng clientRef khác — gửi lại đúng clientRef này, hoặc báo shop đối soát reconcileId."
> }
> ```
> **Không retry bằng `clientRef` mới** — nếu yêu cầu cũ thật sự đã tạo key, bạn sẽ có hai key và trả tiền hai lần. Hoặc gửi lại **đúng `clientRef` cũ**, hoặc báo shop kèm `reconcileId` để đối soát.

**Giới hạn theo ngày**

API key của bạn có thể bị shop đặt trần. Vượt trần → `429`:

```json
{ "error": "Vượt trần 100 key/ngày", "usedToday": 100, "limit": 100 }
{ "error": "Vượt trần 500000000 token/ngày", "usedToday": 490000000, "limit": 500000000 }
```

Trần hiện tại của key bạn xem ở [trang tài liệu động](#trang-tài-liệu-động). `0` hoặc không có = không giới hạn. Trần tính theo ngày giờ Việt Nam.

---

### `GET /keys` — danh sách key

Key do **chính API key này** cấp. Không trả chuỗi `sk-*` thật.

**Query**

| Tham số | Mặc định | Ghi chú |
|---|---|---|
| `page` | `1` | Trang, bắt đầu từ 1. |
| `limit` | `50` | Số dòng/trang, tối đa `100`. |
| `live` | `1` | `0` = **không** gọi nhà cung cấp lấy số liệu sống. Nhanh hơn nhiều (bỏ được 4 request HTTP mỗi trang) nhưng không có quota/thời gian sử dụng thực tế. |

```bash
curl "http://18.142.51.173:3001/api/seller/keys?page=1&limit=20" \
  -H "Authorization: Bearer $API_KEY"
```

**Response `200`**

```json
{
  "keys": [
    {
      "id": "6a1b2c3d4e5f6a7b8c9d0e1f",
      "key": "sk-8f3a…d7e8",
      "keyRevealed": false,
      "pending": false,
      "telegramId": "123456789",
      "quotaTokens": 20000000,
      "rpm": 300,
      "models": ["claude", "gpt"],
      "profileId": 1,
      "profileName": "Mặc định",
      "expiresAt": "2026-10-13T06:00:00.000Z",
      "renewCount": 0,
      "lastRenewAt": null,
      "createdAt": "2026-09-13T06:00:00.000Z",
      "hidden": false,
      "live": { "...": "xem bên dưới" }
    }
  ],
  "page": 1,
  "limit": 20,
  "total": 57,
  "pages": 3,
  "liveOk": true
}
```

| Trường | Ý nghĩa |
|---|---|
| `key` | **Luôn luôn là bản che** ở endpoint này. |
| `keyRevealed` | `false` — khẳng định bản trên là bản che. |
| `pending` | `true` = đã giữ chỗ nhưng nhà cung cấp **chưa** trả key (hoặc yêu cầu cũ gặp lỗi mơ hồ). **Đừng báo khách là đã có key.** Liên hệ shop kèm `id`. |
| `hidden` | `true` = key đã bị thu hồi/ẩn khỏi `/mykey` của khách. |
| `liveOk` | `false` = không đọc được nhà cung cấp, mọi `live.status` sẽ là `"unknown"`. |
| `live` | Chỉ có khi `live=1`. Xem bên dưới. |

**Khối `live` — số liệu thực tế từ nhà cung cấp**

```json
{
  "live": true,
  "status": "active",
  "quotaTokensLive": 20000000,
  "usedTokensLive": 4500000,
  "usedPct": 23,
  "unlimitedQuota": false,
  "daysLeft": 28,
  "expiresAtLive": "2026-10-13T06:00:00Z",
  "enabled": true,
  "lastUsedAt": "2026-09-13T05:00:00Z",
  "rpmLive": 300,
  "effectiveRpm": 300,
  "renewability": { "canAddTokens": true, "canAddDays": true }
}
```

Hai con số quota **cố ý khác nhau**: `quotaTokens` (ở cấp ngoài) là số **đã bán lúc cấp**, `quotaTokensLive` là số **đang có thật** ở nhà cung cấp. Sau khi gia hạn chúng lệch nhau — đó là chuyện bình thường.

Khi `live: false` (không đọc được provider), các trường số liệu là `null` và `status` là `"unknown"`:

```json
{ "live": false, "status": "unknown", "usedPct": null, "daysLeft": null,
  "unlimitedQuota": null, "enabled": null, "quotaTokensLive": null, "usedTokensLive": null }
```

> ⚠️ **`"unknown"` KHÔNG có nghĩa là key đã bị xoá.** Nó nghĩa là "lúc này không đọc được nhà cung cấp". Đừng tự động cấp key mới cho khách khi thấy `"unknown"` — key cũ có thể vẫn đang chạy tốt. `"missing"` mới nghĩa là key không còn ở nhà cung cấp.

**Giá trị `live.status`**

| `status` | Ý nghĩa | Nên làm gì |
|---|---|---|
| `active` | Khoẻ | — |
| `low` | Sắp cạn (≥ 80% quota, hoặc còn ≤ 3 ngày) | Mời khách gia hạn |
| `exhausted` | Hết quota | Gia hạn bằng `addTokens` |
| `expired` | Quá ngày hết hạn | Gia hạn bằng `addDays` |
| `disabled` | Đã bị tắt | Bật lại bằng `PATCH /keys/:id/enabled` |
| `missing` | Không còn ở nhà cung cấp | Phải cấp key mới |
| `unknown` | Không đọc được nhà cung cấp | **Chờ và thử lại**, đừng cấp mới |

Key vừa cạn quota vừa quá hạn sẽ báo `exhausted` (cái khách chạm phải trước).

---

### `GET /keys/:id` — chi tiết một key

Đọc số liệu sống **trực tiếp** (không qua cache 60 giây như danh sách).

```bash
curl "http://18.142.51.173:3001/api/seller/keys/6a1b2c3d4e5f6a7b8c9d0e1f" \
  -H "Authorization: Bearer $API_KEY"
```

**Response `200`**

```json
{
  "key": { "id": "...", "key": "sk-8f3a…d7e8", "live": { "...": "..." } },
  "endpoint": "https://...",
  "usageUrl": "https://..."
}
```

`404` nếu id không tồn tại **hoặc không thuộc API key của bạn** — hai trường hợp này cố ý trả về giống nhau.

---

### `PATCH /keys/:id` — gia hạn

Cộng thêm quota và/hoặc kéo dài thời hạn cho key **đang có**. Chuỗi `sk-*` **giữ nguyên** — khách không phải đổi gì trong ứng dụng của họ.

**Body**

| Trường | Kiểu | Ghi chú |
|---|---|---|
| `addTokens` | number | Số token **cộng thêm**. ≥ 1 nếu gửi. |
| `addDays` | number | Số ngày **cộng thêm**. Tối đa `3.650`. |
| `clientRef` | string | **Khuyến nghị gửi.** Chống gia hạn trùng. |

Phải có **ít nhất một** trong `addTokens` / `addDays` lớn hơn 0, nếu không → `400`.

```bash
curl -X PATCH "http://18.142.51.173:3001/api/seller/keys/6a1b2c3d4e5f6a7b8c9d0e1f" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "addTokens": 10000000, "addDays": 30, "clientRef": "GH-1001" }'
```

**Response `200`**

```json
{
  "ok": true,
  "id": "6a1b2c3d4e5f6a7b8c9d0e1f",
  "addTokens": 10000000,
  "addDays": 30,
  "before": { "quotaLimit": 3000000, "expiresAt": "2026-10-01T00:00:00Z" },
  "after":  { "quotaLimit": 4500000, "expiresAt": "2026-11-13T06:00:00Z" },
  "quotaTokens": 30000000,
  "renewCount": 1,
  "valueUsd": 0.21,
  "storeSyncFailed": false
}
```

| Trường | Ý nghĩa |
|---|---|
| `before` / `after` | Số thô phía nhà cung cấp, trước và sau. `null` nếu không đọc được. |
| `quotaTokens` | Tổng quota sau gia hạn, quy đổi về số token hiển thị. |
| `valueUsd` | Giá trị phần vừa cộng thêm (USD) — dùng đối soát. |
| `storeSyncFailed` | `true` = nhà cung cấp **đã** gia hạn thành công nhưng shop chưa cập nhật được bản ghi nội bộ. **Key của khách vẫn có thêm quota thật.** Shop sẽ tự đối soát; bạn không cần làm gì. |

Gửi lại **đúng `clientRef`** của một lượt gia hạn đã xong → `200` kèm `duplicate: true` và biên nhận cũ, **không** gọi nhà cung cấp lần nữa:

```json
{
  "ok": true, "duplicate": true, "id": "...",
  "quotaTokens": 30000000, "expiresAt": "2026-11-13T06:00:00.000Z", "renewCount": 1,
  "note": "clientRef này đã được gia hạn. Không gọi lại nhà cung cấp."
}
```

**Lỗi**

| HTTP | `code` | `retryable` | Ý nghĩa & cách xử lý |
|---|---|---|---|
| `400` | — | — | Thiếu `addTokens`/`addDays`, hoặc ngoài miền, hoặc `clientRef` quá dài. |
| `404` | — | — | Key không tồn tại hoặc không thuộc bạn. |
| `409` | `no_external_id` | — | Key không có id phía nhà cung cấp → không gia hạn được. Báo shop. |
| `409` | `key_not_found` | `true` | Key đã bị xoá phía nhà cung cấp. Chưa cộng gì — có thể thử lại hoặc cấp key mới. |
| `409` | `not_configured` | `true` | Server của key này chưa cấu hình. Báo shop. |
| `409` | `nothing_to_renew` | `true` | Không có gì để cộng. |
| `409` | `renew_in_progress` | **`false`** | Có một lượt gia hạn **chưa chốt kết quả**. Xem cảnh báo dưới. |
| `502` | `quota_not_applied` / `expiry_not_applied` | `false` | Nhà cung cấp nhận lệnh nhưng **không áp dụng**. Có thể đã cộng một phần. `renewBlocked: true`. |
| `502` | `network` | `false` | Không xác định được PATCH đã tới nơi hay chưa. `renewBlocked: true`. |

> 🚨 **`retryable: false` nghĩa là ĐỪNG TỰ RETRY.**
>
> `quota_limit` phía nhà cung cấp là số **tuyệt đối** và shop phải *đọc-rồi-cộng*. Nếu lượt cũ thật ra đã cộng quota mà shop tự chạy lại, khách sẽ được cộng **hai lần miễn phí**. Vì vậy shop cố ý **khoá** key đó lại và đẩy cho người đối soát.
>
> Khi gặp `renew_in_progress` / `quota_not_applied` / `expiry_not_applied` / `network`:
> 1. **Không** retry bằng `clientRef` khác.
> 2. Có thể gửi lại **đúng `clientRef` cũ** — nếu lượt đó đã xong, bạn nhận biên nhận cũ; nếu đang treo, bạn vẫn nhận `409`.
> 3. Nếu vẫn `409`, báo shop kèm `id` của key. Shop sẽ đối soát và mở khoá.

---

### `PATCH /keys/:id/enabled` — bật/tắt

Tắt hoặc mở lại key, **không xoá**. Dùng khi khách chưa thanh toán, hoặc cần tạm ngưng mà vẫn giữ quota.

**Body**: `{ "enabled": true }` hoặc `{ "enabled": false }`

Bỏ trống / gửi giá trị không phải `false` → hiểu là `true` (bật).

```bash
curl -X PATCH "http://18.142.51.173:3001/api/seller/keys/6a1b2c3d4e5f6a7b8c9d0e1f/enabled" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "enabled": false }'
```

**Response `200`**

```json
{ "ok": true, "id": "6a1b...", "enabled": false }
```

`enabled` trong response là giá trị **nhà cung cấp đang thật sự giữ**, đọc lại sau khi đổi — không phải là echo từ request của bạn. Nếu nhà cung cấp không áp dụng, bạn nhận `502` với `code: "enabled_not_applied"` kèm trạng thái thật.

Lỗi: `404` (không thuộc bạn), `409` (`no_external_id`), `502` (nhà cung cấp từ chối / không đọc lại được).

---

### `DELETE /keys/:id` — thu hồi

**Query**: `?revoke=true` (mặc định) hoặc `?revoke=false`

| | `revoke=true` (mặc định) | `revoke=false` |
|---|---|---|
| Tắt key phía nhà cung cấp | ✅ Có — khách **ngừng gọi được ngay** | ❌ Không — **key vẫn dùng được** |
| Ẩn khỏi `/mykey` của khách | ✅ Có | ✅ Có |

Dùng `revoke=false` khi bạn không muốn bán cho khách này nữa nhưng **không muốn cắt giữa chừng** (ví dụ khách đã trả tiền cho kỳ này).

```bash
curl -X DELETE "http://18.142.51.173:3001/api/seller/keys/6a1b2c3d4e5f6a7b8c9d0e1f?revoke=true" \
  -H "Authorization: Bearer $API_KEY"
```

**Response `200`**

```json
{
  "ok": true,
  "id": "6a1b...",
  "providerRevoked": true,
  "hiddenFromMykey": true,
  "stillUsable": false
}
```

> ⚠️ **Luôn kiểm tra `stillUsable`.** Nếu `true` nghĩa là key **vẫn đang sống** — đừng tưởng đã cắt mà khách vẫn gọi được. Trường hợp này xảy ra với `revoke=false`, hoặc khi key không có `externalId` (`409`, `code: "no_external_id"` — chỉ ẩn được, không thu hồi được).

Bản ghi **không bị xoá**: nó là sổ doanh thu và là nguồn cho job nhắc hết hạn. Key đã thu hồi vẫn hiện trong `GET /keys` với `hidden: true`.

---

## Thống kê

### `GET /stats` — tổng quan

```bash
curl "http://18.142.51.173:3001/api/seller/stats" -H "Authorization: Bearer $API_KEY"
```

```json
{ "totalOrders": 1250, "pendingOrders": 8, "totalProducts": 24, "myKeys": 57 }
```

| Trường | Ý nghĩa |
|---|---|
| `totalOrders` | Đơn đã thanh toán / đã giao của **toàn shop**. |
| `pendingOrders` | Đơn đang chờ thanh toán của **toàn shop**. |
| `totalProducts` | Sản phẩm đang mở bán. |
| `myKeys` | Số key do **chính API key của bạn** cấp. |

---

### `GET /stats/keys` — key theo ngày

Key của riêng bạn, gộp theo ngày và theo trạng thái.

**Query**: `?days=30` (miền `1` – `366`)

```bash
curl "http://18.142.51.173:3001/api/seller/stats/keys?days=30" \
  -H "Authorization: Bearer $API_KEY"
```

```json
{
  "days": 30,
  "keys": 57,
  "truncated": false,
  "liveOk": true,
  "pending": 0,
  "totals": { "quotaTokens": 1140000000, "valueUsd": 19.95, "renewals": 12 },
  "byStatus": { "active": 40, "low": 8, "exhausted": 4, "expired": 3, "disabled": 1, "unknown": 1 },
  "daySeries": [
    { "date": "2026-08-15", "keys": 3, "quotaTokens": 60000000, "valueUsd": 1.05 }
  ]
}
```

| Trường | Ý nghĩa |
|---|---|
| `keys` | Tổng số key của bạn (toàn bộ, không chỉ trong khoảng `days`). |
| `pending` | Số key đang ở trạng thái chưa có key thật. |
| `truncated` | `true` = đã chạm trần quét **1.000 key**. Số liệu chỉ tính trên 1.000 key gần nhất — **không phải toàn bộ**. |
| `liveOk` | `false` = không đọc được nhà cung cấp; `byStatus` sẽ dồn vào `"unknown"`. |
| `totals.valueUsd` | Tổng giá vốn của key bạn đã cấp. |
| `totals.renewals` | Tổng số lượt gia hạn. |
| `daySeries` | Chỉ gồm **ngày có phát sinh**, xếp cũ → mới. |

---

### `GET /stats/users/daily` — khách tiêu bao nhiêu mỗi ngày

Doanh thu của **toàn shop** chia theo ngày, kèm bảng xếp hạng khách.

**Query**

| Tham số | Mặc định | Miền | Ghi chú |
|---|---|---|---|
| `days` | `30` | `1` – `366` | Số ngày, **tính cả hôm nay**. |
| `top` | `20` | `1` – `500` | Số khách trong bảng xếp hạng. |
| `user` | — | `u_` + 40 hex | Lọc đúng một khách, bằng mã lấy từ chính endpoint này. |

```bash
curl "http://18.142.51.173:3001/api/seller/stats/users/daily?days=30&top=10" \
  -H "Authorization: Bearer $API_KEY"
```

**Response `200`**

```json
{
  "days": 30,
  "from": "2026-08-14T17:00:00.000Z",
  "to": "2026-09-13T17:00:00.000Z",
  "statuses": ["PAID", "DELIVERING", "DELIVERED"],
  "tzOffsetMinutes": 420,
  "totals": {
    "revenueVnd": 45250000,
    "revenueUsd": 1740.5,
    "orders": 312,
    "users": 88,
    "avgVndPerDay": 1508333,
    "avgVndPerUser": 514204
  },
  "daySeries": [
    { "date": "2026-08-14", "revenueVnd": 0, "revenueUsd": 0, "orders": 0, "users": 0 },
    { "date": "2026-08-15", "revenueVnd": 1250000, "revenueUsd": 48.1, "orders": 9, "users": 6 }
  ],
  "topUsers": [
    {
      "user": "u_3f9a1c7b2e4d5a6f8b0c",
      "telegramId": null,
      "totalVnd": 8500000,
      "totalUsd": 327.9,
      "orders": 41,
      "activeDays": 12,
      "avgVndPerActiveDay": 708333,
      "avgVndPerDayInRange": 283333,
      "days": { "2026-08-15": 650000, "2026-08-17": 1200000 },
      "lastOrderAt": "2026-09-12T14:22:05.000Z"
    }
  ],
  "userCount": 88,
  "truncatedUserCount": 0,
  "user": null,
  "truncated": false,
  "scanned": 312,
  "pseudonym": {
    "stablePerApiKey": true,
    "reversible": false,
    "note": "Cùng một khách ra hai mã khác nhau với hai API key khác nhau."
  }
}
```

**Đọc các con số**

| Trường | Ý nghĩa |
|---|---|
| `statuses` | Chỉ đơn ở các trạng thái này được tính: `PAID`, `DELIVERING`, `DELIVERED` — tức **tiền đã thu**. Đơn `PENDING` / `CANCELED` không tính. |
| `from` / `to` | Khoảng thời gian dạng UTC. `to` là **không bao gồm**. |
| `daySeries` | **Luôn đủ `days` phần tử**, kể cả ngày không có đơn (ngày đó toàn `0`). |
| `users` (trong ngày) | Số khách **khác nhau** mua trong ngày đó. |
| `totals.avgVndPerDay` | Chia cho **số ngày trong khoảng** — "mỗi ngày shop thu bao nhiêu", kể cả ngày ế. |
| `totals.avgVndPerUser` | Chia cho số khách. |
| `activeDays` | Số ngày khách **có mua**. |
| `avgVndPerActiveDay` | Trung bình theo ngày-có-mua — mô tả đúng hành vi khách. |
| `avgVndPerDayInRange` | Trung bình theo toàn bộ khoảng — con số này luôn ≤ cái trên. |
| `days` | Bản đồ `"YYYY-MM-DD" → số tiền VND` của riêng khách đó. |
| `userCount` | Tổng số khách có đơn trong khoảng. |
| `truncatedUserCount` | Số khách **không hiện** trong `topUsers` vì bị cắt bởi `top`. `0` = bảng đã đầy đủ. |
| `scanned` | Số đơn đã đọc để tính. |
| `truncated` | ⚠️ `true` = đã chạm trần quét, **mọi con số ở trên đều là con số thiếu**. Thu nhỏ `days` lại. |

> **`telegramId` luôn là `null`.** Danh tính khách của shop không được cung cấp cho seller. Mỗi khách được đại diện bằng một **mã ẩn danh** `u_...`:
> - Mã này **ổn định** với API key của bạn: cùng một khách luôn ra cùng một mã, nên bạn theo dõi được họ qua nhiều lần gọi.
> - Mã **khác nhau giữa các API key** — bạn không thể so khách của mình với danh sách của seller khác.
> - Mã **không đảo ngược được** thành Telegram ID thật.
> - Đổi API key mới = mất khả năng nối chuỗi mã cũ.

**Lọc một khách**

```bash
curl "http://18.142.51.173:3001/api/seller/stats/users/daily?days=30&user=u_3f9a1c7b2e4d5a6f8b0c" \
  -H "Authorization: Bearer $API_KEY"
```

Response có thêm khối `user` với `daySeries` và `totals` của riêng khách đó:

```json
{
  "user": {
    "user": "u_3f9a1c7b2e4d5a6f8b0c",
    "telegramId": null,
    "daySeries": [{ "date": "2026-08-15", "revenueVnd": 650000, "revenueUsd": 25.05, "orders": 4 }],
    "totals": {
      "revenueVnd": 8500000, "revenueUsd": 327.9, "orders": 41,
      "activeDays": 12, "avgVndPerActiveDay": 708333, "avgVndPerDayInRange": 283333
    },
    "skippedNotThisUser": { "wrongStatus": 0, "badDate": 0, "outOfRange": 0, "noUser": 0 }
  }
}
```

`user` chỉ nhận **mã `u_...`** lấy từ chính endpoint này. Gửi Telegram ID thô → `400`.

**Lỗi**: `400` (mã `user` sai định dạng), `503` (`code: "no_pseudonym_secret"` — shop chưa bật được tính ẩn danh nên endpoint từ chối trả dữ liệu; báo shop).

---

## Nạp hàng & đơn hàng

### `GET /products`

Danh sách sản phẩm đang mở bán.

```bash
curl "http://18.142.51.173:3001/api/seller/products" -H "Authorization: Bearer $API_KEY"
```

```json
{
  "products": [
    {
      "id": "6a930eb680d61abe346dc55b",
      "name": "Netflix Premium",
      "price": 50000,
      "currency": "VND",
      "deliveryMode": "STOCK_LINES",
      "description": "...",
      "stock": 42
    }
  ]
}
```

`stock` là `null` với sản phẩm **không** dùng chế độ `STOCK_LINES` (sản phẩm giao bằng nội dung cố định hoặc file thì không có kho đếm được). Số tồn kho cache 30 giây.

`deliveryMode`: `STOCK_LINES` (mỗi đơn lấy một dòng trong kho), `TEXT`, `FILE`, `API_KEY`.

---

### `POST /stock`

Nạp các dòng hàng (mỗi dòng là một tài khoản/mã bán được). Chỉ dùng cho sản phẩm `deliveryMode: "STOCK_LINES"`.

**Body**

| Trường | Kiểu | Bắt buộc |
|---|---|---|
| `productId` | string | **Có** |
| `lines` | string[] | **Có** — mảng không rỗng |

```bash
curl -X POST http://18.142.51.173:3001/api/seller/stock \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "productId": "6a930eb680d61abe346dc55b",
    "lines": ["user1:pass1", "user2:pass2", "user3:pass3"]
  }'
```

**Response `200`**

```json
{ "ok": true, "added": 3, "totalStock": 45, "product": "Netflix Premium" }
```

`added` là số dòng **thật sự được thêm** — dòng rỗng và dòng chỉ có khoảng trắng bị loại. `totalStock` là tồn kho sau khi nạp.

Nạp hàng sẽ tự **mở bán lại** sản phẩm nếu nó đang bị tắt vì hết hàng.

---

### `POST /stock/text`

Giống `POST /stock` nhưng gửi một chuỗi văn bản, **mỗi dòng một đơn vị hàng**. Tiện khi bạn có sẵn file.

**Body**: `{ "productId": "...", "text": "dòng1\ndòng2\ndòng3" }`

```bash
curl -X POST http://18.142.51.173:3001/api/seller/stock/text \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "productId": "6a930eb680d61abe346dc55b", "text": "user1:pass1\nuser2:pass2" }'
```

Response giống `POST /stock`.

**Lỗi chung của hai endpoint nạp hàng**

| HTTP | Nguyên nhân |
|---|---|
| `400` | Thiếu `productId`; `lines`/`text` rỗng; không có dòng hợp lệ; sản phẩm không dùng `STOCK_LINES`. |
| `404` | `productId` không tồn tại. |

---

### `GET /orders`

Đơn hàng gần đây.

**Query**

| Tham số | Mặc định | Ghi chú |
|---|---|---|
| `status` | — | Lọc theo trạng thái: `PENDING`, `PAID`, `DELIVERING`, `DELIVERED`, `CANCELED`. |
| `limit` | `20` | Tối đa `100`. |

```bash
curl "http://18.142.51.173:3001/api/seller/orders?status=PAID&limit=50" \
  -H "Authorization: Bearer $API_KEY"
```

**Response `200`**

```json
{
  "orders": [
    {
      "id": "6aa63c199f8934fdafd2a438",
      "shortId": "AFD2A438",
      "product": "Netflix Premium",
      "productId": "6a930eb680d61abe346dc55b",
      "quantity": 1,
      "amount": 50000,
      "currency": "VND",
      "status": "PAID",
      "paymentMethod": "vietqr",
      "createdAt": "2026-09-13T05:40:12.000Z"
    }
  ]
}
```

`shortId` là 8 ký tự cuối viết hoa — đây là mã khách thấy trên bot và là mã ghi trong nội dung chuyển khoản ngân hàng. Dùng nó khi trao đổi với shop hoặc với khách.

> **Endpoint này chỉ trả các trường trên.** Thông tin cá nhân của người mua (Telegram ID, tên, tài khoản đã bán) **không** được cung cấp.

---

### `GET /orders/:id`

```bash
curl "http://18.142.51.173:3001/api/seller/orders/6aa63c199f8934fdafd2a438" \
  -H "Authorization: Bearer $API_KEY"
```

**Response `200`**: `{ "order": { ... } }` — cùng cấu trúc với một phần tử của `GET /orders`.

`404` nếu không tìm thấy.

---

## Cấu hình server

### `GET /profiles`

Shop có thể bán nhiều "server" (mỗi server là một nhóm model + một đơn giá riêng). Endpoint này cho biết server nào đang mở và giới hạn của nó.

```bash
curl "http://18.142.51.173:3001/api/seller/profiles" -H "Authorization: Bearer $API_KEY"
```

```json
{
  "profiles": [
    {
      "profileId": 1,
      "name": "Mặc định",
      "enabled": true,
      "configured": true,
      "usdPerMtoken": 0.01,
      "maxBuyTokens": 1000000000000,
      "defaultRpm": 300,
      "defaultValidDays": 30,
      "rpmPresets": [100, 300, 600, 1200],
      "daysPresets": [1, 3, 7, 30, 90, 365],
      "models": ["claude", "gpt"],
      "endpoint": "https://...",
      "usageUrl": "https://...",
      "docUrl": "https://..."
    }
  ]
}
```

| Trường | Dùng để làm gì |
|---|---|
| `profileId` | Truyền vào `POST /keys` để chọn server. |
| `enabled` | `false` = server **ngừng bán**. Tạo key trên đó → `409 disabled`. |
| `configured` | `false` = server chưa cấu hình xong, chưa dùng được. |
| `usdPerMtoken` | Đơn giá: USD cho mỗi 1 triệu token. |
| `maxBuyTokens` | **Trần `tokens`** được phép tạo trên server này. |
| `defaultRpm` / `defaultValidDays` | Giá trị dùng khi bạn **không** gửi `rpm` / `validDays`. |
| `rpmPresets` / `daysPresets` | Các mức shop gợi ý. |
| `models` | Nhóm model mà key trên server này dùng được. |
| `endpoint` | URL gốc để khách gọi API bằng key `sk-*`. |

Giá một key được tính: `(tokens / 1.000.000) × usdPerMtoken × hệ_số_RPM × hệ_số_ngày`. Bạn không cần tự tính — `POST /keys` trả sẵn `priceUsd`, và `PATCH /keys/:id` trả sẵn `valueUsd`.

---

## Trang tài liệu động

```bash
curl "http://18.142.51.173:3001/api/seller/docs" -H "Authorization: Bearer $API_KEY"
```

Mở trực tiếp trên trình duyệt (cần đăng nhập bằng API key) sẽ thấy trang tài liệu HTML, **kèm trần ngày hiện tại của chính key bạn**. Đây là nơi kiểm tra nhanh giới hạn đang áp dụng.

---

## Bảng mã lỗi

### HTTP status

| Mã | Ý nghĩa | Retry được? |
|---|---|---|
| `200` | Thành công (kể cả `duplicate: true`) | — |
| `400` | Tham số sai / thiếu | Không — sửa tham số |
| `401` | Thiếu hoặc sai API key | Không |
| `404` | Không tìm thấy, **hoặc không thuộc API key của bạn** | Không |
| `409` | Xung đột trạng thái | Tuỳ `code` và `retryable` |
| `429` | Vượt trần ngày | Có — chờ sang ngày kế tiếp (giờ VN) |
| `500` | Lỗi nội bộ | Có, nhưng nên báo shop |
| `502` | Nhà cung cấp lỗi hoặc không xác định được | **Xem `retryable`** |
| `503` | Thiếu cấu hình phía shop | Không — báo shop |

### `code` thường gặp

| `code` | Ở đâu | Ý nghĩa |
|---|---|---|
| `client_ref_too_long` | `POST /keys`, `PATCH /keys/:id` | `clientRef` > 100 ký tự |
| `disabled` | `POST /keys` | Server đang ngừng bán |
| `not_configured` | `POST /keys`, `PATCH /keys/:id` | Server chưa cấu hình |
| `no_external_id` | `PATCH /keys/:id`, `/enabled`, `DELETE` | Key không có id phía nhà cung cấp |
| `key_not_found` | `PATCH /keys/:id`, `/enabled` | Key đã bị xoá phía nhà cung cấp |
| `nothing_to_renew` | `PATCH /keys/:id` | Không có gì để cộng |
| `renew_in_progress` | `PATCH /keys/:id` | Có lượt gia hạn chưa chốt — **không tự retry** |
| `quota_not_applied` | `PATCH /keys/:id` | Provider nhận lệnh nhưng không áp dụng quota |
| `expiry_not_applied` | `PATCH /keys/:id` | Provider nhận lệnh nhưng không áp dụng ngày hết hạn |
| `enabled_not_applied` | `PATCH /keys/:id/enabled` | Provider không đổi trạng thái bật/tắt |
| `network` | nhiều nơi | Lỗi mạng — **xem `retryable` để biết có nên thử lại** |
| `no_pseudonym_secret` | `GET /stats/users/daily` | Shop chưa bật được ẩn danh; báo shop |

### Nguyên tắc retry

1. **Luôn đọc `retryable`** trước khi thử lại. `retryable: true` = an toàn. `retryable: false` = **dừng lại và báo shop**.
2. **Luôn gửi cùng `clientRef`** khi retry một yêu cầu tạo key hoặc gia hạn.
3. Không bao giờ retry một ca `retryable: false` bằng `clientRef` mới.
4. Với `429`, chờ qua ngày kế tiếp theo giờ Việt Nam.
5. Với `502` / `500` lặp lại nhiều lần, báo shop — đừng retry vòng lặp vô hạn.

---

## Checklist tích hợp

- [ ] Lưu API key ở biến môi trường, **không** hardcode.
- [ ] Gửi `clientRef` cho **mọi** lần gọi `POST /keys` và `PATCH /keys/:id`.
- [ ] **Lưu chuỗi `key` ngay** khi nhận từ `POST /keys` — chỉ thấy một lần.
- [ ] Xử lý nhánh `duplicate: true` (không phải lỗi; key đã có rồi, nhưng bạn không nhận lại được chuỗi thật).
- [ ] Kiểm tra `pending` trước khi báo khách "đã có key".
- [ ] Tôn trọng `retryable: false` — dừng và báo shop, kèm `reconcileId` / `id`.
- [ ] Không cấp key mới khi thấy `live.status: "unknown"`.
- [ ] Kiểm tra `truncated` / `truncatedUserCount` trước khi tin số liệu thống kê.
- [ ] Gọi `GET /profiles` để lấy `maxBuyTokens` thay vì hardcode trần token.

---

## Liên hệ

Mọi ca `retryable: false`, key `pending: true`, hoặc số liệu nghi ngờ sai — báo shop kèm:

- `id` của key (hoặc `reconcileId` trong response lỗi)
- `clientRef` bạn đã dùng
- Thời điểm gọi (kèm múi giờ)
- Nguyên văn response lỗi

Shop có audit log đầy đủ cho mỗi lần gọi (`SELLER_CREATE_KEY`, `SELLER_RENEW_KEY`, `SELLER_KEY_AMBIGUOUS`, `SELLER_REVOKE_KEY`…) nên đối soát được chính xác chuyện gì đã xảy ra.
