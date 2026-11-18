/**
 * Scheduler & Trình gửi thông báo nền cho Hệ thống Referral v2:
 *   1. 00:05 – 00:25 (giờ Việt Nam): Trả thưởng Top 1–2–3 người mời ngày hôm qua
 *   2. Mỗi 60 phút: Cảnh báo Referral Key 30 ngày còn <= 3 ngày & <= 1 ngày
 *   3. Mỗi 2 phút: Tự phục hồi các lượt tặng token bị kẹt do 429 / mạng nhà cung cấp
 */

import {
    payReferralDailyTopPrizes,
    collectExpiringReferralBonusWarnings,
    resumeStuckReferralGrants,
} from "./referral.js";
import { vnClockParts } from "./referral-math.js";
import { apiKeyMessage } from "./bot-ui/apikey-messages.js";
import { formatTokens } from "./apikey-pricing.js";
import { escapeHtml } from "./bot-ui/format.js";
import { sendLog } from "./lib/logger.js";

const MEDALS = ["🥇", "🥈", "🥉"];

export function sendGrantedKeyOrTopupDm(telegram, grant, { header = "", note = null, icon = () => "" } = {}) {
    if (!telegram || !grant?.telegramId) return Promise.resolve();
    const lang = grant.language || "vi";

    if (grant.mode === "topup") {
        const expText = grant.expiresAt
            ? escapeHtml(String(grant.expiresAt).slice(0, 19).replace("T", " "))
            : (lang === "en" ? "no expiry" : "không hết hạn");
        const lines = [];
        if (header) lines.push(header);
        lines.push(`⚡ <b>${lang === "en" ? "Tokens added to your Referral Key!" : "Đã nạp cộng dồn vào Referral Key!"}</b>`);
        lines.push("━━━━━━━━━━━━━━━━");
        lines.push(`➕ ${lang === "en" ? "Added" : "Vừa cộng"}: <b>+${formatTokens(grant.tokensAdded)} token</b>${grant.lucky ? " 🍀 <i>(Bảo hiểm nhân phẩm!)</i>" : ""}`);
        lines.push(`💎 ${lang === "en" ? "Total quota" : "Tổng hạn mức key"}: <b>${formatTokens(grant.totalTokens)} token</b>`);
        lines.push(`⏳ ${lang === "en" ? "Expires" : "Hạn dùng"}: <b>${expText}</b>`);
        lines.push("");
        lines.push(`<code>${escapeHtml(grant.key)}</code>`);
        lines.push(`<i>${lang === "en" ? "(Key unchanged — no need to update your app)" : "(Key giữ nguyên — không cần đổi lại trong ứng dụng)"}</i>`);
        if (note) {
            lines.push("");
            lines.push(`📌 ${escapeHtml(note)}`);
        }
        return telegram.sendMessage(grant.telegramId, lines.join("\n"), {
            parse_mode: "HTML",
            disable_web_page_preview: true,
        }).catch((e) => console.error("[referral-dm] gửi tin topup lỗi:", e.message));
    }

    const body = apiKeyMessage({
        key: grant.key,
        quotaTokens: grant.quotaTokens || grant.tokensAdded,
        rpm: grant.rpm,
        expiresAt: grant.expiresAt,
        models: grant.models || [],
        endpoint: grant.endpoint || "",
        usageUrl: grant.usageUrl || "",
        kind: "gift",
        note,
        lang,
        icon,
    });
    const fullText = header ? `${header}\n\n${body}` : body;
    return telegram.sendMessage(grant.telegramId, fullText, {
        parse_mode: "HTML",
        disable_web_page_preview: true,
    }).catch((e) => console.error("[referral-dm] gửi tin key mới lỗi:", e.message));
}

export async function deliverInviteGrantsMessages(telegram, grants, { refereeDisplayName = "", icon = () => "" } = {}) {
    if (!telegram || !grants) return;
    const who = escapeHtml(refereeDisplayName || "Một người bạn");

    if (grants.referee) {
        const lang = grants.referee.language || "vi";
        const header = lang === "en"
            ? `🎁 <b>[INVITE GIFT · NEW FRIEND]</b>`
            : `🎁 <b>[KEY TẶNG · NGƯỜI ĐƯỢC MỜI]</b>`;
        const note = lang === "en"
            ? "Welcome gift via referral link!"
            : "Quà tặng khi tham gia qua link giới thiệu!";
        await sendGrantedKeyOrTopupDm(telegram, grants.referee, { header, note, icon });
    }

    if (grants.referrer) {
        const lang = grants.referrer.language || "vi";
        const luckyTag = grants.referrer.lucky ? " 🍀 (Lucky Protect!)" : "";
        const header = lang === "en"
            ? `🎉 <b>[REFERRER REWARD]</b>${luckyTag}\n${who} verified channel membership via your invite link!`
            : `🎉 <b>[THƯỞNG NGƯỜI MỜI]</b>${luckyTag}\n<b>${who}</b> vừa xác minh tham gia kênh qua link giới thiệu của bạn!`;
        const note = grants.referrer.mode === "new"
            ? (lang === "en"
                ? `30-day Referral Key — future invites will automatically top up this same key!`
                : `Referral Key hạn ${grants.referrerKeyDays || 30} ngày — các lượt mời tiếp theo sẽ tự động cộng dồn token vào chính key này!`)
            : null;
        await sendGrantedKeyOrTopupDm(telegram, grants.referrer, { header, note, icon });
    }

    if (Array.isArray(grants.milestones)) {
        for (const m of grants.milestones) {
            const lang = m.language || "vi";
            const header = lang === "en"
                ? `🏆 <b>[MILESTONE ${m.milestoneCount} INVITES]</b>\nCongrats on reaching <b>${m.milestoneCount}</b> verified invites!`
                : `🏆 <b>[THƯỞNG MỐC ${m.milestoneCount} NGƯỜI]</b>\nChúc mừng bạn cán mốc <b>${m.milestoneCount} lượt mời hợp lệ</b>!`;
            await sendGrantedKeyOrTopupDm(telegram, m, { header, icon });
        }
    }
}

export function startReferralScheduler({ telegram, icon = () => "" } = {}) {
    if (!telegram) return { stop: () => {} };
    if (String(process.env.SECONDARY_INSTANCE || "").trim().toLowerCase() === "true") {
        return { stop: () => {}, secondary: true };
    }
    let stopped = false;
    let runningDaily = false;
    let runningWarn = false;
    let runningResume = false;

    const tickDailyTop = async () => {
        if (stopped || runningDaily) return;
        const { hour, minute } = vnClockParts(Date.now());
        if (hour !== 0 || minute < 5 || minute > 25) return;

        runningDaily = true;
        try {
            const res = await payReferralDailyTopPrizes();
            if (res?.winners?.length) {
                for (const w of res.winners) {
                    const medal = MEDALS[w.rank - 1] || `#${w.rank}`;
                    const header = `${medal} <b>[THƯỞNG TOP ${w.rank} MỜI BẠN NGÀY ${w.dayKey}]</b>\n`
                        + `Chúc mừng bạn đạt <b>Top ${w.rank}</b> với <b>${w.inviteCount}</b> lượt mời hợp lệ hôm qua!`;
                    await sendGrantedKeyOrTopupDm(telegram, w, { header, icon });
                }
                sendLog(
                    "REFERRAL",
                    `🏆 Đã trao giải Top ngày ${res.dayKey}: `
                    + res.winners.map((w) => `Top ${w.rank} (${w.telegramId}: +${formatTokens(w.tokensAdded)})`).join(", "),
                );
            }
        } catch (err) {
            console.error("[referral-scheduler] tickDailyTop lỗi:", err.message);
        } finally {
            runningDaily = false;
        }
    };

    const tickExpiryWarn = async () => {
        if (stopped || runningWarn) return;
        runningWarn = true;
        try {
            const alerts = await collectExpiringReferralBonusWarnings();
            for (const a of alerts) {
                const text = `⏰ <b>Cảnh báo Referral Key sắp hết hạn (còn ~${a.daysLeft} ngày)</b>\n`
                    + `━━━━━━━━━━━━━━━━\n`
                    + `🔑 Key thưởng mời bạn: <code>${escapeHtml(a.key)}</code>\n`
                    + `💎 Tổng hạn mức đã tích: <b>${formatTokens(a.quotaTokens)} token</b>\n`
                    + `📅 Hết hạn lúc: <b>${escapeHtml(a.expiresAt.slice(0, 19).replace("T", " "))}</b>\n\n`
                    + `💡 <i>Hãy tranh thủ sử dụng quota trên key này trước khi hết hạn! Khi key hết hạn, lượt mời bạn hợp lệ tiếp theo sẽ tự động tạo cho bạn một Referral Key 30 ngày mới.</i>`;
                await telegram.sendMessage(a.telegramId, text, { parse_mode: "HTML" }).catch(() => {});
            }
        } catch (err) {
            console.error("[referral-scheduler] tickExpiryWarn lỗi:", err.message);
        } finally {
            runningWarn = false;
        }
    };

    const tickResume = async () => {
        if (stopped || runningResume) return;
        runningResume = true;
        try {
            const recoveredList = await resumeStuckReferralGrants();
            for (const grants of recoveredList) {
                await deliverInviteGrantsMessages(telegram, grants, { icon });
            }
        } catch (err) {
            console.error("[referral-scheduler] tickResume lỗi:", err.message);
        } finally {
            runningResume = false;
        }
    };

    const dailyTimer = setInterval(tickDailyTop, 60_000);
    const warnTimer = setInterval(tickExpiryWarn, 60 * 60_000);
    const resumeTimer = setInterval(tickResume, 2 * 60_000);
    const bootWarmTimer = setTimeout(() => {
        tickExpiryWarn().catch(() => {});
        tickResume().catch(() => {});
    }, 30_000);

    dailyTimer.unref?.();
    warnTimer.unref?.();
    resumeTimer.unref?.();
    bootWarmTimer.unref?.();

    return {
        stop() {
            stopped = true;
            clearInterval(dailyTimer);
            clearInterval(warnTimer);
            clearInterval(resumeTimer);
            clearTimeout(bootWarmTimer);
        },
    };
}

export default {
    sendGrantedKeyOrTopupDm,
    deliverInviteGrantsMessages,
    startReferralScheduler,
};
