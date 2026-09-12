/**
 * Thống kê "khách tiêu bao nhiêu mỗi ngày" — HÀM THUẦN, không chạm DB.
 *
 * Vì sao tách riêng thay vì thêm vào `stats.js`:
 *   1. `stats.js` tự mâu thuẫn về luật tính doanh thu — `getStats()` chỉ đếm
 *      `DELIVERED`, còn `getRevenueByDay()` đếm `PAID` + `DELIVERED`. Thêm một hàm
 *      nữa vào đó là thêm một luật thứ ba, và không ai biết cái nào đúng. Ở đây
 *      luật là MỘT hằng `SPEND_STATUSES` có test chốt.
 *   2. Chia ngày bằng `new Date().toDateString()` như `getRevenueByDay` phụ thuộc
 *      MÚI GIỜ CỦA MÁY CHỦ. VPS đặt UTC thì "hôm nay" của shop Việt Nam sai 7
 *      tiếng mỗi ngày: đơn 19:00 hôm nay bị đẩy sang ngày mai. Ở đây múi giờ là
 *      THAM SỐ, mặc định UTC+7.
 *
 * Đơn vị tiền: `Order.finalAmount` LUÔN là VND — kể cả sản phẩm niêm yết giá USD
 * (giá USD đã được quy đổi lúc tạo đơn và nằm ở `displayFinalUsd` / `displayCurrency`).
 * Vì vậy cột VND cộng thẳng `finalAmount`; cột USD cộng `displayFinalUsd` và chỉ có
 * nghĩa với những đơn có field đó (đơn cũ / đơn VND thuần sẽ là 0).
 */

/** Trạng thái nghĩa là TIỀN ĐÃ VÀO TÚI SHOP. */
export const SPEND_STATUSES = ["PAID", "DELIVERING", "DELIVERED"];

/** Việt Nam = UTC+7, không có DST nên một offset cố định là đủ. */
export const DEFAULT_TZ_OFFSET_MINUTES = 7 * 60;

const DAY_MS = 86_400_000;
const MAX_DAYS = 366;
const pad2 = (n) => String(n).padStart(2, "0");

function clampInt(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.floor(n)));
}

function localParts(date, tzOffsetMinutes) {
    // Cộng offset rồi đọc bằng getUTC* — ra đúng ngày theo GIỜ ĐỊA PHƯƠNG mà không
    // phụ thuộc TZ của tiến trình Node.
    const shifted = new Date(date.getTime() + tzOffsetMinutes * 60_000);
    return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth() + 1, d: shifted.getUTCDate() };
}

/** Ngày địa phương của một thời điểm, dạng `"YYYY-MM-DD"` (sortable, không phụ thuộc locale). */
export function dayKey(date, tzOffsetMinutes = DEFAULT_TZ_OFFSET_MINUTES) {
    const { y, m, d } = localParts(new Date(date), tzOffsetMinutes);
    return `${String(y).padStart(4, "0")}-${pad2(m)}-${pad2(d)}`;
}

/**
 * Nửa đêm của một ngày địa phương, trả về đúng THỜI ĐIỂM UTC.
 * Đây là cái phải đưa vào `where: { createdAt: { gte: ... } }` — đưa `"2026-09-13"`
 * vào thì Mongo so với 00:00 UTC, lệch 7 tiếng so với ngày shop đang tính.
 */
export function dayStartUtc(key, tzOffsetMinutes = DEFAULT_TZ_OFFSET_MINUTES) {
    const [y, m, d] = String(key).split("-").map(Number);
    return new Date(Date.UTC(y, (m || 1) - 1, d || 1) - tzOffsetMinutes * 60_000);
}

/**
 * `days` ngày địa phương gần nhất, KỂ CẢ hôm nay, cũ → mới.
 * `from` (bao gồm) / `to` (loại trừ) là hai mốc UTC khớp đúng tập `keys` — query và
 * bucket phải dùng cùng một luật, không thì đơn ở biên bị đếm hai lần hoặc mất hút.
 */
export function dayRange(days = 30, now = Date.now(), tzOffsetMinutes = DEFAULT_TZ_OFFSET_MINUTES) {
    const n = clampInt(days, 1, MAX_DAYS, 30);
    const { y, m, d } = localParts(new Date(now), tzOffsetMinutes);
    const keys = [];
    for (let i = n - 1; i >= 0; i--) {
        // Date.UTC tự cuộn tháng/năm khi d - i <= 0 — không cần tự xử lý biên.
        const dt = new Date(Date.UTC(y, m - 1, d - i));
        keys.push(`${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`);
    }
    const todayKey = keys[keys.length - 1];
    return {
        keys,
        from: dayStartUtc(keys[0], tzOffsetMinutes),
        to: new Date(dayStartUtc(todayKey, tzOffsetMinutes).getTime() + DAY_MS),
    };
}

function normalizeOpts(opts) {
    const tzOffsetMinutes = clampInt(
        opts.tzOffsetMinutes, -14 * 60, 14 * 60, DEFAULT_TZ_OFFSET_MINUTES,
    );
    const statuses = Array.isArray(opts.statuses) && opts.statuses.length
        ? opts.statuses.map(String)
        : SPEND_STATUSES;
    const range = dayRange(opts.days, opts.now, tzOffsetMinutes);
    return { tzOffsetMinutes, statuses, allowed: new Set(statuses), range, topUsers: clampInt(opts.topUsers, 1, 500, 20) };
}

/**
 * Gộp đơn hàng thành: chuỗi theo ngày + bảng xếp hạng khách.
 *
 * @param rows dòng Order thô (chỉ cần `odelegramId`, `finalAmount`, `displayFinalUsd`, `status`, `createdAt`)
 * @returns `daySeries` luôn đủ `days` phần tử kể cả ngày không có đơn (0), để biểu đồ
 *          không bị co lại và người đọc không tưởng ngày trống là ngày mất dữ liệu.
 */
export function summarizeDailySpend(rows = [], opts = {}) {
    const { tzOffsetMinutes, statuses, allowed, range, topUsers } = normalizeOpts(opts);
    const byDay = new Map(range.keys.map((k) => [k, { date: k, revenueVnd: 0, revenueUsd: 0, orders: 0 }]));
    const dayUsers = new Map(range.keys.map((k) => [k, new Set()]));
    const users = new Map();
    const skipped = { wrongStatus: 0, badDate: 0, outOfRange: 0, noUser: 0 };

    for (const r of rows || []) {
        if (!allowed.has(String(r?.status ?? ""))) { skipped.wrongStatus++; continue; }
        const createdAt = r.createdAt ? new Date(r.createdAt) : null;
        if (!createdAt || Number.isNaN(+createdAt)) { skipped.badDate++; continue; }
        const day = byDay.get(dayKey(createdAt, tzOffsetMinutes));
        // Lọc lại một lần nữa thay vì tin `where` của caller: hàm này nhận mảng thô,
        // và một đơn ngoài khoảng mà vẫn được cộng vào là con số admin đọc bị sai.
        if (!day) { skipped.outOfRange++; continue; }

        const vnd = Number(r.finalAmount) || 0;
        const usd = Number(r.displayFinalUsd) || 0;
        day.revenueVnd += vnd;
        day.revenueUsd += usd;
        day.orders += 1;

        const uid = r.odelegramId != null && r.odelegramId !== "" ? String(r.odelegramId) : null;
        // Đơn không gắn được người (đơn tạo tay từ web) vẫn PHẢI nằm trong tổng ngày —
        // chỉ là không xếp vào bảng khách được.
        if (!uid) { skipped.noUser++; continue; }
        dayUsers.get(day.date).add(uid);

        let u = users.get(uid);
        if (!u) {
            u = { telegramId: uid, totalVnd: 0, totalUsd: 0, orders: 0, days: {}, lastOrderAt: null };
            users.set(uid, u);
        }
        u.totalVnd += vnd;
        u.totalUsd += usd;
        u.orders += 1;
        u.days[day.date] = (u.days[day.date] || 0) + vnd;
        if (!u.lastOrderAt || createdAt > u.lastOrderAt) u.lastOrderAt = createdAt;
    }

    const daySeries = range.keys.map((k) => {
        const d = byDay.get(k);
        return { date: k, revenueVnd: d.revenueVnd, revenueUsd: round6(d.revenueUsd), orders: d.orders, users: dayUsers.get(k).size };
    });

    const all = [...users.values()].map((u) => ({
        telegramId: u.telegramId,
        totalVnd: u.totalVnd,
        totalUsd: round6(u.totalUsd),
        orders: u.orders,
        // "Tiêu bao nhiêu /1 ngày" — số NGÀY CÓ MUA, không phải số ngày trong khoảng:
        // khách mua 3 đơn rải trong 30 ngày thì trung bình theo ngày-có-mua mới là
        // con số mô tả đúng hành vi của họ.
        activeDays: Object.keys(u.days).length,
        avgVndPerActiveDay: Object.keys(u.days).length ? Math.round(u.totalVnd / Object.keys(u.days).length) : 0,
        avgVndPerDayInRange: Math.round(u.totalVnd / range.keys.length),
        days: u.days,
        lastOrderAt: u.lastOrderAt ? u.lastOrderAt.toISOString() : null,
    }));
    // Xếp theo tiền rồi tới số đơn — hai khách cùng tiền thì ai mua nhiều lần hơn lên trước.
    all.sort((a, b) => b.totalVnd - a.totalVnd || b.orders - a.orders || (a.telegramId < b.telegramId ? -1 : 1));

    const totals = daySeries.reduce(
        (acc, d) => ({
            revenueVnd: acc.revenueVnd + d.revenueVnd,
            revenueUsd: acc.revenueUsd + d.revenueUsd,
            orders: acc.orders + d.orders,
        }),
        { revenueVnd: 0, revenueUsd: 0, orders: 0 },
    );

    return {
        from: range.from.toISOString(),
        to: range.to.toISOString(),
        tzOffsetMinutes,
        statuses,
        dayCount: range.keys.length,
        daySeries,
        totals: {
            ...totals,
            revenueUsd: round6(totals.revenueUsd),
            users: users.size,
            // Trung bình ngày tính trên SỐ NGÀY TRONG KHOẢNG: đây là con số "mỗi ngày
            // shop thu bao nhiêu", kể cả ngày ế. Chia cho số ngày có đơn sẽ thổi
            // phồng nó lên và không so được giữa hai khoảng khác nhau.
            avgVndPerDay: Math.round(totals.revenueVnd / range.keys.length),
            avgVndPerUser: users.size ? Math.round(totals.revenueVnd / users.size) : 0,
        },
        topUsers: all.slice(0, topUsers),
        userCount: all.length,
        // KHÔNG cắt âm thầm: caller phải nói được với người đọc rằng bảng này chưa
        // phải toàn bộ. Xem `warnIfScanTruncated` ở luồng poller — cùng một bài học.
        truncatedUserCount: Math.max(0, all.length - topUsers),
        skipped,
    };
}

/**
 * Chuỗi chi tiêu THEO NGÀY của MỘT khách, trong cùng khoảng và cùng luật với
 * `summarizeDailySpend` — để hai endpoint không bao giờ ra hai con số khác nhau
 * cho cùng một người cùng một ngày.
 */
export function summarizeUserDailySpend(rows = [], telegramId, opts = {}) {
    const { tzOffsetMinutes, allowed, range } = normalizeOpts(opts);
    const uid = telegramId == null ? "" : String(telegramId);
    const perDay = new Map(range.keys.map((k) => [k, { date: k, revenueVnd: 0, revenueUsd: 0, orders: 0 }]));
    let skipped = 0;

    for (const r of rows || []) {
        if (String(r?.odelegramId ?? "") !== uid) { skipped++; continue; }
        if (!allowed.has(String(r.status ?? ""))) continue;
        const createdAt = r.createdAt ? new Date(r.createdAt) : null;
        if (!createdAt || Number.isNaN(+createdAt)) continue;
        const d = perDay.get(dayKey(createdAt, tzOffsetMinutes));
        if (!d) continue;
        d.revenueVnd += Number(r.finalAmount) || 0;
        d.revenueUsd += Number(r.displayFinalUsd) || 0;
        d.orders += 1;
    }

    const daySeries = range.keys.map((k) => {
        const d = perDay.get(k);
        return { date: k, revenueVnd: d.revenueVnd, revenueUsd: round6(d.revenueUsd), orders: d.orders };
    });
    const totalVnd = daySeries.reduce((s, d) => s + d.revenueVnd, 0);
    const activeDays = daySeries.filter((d) => d.orders > 0).length;

    return {
        telegramId: uid || null,
        from: range.from.toISOString(),
        to: range.to.toISOString(),
        tzOffsetMinutes,
        statuses: opts.statuses || SPEND_STATUSES,
        dayCount: range.keys.length,
        daySeries,
        totals: {
            revenueVnd: totalVnd,
            revenueUsd: round6(daySeries.reduce((s, d) => s + d.revenueUsd, 0)),
            orders: daySeries.reduce((s, d) => s + d.orders, 0),
            activeDays,
            avgVndPerActiveDay: activeDays ? Math.round(totalVnd / activeDays) : 0,
            avgVndPerDayInRange: Math.round(totalVnd / range.keys.length),
        },
        skippedNotThisUser: skipped,
    };
}

function round6(n) {
    return Math.round((Number(n) || 0) * 1e6) / 1e6;
}

export default {
    SPEND_STATUSES,
    DEFAULT_TZ_OFFSET_MINUTES,
    dayKey,
    dayStartUtc,
    dayRange,
    summarizeDailySpend,
    summarizeUserDailySpend,
};
