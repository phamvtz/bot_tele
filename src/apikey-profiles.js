/**
 * Profile cửa hàng API key — nhiều "server" trên CÙNG một kết nối GPT2API.
 *
 * Bối cảnh: shop chỉ có 1 tài khoản xpiki (1 base + 1 token adm_* + 1 user_id),
 * nhưng muốn bán vài "server" khác nhau cho khách chọn. Thứ thật sự khác nhau
 * giữa chúng là DANH SÁCH + THỨ TỰ nhóm model fallback gửi kèm lúc tạo key
 * (`fallback_allowed_groups` / `fallback_order`), kèm bộ giá riêng.
 *
 * TOÀN BỘ file là hàm THUẦN — không I/O, không đọc ENV. gpt2api.js lo phần đọc
 * Setting, file này chỉ chuẩn hoá + gộp knob. Nhờ vậy test được trên máy dev
 * không kết nối được Atlas (xem test/apikey-profiles.test.js).
 *
 * Lưu trong MỘT Setting `GPT2API_PROFILES` = JSON mảng. Mỗi phần tử chỉ chứa
 * knob admin THỰC SỰ đặt riêng; knob bỏ trống = KẾ THỪA giá trị chung của shop
 * (các khoá GPT2API_* phẳng đang có). Nhờ vậy admin chỉ điền chỗ khác nhau,
 * và cấu hình cũ chạy y nguyên khi chưa có profile nào.
 */

/** Trần số profile — giữ bàn phím Telegram không tràn và callback data đủ ngắn. */
export const MAX_PROFILES = 6;

/** Profile mặc định khi shop chưa cấu hình gì — id 1 để callback cũ vẫn khớp. */
export const DEFAULT_PROFILE_ID = 1;
export const DEFAULT_PROFILE_NAME = "Mặc định";

/**
 * Knob mà profile được phép override. `type` quyết định cách đọc giá trị thô:
 * dữ liệu có thể tới từ JSON Setting HOẶC từ form web admin (mọi ô là chuỗi),
 * nên đọc lỏng nhưng ghi chặt.
 *
 * Không có trong bảng này = không override được (base/token/userId/endpoint/
 * docUrl/usageUrl dùng chung toàn shop — đó chính là ý "cùng một kết nối").
 */
export const PROFILE_KNOBS = {
    usdPerMtoken: { type: "float", min: 0, positive: true },
    rpm: { type: "int", min: 0 },
    tpm: { type: "int", min: 0 },
    validDays: { type: "int", min: 0 },
    rpmIncluded: { type: "int", min: 1 },
    rpmSurchargePct: { type: "float", min: 0 },
    daySurchargePct: { type: "float", min: 0 },
    noExpiryMult: { type: "float", min: 1 },
    maxBuyM: { type: "int", min: 1 },
    quotaRefPrice: { type: "float", min: 0 },
    buyPresetsM: { type: "intList" },
    rpmPresets: { type: "intList" },
    daysPresets: { type: "intList" },
    freeMinM: { type: "int", min: 1 },
    freeMaxM: { type: "int", min: 1 },
    freeAlpha: { type: "float", min: 0 },
    allowedModelsMode: { type: "enum", values: ["all", "restrict"] },
    models: { type: "strList" },
};

export const PROFILE_KNOB_NAMES = Object.keys(PROFILE_KNOBS);

const TOKENS_PER_M = 1_000_000;

// ─── Đọc giá trị thô ──────────────────────────────────────────────────────────
// Quy ước xuyên suốt: "" / null / undefined / giá trị vô lý → undefined, nghĩa là
// "không đặt" → kế thừa shop. KHÔNG bao giờ tự bịa số 0 vì 0 là giá trị hợp lệ
// của validDays (không hết hạn) và quotaRefPrice (gửi token thô).
function readNumber(value, { min = -Infinity, positive = false, int = false } = {}) {
    if (value === undefined || value === null || value === "") return undefined;
    const n = Number(value);
    if (!Number.isFinite(n)) return undefined;
    if (positive && n <= 0) return undefined;
    if (n < min) return undefined;
    return int ? Math.floor(n) : n;
}

/** "1, 5,10" / [1,5,10] / "[1,5,10]" → [1,5,10]. Rỗng/sai → undefined. */
function readIntList(value) {
    if (value === undefined || value === null || value === "") return undefined;
    let arr = value;
    if (typeof value === "string") {
        const raw = value.trim();
        if (!raw) return undefined;
        try {
            arr = raw.startsWith("[") ? JSON.parse(raw) : raw.split(/[,\s]+/);
        } catch {
            arr = raw.split(/[,\s]+/);
        }
    }
    if (!Array.isArray(arr)) return undefined;
    const out = arr
        .map((x) => Math.floor(Number(x)))
        .filter((x) => Number.isFinite(x) && x > 0)
        .slice(0, 12);
    return out.length ? out : undefined;
}

/** "a, b\nc" / ["a","b"] → ["a","b","c"]. Rỗng → undefined. */
function readStrList(value) {
    if (value === undefined || value === null || value === "") return undefined;
    const arr = Array.isArray(value) ? value : String(value).split(/[,\s]+/);
    const out = arr.map((s) => String(s).trim()).filter(Boolean).slice(0, 64);
    return out.length ? out : undefined;
}

function readKnob(name, value) {
    const spec = PROFILE_KNOBS[name];
    if (!spec) return undefined;
    switch (spec.type) {
        case "int": return readNumber(value, { ...spec, int: true });
        case "float": return readNumber(value, spec);
        case "intList": return readIntList(value);
        case "strList": return readStrList(value);
        case "enum": {
            if (value === undefined || value === null || value === "") return undefined;
            const v = String(value).trim().toLowerCase();
            return spec.values.includes(v) ? v : undefined;
        }
        default: return undefined;
    }
}

// ─── Chuẩn hoá ────────────────────────────────────────────────────────────────

/** JSON Setting → mảng object thô. Hỏng/không phải mảng → [] (caller tự lo default). */
export function parseProfiles(raw) {
    if (Array.isArray(raw)) return raw.filter((p) => p && typeof p === "object");
    if (raw === undefined || raw === null || raw === "") return [];
    try {
        const parsed = JSON.parse(String(raw));
        return Array.isArray(parsed) ? parsed.filter((p) => p && typeof p === "object") : [];
    } catch {
        // Setting hỏng KHÔNG được làm sập cửa hàng — trả rỗng để lùi về profile
        // mặc định dựng từ cấu hình phẳng.
        return [];
    }
}

/**
 * Làm sạch một profile về đúng shape lưu trữ. `index` chỉ dùng để đặt id/tên khi
 * admin không đặt (id phải là SỐ NGUYÊN DƯƠNG vì callback data của bot dùng regex
 * `\d+` — xem CLAUDE.md).
 */
export function normalizeProfile(raw = {}, index = 0) {
    const id = readNumber(raw.id, { min: 1, int: true }) ?? index + 1;
    const name = String(raw.name ?? "").trim().slice(0, 40)
        || (index === 0 ? DEFAULT_PROFILE_NAME : `Server ${index + 1}`);

    const out = {
        id,
        name,
        // Thiếu field `enabled` (profile tạo bởi bản cũ) = bật, không phải tắt.
        enabled: raw.enabled === undefined || raw.enabled === null
            ? true
            : String(raw.enabled).toLowerCase() !== "false" && raw.enabled !== false,
        // Mô tả ngắn hiện cho khách ở màn chọn server. Rỗng = không hiện dòng nào.
        note: String(raw.note ?? "").trim().slice(0, 120),
        // ĐIỂM KHÁC BIỆT CHÍNH giữa các profile. Rỗng = kế thừa shop, mà shop rỗng
        // nghĩa là "gửi TẤT CẢ group" (xem resolveFallbackGroups trong gpt2api.js).
        fallbackGroups: readStrList(raw.fallbackGroups) ?? [],
    };

    for (const name_ of PROFILE_KNOB_NAMES) {
        const v = readKnob(name_, raw[name_]);
        if (v !== undefined) out[name_] = v;
    }
    return out;
}

/**
 * Chuẩn hoá cả danh sách: bỏ phần tử rác, ép id duy nhất, cắt về MAX_PROFILES.
 * Trùng id (admin sửa JSON tay) → cấp lại id trống nhỏ nhất thay vì im lặng ghi
 * đè nhau, vì id là thứ nằm trong callback data và trong Order.
 */
export function normalizeProfiles(rawList) {
    const list = parseProfiles(rawList).slice(0, MAX_PROFILES).map((p, i) => normalizeProfile(p, i));
    const seen = new Set();
    for (const p of list) {
        if (seen.has(p.id)) {
            let next = 1;
            while (seen.has(next)) next++;
            p.id = next;
        }
        seen.add(p.id);
    }
    return list;
}

/** Ngược lại normalizeProfiles — chuỗi JSON để ghi vào Setting. */
export function serializeProfiles(list) {
    return JSON.stringify(normalizeProfiles(list));
}

/**
 * Profile mặc định dựng từ cấu hình PHẲNG đang có (GPT2API_FALLBACK_GROUPS…).
 * Dùng khi Setting GPT2API_PROFILES trống — shop chưa từng bật tính năng nhiều
 * server thì mọi thứ chạy y như trước, không cần migration.
 */
export function defaultProfile(shop = {}) {
    return {
        id: DEFAULT_PROFILE_ID,
        name: DEFAULT_PROFILE_NAME,
        enabled: true,
        note: "",
        fallbackGroups: Array.isArray(shop.fallbackGroups) ? shop.fallbackGroups : [],
    };
}

/**
 * Gộp profile với cấu hình chung → cấu hình HIỆU LỰC dùng để báo giá và tạo key.
 *
 * Kết quả có đủ mọi field mà priceUsdForKey / buildCreateKeyBody cần, nên chỗ gọi
 * chỉ việc truyền thẳng object này vào như trước vẫn truyền `cfg`. Đó là lý do
 * hàm giữ nguyên tên field của getConfig() thay vì đặt tên mới.
 */
export function resolveProfile(profile, shop = {}) {
    const p = profile || defaultProfile(shop);
    const pick = (name) => (p[name] !== undefined ? p[name] : shop[name]);

    // maxBuyM (đơn vị triệu, hợp với người nhập) → maxBuyTokens (đơn vị token,
    // hợp với mọi chỗ tính toán). Profile không đặt thì giữ trần chung của shop.
    const maxBuyTokens = p.maxBuyM !== undefined
        ? Math.floor(p.maxBuyM) * TOKENS_PER_M
        : shop.maxBuyTokens;

    const resolved = {
        ...shop,
        profileId: p.id,
        profileName: p.name,
        profileNote: p.note || "",
        // Cờ RIÊNG của profile — tách khỏi `enabled` vì sau khi spread `...shop`,
        // `enabled` là công tắc TOÀN CỬA HÀNG. Lẫn hai cái thì tắt một server sẽ
        // không có tác dụng gì (shop bật là mọi profile trông như đang bật).
        profileEnabled: p.enabled !== false,
        // Công tắc CẢ CỬA HÀNG, giữ riêng vì `...shop` ở trên bị `enabled` bên
        // dưới đè mất. Đường GIAO HÀNG cần phân biệt hai thứ: tắt một server là
        // ngừng bán server đó, KHÔNG phải huỷ những đơn đã trả tiền cho nó.
        shopEnabled: shop.enabled !== false,
        // Bán được = cửa hàng bật VÀ server này bật.
        enabled: shop.enabled !== false && p.enabled !== false,
        // Rỗng ở CẢ profile lẫn shop = gửi tất cả group (hành vi cũ).
        fallbackGroups: (p.fallbackGroups && p.fallbackGroups.length)
            ? p.fallbackGroups
            : (shop.fallbackGroups || []),
        maxBuyTokens,
    };
    for (const name of PROFILE_KNOB_NAMES) {
        if (name === "maxBuyM") continue; // đã quy đổi ở trên
        const v = pick(name);
        if (v !== undefined) resolved[name] = v;
    }
    return resolved;
}

/**
 * Danh sách profile HIỆU LỰC. Chưa cấu hình → đúng một profile mặc định, nên
 * `profiles.length === 1` là dấu hiệu "shop chạy chế độ một server" và bot bỏ
 * qua bước chọn server.
 */
export function resolveProfiles(rawList, shop = {}) {
    const list = normalizeProfiles(rawList);
    if (!list.length) return [resolveProfile(defaultProfile(shop), shop)];
    return list.map((p) => resolveProfile(p, shop));
}

/**
 * Chỉ những profile đang bật — cái khách được thấy. Lọc theo `profileEnabled`
 * (cờ riêng của từng server), KHÔNG phải `enabled` (công tắc cả cửa hàng, đã
 * được bot kiểm riêng ở màn store).
 *
 * Admin tắt hết → trả cái đầu tiên: cửa hàng vẫn bật thì phải bán được cái gì đó,
 * còn hơn hiện màn chọn server trống trơn.
 */
export function enabledProfiles(resolved = []) {
    const on = resolved.filter((p) => p.profileEnabled !== false);
    return on.length ? on : resolved.slice(0, 1);
}

/**
 * Tìm profile theo id, dùng cho callback data và cho Order đã lưu.
 *
 * Không tìm thấy (admin xoá profile sau khi khách bấm nút, hoặc đơn cũ chưa có
 * field) → trả profile đầu tiên ĐANG BẬT thay vì null: thà cấp key bằng server
 * khác còn hơn để đơn đã trừ tiền chết kẹt.
 */
export function pickProfile(resolved = [], id) {
    if (!resolved.length) return null;
    const wanted = Number(id);
    if (Number.isFinite(wanted)) {
        // `profileId` ở bản đã resolve, `id` ở bản thô — nhận cả hai để hàm không
        // âm thầm trượt về server đầu tiên khi bị gọi nhầm shape.
        const want = Math.floor(wanted);
        const hit = resolved.find((p) => (p.profileId ?? p.id) === want);
        if (hit) return hit;
    }
    return enabledProfiles(resolved)[0] || resolved[0];
}

export default {
    MAX_PROFILES,
    DEFAULT_PROFILE_ID,
    DEFAULT_PROFILE_NAME,
    PROFILE_KNOBS,
    PROFILE_KNOB_NAMES,
    parseProfiles,
    normalizeProfile,
    normalizeProfiles,
    serializeProfiles,
    defaultProfile,
    resolveProfile,
    resolveProfiles,
    enabledProfiles,
    pickProfile,
};
