# Plan — Quản lý admin cho "Cửa hàng API key" (GPT2API)

> Tiếp nối phiên 2026-08-30 ("lên plan chi tiết thêm quản lý admin của phần tạo api").
> Khảo sát nền do 3 agent thực hiện — tóm tắt ở mục "Hiện trạng".
>
> **Tiến độ (2026-08-31):**
> - [x] **A** — tab Kết nối GPT2API (route `/api/admin-react/gpt2api/*`, xoá route cũ)
> - [x] **C** — tab "Key đã cấp" (list/lọc/tìm/chi tiết + ẩn khỏi /mykey) + DB viewer
> - [ ] **B** — Giá & giới hạn (refactor pricing động)
> - [ ] **D** — Cấp key thủ công (`source=ADMIN`)
> - [ ] **E** — Breakout doanh thu API key

---

## 1. Mục tiêu

Thêm một khu **"Cửa hàng API key"** vào React admin (`/admin-new`, namespace
`/api/admin-react/*`) để quản lý toàn bộ phần tạo / bán API key GPT2API, gồm:

| # | Khối | Loại việc |
|---|------|-----------|
| A | Cấu hình kết nối GPT2API (base, token, user_id, models, fallback groups, endpoint, doc/usage URL, bật/tắt) | Thêm UI cho backend đã có |
| B | Cấu hình giá & giới hạn (USD/Mtoken, presets token/RPM/ngày, phụ phí RPM, phụ phí ngày, hệ số vĩnh viễn, trần mua, miền quota quà tặng) | **Refactor code** + UI |
| C | Danh sách key đã cấp (`IssuedApiKey`) — xem / lọc / tìm / chi tiết | Backend + UI mới hoàn toàn |
| D | Cấp key thủ công cho khách (`source = ADMIN`) | Backend + UI mới hoàn toàn |
| E | Thống kê doanh thu API key tách riêng | Nice-to-have |

---

## 2. Hiện trạng (kết quả khảo sát)

### Backend đã có
- `GET/PUT /api/admin/gpt2api-config` (`src/server.js:1987-2029`) — hoạt động đầy
  đủ: che token `adm_XXXXXXXX…YYYY`, "token rỗng = giữ nguyên",
  `invalidateGpt2apiConfig()`, `logAction`. **NHƯNG:**
  - Nằm ở **namespace CŨ** `?secret=` (`checkAdminSecret`), không phải header
    `x-admin-token` của React admin.
  - **Không có UI nào gọi** — orphan (grep chỉ ra `CLAUDE.md` + `server.js`).
  - Chỉ whitelist 14 key Setting — **thiếu toàn bộ knob pricing**.
- `src/gpt2api.js`: `getConfig()` merge DB Setting > env > default, cache 30s,
  `invalidateGpt2apiConfig()`. `createApiKey()`, `listModelGroups()`.
- `src/apikey-store.js`: `saveIssuedKey`, `listIssuedKeys(telegramId, limit)`,
  `countIssuedKeys`, `sumIssuedQuota` — **tất cả scoped theo `telegramId`**, chưa
  có hàm "list tất cả". `sumIssuedQuota` viết ra để "soi khách lạm dụng giftcode"
  nhưng **chưa ai gọi**.

### Chưa có
- **Không có view admin nào cho `IssuedApiKey`**: không trong DB viewer
  (`DB_ALLOWED` / `COLLECTION_TO_MODEL` thiếu `issuedApiKeys`), không route,
  không trang, không lệnh bot.
- `KeySource.ADMIN` đã định nghĩa (`apikey-store.js`) + render nhãn "admin"
  (`apikey-messages.js`) nhưng **không có code path nào tạo key `source: "ADMIN"`**.
- 5 knob pricing đọc **1 lần lúc load module** trong `src/apikey-pricing.js`
  → đổi phải sửa `.env` + **restart process**:
  `GPT2API_RPM_INCLUDED`, `GPT2API_RPM_SURCHARGE_PCT`, `GPT2API_DAY_SURCHARGE_PCT`,
  `GPT2API_NO_EXPIRY_MULT`, `GPT2API_MAX_BUY_M`.
  Cùng nhóm "hằng số, sửa phải deploy": `DEFAULT_RPM_PRESETS`,
  `DEFAULT_DAYS_PRESETS`, `FREE_MIN_M/MAX_M`, `DEFAULT_FREE_ALPHA`.
- Không có breakout doanh thu API key trong `src/stats.js` / `GET /stats`
  (đơn API key lẫn vào tổng `finalAmount` VND).

### Ràng buộc từ provider (xpiki `admin-pub`)
- Chỉ hỗ trợ **`POST /keys`** và **`GET /model-groups`**. **Không có** list key,
  không disable, không delete. → "thu hồi key" chỉ làm được ở **bản ghi local**;
  khách vẫn dùng key tới khi cạn quota.
- `createApiKey()` **tạo key thật, tốn credit** trên tài khoản shop → mọi nút tạo
  phải có bước xác nhận.
- `quota_limit` phía xpiki là **đơn vị credit, không phải token Claude literal** —
  chỗ nào hiện "≈ token" là ước lượng (memory `xpiki-quota-limit-unit`).

### Quy ước phải theo
- Mọi write Setting: `upsert` → `invalidate*()` **đồng bộ trước khi `res.json`** →
  `logAction("web-admin", "<ACTION>", "<target>", {...})`.
- Thêm 1 trang React = 3 sửa tách biệt: `App.jsx` (route), `Sidebar.jsx` (`NAV`),
  `TopBar.jsx` (`BREADCRUMBS`).
- `admin-react/dist/` **được commit**; rebuild (`cd admin-react && npm run build`)
  và commit **chung 1 commit** với source. Deploy VPS = `git pull` + restart,
  không build.
- Components dùng lại: `Modal`, `Toast`/`useToast`, `Pagination`, `SearchBar`,
  `TabFilter`, `StatsCard`, `Badge`, `EmptyState`.

---

## 3. Quyết định kiến trúc

1. **Route mới trong `/api/admin-react/*`** (`src/api-routes.js`, header auth).
   Không tái dùng route `?secret=` cũ.
2. **Xoá** `GET/PUT /api/admin/gpt2api-config` khỏi `server.js` sau khi route mới
   chạy (nó đang là orphan — không sợ vỡ gì). Cập nhật `CLAUDE.md`.
3. **Gộp 1 endpoint config** `/api/admin-react/gpt2api/config` cho cả A và B —
   whitelist là hợp của 2 nhóm key. GET che token + trả cả pricing knob + cờ
   `configured`/`tokenConfigured`.
4. **Pricing động**: mở rộng `SETTING_KEYS` + `getConfig()` trong `gpt2api.js`
   (tái dùng cache 30s + `invalidateGpt2apiConfig()` sẵn có). `apikey-pricing.js`
   giữ **hàm thuần** — nhận config qua tham số, default = hằng số hiện tại (test
   không đổi).
5. "Thu hồi key" = **ẩn khỏi `/mykey`** (set field `hiddenAt`), KHÔNG hứa hẹn
   disable phía provider. `listIssuedKeys` (khách) filter `hiddenAt == null`.
6. Token `adm_*`: bê nguyên logic che + "rỗng = giữ nguyên" sang route mới.

---

## 4. Chi tiết từng phần

### Phần A — Cấu hình kết nối GPT2API

**Backend** (`src/api-routes.js`, khu mới `// ─── GPT2API / Cửa hàng API key ───`):

| Route | Việc |
|-------|------|
| `GET /gpt2api/config` | đọc Setting (14 key kết nối + knob pricing phần B), merge env default, che `GPT2API_ADMIN_TOKEN` → `adm_xxxxxxxx…yyyy`, trả `{ config, tokenConfigured, configured }` |
| `PUT /gpt2api/config` | whitelist (hợp A+B), lọc token rỗng, `upsert`, `invalidateGpt2apiConfig()`, `logAction("web-admin","UPDATE_GPT2API_CONFIG",...)`, trả `{ ok, updated }` |
| `POST /gpt2api/test` | gọi `listModelGroups({ force: true })` với config hiện tại → trả `{ ok, groupCount, groups }` hoặc `{ ok:false, error }`. Kiểm tra token + base còn sống |
| `GET /gpt2api/model-groups` | trả list group cho admin tick chọn `GPT2API_FALLBACK_GROUPS` |

- **KHÔNG** làm nút "tạo key thử" ở phần A (tốn tiền). Nếu muốn: endpoint riêng
  `POST /gpt2api/probe-key` quota tối thiểu, modal xác nhận 2 bước, nhãn đỏ "tạo
  key thật".

**`admin-react/src/api/endpoints.js`** — thêm:
```js
gpt2apiConfig:        () => client.get("/gpt2api/config").then(r => r.data),
updateGpt2apiConfig:  (data) => client.put("/gpt2api/config", data).then(r => r.data),
testGpt2api:          () => client.post("/gpt2api/test").then(r => r.data),
gpt2apiModelGroups:   () => client.get("/gpt2api/model-groups").then(r => r.data),
```

**UI** — trang mới `admin-react/src/pages/ApiKeyShop.jsx`, route `/api-key-shop`,
dùng `<TabFilter>` 3 tab. **Tab "Kết nối"**:
- Form: Base URL · Admin token (`type=password`, placeholder = bản che, rỗng =
  giữ) · User ID · Endpoint (hint auto-derive từ base) · Models (chips/textarea)
  · Fallback groups (multi-select từ `gpt2apiModelGroups`, rỗng = "tất cả") ·
  Doc URL · Usage URL · toggle **Bật cửa hàng** (`GPT2API_ENABLED`).
- Nút **"Kiểm tra kết nối"** → `testGpt2api` → toast kết quả.
- Badge: `configured` (đủ base+token+userId) / `enabled`.

---

### Phần B — Cấu hình giá & giới hạn  *(có refactor code)*

#### B1. Chuyển knob pricing → Setting động

**`src/gpt2api.js`:**
- Thêm vào `SETTING_KEYS`: `GPT2API_RPM_INCLUDED`, `GPT2API_RPM_SURCHARGE_PCT`,
  `GPT2API_DAY_SURCHARGE_PCT`, `GPT2API_NO_EXPIRY_MULT`, `GPT2API_MAX_BUY_M`,
  `GPT2API_RPM_PRESETS`, `GPT2API_DAYS_PRESETS`, `GPT2API_FREE_MIN_M`,
  `GPT2API_FREE_MAX_M`, `GPT2API_FREE_ALPHA`.
- `getConfig()` trả thêm các field trên (parse số/list, default = hằng số hiện
  tại trong `apikey-pricing.js`).

**`src/apikey-pricing.js`** — đổi hàm đọc `process.env` lúc load thành **tham số**:
- `keyPriceFactors({ rpm, validDays, rpmIncluded?, rpmSurchargePct?, daySurchargePct?, noExpiryMult? })`
- `priceUsdForKey({ tokens, rpm, validDays }, usdPerMtoken, factors?)`
- `parseTokenAmount(input, { min, max })` — `max` truyền từ `cfg` thay vì
  `MAX_BUY_TOKENS` module.
- `buildFreeQuotaTable({ minM, maxM, alpha })` — đã nhận tham số rồi, chỉ cần call
  site truyền `cfg`.
- Giữ mọi hằng số `DEFAULT_*` làm giá trị mặc định của tham số → **test hiện tại
  không phải đổi logic**, chỉ bổ sung test cho nhánh có config.

**Call sites phải truyền `cfg`:**
- `src/bot.js` — màn xác nhận mua + các bước preset (token/RPM/ngày).
- `src/delivery.js` — `deliverApiKey` (đã có `cfg` sẵn).
- `src/giftcode.js` — `grantApiKeyReward` (đã có `cfg` sẵn).

**`.env.example` + `CLAUDE.md`** — sửa dòng "Tất cả chỉnh qua .env, không cần
deploy lại" thành "chỉnh trong web admin (DB thắng ENV)".

#### B2. Backend
Gộp vào `PUT /gpt2api/config` ở phần A (whitelist mở rộng). Thêm:
| Route | Việc |
|-------|------|
| `POST /gpt2api/price-preview` | body `{ tokens, rpm, validDays }` → server tính `priceUsdForKey` với cfg hiện tại → trả `{ priceUsd, base, rpmPct, daysPct }` |
| `GET /gpt2api/quota-preview` | query `minM,maxM,alpha` → `freeQuotaBandProbabilities` → trả bảng xác suất |

#### B3. UI — **Tab "Giá & giới hạn"**
- Nhóm **Giá bán**: USD / 1M token · gói token presets (`GPT2API_BUY_PRESETS_M`).
- Nhóm **Phụ phí**: RPM included · RPM surcharge % · Day surcharge % · No-expiry
  multiplier. Kèm dòng giải thích công thức (copy từ CLAUDE.md).
- Nhóm **Giới hạn khách chọn**: RPM presets · Days presets · Max buy (M).
- Nhóm **Quà tặng (giftcode free)**: min M · max M · alpha.
- Khối **"Xem trước giá"**: 3 ô nhập (token/RPM/ngày) → `price-preview` → hiện giá
  + `(+X% RPM) (+Y% ngày)`.
- **Bảng xác suất quà tặng** (`quota-preview`) cập nhật live khi đổi min/max/alpha.

---

### Phần C — Danh sách key đã cấp

**Backend:**

`src/apikey-store.js` — thêm:
```js
export async function listAllIssuedKeys({ limit = 50, skip = 0, source, telegramId, q } = {})
export async function countAllIssuedKeys({ source, telegramId, q } = {})
```
- `findMany` orderBy `createdAt desc`, `take/skip`.
- `q` match `telegramId` HOẶC `orderId` HOẶC tiền tố `key` (regex `^q`).
- Filter `source` nếu có.
- `listIssuedKeys` (khách) thêm điều kiện `hiddenAt == null` (hoặc field không tồn
  tại) — không hiện key đã ẩn.

`src/api-routes.js`:
| Route | Việc |
|-------|------|
| `GET /issued-keys?page&limit&source&q` | `{ keys, total, page, limit }`. Với mỗi key: join thủ công `order` (theo `orderId`) lấy `displayFinalUsd`, `giftCode` (theo `giftCodeId`) lấy `code`, `user` (theo `telegramId`) lấy `firstName/username`. Che `key` → 12 ký tự đầu + `…` |
| `GET /issued-keys/:id` | chi tiết đầy đủ + `key` nguyên văn + order + giftcode + redemption liên kết |
| `POST /issued-keys/:id/hide` | set `hiddenAt = now` (ẩn khỏi `/mykey`). `logAction("web-admin","HIDE_ISSUED_KEY",id,{...})`. UI ghi rõ "không thu hồi được phía GPT2API" |
| `GET /issued-keys/stats` | tổng số key, tổng `quotaTokens` đã cấp, tổng USD (join order), đếm theo `source` |

**DB viewer** (rẻ, làm kèm): thêm `issuedApiKeys: "issuedApiKey"` vào
`COLLECTION_TO_MODEL` (`api-routes.js:29-36`) và `"issuedApiKeys"` vào `DB_ALLOWED`
(`api-routes.js:1735`). ⚠️ **key plaintext sẽ lộ trong DB viewer** — hoặc chấp
nhận (admin full quyền), hoặc thêm `issuedApiKeys` vào danh sách cột cần mask.

`endpoints.js`:
```js
issuedKeys:      (params) => client.get("/issued-keys", { params }).then(r => r.data),
issuedKey:       (id) => client.get(`/issued-keys/${id}`).then(r => r.data),
hideIssuedKey:   (id) => client.post(`/issued-keys/${id}/hide`).then(r => r.data),
issuedKeyStats:  () => client.get("/issued-keys/stats").then(r => r.data),
```

**UI — Tab "Key đã cấp":**
- Hàng `<StatsCard>`: tổng key · tổng quota · doanh thu USD · số key từ giftcode.
- `<SearchBar>` + filter nguồn (`<TabFilter>` hoặc `<select>`).
- Bảng: Khách (tên + tgId) · Quota · RPM · Nguồn (`<Badge>` GIFTCODE/PURCHASE/ADMIN)
  · Giá USD · Hết hạn · Ngày tạo · Key (che, nút hiện/copy).
- `<Pagination>`.
- Click hàng → `<Modal>` chi tiết: order liên kết (link `/orders`), giftcode,
  models, `externalId`, nút "Ẩn khỏi /mykey".

---

### Phần D — Cấp key thủ công (`source = ADMIN`)

**Backend** `src/api-routes.js`:
```
POST /issued-keys   body { telegramId, tokens, rpm?, validDays?, notify? }
```
1. Validate `telegramId` (user tồn tại? — cảnh báo nếu không, vẫn cho tiếp).
2. `cfg = await getGpt2apiConfig()`; `!cfg.configured` → 400.
3. `created = await createApiKey({ quotaTokens: tokens,
   name: \`admin-${telegramId}-${Date.now()}\`, rpm: rpm>0?rpm:undefined,
   validDays: validDays>0?validDays:0 })`.
4. `!created.ok` → 502 `{ error, code: created.code }`.
5. `saved = await saveIssuedKey({ telegramId, key: created.key, quotaTokens: tokens,
   rpm: rpm||0, source: KeySource.ADMIN, externalId: created.id,
   expiresAt: created.expiresAt || (validDays>0 ? ... : null), models: cfg.models })`.
6. `logAction("web-admin","ISSUE_API_KEY", String(telegramId),
   { tokens, rpm, validDays, externalId: created.id })`.
7. `notify` → `_bot.telegram.sendMessage(telegramId, <tin kèm <code>key</code>>,
   { parse_mode:"HTML" }).catch(()=>{})`. (Tái dùng `apiKeyMessage({...kind})` từ
   `bot-ui/apikey-messages.js` nếu muốn tin đầy đủ.)

**Rủi ro**: tạo key thật tốn credit. UI **bắt buộc** modal xác nhận có hiện
token/RPM/ngày + ước tính giá (`price-preview`).

**UI**: nút **"+ Cấp key thủ công"** ở Tab "Key đã cấp" → `<Modal>`:
- telegramId (nhập tay, hoặc autocomplete từ `api.users`).
- Token (parse như bot: `3m`, `3.000.000`…), RPM, số ngày (0 = không hết hạn).
- Checkbox "Gửi key cho khách qua bot".
- Nút xác nhận đổi màu + text "Sẽ tạo key thật trên GPT2API".

---

### Phần E — Thống kê doanh thu API key  *(tuỳ chọn, làm sau)*

- `src/stats.js` / `GET /stats`: breakout đơn `deliveryRef === "API_KEY"` →
  `{ apiKeyRevenueUsd, apiKeyOrders, apiKeyTokensSold }` từ `displayFinalUsd` +
  `apikeyTokens`.
- Hiện trên Dashboard hoặc đầu Tab "Key đã cấp".

---

## 5. Thứ tự triển khai đề xuất

| Bước | Phần | Lý do |
|------|------|-------|
| 1 | **A** — config kết nối | Độc lập, rủi ro thấp, thay route orphan. Ship ngay. |
| 2 | **C** — danh sách key (read-only) + DB viewer | Không đụng luồng bán. Giá trị cao — hiện đang mù hoàn toàn. |
| 3 | **B** — giá động | Refactor lan rộng, đụng luồng trừ tiền → cần test kỹ. Làm khi A/C ổn. |
| 4 | **D** — cấp thủ công | Sau B để tái dùng config. |
| 5 | **E** — thống kê | Bất cứ lúc nào. |

Mỗi bước = 1 commit (source + `admin-react/dist` rebuild chung), test `npm test`
trước khi commit.

---

## 6. Danh sách file sẽ đụng

**Backend**
- `src/api-routes.js` — routes mới (config, test, model-groups, price-preview,
  quota-preview, issued-keys CRUD/stats); DB viewer allow-list.
- `src/apikey-store.js` — `listAllIssuedKeys`, `countAllIssuedKeys`, filter `hiddenAt`.
- `src/gpt2api.js` — mở rộng `SETTING_KEYS` + `getConfig()`.
- `src/apikey-pricing.js` — hàm nhận config qua tham số (giữ default cũ).
- `src/bot.js`, `src/delivery.js`, `src/giftcode.js` — truyền `cfg` vào pricing.
- `src/server.js` — xoá route cũ `/api/admin/gpt2api-config`.
- `src/stats.js` — (phần E) breakout doanh thu.
- `.env.example`, `CLAUDE.md` — cập nhật ghi chú.
- `test/apikey-pricing*.test.js` — test signature mới.

**Frontend** (`admin-react/src/`)
- `pages/ApiKeyShop.jsx` — **mới**, 3 tab.
- `api/endpoints.js` — ~11 method mới.
- `App.jsx` — route `/api-key-shop`.
- `components/Sidebar.jsx` — mục nav trong "NGUỒN HÀNG & API" (icon `Sparkles`
  hoặc `Cpu`; nhớ thêm import lucide).
- `components/TopBar.jsx` — breadcrumb `["Nguồn hàng & API", "Cửa hàng API key"]`.
- `admin-react/dist/` — rebuild + commit chung.

---

## 7. Rủi ro & lưu ý

- **xpiki không cho list / disable / delete key** → "thu hồi" chỉ là ẩn local.
  Không để UI hứa điều provider không làm được.
- **`createApiKey` tạo key thật, tốn credit** → mọi nút tạo (D, probe) phải có
  xác nhận + hiện giá ước tính.
- **Refactor pricing (B) đụng luồng trừ tiền khách** → so sánh `priceUsdForKey`
  trước/sau trên vài bộ input; chạy full `npm test`.
- `quota_limit` là **credit unit**, "≈ token" chỉ là ước lượng (memory).
- Thêm `issuedApiKeys` vào DB viewer ⇒ **key plaintext lộ** — cân nhắc mask.
- `admin-react/dist` **phải rebuild & commit cùng source** (deploy = `git pull`).
- `Order` (Mongo) có `apikeyTokens/apikeyRpm/apikeyValidDays/displayFinalUsd/
  displayCurrency` **không có trong `schema.prisma`** (doc-only) — join bằng field
  thô là được, đừng tin schema.
- `IssuedApiKey` không có `updatedAt` (`UPDATED_AT_MODELS` không liệt kê) → field
  `hiddenAt` phải tự set `new Date()` khi ghi.
- Route mới ở `/api/admin-react/*` = header `x-admin-token`; đừng nhầm sang
  `?secret=` của admin cũ.
