/**
 * Nhắc khách gia hạn khi key sắp hết / đã hết.
 *
 * Ba mốc, mỗi mốc ĐÚNG MỘT TIN (xem nextNotifyStage trong apikey-renew.js):
 *   1. sắp hết   — dùng ~80% quota, hoặc còn ≤3 ngày
 *   2. sắp cạn   — dùng ~95% quota, hoặc còn ≤1 ngày
 *   3. đã hết    — cạn quota, quá hạn, hoặc provider đã tắt key
 * Mốc đã nhắc lưu ở IssuedApiKey.notifyStage; gia hạn xong reset về 0 nên chu kỳ
 * chạy lại từ đầu cho lần sau.
 *
 * Hiệu năng: MỘT request `GET /keys` lấy quota_used của toàn bộ key, không phải
 * mỗi key một request. Shop có hàng nghìn key vẫn chỉ tốn một lượt gọi mỗi vòng.
 *
 * Vòng quét được viết thành hàm THUẦN THAM SỐ (`runApiKeyNotifierOnce`) để test
 * được: prisma/telegram/nguồn số liệu đều tiêm từ ngoài, giống delivery-recovery.
 */

import { keyLifecycle, nextNotifyStage, toDisplayTokens, STAGE_LOW, STAGE_CRITICAL, STAGE_DEAD } from "./apikey-renew.js";

const DEFAULT_INTERVAL_MS = 30 * 60_000;
const DEFAULT_BATCH = 200;
/** Key hết hạn quá lâu thì thôi, đừng đào mộ nhắc khách nữa. */
const MAX_DEAD_AGE_MS = 30 * 86_400_000;

const COPY = {
    vi: {
        title: { [STAGE_LOW]: "API key của bạn sắp hết", [STAGE_CRITICAL]: "API key sắp cạn", [STAGE_DEAD]: "API key đã hết" },
        quotaLeft: (pct) => `Đã dùng <b>${pct}%</b> quota.`,
        daysLeft: (d) => `Còn <b>${d}</b> ngày sử dụng.`,
        deadQuota: "Key đã dùng hết quota.",
        deadTime: "Key đã quá hạn sử dụng.",
        deadOff: "Key đã bị ngừng hoạt động.",
        cta: "Gia hạn ngay — key giữ nguyên, không phải sửa gì trong ứng dụng.",
        btn: "Gia hạn key",
        btnMine: "API key của tôi",
    },
    en: {
        title: { [STAGE_LOW]: "Your API key is running low", [STAGE_CRITICAL]: "API key almost exhausted", [STAGE_DEAD]: "API key exhausted" },
        quotaLeft: (pct) => `<b>${pct}%</b> of the quota used.`,
        daysLeft: (d) => `<b>${d}</b> day(s) left.`,
        deadQuota: "The key has used up its quota.",
        deadTime: "The key has expired.",
        deadOff: "The key has been disabled.",
        cta: "Renew now — the key stays the same, nothing to change in your app.",
        btn: "Renew key",
        btnMine: "My API keys",
    },
    zh: {
        title: { [STAGE_LOW]: "您的 API 密钥即将用完", [STAGE_CRITICAL]: "API 密钥即将耗尽", [STAGE_DEAD]: "API 密钥已用完" },
        quotaLeft: (pct) => `已使用 <b>${pct}%</b> 配额。`,
        daysLeft: (d) => `剩余 <b>${d}</b> 天。`,
        deadQuota: "密钥配额已用尽。",
        deadTime: "密钥已过期。",
        deadOff: "密钥已被停用。",
        cta: "立即续期 —— 密钥不变，无需修改应用配置。",
        btn: "续期密钥",
        btnMine: "我的 API 密钥",
    },
};

const copyOf = (lang) => COPY[["vi", "en", "zh"].includes(lang) ? lang : "vi"] || COPY.vi;

function esc(v = "") {
    return String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Nội dung tin nhắc. Hàm THUẦN — test được không cần Telegram.
 * `icon` là hàm lấy icon theo key config (iconOf), mặc định không icon.
 */
export function buildRenewNudge({ stage, life, key, quotaTokens, lang = "vi", icon = () => "" } = {}) {
    const t = copyOf(lang);
    const ic = (k) => { const v = icon(k); return v ? `${v} ` : ""; };
    const head = stage === STAGE_DEAD ? ic("APIKEY_WARN_DEAD") : ic("APIKEY_WARN_LOW");

    let detail;
    if (stage === STAGE_DEAD) {
        detail = life.reason === "disabled" ? t.deadOff : (life.reason === "time" ? t.deadTime : t.deadQuota);
    } else if (life.reason === "time") {
        detail = t.daysLeft(Math.max(0, Math.ceil(life.daysLeft)));
    } else {
        detail = t.quotaLeft(Math.round(life.usedPct));
    }

    const text = `${head}<b>${t.title[stage]}</b>\n━━━━━━━━━━━━━━━━\n`
        + `<code>${esc(key)}</code>\n\n`
        + `${detail}\n\n${t.cta}`;
    return { text, buttons: { renew: t.btn, mine: t.btnMine } };
}

/**
 * Một vòng quét. Trả thống kê để log và để test khẳng định.
 *
 * @param statuses  Map externalId → { quotaLimit, quotaUsed, expiresAt, enabled }
 *                  (thường là kết quả listKeyStatuses().byId)
 */
export async function runApiKeyNotifierOnce({
    prisma, telegram, statuses, now = Date.now(), batchSize = DEFAULT_BATCH,
    icon = () => "", quotaRefPrice = 0, thresholds = {},
} = {}) {
    const result = { scanned: 0, notified: 0, failed: 0, skipped: 0 };
    if (!prisma || !telegram || !(statuses instanceof Map) || statuses.size === 0) return result;

    // Chỉ xét key CÓ externalId (gia hạn được) và CHƯA nhắc hết ba mốc.
    const rows = await prisma.issuedApiKey.findMany({
        where: { externalId: { not: null }, notifyStage: { lt: STAGE_DEAD } },
        orderBy: { createdAt: "desc" },
        take: Math.max(1, Number(batchSize) || DEFAULT_BATCH),
    }).catch(() => []);
    if (!rows.length) return result;

    // Ngôn ngữ + trạng thái chặn của chủ key, lấy MỘT lượt cho cả lô (IssuedApiKey
    // không mang language). Khách đã chặn bot thì bỏ qua luôn, khỏi tốn request.
    const owners = await prisma.user.findMany({
        where: { telegramId: { in: [...new Set(rows.map((r) => String(r.telegramId)))] } },
        select: { telegramId: true, language: true, isBlocked: true },
    }).catch(() => []);
    const ownerById = new Map(owners.map((u) => [String(u.telegramId), u]));

    for (const row of rows) {
        result.scanned += 1;
        const st = statuses.get(row.externalId);
        // Không có trong danh sách provider = key đã bị xoá bên đó. Đánh dấu đã
        // nhắc hết để vòng sau không quét lại mãi, nhưng KHÔNG nhắn gì — khách
        // không làm gì sai, và cũng chẳng gia hạn được nữa.
        if (!st) {
            await prisma.issuedApiKey.update({ where: { id: row.id }, data: { notifyStage: STAGE_DEAD } }).catch(() => {});
            result.skipped += 1;
            continue;
        }

        // Hạn dùng số của BOT: bản `GET /keys` (danh sách) không trả expires_at.
        const life = keyLifecycle(
            { ...st, expiresAt: st.expiresAt ?? row.expiresAt ?? null },
            now, thresholds,
        );
        const stage = nextNotifyStage(life.stage, row.notifyStage || 0);
        if (!stage) { result.skipped += 1; continue; }

        // Khách đã chặn bot → không gửi được, và cũng không nhả mốc: giữ nguyên
        // để lần sau họ mở lại bot vẫn nhận được đúng mốc đó.
        const owner = ownerById.get(String(row.telegramId));
        if (owner?.isBlocked) { result.skipped += 1; continue; }

        // Key chết đã lâu thì im lặng đóng hồ sơ — nhắc gia hạn một key hết hạn
        // từ hai tháng trước chỉ làm phiền.
        const deadTooLong = life.dead && row.expiresAt
            && (now - new Date(row.expiresAt).getTime()) > MAX_DEAD_AGE_MS;
        if (deadTooLong) {
            await prisma.issuedApiKey.update({ where: { id: row.id }, data: { notifyStage: STAGE_DEAD } }).catch(() => {});
            result.skipped += 1;
            continue;
        }

        // GHI MỐC TRƯỚC KHI GỬI, có điều kiện: hai vòng quét chồng nhau (job chậm
        // hơn interval) thì chỉ một vòng qua được, khách không nhận tin đôi.
        const claimed = await prisma.issuedApiKey.updateMany({
            where: { id: row.id, notifyStage: row.notifyStage || 0 },
            data: { notifyStage: stage, notifyAt: new Date(now) },
        }).catch(() => ({ count: 0 }));
        if (!claimed?.count) { result.skipped += 1; continue; }

        const quotaTokens = st.quotaLimit > 0 ? toDisplayTokens(st.quotaLimit, quotaRefPrice) : row.quotaTokens;
        const { text, buttons } = buildRenewNudge({
            stage, life, key: row.key, quotaTokens, lang: owner?.language || "vi", icon,
        });
        try {
            await telegram.sendMessage(row.telegramId, text, {
                parse_mode: "HTML",
                reply_markup: {
                    inline_keyboard: [
                        [{ text: buttons.renew, callback_data: `APIKEY_RN:${row.id}` }],
                        [{ text: buttons.mine, callback_data: "APIKEY_MINE" }],
                    ],
                },
            });
            result.notified += 1;
        } catch (err) {
            // Khách chặn bot / xoá tài khoản → KHÔNG nhả mốc: nhắc lại cũng thế.
            result.failed += 1;
            if (err?.code === 403) {
                await prisma.user.update({ where: { telegramId: String(row.telegramId) }, data: { isBlocked: true } }).catch(() => {});
            }
        }
        // Giãn nhịp: broadcast của repo dùng 50ms, giữ nguyên cho khớp rate limit.
        await new Promise((r) => setTimeout(r, 50));
    }

    return result;
}

/** Chạy định kỳ. Gọi từ server.js, giống scheduleDeliveryRecovery. */
export function scheduleApiKeyNotifier({
    prisma, telegram, listKeyStatuses, getConfig, icon = () => "",
    intervalMs = DEFAULT_INTERVAL_MS,
} = {}) {
    if (!prisma || !telegram || typeof listKeyStatuses !== "function") return null;
    let running = false;

    const tick = async () => {
        if (running) return; // vòng trước còn chạy → bỏ nhịp này, không chồng nhau
        running = true;
        try {
            const cfg = await getConfig?.().catch(() => ({})) ?? {};
            // Cửa hàng tắt hoặc chưa cấu hình → không nhắc gì (nhắc gia hạn khi
            // khách không mua được là mời họ vào ngõ cụt).
            if (!cfg.configured || cfg.enabled === false) return;
            const statuses = await listKeyStatuses().catch(() => null);
            if (!statuses?.ok) return;
            const res = await runApiKeyNotifierOnce({
                prisma, telegram, statuses: statuses.byId, icon,
                quotaRefPrice: cfg.quotaRefPrice ?? 0,
            });
            if (res.notified) console.log(`[apikey-notifier] nhắc ${res.notified} key (quét ${res.scanned}, lỗi ${res.failed})`);
        } catch (e) {
            console.error("[apikey-notifier]", e.message);
        } finally {
            running = false;
        }
    };

    const timer = setInterval(tick, Math.max(60_000, Number(intervalMs) || DEFAULT_INTERVAL_MS));
    if (timer.unref) timer.unref();
    console.log(`Nhắc gia hạn API key đã bật (${Math.round(intervalMs / 60000)} phút/lượt)`);
    return timer;
}

export default { buildRenewNudge, runApiKeyNotifierOnce, scheduleApiKeyNotifier };
