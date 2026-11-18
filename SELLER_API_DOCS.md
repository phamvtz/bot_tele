# 📖 HƯỚNG DẪN TÍCH HỢP SELLER API (CẤP KEY AI & TỰ ĐỘNG TRỪ VÍ)

Tài liệu hướng dẫn kết nối hệ thống API dành cho Đối tác / Seller. Hệ thống hỗ trợ cấp key AI (OpenAI GPT, Claude...), gia hạn, kiểm tra thông tin và **tự động trừ tiền vào số dư ví nạp qua Bot Telegram**.

---

## 1. Thông tin chung & Xác thực

- **Base URL:** `http://103.20.102.211:3001/api/seller`
- **Xác thực:** Mọi request gửi lên bắt buộc gửi kèm Header:
  ```http
  Authorization: Bearer <API_KEY_CỦA_BẠN>
  Content-Type: application/json
  ```
  *(Ví dụ: `Authorization: Bearer sk_a1b2c3d4e5f6...` do Admin cấp)*

---

## 2. Cơ chế Nạp tiền & Trừ ví tự động

1. **Nạp tiền vào tài khoản:**
   - Bạn sử dụng tài khoản Telegram cá nhân (đã đăng ký Telegram ID với Admin) mở bot **`@ShopAccountsPreBot`**.
   - Chọn mục **Nạp tiền** hoặc chuyển khoản VietQR tự động trong bot để cộng số dư vào ví.
2. **Trừ tiền khi gọi API:**
   - Khi bạn gọi API tạo key hoặc gia hạn key, hệ thống sẽ tự động quy đổi giá trị sang VNĐ và **trừ trực tiếp vào số dư ví Telegram của bạn**.
   - Không cần thanh toán thủ công từng đơn.
3. **Cơ chế bảo vệ & Hoàn tiền tự động:**
   - Nếu số dư ví không đủ, API sẽ từ chối và báo rõ số tiền cần nạp thêm.
   - Nếu server AI gặp sự cố hoặc gián đoạn mạng, hệ thống **tự động hoàn tiền 100% vào ví ngay lập tức**.

---

## 3. Danh sách các API Endpoints

### 3.1. Kiểm tra số dư ví hiện tại
Kiểm tra số dư VNĐ trong ví bot Telegram của bạn.

- **Endpoint:** `GET /api/seller/balance`
- **Ví dụ cURL:**
  ```bash
  curl -X GET "http://103.20.102.211:3001/api/seller/balance" \
       -H "Authorization: Bearer <API_KEY>"
  ```
- **Phản hồi thành công (HTTP 200):**
  ```json
  {
    "ok": true,
    "telegramId": "5912345678",
    "balance": 500000,
    "active": true
  }
  ```

---

### 3.2. Xem thông tin tài khoản đầy đủ
Xem thông tin tài khoản, tên seller, hạn mức ngày và số dư.

- **Endpoint:** `GET /api/seller/me`
- **Ví dụ cURL:**
  ```bash
  curl -X GET "http://103.20.102.211:3001/api/seller/me" \
       -H "Authorization: Bearer <API_KEY>"
  ```
- **Phản hồi thành công (HTTP 200):**
  ```json
  {
    "ok": true,
    "seller": {
      "name": "Đại lý Nam",
      "telegramId": "5912345678",
      "walletBalance": 500000,
      "user": {
        "firstName": "Nam",
        "username": "nam_reseller"
      },
      "limits": {
        "maxKeysPerDay": 0,
        "maxTokensPerDay": 0,
        "usedToday": {
          "keys": 5,
          "tokens": 5000000
        }
      }
    }
  }
  ```

---

### 3.3. Xem bảng giá & Danh sách gói Key AI
Lấy danh sách các gói model (GPT-4o, Claude...), đơn giá USD và số token min/max.

- **Endpoint:** `GET /api/seller/profiles`
- **Ví dụ cURL:**
  ```bash
  curl -X GET "http://103.20.102.211:3001/api/seller/profiles" \
       -H "Authorization: Bearer <API_KEY>"
  ```
- **Phản hồi thành công (HTTP 200):**
  ```json
  {
    "profiles": [
      {
        "id": "gpt4o_general",
        "name": "GPT-4o Standard",
        "pricePerMillion": 0.5,
        "minTokens": 100000,
        "maxTokens": 50000000,
        "defaultRpm": 60,
        "validDays": 30
      }
    ]
  }
  ```

---

### 3.4. Tạo API Key AI mới (Tự động trừ ví)
Tạo key AI cho khách hàng của bạn. Số tiền sẽ tự động trừ vào ví.

- **Endpoint:** `POST /api/seller/keys`
- **Payload Parameters:**
  | Trường | Kiểu | Bắt buộc | Mô tả |
  | :--- | :---: | :---: | :--- |
  | `profileId` | string | Không | ID gói key (mặc định lấy gói tiêu chuẩn) |
  | `quotaTokens`| number | Có | Số lượng token cần cấp (vd: `1000000` = 1M token) |
  | `name` | string | Không | Tên gợi nhớ/khách hàng (tối đa 60 ký tự) |
  | `validDays` | number | Không | Số ngày sử dụng (vd: `30` ngày) |
  | `clientRef` | string | **Khuyên dùng** | Mã đơn riêng của bạn để chống tạo trùng khi mạng chập chờn |

- **Ví dụ cURL:**
  ```bash
  curl -X POST "http://103.20.102.211:3001/api/seller/keys" \
       -H "Authorization: Bearer <API_KEY>" \
       -H "Content-Type: application/json" \
       -d '{
         "profileId": "gpt4o_general",
         "quotaTokens": 1000000,
         "name": "DonHang_KH001",
         "validDays": 30,
         "clientRef": "MY_ORDER_1001"
       }'
  ```
- **Phản hồi thành công (HTTP 200):**
  ```json
  {
    "ok": true,
    "id": "ck_6ae5973f00c91f175a6f547c",
    "key": "sk-gpt2api-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "keyMasked": "sk-gpt2...9a4c",
    "quotaTokens": 1000000,
    "validDays": 30,
    "expiresAt": "2026-11-30T15:00:00.000Z",
    "priceUsd": 2.0,
    "priceVnd": 51200,
    "newBalance": 448800
  }
  ```
  *(Lưu ý: Chuỗi `key` đầy đủ chỉ trả về một lần duy nhất lúc tạo để bảo mật. Hãy lưu lại ngay).*

---

### 3.5. Gia hạn thêm Token / Ngày cho Key (Tự động trừ ví)
Nạp thêm token hoặc gia hạn thêm hạn dùng cho key đã cấp trước đó.

- **Endpoint:** `PATCH /api/seller/keys/:id`
- **Payload Parameters:**
  | Trường | Kiểu | Mô tả |
  | :--- | :---: | :--- |
  | `addTokens` | number | Số token nạp thêm (vd: `500000`) |
  | `addDays` | number | Số ngày gia hạn thêm (vd: `30`) |
  | `clientRef` | string | Mã đối soát chống gia hạn trùng lặp |

- **Ví dụ cURL:**
  ```bash
  curl -X PATCH "http://103.20.102.211:3001/api/seller/keys/ck_6ae5973f00c91f175a6f547c" \
       -H "Authorization: Bearer <API_KEY>" \
       -H "Content-Type: application/json" \
       -d '{
         "addTokens": 500000,
         "addDays": 30,
         "clientRef": "RENEW_ORDER_2001"
       }'
  ```
- **Phản hồi thành công (HTTP 200):**
  ```json
  {
    "ok": true,
    "id": "ck_6ae5973f00c91f175a6f547c",
    "addTokens": 500000,
    "addDays": 30,
    "quotaTokens": 1500000,
    "renewCount": 1,
    "valueUsd": 1.25,
    "priceVnd": 32000,
    "newBalance": 416800
  }
  ```

---

### 3.6. Kiểm tra chi tiết 1 Key & Mức tiêu thụ thực tế
Xem thông tin sống của key (đã dùng bao nhiêu token, còn lại bao nhiêu, trạng thái active hay hết hạn).

- **Endpoint:** `GET /api/seller/keys/:id`
- **Ví dụ cURL:**
  ```bash
  curl -X GET "http://103.20.102.211:3001/api/seller/keys/ck_6ae5973f00c91f175a6f547c" \
       -H "Authorization: Bearer <API_KEY>"
  ```
- **Phản hồi:**
  ```json
  {
    "key": {
      "id": "ck_6ae5973f00c91f175a6f547c",
      "key": "sk-gpt2...9a4c",
      "name": "DonHang_KH001",
      "status": "active",
      "quotaTokens": 1000000,
      "usedTokens": 250000,
      "remainingTokens": 750000,
      "expiresAt": "2026-11-30T15:00:00.000Z"
    },
    "endpoint": "https://api.openai-proxy.com/v1"
  }
  ```

---

### 3.7. Xem danh sách key đã cấp
Xem danh sách toàn bộ các key do chính tài khoản seller này tạo (key hiển thị dưới dạng che `sk-gpt2...9a4c`).

- **Endpoint:** `GET /api/seller/keys?page=1&limit=20`
- **Ví dụ cURL:**
  ```bash
  curl -X GET "http://103.20.102.211:3001/api/seller/keys?page=1&limit=20" \
       -H "Authorization: Bearer <API_KEY>"
  ```

---

### 3.8. Tắt / Bật hoặc Thu hồi Key
- **Tạm khóa / Mở lại key:** `PATCH /api/seller/keys/:id/enabled`
  ```bash
  curl -X PATCH "http://103.20.102.211:3001/api/seller/keys/:id/enabled" \
       -H "Authorization: Bearer <API_KEY>" \
       -H "Content-Type: application/json" \
       -d '{ "enabled": false }'
  ```
- **Thu hồi vĩnh viễn key:** `DELETE /api/seller/keys/:id?revoke=true`
  ```bash
  curl -X DELETE "http://103.20.102.211:3001/api/seller/keys/:id?revoke=true" \
       -H "Authorization: Bearer <API_KEY>"
  ```

---

## 4. Bảng mã lỗi thường gặp (Error Handling)

| Mã HTTP | Mã lỗi (`code`) | Nguyên nhân & Cách xử lý |
| :---: | :--- | :--- |
| `400` | `insufficient_balance` | **Số dư ví bot không đủ.** Phản hồi sẽ trả về rõ `shortfall` (số tiền còn thiếu). Hãy vào bot Telegram nạp thêm tiền và thử lại. |
| `400` | `client_ref_too_long` | `clientRef` dài quá 64 ký tự. |
| `401` | `unauthorized` | API key không hợp lệ hoặc thiếu header Authorization. |
| `403` | `forbidden` | API key của bạn đã bị Admin tạm dừng. |
| `409` | `duplicate` | `clientRef` này đã được sử dụng tạo key trước đó (hệ thống không trừ tiền lần 2). |
| `429` | `rate_limit_exceeded`| Vượt quá giới hạn số key hoặc số token được phép tạo trong ngày. |
| `502` | `provider_error` | Server cấp key AI gặp sự cố. **Tiền đã được hoàn lại 100% vào ví của bạn**. |

---

## 5. Ví dụ code mẫu tích hợp

### Node.js (JavaScript / TypeScript)
```javascript
const API_URL = "http://103.20.102.211:3001/api/seller";
const API_KEY = "sk_your_seller_key_here";

async function createApiKey(clientOrderId, tokens) {
  const response = await fetch(`${API_URL}/keys`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      quotaTokens: tokens,
      name: `Order_${clientOrderId}`,
      validDays: 30,
      clientRef: String(clientOrderId)
    })
  });

  const data = await response.json();
  if (!response.ok) {
    if (data.code === "insufficient_balance") {
      console.error(`Số dư ví không đủ! Cần thêm ${data.shortfall}đ`);
    }
    throw new Error(data.error);
  }

  console.log("Cấp key thành công:", data.key);
  console.log("Số dư ví còn lại:", data.newBalance);
  return data;
}
```

### Python 3
```python
import requests

API_URL = "http://103.20.102.211:3001/api/seller"
API_KEY = "sk_your_seller_key_here"

headers = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json"
}

def create_key(order_id, tokens=1000000):
    payload = {
        "quotaTokens": tokens,
        "name": f"Order_{order_id}",
        "validDays": 30,
        "clientRef": str(order_id)
    }
    res = requests.post(f"{API_URL}/keys", json=payload, headers=headers)
    data = res.json()
    
    if res.status_code == 200:
        print(f"Key mới: {data['key']}")
        print(f"Số dư ví mới: {data['newBalance']} VND")
        return data
    else:
        print(f"Lỗi: {data.get('error')}")
        return None
```
