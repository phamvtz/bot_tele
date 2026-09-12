import test from "node:test";
import assert from "node:assert/strict";

import {
    dayKey, dayStartUtc, dayRange,
    summarizeDailySpend, summarizeUserDailySpend,
    SPEND_STATUSES, DEFAULT_TZ_OFFSET_MINUTES,
} from "../src/spend-stats.js";

// "Khách tiêu bao nhiêu /1 ngày" nghe đơn giản nhưng có đúng hai chỗ dễ sai mà
// không test nào bắt được nếu chỉ nhìn tổng:
//
//   1. MÚI GIỜ. Chia ngày bằng giờ máy chủ (như getRevenueByDay của stats.js) thì
//      trên VPS đặt UTC, mọi đơn sau 17:00 giờ VN bị đẩy sang ngày hôm sau. Tổng
//      cả khoảng vẫn ĐÚNG — chỉ có từng ngày là sai, và sai đúng chỗ người ta dùng
//      để so sánh hôm nay với hôm qua.
//   2. HAI LUẬT TÍNH. stats.js có sẵn hai luật: getStats() chỉ đếm DELIVERED,
//      getRevenueByDay() đếm PAID+DELIVERED. Thêm hàm thứ ba mà không chốt luật là
//      ba con số khác nhau cho cùng một ngày, và admin không biết tin cái nào.
//
// Test ở đây khoá cả hai, và khoá thêm bất biến quan trọng nhất: bảng tổng quan và
// bản chi tiết MỘT khách phải ra CÙNG con số.

const DAY = 86_400_000;
const VN = 7 * 60;

/** 2026-09-13T12:00:00Z = 2026-09-13 19:00 giờ VN. */
const NOW = Date.UTC(2026, 8, 13, 12, 0, 0);

const order = (telegramId, amount, at, extra = {}) => ({
    odelegramId: String(telegramId),
    finalAmount: amount,
    displayFinalUsd: extra.usd ?? 0,
    status: extra.status ?? "DELIVERED",
    createdAt: new Date(at),
});

// ─── 1. Múi giờ: ngày địa phương, không phải ngày của máy chủ ──────────────────────

test("dayKey trả ngày theo GIỜ ĐỊA PHƯƠNG, không phải UTC", () => {
    // 18:00Z ngày 13 = 01:00 ngày 14 ở VN. Đây chính là ca mà bucket theo UTC xếp
    // sai ngày.
    const at = Date.UTC(2026, 8, 13, 18, 0, 0);
    assert.equal(dayKey(new Date(at), VN), "2026-09-14");
    assert.equal(dayKey(new Date(at), 0), "2026-09-13", "cùng thời điểm, offset 0 thì vẫn là ngày 13");
    assert.equal(dayKey(new Date(at), -5 * 60), "2026-09-13", "offset âm kéo về 13:00 cùng ngày");
});

test("mặc định là UTC+7 — shop Việt Nam không phải truyền tham số", () => {
    assert.equal(DEFAULT_TZ_OFFSET_MINUTES, VN);
    assert.equal(dayKey(new Date(Date.UTC(2026, 8, 13, 18, 0, 0))), "2026-09-14");
});

test("dayStartUtc là phép nghịch của dayKey — mốc đưa vào query phải khớp bucket", () => {
    // Đây là bất biến khiến `where: { createdAt: { gte: from, lt: to } }` và bộ
    // bucket trong JS là MỘT luật. Lệch nhau thì đơn ở biên hoặc bị đếm hai lần
    // hoặc mất hút.
    for (const key of ["2026-09-13", "2026-01-01", "2026-12-31", "2024-02-29"]) {
        const start = dayStartUtc(key, VN);
        assert.equal(dayKey(start, VN), key, `mốc bắt đầu của ${key} phải rơi lại đúng ${key}`);
        // Nửa đêm VN = 17:00Z ngày TRƯỚC. Kiểm thẳng công thức, không suy vòng.
        const [y, m, d] = key.split("-").map(Number);
        assert.equal(+start, Date.UTC(y, m - 1, d) - VN * 60_000, `mốc UTC của ${key} sai`);
        // Một mili giây trước nửa đêm là ngày hôm trước.
        assert.equal(dayKey(new Date(start.getTime() - 1), VN), prevDay(key, VN));
        // Đúng nửa đêm thì thuộc ngày này (gte, bao gồm).
        assert.equal(dayKey(new Date(start.getTime()), VN), key);
    }
});

function prevDay(key, tz) {
    const [y, m, d] = key.split("-").map(Number);
    return dayKey(new Date(Date.UTC(y, m - 1, d - 1)), tz);
}

test("dayRange đủ số ngày, liên tiếp, kết thúc ở hôm nay, và from/to bù nhau", () => {
    const r = dayRange(7, NOW, VN);
    assert.equal(r.keys.length, 7);
    assert.equal(r.keys[r.keys.length - 1], dayKey(new Date(NOW), VN), "phần tử cuối phải là hôm nay");
    for (let i = 1; i < r.keys.length; i++) {
        assert.equal(
            dayStartUtc(r.keys[i], VN).getTime() - dayStartUtc(r.keys[i - 1], VN).getTime(),
            DAY,
            "hai ngày kề nhau phải cách đúng 24h — hở một ngày là biểu đồ có lỗ",
        );
    }
    assert.equal(+r.from, +dayStartUtc(r.keys[0], VN), "from = nửa đêm ngày ĐẦU");
    assert.equal(+r.to, +dayStartUtc(r.keys[r.keys.length - 1], VN) + DAY, "to = nửa đêm SAU ngày cuối (loại trừ)");
});

test("dayRange cuộn đúng qua biên tháng và biên năm", () => {
    // Khoảng LUÔN gồm hôm nay. 2026-03-01T12:00Z = 19:00 ngày 01 giờ VN nên hôm
    // nay là 01/03, lùi 3 ngày → 27, 28/02 và 01/03 (năm 2026 không nhuận).
    const march = dayRange(3, Date.UTC(2026, 2, 1, 12, 0, 0), VN);
    assert.deepEqual(march.keys, ["2026-02-27", "2026-02-28", "2026-03-01"]);

    const newYear = dayRange(3, Date.UTC(2026, 0, 1, 12, 0, 0), VN);
    assert.deepEqual(newYear.keys, ["2025-12-30", "2025-12-31", "2026-01-01"]);

    // Năm nhuận: lùi qua 29/02.
    const leap = dayRange(3, Date.UTC(2024, 2, 1, 12, 0, 0), VN);
    assert.deepEqual(leap.keys, ["2024-02-28", "2024-02-29", "2024-03-01"]);
});

test("days vô lý bị kẹp về khoảng an toàn chứ không sinh mảng rỗng/khổng lồ", () => {
    // Số hữu hạn ngoài khoảng → KẸP về biên. Không phải số → mặc định 30.
    // Hai luật đó khác nhau và đều phải ổn định: một client gửi days=0 mà nhận
    // mảng rỗng thì biểu đồ biến mất không lý do.
    assert.equal(dayRange(0, NOW, VN).keys.length, 1, "0 kẹp về tối thiểu 1 ngày");
    assert.equal(dayRange(-5, NOW, VN).keys.length, 1);
    assert.equal(dayRange(10_000, NOW, VN).keys.length, 366, "có trần — không để client xin 1 triệu ngày");
    assert.equal(dayRange(1, NOW, VN).keys.length, 1);
    assert.equal(dayRange("abc", NOW, VN).keys.length, 30, "không phải số → mặc định");
    assert.equal(dayRange(undefined, NOW, VN).keys.length, 30);
    assert.equal(dayRange(NaN, NOW, VN).keys.length, 30);
});

// ─── 2. Luật trạng thái: MỘT hằng, có test chốt ──────────────────────────────────

test("SPEND_STATUSES = tiền đã vào túi shop, không gồm PENDING và CANCELED", () => {
    assert.deepEqual(SPEND_STATUSES, ["PAID", "DELIVERING", "DELIVERED"]);
    // PENDING chưa thu tiền; CANCELED đã hết hạn hoặc đã hoàn. Đếm cả hai là báo
    // cáo doanh thu khống.
    assert.ok(!SPEND_STATUSES.includes("PENDING"));
    assert.ok(!SPEND_STATUSES.includes("CANCELED"));
});

test("đơn PENDING / CANCELED không được cộng vào ngày nào cả", () => {
    const rows = [
        order(1, 50_000, NOW, { status: "DELIVERED" }),
        order(1, 99_000, NOW, { status: "PENDING" }),
        order(1, 77_000, NOW, { status: "CANCELED" }),
    ];
    const s = summarizeDailySpend(rows, { days: 1, now: NOW, tzOffsetMinutes: VN });
    assert.equal(s.totals.revenueVnd, 50_000);
    assert.equal(s.totals.orders, 1);
    assert.equal(s.skipped.wrongStatus, 2, "phải ĐẾM số dòng bị loại — im lặng là không ai biết luật đã đổi");
});

// ─── 3. Bảng tổng quan ─────────────────────────────────────────────────────────

test("daySeries luôn đủ `days` phần tử, kể cả ngày không có đơn", () => {
    // Ngày trống phải hiện 0 chứ không biến mất: biểu đồ co lại là người đọc tưởng
    // mất dữ liệu, và hai khoảng khác nhau không so được với nhau.
    const rows = [order(1, 10_000, NOW)];
    const s = summarizeDailySpend(rows, { days: 5, now: NOW, tzOffsetMinutes: VN });
    assert.equal(s.daySeries.length, 5);
    const zeros = s.daySeries.filter((d) => d.orders === 0);
    assert.equal(zeros.length, 4);
    for (const z of zeros) {
        assert.equal(z.revenueVnd, 0);
        assert.equal(z.users, 0);
    }
    assert.equal(s.daySeries[4].date, dayKey(new Date(NOW), VN), "phần tử cuối là hôm nay");
});

test("đơn rơi đúng ngày theo GIỜ VN, không theo giờ máy chủ", () => {
    // 2026-09-12T18:30Z = 2026-09-13 01:30 VN → phải vào ngày 13 (hôm nay).
    const lateUtc = Date.UTC(2026, 8, 12, 18, 30, 0);
    const s = summarizeDailySpend([order(1, 20_000, lateUtc)], { days: 2, now: NOW, tzOffsetMinutes: VN });
    const today = s.daySeries.find((d) => d.date === "2026-09-13");
    const yesterday = s.daySeries.find((d) => d.date === "2026-09-12");
    assert.equal(today.orders, 1, "01:30 giờ VN là đơn của ngày 13");
    assert.equal(today.revenueVnd, 20_000);
    assert.equal(yesterday.orders, 0, "bucket theo UTC sẽ bỏ nhầm đơn này vào ngày 12");

    // Cùng dữ liệu nhưng offset 0 thì nó thuộc ngày 12 — chứng tỏ offset có tác dụng.
    const utcView = summarizeDailySpend([order(1, 20_000, lateUtc)], { days: 2, now: NOW, tzOffsetMinutes: 0 });
    assert.equal(utcView.daySeries.find((d) => d.date === "2026-09-12").orders, 1);
});

test("biên khoảng: gte `from` được tính, `to` thì không", () => {
    const r = dayRange(2, NOW, VN);
    const atFrom = +r.from;
    const atTo = +r.to;
    const s = summarizeDailySpend(
        [order(1, 1_000, atFrom), order(2, 2_000, atFrom - 1), order(3, 4_000, atTo), order(4, 8_000, atTo - 1)],
        { days: 2, now: NOW, tzOffsetMinutes: VN },
    );
    assert.equal(s.totals.revenueVnd, 1_000 + 8_000, "chỉ hai đơn nằm trong [from, to)");
    assert.equal(s.skipped.outOfRange, 2);
});

test("tổng = tổng của daySeries, không phải một phép cộng song song", () => {
    const rows = [
        order(1, 10_000, NOW), order(2, 20_000, NOW), order(1, 5_000, NOW - DAY),
        order(3, 7_000, NOW - 2 * DAY, { usd: 0.28 }),
    ];
    const s = summarizeDailySpend(rows, { days: 3, now: NOW, tzOffsetMinutes: VN });
    const seriesSum = s.daySeries.reduce((a, d) => a + d.revenueVnd, 0);
    assert.equal(s.totals.revenueVnd, seriesSum);
    assert.equal(s.totals.revenueVnd, 42_000);
    assert.equal(s.totals.orders, 4);
    assert.equal(s.totals.users, 3, "ba khách khác nhau");
    assert.equal(s.totals.revenueUsd, 0.28);
});

test("đơn không gắn người vẫn vào tổng ngày, chỉ không vào bảng khách", () => {
    // Đơn tạo tay từ web có thể thiếu odelegramId. Loại nó khỏi tổng ngày là báo
    // cáo doanh thu thiếu; loại khỏi bảng xếp hạng khách là bắt buộc.
    const rows = [
        { finalAmount: 30_000, status: "DELIVERED", createdAt: new Date(NOW) },
        { odelegramId: "", finalAmount: 40_000, status: "DELIVERED", createdAt: new Date(NOW) },
        order(9, 10_000, NOW),
    ];
    const s = summarizeDailySpend(rows, { days: 1, now: NOW, tzOffsetMinutes: VN });
    assert.equal(s.totals.revenueVnd, 80_000, "tổng ngày phải gồm cả hai đơn mồ côi");
    assert.equal(s.totals.orders, 3);
    assert.equal(s.totals.users, 1, "chỉ một khách có danh tính");
    assert.equal(s.skipped.noUser, 2);
    assert.equal(s.daySeries[0].users, 1);
});

test("ngày có hai đơn của cùng một khách chỉ đếm MỘT user", () => {
    const s = summarizeDailySpend([order(5, 1_000, NOW), order(5, 2_000, NOW + 1_000)], { days: 1, now: NOW, tzOffsetMinutes: VN });
    assert.equal(s.daySeries[0].orders, 2);
    assert.equal(s.daySeries[0].users, 1, "users là số khách DISTINCT, không phải số đơn");
    assert.equal(s.totals.users, 1);
});

test("bảng xếp hạng giảm dần theo tiền, rồi theo số đơn", () => {
    const rows = [
        order("A", 50_000, NOW),
        order("B", 50_000, NOW), order("B", 1, NOW + 1_000),   // B: cùng 50_001 > A
        order("C", 10_000, NOW),
    ];
    const s = summarizeDailySpend(rows, { days: 1, now: NOW, tzOffsetMinutes: VN });
    assert.deepEqual(s.topUsers.map((u) => u.telegramId), ["B", "A", "C"]);
    assert.equal(s.topUsers[0].orders, 2);
    assert.equal(s.topUsers[0].totalVnd, 50_001);
});

test("cắt topUsers PHẢI kêu — truncatedUserCount nói rõ còn bao nhiêu người chưa hiện", () => {
    // Im lặng cắt là lỗi đã gây bug ở cả hai poller: người đọc tưởng đã thấy hết.
    const rows = [];
    for (let i = 0; i < 12; i++) rows.push(order(1000 + i, (12 - i) * 1_000, NOW));
    const s = summarizeDailySpend(rows, { days: 1, now: NOW, tzOffsetMinutes: VN, topUsers: 5 });
    assert.equal(s.topUsers.length, 5);
    assert.equal(s.userCount, 12, "tổng số khách thật vẫn phải được báo");
    assert.equal(s.truncatedUserCount, 7);
    // Người bị cắt là người chi ÍT hơn, không phải cắt tuỳ tiện.
    assert.equal(s.topUsers[4].totalVnd, 8_000);
});

test("hai kiểu trung bình /ngày là hai con số khác nhau và đều có mặt", () => {
    // avgVndPerDayInRange chia cho số ngày trong khoảng (đúng nghĩa "mỗi ngày shop
    // thu bao nhiêu"). avgVndPerActiveDay chia cho số ngày CÓ mua (mô tả hành vi
    // khách). Gộp làm một là một trong hai người đọc bị lừa.
    const rows = [order(7, 30_000, NOW), order(7, 30_000, NOW - 2 * DAY)];
    const s = summarizeDailySpend(rows, { days: 10, now: NOW, tzOffsetMinutes: VN });
    const u = s.topUsers[0];
    assert.equal(u.activeDays, 2);
    assert.equal(u.avgVndPerActiveDay, 30_000);
    assert.equal(u.avgVndPerDayInRange, 6_000, "60_000 / 10 ngày");
    assert.equal(s.totals.avgVndPerDay, 6_000, "tổng ngày cũng chia cho 10, không chia cho 2");
    assert.equal(s.totals.avgVndPerUser, 60_000);
});

test("ngày xấu / dòng rác không làm nổ và được đếm", () => {
    const rows = [
        order(1, 1_000, NOW),
        { odelegramId: "2", finalAmount: 5, status: "DELIVERED", createdAt: null },
        { odelegramId: "3", finalAmount: 5, status: "DELIVERED", createdAt: "không phải ngày" },
        { odelegramId: "4", finalAmount: 5, status: "DELIVERED" },
        null, undefined,
    ];
    const s = summarizeDailySpend(rows, { days: 1, now: NOW, tzOffsetMinutes: VN });
    assert.equal(s.totals.orders, 1);
    assert.equal(s.skipped.badDate, 3);
    // Mảng rỗng / null / undefined đều phải chạy được.
    assert.equal(summarizeDailySpend([], { days: 3, now: NOW }).daySeries.length, 3);
    assert.equal(summarizeDailySpend(null, { days: 1, now: NOW }).totals.orders, 0);
    assert.equal(summarizeDailySpend(undefined, { days: 1, now: NOW }).totals.orders, 0);
});

test("finalAmount không phải số thì coi như 0, không thành NaN lan ra cả bảng", () => {
    const rows = [
        { odelegramId: "1", finalAmount: null, status: "DELIVERED", createdAt: new Date(NOW) },
        { odelegramId: "2", finalAmount: "abc", status: "DELIVERED", createdAt: new Date(NOW) },
        order(3, 10_000, NOW),
    ];
    const s = summarizeDailySpend(rows, { days: 1, now: NOW, tzOffsetMinutes: VN });
    assert.equal(s.totals.revenueVnd, 10_000);
    assert.equal(s.totals.orders, 3, "vẫn đếm là đơn, chỉ không cộng tiền");
    assert.ok(Number.isFinite(s.totals.revenueUsd));
});

// ─── 4. Hai endpoint MỘT luật ──────────────────────────────────────────────────

test("chi tiết một khách khớp ĐÚNG từng con số với bảng tổng quan", () => {
    // Đây là lý do cả hai hàm nằm trong cùng một module và dùng cùng dayRange.
    // Seller API gọi cái này, web admin gọi cái kia — lệch nhau là hai màn hình của
    // cùng một shop cãi nhau về cùng một khách.
    const rows = [
        order(11, 10_000, NOW),
        order(11, 20_000, NOW - DAY),
        order(11, 30_000, NOW - 2 * DAY),
        order(22, 99_000, NOW),
        order(11, 500, NOW, { status: "PENDING" }),   // bị loại ở cả hai
        order(11, 600, NOW - 40 * DAY),               // ngoài khoảng ở cả hai
    ];
    const opts = { days: 5, now: NOW, tzOffsetMinutes: VN };
    const all = summarizeDailySpend(rows, opts);
    const one = summarizeUserDailySpend(rows, 11, opts);

    const fromBoard = all.topUsers.find((u) => u.telegramId === "11");
    assert.ok(fromBoard, "khách 11 phải có trong bảng tổng quan");
    assert.equal(one.totals.revenueVnd, fromBoard.totalVnd);
    assert.equal(one.totals.orders, fromBoard.orders);
    assert.equal(one.totals.activeDays, fromBoard.activeDays);
    assert.equal(one.totals.avgVndPerActiveDay, fromBoard.avgVndPerActiveDay);
    assert.equal(one.daySeries.length, all.daySeries.length, "cùng một khoảng ngày");

    for (const d of one.daySeries) {
        const board = all.daySeries.find((x) => x.date === d.date);
        assert.ok(d.revenueVnd <= board.revenueVnd, `${d.date}: một khách không thể chi hơn tổng cả ngày`);
    }
    assert.equal(one.totals.revenueVnd, 60_000, "10k + 20k + 30k; PENDING và đơn ngoài khoảng bị loại");
});

test("khách không có đơn nào vẫn nhận đủ chuỗi ngày 0", () => {
    const one = summarizeUserDailySpend([order(99, 1_000, NOW)], 12345, { days: 4, now: NOW, tzOffsetMinutes: VN });
    assert.equal(one.telegramId, "12345");
    assert.equal(one.daySeries.length, 4);
    assert.equal(one.totals.revenueVnd, 0);
    assert.equal(one.totals.activeDays, 0);
    assert.equal(one.totals.avgVndPerActiveDay, 0, "không được chia cho 0");
    assert.equal(one.skippedNotThisUser, 1);
});

test("summarizeUserDailySpend so telegramId theo CHUỖI, không theo số", () => {
    // odelegramId trong DB là String. So lỏng (`==`) thì "007" khớp 7 — hai khách
    // khác nhau bị gộp làm một.
    const rows = [{ odelegramId: "007", finalAmount: 1_000, status: "DELIVERED", createdAt: new Date(NOW) }];
    assert.equal(summarizeUserDailySpend(rows, 7, { days: 1, now: NOW }).totals.revenueVnd, 0);
    assert.equal(summarizeUserDailySpend(rows, "007", { days: 1, now: NOW }).totals.revenueVnd, 1_000);
});
