import { escapeHtml } from "./bot-ui/format.js";
import { formatUsdPrimary, liveUsdVndRate } from "./money-display.js";
// Chỉ import từ flash-sale-MATH (không I/O). Import từ flash-sale.js ở đây sẽ kéo
// theo Mongo client và làm mất khả năng test thuần — đúng lý do đã tách hai file.
import { discountedUnitPrice, discountedUsdPerM, normalizeDiscountPct, offerMinutesLeft } from "./flash-sale-math.js";

/**
 * Toàn bộ CHỮ của Flash Sale, gom một chỗ.
 *
 * Repo có ba kiểu i18n song song: `t()` trong src/i18n, các bảng MSG_LABELS /
 * UI_LABELS nội tuyến, và bảng copy riêng theo module (ORDER_BROADCAST_COPY,
 * GIFT_BROADCAST_COPY trong broadcast.js). Flash sale theo kiểu thứ ba vì:
 *
 *  - Hai kiểu đầu bắt thêm khoá vào 6 file khác nhau cho MỖI câu chữ mới, và thiếu
 *    một file là bản dịch vỡ im lặng. Bảng riêng thì đầy đủ theo cấu tạo.
 *  - Feature này có nhiều câu chữ phụ thuộc nhau (cùng một mức giảm phải đọc nhất
 *    quán ở tin mời, ở màn sản phẩm, ở checkout). Gom một file thì thấy hết.
 *
 * Repo chỉ có vi / en / zh — KHÔNG có tiếng Thái. `t()` fallback về vi, nên thêm `th`
 * riêng cho flash sale sẽ tạo ra khách Thái đọc tiếng Thái ở màn ưu đãi và tiếng Việt
 * ở mọi màn khác. Tệ hơn là đồng nhất fallback, vì vậy không thêm.
 */

const FLASH_COPY = {
    vi: {
        title: "FLASH SALE",
        product: "Sản phẩm",
        each: "suất",
        validity: (m) => `${m} phút kể từ lúc bạn nhận`,
        slotsLimited: "Số suất có hạn",
        slotsLeft: (n) => `Còn ${n} suất`,
        opensAt: (t) => `Mở nhận lúc ${t}`,
        accept: "Nhận ưu đãi",
        skip: "Bỏ qua",
        accepted: "Đã nhận",
        skipped: "Đã bỏ qua",
        // Khách bấm Nhận khi bot còn đang gửi
        notOpenTitle: "Chưa tới giờ mở",
        notOpenBody: "Ưu đãi đang được gửi tới tất cả mọi người.",
        opensIn: (s) => `Mở sau ~${s}s`,
        opensInMin: (m) => `Mở sau ~${m} phút`,
        // Kết quả
        claimOkTitle: "Đã nhận ưu đãi!",
        claimOkBody: (t) => `Ưu đãi hết hạn lúc ${t}`,
        minutesLeft: (m) => `còn ${m} phút`,
        alreadyTitle: "Bạn đã nhận ưu đãi này rồi",
        alreadyBody: (t, m) => `Hết hạn lúc ${t} — còn ${m} phút`,
        full: "Rất tiếc, đã hết suất",
        closed: "Đợt này đã kết thúc",
        expired: "Ưu đãi của bạn đã hết hạn",
        error: "Có lỗi xảy ra, bạn thử lại nhé",
        skipOk: "Đã bỏ qua. Bạn vẫn nhận lại được nếu đợt còn mở và còn suất.",
        // Nhãn gắn vào giá
        badge: (pct, m) => `⚡ Flash sale −${pct}% · còn ${m} phút`,
        badgeNoTime: (pct) => `⚡ Flash sale −${pct}%`,
        perMUnit: "/ 1M token",
        totalOff: (pct) => `−${pct}% trên tổng đơn`,
    },
    en: {
        title: "FLASH SALE",
        product: "Product",
        each: "each",
        validity: (m) => `${m} minutes from when you claim`,
        slotsLimited: "Limited slots",
        slotsLeft: (n) => `${n} slots left`,
        opensAt: (t) => `Opens at ${t}`,
        accept: "Claim offer",
        skip: "Skip",
        accepted: "Claimed",
        skipped: "Skipped",
        notOpenTitle: "Not open yet",
        notOpenBody: "The offer is being sent to everyone.",
        opensIn: (s) => `Opens in ~${s}s`,
        opensInMin: (m) => `Opens in ~${m} min`,
        claimOkTitle: "Offer claimed!",
        claimOkBody: (t) => `Your offer expires at ${t}`,
        minutesLeft: (m) => `${m} min left`,
        alreadyTitle: "You already claimed this offer",
        alreadyBody: (t, m) => `Expires at ${t} — ${m} min left`,
        full: "Sorry, all slots are taken",
        closed: "This round has ended",
        expired: "Your offer has expired",
        error: "Something went wrong, please try again",
        skipOk: "Skipped. You can still claim later while the round is open and slots remain.",
        badge: (pct, m) => `⚡ Flash sale −${pct}% · ${m} min left`,
        badgeNoTime: (pct) => `⚡ Flash sale −${pct}%`,
        perMUnit: "/ 1M tokens",
        totalOff: (pct) => `−${pct}% off the order total`,
    },
    zh: {
        title: "限时抢购",
        product: "商品",
        each: "份",
        validity: (m) => `领取后 ${m} 分钟内有效`,
        slotsLimited: "名额有限",
        slotsLeft: (n) => `剩余 ${n} 个名额`,
        opensAt: (t) => `${t} 开始领取`,
        accept: "领取优惠",
        skip: "跳过",
        accepted: "已领取",
        skipped: "已跳过",
        notOpenTitle: "尚未开始",
        notOpenBody: "优惠正在发送给所有人。",
        opensIn: (s) => `约 ${s} 秒后开始`,
        opensInMin: (m) => `约 ${m} 分钟后开始`,
        claimOkTitle: "已领取优惠！",
        claimOkBody: (t) => `优惠将于 ${t} 到期`,
        minutesLeft: (m) => `还剩 ${m} 分钟`,
        alreadyTitle: "您已领取过此优惠",
        alreadyBody: (t, m) => `${t} 到期 —— 还剩 ${m} 分钟`,
        full: "很抱歉，名额已满",
        closed: "本轮活动已结束",
        expired: "您的优惠已过期",
        error: "出错了，请重试",
        skipOk: "已跳过。活动仍开放且还有名额时，您仍可以领取。",
        badge: (pct, m) => `⚡ 限时抢购 −${pct}% · 还剩 ${m} 分钟`,
        badgeNoTime: (pct) => `⚡ 限时抢购 −${pct}%`,
        perMUnit: "/ 100万 token",
        totalOff: (pct) => `订单总额 −${pct}%`,
    },
};

const copyOf = (lang) => FLASH_COPY[lang] || FLASH_COPY.vi;

/** `18:06` theo giờ Việt Nam — cùng múi giờ mà formatDateTime của repo đang dùng. */
export function formatClock(date) {
    if (!date) return "--:--";
    return new Intl.DateTimeFormat("vi-VN", {
        timeZone: "Asia/Ho_Chi_Minh",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    }).format(new Date(date));
}

/**
 * Số USD không làm tròn, cắt số 0 thừa — để hiện `0.007` chứ không phải `0.0070`.
 * Chỉ dùng cho CON SỐ HIỂN THỊ của giá $/1M token; tiền thật vẫn theo cent.
 */
export function trimUsd(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "0";
    const s = n.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
    return s || "0";
}

/**
 * Cặp giá gạch-ngang: `~~giá cũ~~ → <b>giá mới</b> (−30%)`.
 *
 * `showEquivalent: false` là cố ý: bật lên thì mỗi vế kèm thêm "≈ 250.000đ", và hai
 * vế nhân đôi thành một dòng dài không đọc nổi trên điện thoại.
 */
export function flashPricePair({ priceBefore, priceAfter, currency = "VND", lang = "vi", pct = 0, rate = null } = {}) {
    const r = rate || liveUsdVndRate();
    const opts = { lang, showEquivalent: false, rate: r };
    const oldText = formatUsdPrimary(Number(priceBefore) || 0, currency, opts);
    const newText = formatUsdPrimary(Number(priceAfter) || 0, currency, opts);
    const p = normalizeDiscountPct(pct);
    return `<s>${escapeHtml(oldText)}</s> → <b>${escapeHtml(newText)}</b>${p ? ` <b>(−${p}%)</b>` : ""}`;
}

/**
 * Dòng giá cho sản phẩm API key — giảm trên TỔNG đơn nên con số quảng cáo là
 * giá mỗi 1M token (§4: `~~0.01~~ → 0.007 USDT / 1M token`).
 *
 * Không có `perMUsd` thì chỉ nêu %, không bịa ra một con số $/1M.
 */
export function flashPerMLine({ perMUsd = 0, pct = 0, lang = "vi", totalDiscount = false } = {}) {
    const copy = copyOf(lang);
    const p = normalizeDiscountPct(pct);
    const base = Number(perMUsd) || 0;
    const unit = escapeHtml(copy.perMUnit);
    if (totalDiscount && base > 0 && p) {
        const after = discountedUsdPerM(base, p);
        return `<s>$${trimUsd(base)}</s> → <b>$${trimUsd(after)}</b> ${unit} <b>(−${p}%)</b>`;
    }
    if (base > 0) return `<b>$${trimUsd(base)}</b> ${unit}`;
    // Không đọc được $/1M từ cấu hình thì chỉ nêu %, tuyệt đối không bịa một con số.
    return p ? `<b>${escapeHtml(copy.totalOff(p))}</b>` : "";
}

/** Nhãn `⚡ Flash sale −30% · còn N phút` gắn dưới giá ở màn sản phẩm / checkout. */
export function flashBadge({ pct = 0, expiresAt = null, lang = "vi", now = Date.now() } = {}) {
    const copy = copyOf(lang);
    const p = normalizeDiscountPct(pct);
    if (!p) return "";
    const mins = expiresAt ? offerMinutesLeft(expiresAt, now) : 0;
    return mins > 0 ? copy.badge(p, mins) : copy.badgeNoTime(p);
}

/**
 * Tin ưu đãi gửi cho TOÀN BỘ khách (§2).
 *
 * Ba điều cấm, đều là yêu cầu của spec:
 *  - KHÔNG in số suất, kể cả khi có trần. Tin đã gửi đi thì không sửa được, nên
 *    "Còn 25 suất" là một lời nói dối có hạn dùng — năm phút sau nó sai, và khách
 *    đọc lại tin cũ sẽ thấy bot nói nhảm. Chỉ in "Số suất có hạn". Số thật dành cho
 *    preview của admin, nơi nó còn được cập nhật.
 *  - KHÔNG in số người nhận tin. Đó là dữ liệu kinh doanh của shop.
 *  - KHÔNG hiện thanh tiến độ ở tin này: tiến độ là cho người bấm Nhận sớm.
 */
export function buildOfferMessage({ sale, language = "vi", rate = null, perMUsd = 0 } = {}) {
    const lang = language || "vi";
    const copy = copyOf(lang);
    const r = rate || liveUsdVndRate();
    const pct = normalizeDiscountPct(sale?.discountPct);
    const currency = sale?.productCurrency || "VND";
    const name = escapeHtml(sale?.productName || "");

    const priceLine = sale?.totalDiscount
        ? flashPerMLine({ perMUsd, pct, lang, totalDiscount: true })
        : flashPricePair({
            priceBefore: sale?.productPrice,
            priceAfter: discountedUnitPrice(sale?.productPrice, pct),
            currency,
            lang,
            pct,
            rate: r,
        });

    const text = [
        `⚡ <b>${escapeHtml(copy.title)}</b>`,
        ``,
        `📦 <b>${name}</b>`,
        priceLine,
        `⏱ ${escapeHtml(copy.validity(Number(sale?.validityMinutes) || 60))}`,
        `🎟 ${escapeHtml(copy.slotsLimited)}`,
        sale?.opensAt ? `🔔 ${escapeHtml(copy.opensAt(formatClock(sale.opensAt)))}` : null,
        // `.filter(Boolean)` sẽ nuốt cả dòng "" cố ý để tạo khoảng trống sau tiêu đề.
    ].filter((line) => line !== null && line !== undefined).join("\n");

    const reply_markup = {
        inline_keyboard: [
            [
                { text: `✅ ${copy.accept}`, callback_data: `FLASH_ACC:${sale?.id}` },
                { text: `⏭ ${copy.skip}`, callback_data: `FLASH_SKIP:${sale?.id}` },
            ],
        ],
    };
    return { text, reply_markup };
}

/**
 * Text cho MỌI kết quả của một lượt bấm Nhận / Bỏ Qua.
 *
 * Trả cả `alert` (true = hiện popup chặn, dùng cho ca từ chối) để caller không phải
 * tự đoán: ca "chưa mở" và "hết suất" là popup, ca "đã nhận" phải sửa tin nhắn tại
 * chỗ để nút đổi thành ✅ Đã nhận.
 */
export function buildClaimText({ decision, sale, view = null, language = "vi", rate = null, perMUsd = 0, now = Date.now() } = {}) {
    const lang = language || "vi";
    const copy = copyOf(lang);
    const reason = String(decision?.reason || "");

    if (decision?.ok && reason === "already") {
        const t = formatClock(decision.expiresAt);
        const m = offerMinutesLeft(decision.expiresAt, now);
        // alert: khách bấm lại vì lo lắng, không phải vì muốn đọc một tin mới. Popup
        // nhắc lại hạn là đủ; viết đè lên tin ưu đãi chỉ làm mất thông tin cũ.
        return {
            alert: true,
            text: `${copy.alreadyTitle}\n${copy.alreadyBody(t, m)}`,
        };
    }

    if (decision?.ok) {
        const pct = normalizeDiscountPct(sale?.discountPct);
        const priceLine = sale?.totalDiscount
            ? flashPerMLine({ perMUsd, pct, lang, totalDiscount: true })
            : flashPricePair({
                priceBefore: sale?.productPrice,
                priceAfter: discountedUnitPrice(sale?.productPrice, pct),
                currency: sale?.productCurrency || "VND",
                lang,
                pct,
                rate,
            });
        // Giờ hết hạn và "còn N phút" trên CÙNG một dòng: hai dòng riêng đọc như hai
        // mẩu thông tin, trong khi đây là một ý ("hạn của bạn").
        const mins = offerMinutesLeft(decision.expiresAt, now);
        return {
            alert: false,
            text: [
                `✅ <b>${escapeHtml(copy.claimOkTitle)}</b>`,
                ``,
                `📦 <b>${escapeHtml(sale?.productName || "")}</b>`,
                priceLine,
                `⏱ ${escapeHtml(copy.claimOkBody(formatClock(decision.expiresAt)))}`
                    + (mins > 0 ? ` (${escapeHtml(copy.minutesLeft(mins))})` : ""),
            ].filter((line) => line !== null && line !== undefined).join("\n"),
        };
    }

    // Chưa mở — hiện TIẾN ĐỘ THẬT (§3, §8). Khách bấm sớm phải thấy bot đang gửi tới
    // đâu và còn bao lâu, chứ không phải một câu "chưa mở" khiến họ nghĩ bot treo.
    // `view` KHÔNG chứa tổng số người nhận, nên không có đường nào rò con số đó.
    if (reason === "not_open" && view) {
        const eta = Number(view.etaSeconds) || 0;
        const etaLine = eta >= 120 ? copy.opensInMin(Math.max(1, Math.ceil(eta / 60))) : copy.opensIn(eta);
        return {
            alert: true,
            text: `${view.bar} ${view.pct}%\n\n${copy.notOpenTitle} — ${copy.notOpenBody}\n⏳ ${etaLine}`,
        };
    }

    const map = {
        not_open: copy.notOpenTitle,
        full: copy.full,
        closed: copy.closed,
        expired: copy.expired,
        not_found: copy.closed,
    };
    return { alert: true, text: map[reason] || copy.error };
}

/** Tin báo cho khách sau khi bấm ⏭ Bỏ qua. */
export function buildSkipText({ language = "vi" } = {}) {
    return `⏭ ${escapeHtml(copyOf(language).skipOk)}`;
}

/**
 * Nhãn sản phẩm trong DANH SÁCH khi khách có ưu đãi (§2):
 * `⚡ tên — giá mới (−30%)`.
 */
export function flashListLabel({ name = "", priceAfter = 0, currency = "VND", pct = 0, lang = "vi", rate = null } = {}) {
    const r = rate || liveUsdVndRate();
    const price = formatUsdPrimary(Number(priceAfter) || 0, currency, { lang, showEquivalent: false, rate: r });
    const p = normalizeDiscountPct(pct);
    return `⚡ ${escapeHtml(name)} — <b>${escapeHtml(price)}</b>${p ? ` (−${p}%)` : ""}`;
}

/**
 * Màn xem trước ở bước 5 của wizard (§1).
 *
 * Phải hiện ĐỦ: giá gạch ngang, hạn, suất, số khách sẽ nhận tin, thời gian gửi dự
 * kiến và giờ mở. Admin bấm 🚀 Gửi ngay là bot nhắn cho toàn bộ khách hàng — một
 * hành động không rút lại được, nên màn này là chốt kiểm tra cuối cùng.
 *
 * Giờ mở ở đây là DỰ KIẾN: `opensAt` thật chỉ được chốt lúc tạo đợt (từ thời điểm
 * đó, không phải từ lúc admin đọc màn này). Nói "dự kiến" là cố ý — màn hình có
 * nhiệm vụ làm chốt kiểm tra mà lại in một con số khác con số sẽ gửi cho khách thì
 * nó là một cái chốt sai, tệ hơn là không có chốt.
 */
export function buildAdminPreview({
    productName = "", priceBefore = 0, priceAfter = 0, currency = "VND",
    discountPct = 0, validityMinutes = 60, maxSlots = 0,
    customerCount = 0, opensAt = null, secsPerUser = 0, perMUsd = 0, totalDiscount = false,
} = {}) {
    const pct = normalizeDiscountPct(discountPct);
    const sendSeconds = Math.max(0, Math.round(Number(customerCount) * Number(secsPerUser || 0)));
    const priceLine = totalDiscount
        ? flashPerMLine({ perMUsd, pct, lang: "vi", totalDiscount: true })
        : flashPricePair({ priceBefore, priceAfter, currency, lang: "vi", pct });

    return [
        `⚡ <b>XEM TRƯỚC FLASH SALE</b>`,
        ``,
        `📦 Sản phẩm: <b>${escapeHtml(productName)}</b>`,
        `🏷 Giá: ${priceLine}`,
        `⏱ Hiệu lực: <b>${validityMinutes} phút</b> kể từ lúc khách nhận`,
        `🎟 Suất: <b>${maxSlots > 0 ? maxSlots : "không giới hạn"}</b>`,
        ``,
        `📨 Sẽ gửi tới <b>${customerCount.toLocaleString("vi-VN")}</b> khách`,
        `⏳ Thời gian gửi dự kiến: <b>~${Math.ceil(sendSeconds / 60)} phút</b>`,
        `🔔 Mở nhận dự kiến lúc: <b>${formatClock(opensAt)}</b>`,
        ``,
        `⚠️ Bấm Gửi ngay là bot nhắn cho TOÀN BỘ khách hàng. Không thu hồi được.`,
        `<i>Giờ mở chính thức chốt lúc bạn bấm Gửi ngay.</i>`,
    ].join("\n");
}

/**
 * Bàn phím của tin ưu đãi, theo trạng thái lựa chọn của khách.
 *
 * Ba trạng thái, và một chi tiết của §2 quyết định hình dạng của chúng: khách BỎ QUA
 * rồi VẪN được nhận lại nếu đợt còn mở và còn suất. Vì vậy ở trạng thái `skipped` nút
 * Nhận PHẢI còn đó — chỉ đổi nhãn nút Bỏ qua thành "Đã bỏ qua". Nếu ẩn nút Nhận đi thì
 * câu hứa "vẫn nhận lại được" thành lời hứa suông, khách chỉ còn cách đợi đợt sau.
 */
export function flashButtons(state, saleId, lang = "vi") {
    const copy = copyOf(lang);
    const acc = { text: `✅ ${copy.accept}`, callback_data: `FLASH_ACC:${saleId}` };
    const skip = { text: `⏭ ${copy.skip}`, callback_data: `FLASH_SKIP:${saleId}` };
    if (state === "accepted") {
        return { inline_keyboard: [[{ text: `✅ ${copy.accepted}`, callback_data: `FLASH_DONE:${saleId}` }]] };
    }
    if (state === "skipped") {
        return { inline_keyboard: [[acc, { text: `⏭ ${copy.skipped}`, callback_data: `FLASH_DONE:${saleId}` }]] };
    }
    return { inline_keyboard: [[acc, skip]] };
}

/**
 * Popup cho nút đã chốt trạng thái (✅ Đã nhận / ⏭ Đã bỏ qua).
 *
 * KHÔNG chạy lại luồng nhận ở đây: sau khi Bỏ qua, nút "Đã bỏ qua" vẫn nằm cạnh nút
 * Nhận còn sống, và nếu bấm nó mà lại đi chiếm suất thì một cú bấm nhầm đổi thành một
 * lượt mua giá giảm ngoài ý muốn. Nút này chỉ trả lời "trạng thái của bạn là gì".
 */
export function buildDoneText({ kind = "", expiresAt = null, lang = "vi", now = Date.now() } = {}) {
    const copy = copyOf(lang);
    if (kind === "ACCEPT") {
        const mins = offerMinutesLeft(expiresAt, now);
        return mins > 0
            ? `${copy.alreadyTitle}\n${copy.alreadyBody(formatClock(expiresAt), mins)}`
            : copy.expired;
    }
    if (kind === "SKIP") return copy.skipOk;
    return copy.closed;
}

/**
 * Rút thông tin ưu đãi từ một product ĐÃ được `applyOfferToProduct` xử lý, thành shape
 * mà các hàm render ở `bot-ui/messages.js` nhận.
 *
 * Trả null khi không có ưu đãi — nhờ vậy mọi màn hình chỉ cần truyền
 * `flash: flashViewOf(product)` mà không phải tự kiểm tra, và hành vi khi không có
 * flash sale giống hệt trước đây.
 */
export function flashViewOf(product) {
    const pct = normalizeDiscountPct(product?.flashPct);
    if (!pct || product?.flashMode !== "unit") return null;
    return {
        pct,
        priceBefore: Number(product?.priceBeforeFlash) || 0,
        expiresAt: product?.flashOffer?.expiresAt || null,
    };
}

export default {
    FLASH_COPY,
    formatClock,
    trimUsd,
    flashPricePair,
    flashPerMLine,
    flashBadge,
    flashViewOf,
    buildOfferMessage,
    buildClaimText,
    buildSkipText,
    buildDoneText,
    flashButtons,
    flashListLabel,
    buildAdminPreview,
};
