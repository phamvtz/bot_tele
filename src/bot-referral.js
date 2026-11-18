/**
 * Giao diện & Handler Telegram Bot cho Hệ thống Referral v2:
 *   - Màn chính Giới thiệu (`REFERRAL`, lệnh `/ref`, bàn phím dưới "Giới thiệu")
 *   - Xem / Copy Referral Key 30 ngày (`REF:COPY_KEY`)
 *   - Đổi điểm lấy Token API (`REF:TOK`, lệnh `/tok`, chọn gói, tạo key mới / nạp cộng dồn / dán sk-...)
 *   - Nhập mã quà chào mừng `WEL...` (`REF:WEL_ENTER`)
 *   - Đua Top hôm nay & Bảng xếp hạng Top 10 (`REF:LB`)
 *   - Lịch sử nhận thưởng (`REF:HISTORY`), Luật thưởng (`REF:RULES`), Kiểm tra Join (`REF:CHECK_JOIN`)
 */

import { Markup } from "telegraf";
import { prisma } from "./db.js";
import {
    getReferralConfig,
    getReferralStats,
    getReferralLink,
    processReferralOnboarding,
    redeemWelcomeCode,
    listEligibleTopupKeys,
    redeemPointsToNewKey,
    redeemPointsToTopup,
    listAvailableClassicRedeemTiers,
    redeemPointsToClassicProduct,
    getUserReferralDetails,
    getUserReferralHistory,
    getDailyReferralLeaderboard,
    getReferralLeaderboard,
} from "./referral.js";
import {
    getKey1bUserView,
    redeemKey1b,
    announceKey1bMilestone,
} from "./key1b.js";
import { deliverOrder } from "./delivery.js";
import { deliverInviteGrantsMessages, sendGrantedKeyOrTopupDm } from "./referral-scheduler.js";
import { formatTokens } from "./apikey-pricing.js";
import { escapeHtml } from "./bot-ui/format.js";
import { answerCallback, sendChatAction } from "./bot-ui/safe.js";
import { sendLog } from "./lib/logger.js";
import { sendBroadcast } from "./broadcast.js";

const DIVIDER = "━━━━━━━━━━━━━━━━";
const MEDALS = ["🥇", "🥈", "🥉"];

function maskKeyShort(sk = "") {
    const s = String(sk || "");
    if (s.length <= 14) return s;
    return `${s.slice(0, 7)}...${s.slice(-6)}`;
}

function fmtDateShort(iso) {
    if (!iso) return "không hết hạn";
    const s = String(iso);
    return s.slice(0, 16).replace("T", " ");
}

function rewardTypeBadge(rewardType, note = "") {
    switch (rewardType) {
        case "ref_invite_token":
            return String(note).startsWith("referred") ? "🎁 Quà bạn mới" : "🎉 Thưởng mời bạn";
        case "ref_milestone":
            return "🏆 Thưởng mốc mời";
        case "ref_daily_top":
            return "👑 Giải Top ngày";
        case "ref_welcome_key":
            return "🌟 Quà chào mừng WEL";
        case "token_newkey":
            return "💎 Đổi điểm (Key mới)";
        case "token_topup":
            return "⚡ Đổi điểm (Nạp key)";
        case "buyer_voucher":
            return "🎟️ Coupon mốc người mua";
        case "key1b":
            return "🔥 Đổi Key 1.5B (IP)";
        case "classic_basic":
            return "🎁 Đổi quà Basic";
        case "classic_bh3d":
            return "🛡️ Đổi quà BH 3 ngày";
        case "classic_bh7d":
            return "💎 Đổi quà BH 7 ngày";
        case "classic_gpt":
            return "🤖 Đổi quà GPT 7 ngày";
        default:
            return rewardType;
    }
}

export function createReferralBotModule({
    getLang,
    editMenu,
    cleanReply,
    safeDelete,
    getBotInfo,
    isGroupMember,
    iconOf,
    iconBtn,
    navBtn,
    buildApiKeyDeliveredKeyboard,
    formatUsdPrimary,
    liveUsdVndRate,
    MENU_KEYWORDS = [],
}) {
    /**
     * Chạy pipeline xác minh kênh + gửi các tin thông báo kết quả (Welcome Key, Age Gate,
     * Cặp quà Invite 2 phía, Mốc 5/10/20). An toàn gọi nền (fire-and-forget) hoặc await.
     */
    const runAndDeliverOnboarding = async (ctx, { alreadyVerified = false } = {}) => {
        try {
            if (!ctx?.from?.id) return null;
            if (!alreadyVerified) {
                const candidate = await prisma.user.findUnique({ where: { telegramId: String(ctx.from.id) } }).catch(() => null);
                if (!candidate?.referredBy) return null;
                if (!(await isGroupMember(ctx.from.id))) {
                    return null;
                }
            }
            const out = await processReferralOnboarding(ctx.from);
            if (!out) return null;

            const rawWho = ctx.from?.username
                ? `@${ctx.from.username}`
                : (ctx.from?.first_name || "Một người bạn");

            // 1. Mã quà chào mừng WEL...
            if (out.welcomeReward?.status === "redeemed" && out.welcomeReward.keyData) {
                const header = `🌟 <b>[QUÀ CHÀO MỪNG BẠN MỚI · ${escapeHtml(out.welcomeReward.code)}]</b>`;
                await sendGrantedKeyOrTopupDm(ctx.telegram, out.welcomeReward.keyData, {
                    header,
                    note: "Tự động kích hoạt khi xác minh tham gia kênh lần đầu!",
                    icon: iconOf,
                });
            } else if (out.welcomeReward?.status === "code_sent" && out.welcomeReward.code) {
                const msg = `🎁 <b>Mã quà chào mừng của bạn:</b> <code>${escapeHtml(out.welcomeReward.code)}</code>\n`
                    + `${DIVIDER}\n`
                    + `Bấm nút bên dưới và gửi mã này để nhận ngay API Key miễn phí!`;
                await ctx.telegram.sendMessage(ctx.from.id, msg, {
                    parse_mode: "HTML",
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback("🎁 Nhập mã quà chào mừng", "REF:WEL_ENTER")],
                    ]),
                }).catch(() => {});
            }

            // 2. Bị hoãn do Age Gate Telegram (Peer Envelope)
            if (out.ageGate?.deferred) {
                if (out.ageGate.firstDeferNotice) {
                    const userNotice = `⏳ <b>Tạm hoãn quà mời bạn (Lọc tuổi tài khoản Telegram)</b>\n`
                        + `${DIVIDER}\n`
                        + `Tài khoản Telegram của bạn ước tính chưa đủ <b>${out.ageGate.minDays} ngày tuổi</b> (còn khoảng <b>~${out.ageGate.remainingDays} ngày</b>).\n\n`
                        + `✅ Bạn <b>vẫn mua hàng và sử dụng shop bình thường</b>.\n`
                        + `💡 Sau khi đủ ${out.ageGate.minDays} ngày, hãy vào mục <b>Giới thiệu → ✅ Kiểm tra Join</b> để nhận tiếp Key tặng 20M & điểm thưởng cho cả 2 bên!`;
                    await ctx.telegram.sendMessage(ctx.from.id, userNotice, { parse_mode: "HTML" }).catch(() => {});

                    if (out.ageGate.referrerTgId) {
                        const refNotice = `⏳ <b>Lượt mời đang chờ đủ tuổi Telegram</b>\n`
                            + `${DIVIDER}\n`
                            + `<b>${escapeHtml(rawWho)}</b> đã vào kênh qua link của bạn nhưng tài khoản Telegram chưa đủ <b>${out.ageGate.minDays} ngày tuổi</b> (còn ~${out.ageGate.remainingDays} ngày).\n`
                            + `Khi đủ ngày, bạn của bạn bấm <b>✅ Kiểm tra Join</b> là hệ thống sẽ tự cộng điểm & nạp token thưởng cho cả hai!`;
                        await ctx.telegram.sendMessage(out.ageGate.referrerTgId, refNotice, { parse_mode: "HTML" }).catch(() => {});
                    }
                }
                return out;
            }

            // 3. Giao cặp quà token 2 phía + Mốc 5/10/20
            if (out.inviteGrants) {
                await deliverInviteGrantsMessages(ctx.telegram, out.inviteGrants, {
                    refereeDisplayName: rawWho,
                    icon: iconOf,
                });
                sendLog(
                    "REFERRAL",
                    `User ${ctx.from.id} (${rawWho}) hoàn tất xác minh ref → `
                    + `bạn mới: ${out.inviteGrants.referee ? formatTokens(out.inviteGrants.referee.quotaTokens) : "–"}, `
                    + `người mời: ${out.inviteGrants.referrer ? `+${formatTokens(out.inviteGrants.referrer.tokensAdded)} (${out.inviteGrants.referrer.mode})` : "–"}`,
                );
            }

            return out;
        } catch (err) {
            console.error("[bot-referral] runAndDeliverOnboarding lỗi:", err.message);
            return null;
        }
    };

    /** Hiển thị màn chính Giới thiệu & Điểm thưởng (theo bố cục chuẩn Ảnh 3). */
    const showReferralMenu = async (ctx, { edit = true } = {}) => {
        const lang = getLang(ctx);
        const [user, botInfo, cfg] = await Promise.all([
            prisma.user.findUnique({ where: { telegramId: String(ctx.from.id) } }),
            getBotInfo(),
            getReferralConfig(),
        ]);

        if (!user) {
            return ctx.reply("Không tìm thấy tài khoản. Hãy gõ /start để khởi tạo.");
        }

        const stats = await getReferralStats(user.id, user);
        const link = getReferralLink(botInfo.username, user.telegramId);
        const r = stats.reward;
        const minM = formatTokens(r.referrerMinTokens);
        const maxM = formatTokens(r.referrerMaxTokens);
        const friendM = formatTokens(r.tokens);
        const srvTag = stats.serverName ? ` ${escapeHtml(stats.serverName)}` : "";

        const shareText = r.enabled
            ? `Vào bot nhận ngay API Key ${friendM} token miễn phí!`
            : `Tham gia ${botInfo.first_name || "Shop"} ngay!`;
        const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(shareText)}`;

        const lines = [];
        lines.push(`🎁 <b>Giới thiệu &amp; Điểm thưởng</b>`);
        lines.push(`🔗 Link giới thiệu của bạn:`);
        lines.push(escapeHtml(link));

        if (r.enabled) {
            const friendDayLabel = r.days > 0 ? `${r.days} ngày` : "không giới hạn ngày";
            lines.push(`🎁 Mỗi bạn mới join (captcha + channel): bot cộng <b>${minM}–${maxM}</b> vào <b>key thưởng ${r.referrerKeyDays} ngày</b> (tự tạo, không cần mua) · bạn bè nhận key <b>${friendM}</b> (${friendDayLabel}).`);

            if (stats.bonusKey) {
                lines.push(`🔑 Đang có key thưởng (${r.referrerKeyDays} ngày): <code>${escapeHtml(maskKeyShort(stats.bonusKey.key))}</code> · Tích lũy: <b>${formatTokens(stats.bonusKey.quotaTokens)}</b> · Hạn: <b>${escapeHtml(fmtDateShort(stats.bonusKey.expiresAt))}</b>`);
            } else {
                lines.push(`📭 Chưa có key thưởng. Mời bạn hợp lệ đầu tiên — bot <b>tự tạo key ${r.referrerKeyDays} ngày</b>, không cần mua. Xong bấm <b>Copy key thưởng</b>.`);
            }

            if (stats.milestone) {
                const ms = stats.milestone;
                lines.push(`📈 Tiến độ mời: <code>${ms.bar}</code> <b>${ms.current}/${ms.target}</b>`);
                lines.push(`🎁 Lượt tiếp theo: <b>+${minM} đến +${maxM}</b>`);
                if (ms.allDone) {
                    lines.push(`🏆 Đã chinh phục trọn bộ mốc 5 / 10 / 20!`);
                } else {
                    lines.push(`🎯 Còn <b>${Math.max(0, ms.target - ms.current)}</b> người tới mốc ${ms.target} (<b>+${formatTokens(ms.bonusTokens)}</b>)`);
                }
            }
        }

        lines.push(`⭐ Điểm hiện tại: <b>${stats.referralPoints}</b>`);
        if (stats.referredByDisplay) {
            lines.push(`🤝 Bạn được giới thiệu bởi: <b>${escapeHtml(stats.referredByDisplay)}</b>`);
        }
        lines.push(`📊 Invited: <b>${stats.referralCount}</b> · rewarded: <b>${stats.rewardedCount}</b>`);
        lines.push(`📊 <b>Pipeline mời:</b>`);
        lines.push(`👥 Đã /start qua link: <b>${stats.pipeline.startedCount}</b>`);
        lines.push(`✅ Đã join channel${r.pointJoinChannel > 0 ? ` (đã +${r.pointJoinChannel}đ)` : ""}: <b>${stats.pipeline.joinedChannelCount}</b>`);
        lines.push(`🛒 Người mua giới thiệu: <b>${stats.pipeline.buyersCount}</b>`);
        lines.push(`⚠️ Chỉ user <b>hoàn toàn mới</b> mới tính thưởng — người đã từng /start bot sẽ không nhận.`);

        if (r.redeemEnabled) {
            const capSuffix = stats.maxTokensPerBatch > 0
                ? ` (trần <b>${formatTokens(stats.maxTokensPerBatch)}</b>/user)`
                : "";
            lines.push(`🔋 Đổi điểm lấy token API${srvTag}: <b>1 điểm = ${formatTokens(r.tokenPerPoint)}</b>${capSuffix}.`);
            if (stats.maxTokensPerBatch > 0) {
                lines.push(`📊 Đã đổi <b>${formatTokens(stats.usedTokensInBatch)}/${formatTokens(stats.maxTokensPerBatch)}</b> token.`);
            }
            if (stats.referralPoints < 1) {
                lines.push(`🎁 Cần thêm <b>${1 - stats.referralPoints} điểm</b> để đổi quà${srvTag || " API"}.`);
            }
            lines.push(`⚠️ Chỉ key${srvTag || " trong shop"} thường còn hạn. Không áp dụng key vô hạn quota, key ngoài shop, key hết hạn hoặc đã tắt.`);
        }

        if (stats.refWelcomeCode && !stats.refWelcomeRedeemedAt) {
            lines.push(`🌟 Mã quà chào mừng chưa đổi: <code>${escapeHtml(stats.refWelcomeCode)}</code>`);
        }

        if (stats.commissionPercent > 0) {
            lines.push(`💰 Hoa hồng đơn hàng: <b>${stats.commissionPercent}%</b> · Đã nhận: <b>${formatUsdPrimary(stats.totalCommission, "VND", { lang, rate: liveUsdVndRate() })}</b>`);
        }

        const rows = [
            [Markup.button.url("📤 Chia sẻ link mời ngay", shareUrl)],
            [
                Markup.button.callback("🔗 Link giới thiệu", "REF:LINK"),
                Markup.button.callback("📋 Copy key thưởng", "REF:COPY_KEY"),
            ],
            [
                Markup.button.callback("🎁 Lịch sử thưởng", "REF:HISTORY"),
                Markup.button.callback("📊 Xem chi tiết", "REF:DETAILS"),
            ],
            [Markup.button.callback("🏆 Leaderboard", "REF:LB")],
            [Markup.button.callback("🎁 Đổi quà", "REF:REDEEM_MENU")],
        ];

        if (stats.referredBy && !stats.channelPointAwarded) {
            rows.push([
                Markup.button.callback("📖 Luật thưởng", "REF:RULES"),
                Markup.button.callback("✅ Kiểm tra Join", "REF:CHECK_JOIN"),
            ]);
        } else {
            rows.push([Markup.button.callback("📖 Luật thưởng", "REF:RULES")]);
        }
        rows.push([navBtn("NAV_BACK", "⬅️ Về menu", "BACK_HOME")]);

        const extra = {
            parse_mode: "HTML",
            disable_web_page_preview: true,
            ...Markup.inlineKeyboard(rows),
        };
        return edit ? editMenu(ctx, lines.join("\n"), extra) : cleanReply(ctx, lines.join("\n"), extra);
    };

    /**
     * Kho Quà & Đổi Điểm tổng hợp (`REF:REDEEM_MENU` & `APIKEY_REWARDS` / `apik:rewards`):
     * Gom Đổi điểm lấy Token, Key 1.5B, 4 Tier Account Classic (chỉ hiện tier có slug khác rỗng),
     * và Nhập mã quà chào mừng `WEL...`.
     */
    const showRedeemHubMenu = async (ctx, { edit = true, fromApiMenu = false } = {}) => {
        const [user, cfg, key1bView, classicTiers] = await Promise.all([
            prisma.user.findUnique({ where: { telegramId: String(ctx.from.id) } }),
            getReferralConfig(),
            getKey1bUserView(ctx.from.id),
            listAvailableClassicRedeemTiers(),
        ]);
        if (!user) return ctx.reply("Không tìm thấy tài khoản. Hãy gõ /start để khởi tạo.");

        const pts = Number(user.referralPoints) || 0;
        const lines = [
            `🎁 <b>KHO QUÀ TẶNG & ĐỔI ĐIỂM API</b>`,
            DIVIDER,
            `⭐ Điểm giới thiệu hiện có: <b>${pts} điểm</b>`,
            "",
        ];

        const kbRows = [];

        if (cfg.redeemEnabled && cfg.tokenRedeemEnabled) {
            lines.push(`💎 <b>Đổi điểm lấy Token API:</b> 1⭐ = <b>${formatTokens(cfg.tokenPerPoint)} token</b> (tạo key mới hoặc nạp cộng dồn vào key sẵn có).`);
            kbRows.push([Markup.button.callback(`💎 Đổi điểm lấy Token (${pts}⭐)`, "REF:TOK")]);
        }

        if (key1bView.enabled || key1bView.alreadyClaimed) {
            const statusText = key1bView.alreadyClaimed
                ? "✅ Bạn đã nhận trong đợt này"
                : key1bView.soldOut
                    ? "🚨 Đã hết suất đợt này"
                    : `🔥 Đang mở (${key1bView.cost}⭐ · khóa 1–2 IP)`;
            lines.push(`🔑 <b>${escapeHtml(key1bView.displayName)}:</b> ${statusText}`);
            kbRows.push([
                Markup.button.callback(
                    `🔑 ${key1bView.displayName} (${key1bView.alreadyClaimed ? "Xem lại Key" : `${key1bView.cost}⭐`})`,
                    "KEY1B:INTRO",
                ),
            ]);
        }

        if (classicTiers.length > 0) {
            lines.push(`🎯 <b>Đổi sản phẩm / Tài khoản (cooldown 3 ngày):</b>`);
            const tierBtns = [];
            for (const t of classicTiers) {
                const stockTag = t.inStock ? "" : " [Hết hàng]";
                lines.push(`  • ${t.icon} <b>${escapeHtml(t.label)}</b> — <b>${t.cost}⭐</b>${stockTag}`);
                tierBtns.push(
                    Markup.button.callback(
                        `${t.icon} ${t.label} (${t.cost}⭐)`,
                        `REF:CLASSIC:${t.key}`,
                    ),
                );
            }
            for (let i = 0; i < tierBtns.length; i += 2) {
                kbRows.push(tierBtns.slice(i, i + 2));
            }
        }

        if (cfg.welcomeKeyEnabled) {
            const welHint = user.refWelcomeCode && !user.refWelcomeRedeemedAt
                ? ` <i>(Bạn có mã <code>${escapeHtml(user.refWelcomeCode)}</code> chưa đổi!)</i>`
                : "";
            lines.push(`🌟 <b>Mã quà chào mừng (WEL...):</b> Nhận Key <b>${cfg.welcomeTokenMinM}M–${cfg.welcomeTokenMaxM}M token</b> cho bạn mới.${welHint}`);
            kbRows.push([Markup.button.callback("🌟 Nhập mã quà chào mừng (WEL...)", "REF:WEL_ENTER")]);
        }

        if (!fromApiMenu) {
            kbRows.push([navBtn("NAV_BACK", "⬅️ Quay lại Giới thiệu", "REFERRAL")]);
        } else {
            kbRows.push([
                Markup.button.callback("📢 Tới mục Mời bạn", "REFERRAL"),
                navBtn("NAV_BACK", "⬅️ Cửa hàng API Key", "APIKEY_BUY"),
            ]);
        }

        const extra = { parse_mode: "HTML", ...Markup.inlineKeyboard(kbRows) };
        return edit ? editMenu(ctx, lines.join("\n"), extra) : cleanReply(ctx, lines.join("\n"), extra);
    };

    const showApiKeyRewardsMenu = async (ctx, { edit = true } = {}) => {
        return showRedeemHubMenu(ctx, { edit, fromApiMenu: true });
    };

    /**
     * Màn giới thiệu & trạng thái sự kiện Key 1.5B (`KEY1B:INTRO`, `/key1b`, `?start=key1b`).
     */
    const showKey1bIntro = async (ctx, { edit = true } = {}) => {
        const view = await getKey1bUserView(ctx.from.id);
        const title = escapeHtml(view.displayName || "Key 1.5B");
        const lines = [
            `🔑 <b>SỰ KIỆN ĐỔI ${title.toUpperCase()}</b>`,
            DIVIDER,
        ];
        const kbRows = [];

        if (view.alreadyClaimed && view.claimedKeyValue) {
            lines.push(`✅ <b>Bạn đã nhận ${title} trong đợt hiện tại!</b>`);
            lines.push("");
            lines.push(`🔑 <b>API Key dùng chung của đợt:</b>`);
            lines.push(`<code>${escapeHtml(view.claimedKeyValue)}</code>`);
            lines.push(`<i>(Chạm vào mã trên để sao chép)</i>`);
            if (view.claimedIps.length) {
                lines.push("");
                lines.push(`🌐 <b>IP đã đăng ký:</b> <code>${escapeHtml(view.claimedIps.join(", "))}</code>`);
            }
            if (view.note) {
                lines.push("");
                lines.push(`📌 <b>Hướng dẫn sử dụng:</b>\n${escapeHtml(view.note)}`);
            }
        } else if (!view.enabled) {
            lines.push(`⏸️ <b>Sự kiện ${title} hiện đang tạm đóng.</b>`);
            lines.push(`Hãy theo dõi kênh thông báo của shop và tích lũy điểm ⭐ qua mục /ref để sẵn sàng cho đợt mở tiếp theo nhé!`);
        } else if (view.soldOut) {
            lines.push(`🚨 <b>Đợt ${title} hiện tại đã hết suất (Sold Out)!</b>`);
            lines.push(`⭐ Điểm của bạn: <b>${view.userPoints} điểm</b>`);
            lines.push(`💡 Hãy giữ điểm để đổi ở đợt mở kho kế tiếp hoặc đổi sang Token API riêng tại /tok!`);
            kbRows.push([Markup.button.callback("💎 Đổi điểm lấy Token riêng (/tok)", "REF:TOK")]);
        } else {
            const slotStatus = view.unlimited
                ? "♾️ Đang mở tự do trong đợt"
                : view.roughAvailability === "almost_gone_90"
                    ? "🔥 Đã qua mốc ~90% — chỉ còn ít suất cuối!"
                    : view.roughAvailability === "hot_75"
                        ? "⚡ Đã qua mốc ~75% — nhanh tay!"
                        : view.roughAvailability === "half_50"
                            ? "📊 Đã qua mốc ~50% suất"
                            : "🟢 Đang mở nhận đăng ký";

            lines.push(`• Trạng thái: <b>${slotStatus}</b>`);
            lines.push(`• Chi phí đổi: <b>${view.cost} ⭐ điểm giới thiệu</b>`);
            lines.push(`• Điểm hiện có của bạn: <b>${view.userPoints} ⭐</b>`);
            lines.push(`• Giới hạn: <b>1 lần / tài khoản / đợt</b>`);
            lines.push(`• Yêu cầu bảo mật: Bắt buộc nhập <b>1 hoặc 2 địa chỉ IP (IPv4/IPv6)</b> hợp lệ để chống chia sẻ key tràn lan.`);
            if (view.note) {
                lines.push("");
                lines.push(`📌 <b>Thông tin gói:</b>\n${escapeHtml(view.note)}`);
            }

            if (view.userPoints >= view.cost) {
                kbRows.push([Markup.button.callback(`🌐 Nhập 1–2 IP & Đổi ngay (-${view.cost}⭐)`, "KEY1B:ASK_IP")]);
            } else {
                lines.push("");
                lines.push(`⚠️ <i>Bạn cần thêm <b>${view.cost - view.userPoints}⭐</b> nữa để đổi ${title}. Chia sẻ link ở mục Giới thiệu để nhận điểm ngay!</i>`);
            }
        }

        kbRows.push([navBtn("NAV_BACK", "⬅️ Quay lại Kho quà", "REF:REDEEM_MENU")]);
        const extra = { parse_mode: "HTML", disable_web_page_preview: true, ...Markup.inlineKeyboard(kbRows) };
        return edit ? editMenu(ctx, lines.join("\n"), extra) : cleanReply(ctx, lines.join("\n"), extra);
    };

    /** Hiển thị màn Đổi điểm lấy Token API (`REF:TOK` & `/tok`). */
    const showTokenRedeemMenu = async (ctx, { edit = true } = {}) => {
        const [user, cfg] = await Promise.all([
            prisma.user.findUnique({ where: { telegramId: String(ctx.from.id) } }),
            getReferralConfig(),
        ]);
        if (!user) return ctx.reply("Không tìm thấy tài khoản.");

        const stats = await getReferralStats(user.id, user);
        const pts = stats.referralPoints;
        const perPt = cfg.tokenPerPoint;
        const maxCap = cfg.tokenMaxPerUser;
        const usedCap = stats.usedTokensInBatch;
        const remCap = maxCap > 0 ? Math.max(0, maxCap - usedCap) : Infinity;

        const lines = [
            `💎 <b>ĐỔI ĐIỂM GIỚI THIỆU LẤY TOKEN API</b>`,
            DIVIDER,
            `⭐ Điểm hiện có: <b>${pts} điểm</b>`,
            `💱 Tỷ giá: <b>1 điểm = ${formatTokens(perPt)} token</b>`,
            maxCap > 0
                ? `📊 Hạn mức đợt này: Đã đổi <b>${formatTokens(usedCap)}</b> / <b>${formatTokens(maxCap)}</b> (còn đổi được <b>${formatTokens(remCap)}</b>)`
                : `📊 Hạn mức đợt này: <b>Không giới hạn</b>`,
            `⏱️ Tần suất: Tối đa <b>1 lượt đổi / ngày</b>`,
            "",
            `<b>2 hình thức nhận:</b>`,
            `• 🆕 <b>Tạo Key mới:</b> Hạn <b>${cfg.tokenNewKeyDays > 0 ? `${cfg.tokenNewKeyDays} ngày` : "vô thời hạn"}</b>, RPM <b>${cfg.tokenNewKeyRpm || 100}</b>`,
            `• ⚡ <b>Nạp vào Key đang có:</b> Cộng thẳng token vào key còn hạn của bạn (giữ nguyên hạn dùng)`,
        ];

        const presets = [1, 2, 3, 5, 10];
        const pointBtns = [];
        for (const p of presets) {
            const tok = p * perPt;
            if (maxCap > 0 && tok > remCap) continue;
            const label = pts >= p
                ? `${p}⭐ → +${formatTokens(tok)}`
                : `🔒 ${p}⭐ (${formatTokens(tok)})`;
            pointBtns.push(Markup.button.callback(label, `REF:TOK_PTS:${p}`));
        }

        const kbRows = [];
        for (let i = 0; i < pointBtns.length; i += 2) {
            kbRows.push(pointBtns.slice(i, i + 2));
        }
        kbRows.push([navBtn("NAV_BACK", "⬅️ Quay lại Giới thiệu", "REFERRAL")]);

        if (!cfg.referralEnabled || !cfg.redeemEnabled || !cfg.tokenRedeemEnabled) {
            lines.push("", "⚠️ <i>Tính năng đổi điểm lấy token hiện đang tạm đóng.</i>");
        } else if (remCap <= 0) {
            lines.push("", "✅ <i>Bạn đã đổi tối đa hạn mức token của đợt hiện tại. Hãy chờ Admin mở đợt mới!</i>");
        } else if (pts < 1) {
            lines.push("", "💡 <i>Bạn chưa đủ điểm. Mời bạn bè vào kênh (+1⭐) hoặc mua hàng (+3⭐) để tích điểm ngay!</i>");
        } else {
            lines.push("", "👇 <b>Chọn mức điểm muốn đổi:</b>");
        }

        const extra = {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard(kbRows),
        };
        return edit ? editMenu(ctx, lines.join("\n"), extra) : cleanReply(ctx, lines.join("\n"), extra);
    };

    const formatRedeemError = (res) => {
        switch (res?.error) {
            case "DISABLED":
                return "Tính năng đổi điểm lấy token hiện đang tạm đóng.";
            case "BANNED":
                return "Tài khoản của bạn đang bị khóa.";
            case "TOO_NEW":
                return "Tài khoản mới cần hoạt động tại shop tối thiểu 3 ngày để sử dụng tính năng tự đổi điểm.";
            case "NOT_ENOUGH":
                return `Bạn không đủ điểm (hiện có ${res.currentPoints ?? 0}⭐).`;
            case "DAILY_LIMIT":
                return "Mỗi ngày bạn chỉ được đổi điểm lấy token tối đa 1 lần. Vui lòng quay lại vào ngày mai (sau 00:00 giờ VN)!";
            case "CAP_REACHED":
                return `Vượt quá hạn mức đổi token trong đợt này (còn đổi được tối đa ${formatTokens(res.remainingCapTokens || 0)}).`;
            case "KEY_NOT_FOUND":
                return "Không tìm thấy API key này trong tài khoản của bạn.";
            case "KEY_EXPIRED":
                return "Key bạn chọn đã hết hạn sử dụng — hãy chọn key còn hạn hoặc đổi ra Key mới.";
            case "KEY_DISABLED":
                return "Key bạn chọn đã bị vô hiệu hóa.";
            case "KEY_UNLIMITED":
                return "Key đang có quota vô hạn nên không thể nạp cộng dồn.";
            case "KEY_BUSY":
                return "Key đang xử lý giao dịch khác, vui lòng thử lại sau vài giây.";
            case "GATEWAY_NOT_READY":
                return "Hệ thống cấp key chưa sẵn sàng. Điểm của bạn CHƯA bị trừ.";
            case "AMBIGUOUS_GATEWAY":
                return res?.message || "Kết nối nhà cung cấp bị gián đoạn giữa chừng. Hệ thống đang tạm giữ điểm để tránh cấp trùng — vui lòng kiểm tra /mykey sau ít phút hoặc liên hệ Admin đối soát!";
            default:
                return `Không thực hiện được lúc này (${res?.message || res?.error || "lỗi kết nối"}). Điểm của bạn đã được bảo toàn!`;
        }
    };

    const register = (bot) => {
        // Lệnh tắt /ref, /tok & /key1b
        bot.command("ref", async (ctx) => {
            if (ctx.session?.pendingAction) ctx.session.pendingAction = null;
            await showReferralMenu(ctx, { edit: false });
        });

        bot.command("tok", async (ctx) => {
            if (ctx.session?.pendingAction) ctx.session.pendingAction = null;
            await showTokenRedeemMenu(ctx, { edit: false });
        });

        bot.command("key1b", async (ctx) => {
            if (ctx.session?.pendingAction) ctx.session.pendingAction = null;
            await showKey1bIntro(ctx, { edit: false });
        });

        // Callback chính REFERRAL & Kho Quà tổng hợp
        bot.action("REFERRAL", async (ctx) => {
            answerCallback(ctx);
            if (ctx.session?.pendingAction) ctx.session.pendingAction = null;
            await showReferralMenu(ctx, { edit: true });
        });

        bot.action("REF:REDEEM_MENU", async (ctx) => {
            answerCallback(ctx);
            if (ctx.session?.pendingAction) ctx.session.pendingAction = null;
            await showRedeemHubMenu(ctx, { edit: true, fromApiMenu: false });
        });

        // Nhánh 5: Đổi Key 1.5B khóa 1–2 IP
        bot.action("KEY1B:INTRO", async (ctx) => {
            answerCallback(ctx);
            if (ctx.session?.pendingAction) ctx.session.pendingAction = null;
            await showKey1bIntro(ctx, { edit: true });
        });

        bot.action("KEY1B:ASK_IP", async (ctx) => {
            answerCallback(ctx);
            const view = await getKey1bUserView(ctx.from.id);
            if (!view.enabled || view.soldOut || view.alreadyClaimed) {
                return showKey1bIntro(ctx, { edit: true });
            }
            if (view.userPoints < view.cost) {
                return answerCallback(ctx, `Bạn cần ${view.cost}⭐ điểm (hiện có ${view.userPoints}⭐)!`, { show_alert: true });
            }
            ctx.session.pendingAction = "KEY1B_IPS";
            const text = `🌐 <b>ĐĂNG KÝ 1–2 ĐỊA CHỈ IP CHO ${escapeHtml(view.displayName).toUpperCase()}</b>\n`
                + `${DIVIDER}\n`
                + `Hãy gửi <b>1 hoặc 2 địa chỉ IPv4 / IPv6 hợp lệ</b> (không trùng nhau) mà bạn dùng để gọi API.\n\n`
                + `📌 <b>Ví dụ hợp lệ:</b>\n`
                + `• 1 IP: <code>113.161.72.15</code>\n`
                + `• 2 IP: <code>113.161.72.15, 2001:ee0:4f9b::1</code>\n\n`
                + `⭐ Sẽ trừ <b>${view.cost} điểm</b> ngay sau khi IP hợp lệ.\n`
                + `<i>Bấm Quay lại nếu muốn hủy thao tác.</i>`;
            return editMenu(ctx, text, {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard([[navBtn("NAV_BACK", "⬅️ Hủy & Quay lại", "KEY1B:INTRO")]]),
            });
        });

        // Nhánh 4B: 4 Tier Đổi Account / Sản phẩm Cổ điển (`basic`/`bh3d`/`bh7d`/`gpt`)
        bot.action(/^REF:CLASSIC:(basic|bh3d|bh7d|gpt)$/, async (ctx) => {
            answerCallback(ctx);
            const tierKey = ctx.match[1];
            const [user, tiers] = await Promise.all([
                prisma.user.findUnique({ where: { telegramId: String(ctx.from.id) } }),
                listAvailableClassicRedeemTiers(),
            ]);
            const tier = tiers.find((t) => t.key === tierKey);
            if (!tier || !user) {
                return showRedeemHubMenu(ctx, { edit: true });
            }

            const stats = await getReferralStats(user.id, user);
            const pts = stats.referralPoints;
            const cd = stats.classicCooldown;
            const stockLine = tier.stockCount !== null
                ? `• Tồn kho hiện tại: <b>${tier.inStock ? `Còn ${tier.stockCount} sản phẩm` : "Hết hàng"}</b>\n`
                : "";
            const cdLine = !cd.ready
                ? `\n⏳ <b>Cooldown 3 ngày:</b> Bạn cần chờ thêm khoảng <b>~${cd.remainingHours} giờ</b> nữa mới được đổi sản phẩm tiếp theo.`
                : `\n⏱️ <i>Lưu ý: Nhóm quà sản phẩm có thời gian chờ 3 ngày giữa 2 lần đổi.</i>`;

            const text = `${tier.icon} <b>XÁC NHẬN ĐỔI QUÀ SẢN PHẨM</b>\n`
                + `${DIVIDER}\n`
                + `• Phần thưởng: <b>${escapeHtml(tier.productName)}</b>\n`
                + `• Chi phí: <b>${tier.cost} ⭐ điểm</b> (bạn đang có <b>${pts}⭐</b>)\n`
                + stockLine
                + cdLine;

            const kbRows = [];
            if (tier.inStock && cd.ready && pts >= tier.cost) {
                kbRows.push([Markup.button.callback(`🎁 Xác nhận đổi (-${tier.cost}⭐)`, `REF:CLASSIC_DO:${tier.key}`)]);
            }
            kbRows.push([navBtn("NAV_BACK", "⬅️ Quay lại Kho quà", "REF:REDEEM_MENU")]);

            return editMenu(ctx, text, {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard(kbRows),
            });
        });

        bot.action(/^REF:CLASSIC_DO:(basic|bh3d|bh7d|gpt)$/, async (ctx) => {
            answerCallback(ctx, "⏳ Đang xuất quà...");
            sendChatAction(ctx, "typing");
            const tierKey = ctx.match[1];
            const res = await redeemPointsToClassicProduct(ctx.from.id, tierKey, {
                deliverFn: ({ order }) => deliverOrder({ prisma, telegram: ctx.telegram, order }),
            });

            if (!res.ok) {
                let errMsg = "Không thực hiện được lúc này, điểm của bạn chưa bị trừ.";
                if (res.error === "COOLDOWN") errMsg = `Bạn đang trong thời gian chờ 3 ngày giữa các lần đổi sản phẩm (còn ~${res.remainingHours} giờ).`;
                else if (res.error === "OUT_OF_STOCK") errMsg = "Sản phẩm này vừa hết hàng trong kho. Điểm của bạn đã được bảo toàn!";
                else if (res.error === "NOT_ENOUGH") errMsg = `Bạn không đủ điểm (cần ${res.requiredPoints}⭐, hiện có ${res.currentPoints}⭐).`;
                else if (res.error === "TOO_NEW") errMsg = "Tài khoản mới cần hoạt động tại shop tối thiểu 3 ngày để tự đổi quà.";
                else if (res.error === "BANNED") errMsg = "Tài khoản của bạn đang bị khóa.";
                else if (res.error === "DISABLED" || res.error === "TIER_NOT_CONFIGURED" || res.error === "PRODUCT_UNAVAILABLE") {
                    errMsg = "Mốc quà này hiện đang tạm đóng.";
                }
                return editMenu(ctx, `❌ <b>Chưa đổi được quà</b>\n${DIVIDER}\n${escapeHtml(errMsg)}`, {
                    parse_mode: "HTML",
                    ...Markup.inlineKeyboard([[navBtn("NAV_BACK", "⬅️ Quay lại Kho quà", "REF:REDEEM_MENU")]]),
                });
            }

            return editMenu(
                ctx,
                `✅ <b>Đổi quà thành công (-${res.pointsUsed}⭐)!</b>\n${DIVIDER}\n`
                + `🎁 Sản phẩm <b>${escapeHtml(res.productName)}</b> đã được gửi vào khung chat của bạn.\n`
                + `⭐ Điểm còn lại: <b>${res.remainingPoints} điểm</b>`,
                {
                    parse_mode: "HTML",
                    ...Markup.inlineKeyboard([[navBtn("NAV_BACK", "⬅️ Về mục Giới thiệu", "REFERRAL")]]),
                },
            );
        });

        // Xem & Sao chép nhanh Link giới thiệu
        bot.action("REF:LINK", async (ctx) => {
            answerCallback(ctx);
            const [botInfo, cfg] = await Promise.all([
                getBotInfo(),
                getReferralConfig(),
            ]);
            const link = getReferralLink(botInfo.username, ctx.from.id);
            const friendM = formatTokens(cfg.inviteTokenAmount);
            const minM = formatTokens(cfg.inviteReferrerMinTokens);
            const maxM = formatTokens(cfg.inviteReferrerMaxTokens);
            const shareText = cfg.enabled
                ? `Vào bot nhận ngay API Key ${friendM} token miễn phí!`
                : `Tham gia ${botInfo.first_name || "Shop"} ngay!`;
            const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(shareText)}`;

            const text = `🔗 <b>LINK GIỚI THIỆU CỦA BẠN</b>\n`
                + `${DIVIDER}\n`
                + `<code>${escapeHtml(link)}</code>\n`
                + `<i>(Chạm vào link trên để sao chép)</i>\n\n`
                + `<b>Cách làm:</b>\n`
                + `1️⃣ Gửi link giới thiệu riêng của bạn cho bạn bè.\n`
                + `2️⃣ Người được mời vào bot bằng link, dùng tài khoản đủ điều kiện, pass captcha nếu có và join channel.\n`
                + `3️⃣ Bot xác nhận channel join rồi tự gửi thưởng cho cả hai (bạn nhận <b>+${minM}–${maxM}</b> vào key ${cfg.inviteReferrerKeyDays} ngày + <b>${cfg.pointJoinChannel}⭐</b>, bạn bè nhận key riêng <b>${friendM}</b>).`;

            return editMenu(ctx, text, {
                parse_mode: "HTML",
                disable_web_page_preview: true,
                ...Markup.inlineKeyboard([
                    [Markup.button.url("📤 Chia sẻ link mời ngay", shareUrl)],
                    [navBtn("NAV_BACK", "⬅️ Quay lại Giới thiệu", "REFERRAL")],
                ]),
            });
        });

        // Màn Xem chi tiết Pipeline & Danh sách bạn đã mời
        bot.action("REF:DETAILS", async (ctx) => {
            answerCallback(ctx);
            const [user, cfg] = await Promise.all([
                prisma.user.findUnique({ where: { telegramId: String(ctx.from.id) } }),
                getReferralConfig(),
            ]);
            if (!user) return showReferralMenu(ctx, { edit: true });

            const [stats, list] = await Promise.all([
                getReferralStats(user.id, user),
                getUserReferralDetails(user.id, { limit: 15 }),
            ]);

            const lines = [
                `📊 <b>CHI TIẾT PIPELINE &amp; BẠN ĐÃ MỜI</b>`,
                DIVIDER,
                `⭐ Điểm hiện có: <b>${stats.referralPoints} điểm</b>`,
                `👥 Đã /start qua link: <b>${stats.pipeline.startedCount}</b>`,
                `✅ Đã join channel (+${cfg.pointJoinChannel}đ): <b>${stats.pipeline.joinedChannelCount}</b>`,
                `🎉 Đã phát key thưởng: <b>${stats.rewardedCount}</b>`,
                `🛒 Đã mua đơn đầu (+${cfg.pointPurchase}đ): <b>${stats.pipeline.buyersCount}</b>${cfg.buyerTarget > 0 ? ` <i>(mốc Coupon ${cfg.personalVoucherPercent}%: ${Math.min(stats.pipeline.buyersCount, cfg.buyerTarget)}/${cfg.buyerTarget})</i>` : ""}`,
                "",
                `👥 <b>Danh sách bạn mời gần đây:</b>`,
            ];

            if (!list.length) {
                lines.push(`<i>Chưa có người bạn nào vào qua link giới thiệu. Hãy bấm "Chia sẻ link mời ngay" để bắt đầu!</i>`);
            } else {
                list.forEach((item, idx) => {
                    const tags = [];
                    if (item.lateClaim) tags.push("⚠️ Đã từng /start");
                    else if (item.rewarded) tags.push("✅ Đã thưởng Key");
                    else if (item.hasJoinedChannel) tags.push("⏳ Chờ đủ tuổi TG");
                    else tags.push("📢 Chưa vào kênh");
                    if (item.purchased) tags.push("🛒 Đã mua");
                    lines.push(`${idx + 1}. <b>${escapeHtml(item.displayName)}</b> — ${tags.join(" · ")}`);
                });
            }

            return editMenu(ctx, lines.join("\n"), {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard([
                    [Markup.button.callback("✅ Kiểm tra Join kênh", "REF:CHECK_JOIN")],
                    [navBtn("NAV_BACK", "⬅️ Quay lại Giới thiệu", "REFERRAL")],
                ]),
            });
        });

        // Xem / Copy full Referral Key 30 ngày
        bot.action("REF:COPY_KEY", async (ctx) => {
            answerCallback(ctx);
            const user = await prisma.user.findUnique({ where: { telegramId: String(ctx.from.id) } });
            const stats = user ? await getReferralStats(user.id, user) : null;
            if (!stats?.bonusKey) {
                return editMenu(
                    ctx,
                    `🔑 <b>Chưa có Referral Key đang hoạt động</b>\n${DIVIDER}\nKhi bạn mời được ít nhất 1 người bạn xác minh kênh hợp lệ, hệ thống sẽ tự tạo Referral Key 30 ngày và cộng dồn token cho bạn!`,
                    {
                        parse_mode: "HTML",
                        ...Markup.inlineKeyboard([[navBtn("NAV_BACK", "⬅️ Quay lại", "REFERRAL")]]),
                    },
                );
            }
            const bk = stats.bonusKey;
            const cfg = await getReferralConfig();
            const text = `🔑 <b>REFERRAL KEY CỦA BẠN (${cfg.inviteReferrerKeyDays} NGÀY)</b>\n`
                + `${DIVIDER}\n`
                + `<code>${escapeHtml(bk.key)}</code>\n`
                + `<i>(Chạm vào mã trên để sao chép)</i>\n\n`
                + `💎 Tổng hạn mức đã tích lũy: <b>${formatTokens(bk.quotaTokens)} token</b>\n`
                + `⚡ RPM: <b>${bk.rpm || cfg.tokenNewKeyRpm || 100}</b>\n`
                + `📅 Hết hạn: <b>${escapeHtml(fmtDateShort(bk.expiresAt))}</b>\n\n`
                + `💡 <i>Mọi lượt mời bạn hợp lệ và thưởng mốc 5/10/20 tiếp theo đều tự động nạp cộng dồn vào chính key này!</i>`;
            return editMenu(ctx, text, {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard([[navBtn("NAV_BACK", "⬅️ Quay lại Giới thiệu", "REFERRAL")]]),
            });
        });

        // Menu Đổi điểm lấy Token
        bot.action("REF:TOK", async (ctx) => {
            answerCallback(ctx);
            if (ctx.session?.pendingAction) ctx.session.pendingAction = null;
            await showTokenRedeemMenu(ctx, { edit: true });
        });

        // Chọn mức điểm → chọn Tạo key mới hay Nạp vào key cũ
        bot.action(/^REF:TOK_PTS:(\d+)$/, async (ctx) => {
            const pts = Number(ctx.match[1]);
            const [user, cfg] = await Promise.all([
                prisma.user.findUnique({ where: { telegramId: String(ctx.from.id) } }),
                getReferralConfig(),
            ]);
            if (!user || (Number(user.referralPoints) || 0) < pts) {
                return answerCallback(ctx, `Bạn chưa đủ ${pts}⭐ điểm!`, { show_alert: true });
            }
            answerCallback(ctx);
            const wantTokens = pts * cfg.tokenPerPoint;
            const text = `💎 <b>ĐỔI ${pts}⭐ ĐIỂM → +${formatTokens(wantTokens)} TOKEN</b>\n`
                + `${DIVIDER}\n`
                + `Chọn cách bạn muốn nhận <b>${formatTokens(wantTokens)} token</b>:\n\n`
                + `1️⃣ <b>Tạo API Key mới:</b> Nhận ngay 1 key riêng hạn <b>${cfg.tokenNewKeyDays > 0 ? `${cfg.tokenNewKeyDays} ngày` : "vô thời hạn"}</b> (RPM ${cfg.tokenNewKeyRpm || 100}).\n`
                + `2️⃣ <b>Nạp vào Key đang có:</b> Cộng thẳng <b>+${formatTokens(wantTokens)} token</b> vào key còn hạn của bạn (không đổi chuỗi sk-..., giữ nguyên ngày hết hạn).`;

            return editMenu(ctx, text, {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard([
                    [Markup.button.callback(`🆕 Tạo Key mới (${cfg.tokenNewKeyDays || 3} ngày)`, `REF:TOK_NEW:${pts}`)],
                    [Markup.button.callback("⚡ Nạp vào Key đang có", `REF:TOK_TOPUP_LIST:${pts}`)],
                    [navBtn("NAV_BACK", "⬅️ Chọn lại số điểm", "REF:TOK")],
                ]),
            });
        });

        // Xác nhận Tạo Key mới
        bot.action(/^REF:TOK_NEW:(\d+)$/, async (ctx) => {
            answerCallback(ctx);
            const pts = Number(ctx.match[1]);
            const cfg = await getReferralConfig();
            const wantTokens = pts * cfg.tokenPerPoint;
            const text = `✅ <b>XÁC NHẬN ĐỔI KEY MỚI</b>\n`
                + `${DIVIDER}\n`
                + `• Trừ điểm: <b>${pts} ⭐</b>\n`
                + `• Nhận: <b>1 API Key mới (${formatTokens(wantTokens)} token)</b>\n`
                + `• Thời hạn: <b>${cfg.tokenNewKeyDays > 0 ? `${cfg.tokenNewKeyDays} ngày` : "Không giới hạn"}</b> · RPM: <b>${cfg.tokenNewKeyRpm || 100}</b>\n\n`
                + `<i>Lưu ý: Mỗi ngày chỉ được thực hiện 1 lượt đổi điểm.</i>`;
            return editMenu(ctx, text, {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard([
                    [Markup.button.callback("🎁 Xác nhận đổi ngay", `REF:TOK_DO_NEW:${pts}`)],
                    [navBtn("NAV_BACK", "⬅️ Quay lại", `REF:TOK_PTS:${pts}`)],
                ]),
            });
        });

        // Thực thi Tạo Key mới
        bot.action(/^REF:TOK_DO_NEW:(\d+)$/, async (ctx) => {
            answerCallback(ctx, "⏳ Đang tạo API key...");
            sendChatAction(ctx, "typing");
            const pts = Number(ctx.match[1]);
            const res = await redeemPointsToNewKey(ctx.from.id, pts);
            if (!res.ok) {
                return editMenu(ctx, `❌ <b>Chưa đổi được điểm</b>\n${DIVIDER}\n${escapeHtml(formatRedeemError(res))}`, {
                    parse_mode: "HTML",
                    ...Markup.inlineKeyboard([[navBtn("NAV_BACK", "⬅️ Quay lại", "REF:TOK")]]),
                });
            }

            if (res.broadcastSocialProof && ctx.telegram) {
                const who = ctx.from.first_name ? `${ctx.from.first_name.slice(0, 3)}***` : "Khách hàng";
                sendBroadcast(
                    { telegram: ctx.telegram },
                    `🎉 <b>${escapeHtml(who)}</b> vừa đổi <b>${pts}⭐ điểm mời bạn</b> nhận miễn phí API Key <b>${formatTokens(res.tokensGranted)} token</b>! Gõ /ref để tham gia ngay!`,
                    "system-referral",
                ).catch(() => {});
            }

            const lang = getLang(ctx);
            await sendGrantedKeyOrTopupDm(ctx.telegram, res.keyData, {
                header: `💎 <b>[ĐỔI ĐIỂM THÀNH CÔNG · -${pts}⭐]</b>\nSố điểm còn lại: <b>${res.remainingPoints}⭐</b>`,
                icon: iconOf,
            });
            return editMenu(
                ctx,
                `✅ <b>Đổi ${pts}⭐ → ${formatTokens(res.tokensGranted)} token thành công!</b>\n${DIVIDER}\nKey mới đã được gửi ở tin nhắn bên dưới và lưu vào /mykey.\n⭐ Điểm còn lại: <b>${res.remainingPoints} điểm</b>`,
                {
                    parse_mode: "HTML",
                    ...buildApiKeyDeliveredKeyboard({ lang, docUrl: res.keyData.docUrl || "" }),
                },
            );
        });

        // Liệt kê danh sách key hợp lệ để nạp cộng dồn
        bot.action(/^REF:TOK_TOPUP_LIST:(\d+)$/, async (ctx) => {
            answerCallback(ctx, "⏳ Đang kiểm tra danh sách key...");
            sendChatAction(ctx, "typing");
            const pts = Number(ctx.match[1]);
            const [cfg, eligible] = await Promise.all([
                getReferralConfig(),
                listEligibleTopupKeys(ctx.from.id, { limit: 12 }),
            ]);
            const wantTokens = pts * cfg.tokenPerPoint;

            const lines = [
                `⚡ <b>CHỌN KEY ĐỂ NẠP +${formatTokens(wantTokens)} TOKEN (${pts}⭐)</b>`,
                DIVIDER,
            ];

            const kbRows = [];
            if (!eligible.length) {
                lines.push(`Bạn hiện chưa có API key nào còn hạn để nạp cộng dồn.`);
                lines.push(`💡 Hãy chọn <b>Tạo Key mới</b> hoặc dán trực tiếp chuỗi <code>sk-...</code> nếu bạn có.`);
            } else {
                lines.push(`Chọn 1 trong <b>${eligible.length}</b> key đang hoạt động của bạn (giữ nguyên hạn dùng):`);
                eligible.forEach((k, idx) => {
                    const label = `#${idx + 1} ${maskKeyShort(k.key)} · ${formatTokens(k.quotaTokens)}`;
                    kbRows.push([Markup.button.callback(label, `REF:TOK_TOPUP_CFM:${pts}:${k.id}`)]);
                });
            }

            kbRows.push([Markup.button.callback("📋 Dán chuỗi sk-... thủ công", `REF:TOK_PASTE:${pts}`)]);
            kbRows.push([navBtn("NAV_BACK", "⬅️ Quay lại", `REF:TOK_PTS:${pts}`)]);

            return editMenu(ctx, lines.join("\n"), {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard(kbRows),
            });
        });

        // Màn xác nhận nạp vào key đã chọn
        bot.action(/^REF:TOK_TOPUP_CFM:(\d+):([a-zA-Z0-9_-]+)$/, async (ctx) => {
            answerCallback(ctx);
            const pts = Number(ctx.match[1]);
            const keyId = ctx.match[2];
            const [cfg, keyRow] = await Promise.all([
                getReferralConfig(),
                prisma.issuedApiKey.findFirst({ where: { id: keyId, telegramId: String(ctx.from.id) } }),
            ]);
            if (!keyRow) return showTokenRedeemMenu(ctx, { edit: true });

            const wantTokens = pts * cfg.tokenPerPoint;
            const text = `⚡ <b>XÁC NHẬN NẠP TOKEN VÀO KEY</b>\n`
                + `${DIVIDER}\n`
                + `• Key nhận: <code>${escapeHtml(maskKeyShort(keyRow.key))}</code>\n`
                + `• Điểm sử dụng: <b>${pts} ⭐</b>\n`
                + `• Token cộng thêm: <b>+${formatTokens(wantTokens)} token</b>\n`
                + `• Thời hạn key: <b>Giữ nguyên (${escapeHtml(fmtDateShort(keyRow.expiresAt))})</b>`;

            return editMenu(ctx, text, {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard([
                    [Markup.button.callback("✅ Xác nhận nạp ngay", `REF:TOK_DO_TOPUP:${pts}:${keyRow.id}`)],
                    [navBtn("NAV_BACK", "⬅️ Chọn key khác", `REF:TOK_TOPUP_LIST:${pts}`)],
                ]),
            });
        });

        // Thực thi nạp vào key đã chọn
        bot.action(/^REF:TOK_DO_TOPUP:(\d+):([a-zA-Z0-9_-]+)$/, async (ctx) => {
            answerCallback(ctx, "⏳ Đang nạp token vào key...");
            sendChatAction(ctx, "typing");
            const pts = Number(ctx.match[1]);
            const keyId = ctx.match[2];

            const res = await redeemPointsToTopup(ctx.from.id, pts, { issuedKeyId: keyId });
            if (!res.ok) {
                return editMenu(ctx, `❌ <b>Chưa nạp được token</b>\n${DIVIDER}\n${escapeHtml(formatRedeemError(res))}`, {
                    parse_mode: "HTML",
                    ...Markup.inlineKeyboard([[navBtn("NAV_BACK", "⬅️ Quay lại", "REF:TOK")]]),
                });
            }

            await sendGrantedKeyOrTopupDm(ctx.telegram, res.keyData, {
                header: `⚡ <b>[ĐỔI ĐIỂM NẠP KEY THÀNH CÔNG · -${pts}⭐]</b>\nSố điểm còn lại: <b>${res.remainingPoints}⭐</b>`,
                icon: iconOf,
            });

            return editMenu(
                ctx,
                `✅ <b>Đã nạp +${formatTokens(res.tokensGranted)} token thành công!</b>\n${DIVIDER}\n`
                + `Tổng hạn mức mới của key: <b>${formatTokens(res.totalTokens)} token</b>\n`
                + `⭐ Điểm còn lại: <b>${res.remainingPoints} điểm</b>`,
                {
                    parse_mode: "HTML",
                    ...Markup.inlineKeyboard([[navBtn("NAV_BACK", "⬅️ Về mục Giới thiệu", "REFERRAL")]]),
                },
            );
        });

        // Chờ dán sk-... thủ công
        bot.action(/^REF:TOK_PASTE:(\d+)$/, async (ctx) => {
            answerCallback(ctx);
            const pts = Number(ctx.match[1]);
            ctx.session.pendingAction = `REF_TOK_PASTE_SK:${pts}`;
            return editMenu(
                ctx,
                `📋 <b>DÁN CHUỖI API KEY CẦN NẠP</b>\n${DIVIDER}\n`
                + `Hãy gửi chuỗi <code>sk-...</code> thuộc tài khoản của bạn vào đây để nạp <b>${pts}⭐</b>.\n`
                + `<i>Gõ /cancel hoặc bấm Quay lại để hủy.</i>`,
                {
                    parse_mode: "HTML",
                    ...Markup.inlineKeyboard([[navBtn("NAV_BACK", "⬅️ Hủy", `REF:TOK_TOPUP_LIST:${pts}`)]]),
                },
            );
        });

        // Nhập mã quà chào mừng WEL...
        bot.action("REF:WEL_ENTER", async (ctx) => {
            answerCallback(ctx);
            const user = await prisma.user.findUnique({ where: { telegramId: String(ctx.from.id) } });
            ctx.session.pendingAction = "REF_WEL_CODE";
            const hint = user?.refWelcomeCode && !user?.refWelcomeRedeemedAt
                ? `\n💡 Mã của bạn: <code>${escapeHtml(user.refWelcomeCode)}</code> (chạm copy rồi gửi vào đây!)`
                : "";
            return editMenu(
                ctx,
                `🎁 <b>NHẬP MÃ QUÀ CHÀO MỪNG (WEL...)</b>\n${DIVIDER}\n`
                + `Gửi mã chào mừng dạng <code>WELxxxxxxxx</code> của bạn để nhận API Key miễn phí!${hint}`,
                {
                    parse_mode: "HTML",
                    ...Markup.inlineKeyboard([[navBtn("NAV_BACK", "⬅️ Quay lại Giới thiệu", "REFERRAL")]]),
                },
            );
        });

        // Bảng xếp hạng Đua Top ngày & Toàn thời gian
        bot.action("REF:LB", async (ctx) => {
            answerCallback(ctx);
            const [cfg, daily, allTime] = await Promise.all([
                getReferralConfig(),
                getDailyReferralLeaderboard({ limit: 10 }),
                getReferralLeaderboard({ limit: 10 }),
            ]);

            const lines = [`🏆 <b>BẢNG XẾP HẠNG MỜI BẠN</b>`, DIVIDER];

            if (cfg.dailyTopEnabled) {
                lines.push(
                    `🔥 <b>Đua Top Hôm Nay (${daily.dayKey} · chốt 00:05 VN):</b>`,
                    `🎁 Giải thưởng: 🥇 <b>${formatTokens(cfg.dailyTop1Tokens)}</b> · 🥈 <b>${formatTokens(cfg.dailyTop2Tokens)}</b> · 🥉 <b>${formatTokens(cfg.dailyTop3Tokens)}</b>`,
                );
                if (!daily.rows.length) {
                    lines.push(`<i>Chưa có lượt xác minh kênh nào hôm nay — cơ hội leo Top 1 đang rộng mở!</i>`);
                } else {
                    daily.rows.forEach((r, idx) => {
                        const medal = MEDALS[idx] || `#${idx + 1}`;
                        const name = escapeHtml(r.firstName || (r.username ? `@${r.username}` : `User ***${String(r.telegramId).slice(-4)}`));
                        lines.push(`${medal} <b>${name}</b> — <b>${r.count}</b> người`);
                    });
                }
                lines.push("");
            }

            lines.push(`👑 <b>Top 10 Toàn Thời Gian:</b>`);
            if (!allTime.rows.length) {
                lines.push(`<i>Chưa có dữ liệu bảng xếp hạng.</i>`);
            } else {
                allTime.rows.forEach((r, idx) => {
                    const medal = MEDALS[idx] || `${idx + 1}.`;
                    const name = escapeHtml(r.firstName || (r.username ? `@${r.username}` : `User ***${String(r.telegramId || "").slice(-4)}`));
                    lines.push(`${medal} <b>${name}</b> — <b>${r.rewarded}</b> hợp lệ (tích <b>${formatTokens(r.tokensEarned)}</b>)`);
                });
            }

            return editMenu(ctx, lines.join("\n"), {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard([[navBtn("NAV_BACK", "⬅️ Quay lại Giới thiệu", "REFERRAL")]]),
            });
        });

        // Lịch sử thưởng cá nhân
        bot.action("REF:HISTORY", async (ctx) => {
            answerCallback(ctx);
            const rows = await getUserReferralHistory(ctx.from.id, 12);
            const lines = [`📜 <b>LỊCH SỬ NHẬN THƯỞNG GIỚI THIỆU</b>`, DIVIDER];

            if (!rows.length) {
                lines.push(`<i>Bạn chưa có lịch sử nhận thưởng nào. Chia sẻ link giới thiệu để bắt đầu nhận API Key & Token!</i>`);
            } else {
                for (const r of rows) {
                    const label = rewardTypeBadge(r.rewardType, r.note);
                    const val = r.tokensGranted > 0
                        ? `+${formatTokens(r.tokensGranted)} token`
                        : (r.note ? escapeHtml(r.note) : "Hoàn tất");
                    const ptNote = r.pointsUsed > 0 ? ` (-${r.pointsUsed}⭐)` : "";
                    const dt = fmtDateShort(r.createdAt ? new Date(r.createdAt).toISOString() : "");
                    lines.push(`• <b>${label}:</b> <b>${val}</b>${ptNote} <i>(${dt})</i>`);
                }
            }

            return editMenu(ctx, lines.join("\n"), {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard([[navBtn("NAV_BACK", "⬅️ Quay lại Giới thiệu", "REFERRAL")]]),
            });
        });

        // Luật thưởng chi tiết
        bot.action("REF:RULES", async (ctx) => {
            answerCallback(ctx);
            const cfg = await getReferralConfig();
            const minM = formatTokens(cfg.inviteReferrerMinTokens);
            const maxM = formatTokens(cfg.inviteReferrerMaxTokens);
            const friendM = formatTokens(cfg.inviteTokenAmount);
            const lines = [
                `📖 <b>LUẬT THƯỞNG &amp; HƯỚNG DẪN MỜI BẠN</b>`,
                DIVIDER,
                `🔥 <b>Mời 1 người là cả hai bên đều nhận được quà:</b>`,
                `• 🔰 <b>Bạn:</b> 1 key thưởng hạn <b>${cfg.inviteReferrerKeyDays} ngày</b> — bot tự tạo, <b>không cần mua key</b>. Mỗi người mời thành công cộng ngẫu nhiên <b>${minM}–${maxM} token</b>; hết hạn thì lượt sau tự tạo key mới.`,
                cfg.luckyProtectEnabled ? `  ↳ 🍀 <b>Bảo hiểm nhân phẩm:</b> 3 lượt liên tiếp dưới ${formatTokens(cfg.luckyMinTokens)} thì lượt thứ 4 chắc chắn nổ <b>≥ ${formatTokens(cfg.luckyMinTokens)}</b>!` : null,
                `• 🎁 <b>Người được mời:</b> key riêng <b>${friendM} token</b>, hạn <b>${cfg.inviteTokenDays > 0 ? `${cfg.inviteTokenDays} ngày` : "vô thời hạn"}</b>${cfg.welcomeKeyEnabled ? ` + mã quà chào mừng <b>${cfg.welcomeTokenMinM}M–${cfg.welcomeTokenMaxM}M</b>` : ""}.`,
                "",
                `<b>Cách làm:</b>`,
                `1️⃣ Gửi link giới thiệu riêng của bạn.`,
                `2️⃣ Người được mời vào bot bằng link, dùng tài khoản đủ điều kiện, pass captcha nếu có và join channel.`,
                `3️⃣ Bot xác nhận channel join rồi tự gửi thưởng cho cả hai.`,
                "",
                cfg.milestoneEnabled ? `🈶 <b>Bonus mốc:</b> 5 người: <b>+${formatTokens(cfg.milestone5Tokens)}</b> · 10 người: <b>+${formatTokens(cfg.milestone10Tokens)}</b> · 20 người: <b>+${formatTokens(cfg.milestone20Tokens)}</b>.` : null,
                cfg.dailyTopEnabled ? `👑 <b>Top 1–2–3 mỗi ngày (00:05 VN):</b> <b>${formatTokens(cfg.dailyTop1Tokens)} / ${formatTokens(cfg.dailyTop2Tokens)} / ${formatTokens(cfg.dailyTop3Tokens)} token</b>.` : null,
                `⭐ <b>Tích điểm &amp; Đổi quà:</b> Bạn mới join channel nhận <b>+${cfg.pointJoinChannel}⭐</b> (cho cả 2 bên); mua đơn đầu nhận thêm <b>+${cfg.pointPurchase}⭐</b>${cfg.buyerTarget > 0 ? ` (đủ ${cfg.buyerTarget} người mua tặng Coupon giảm <b>${cfg.personalVoucherPercent}%</b>)` : ""}.`,
                `🔋 <b>Đổi điểm (/tok):</b> <b>1 điểm = ${formatTokens(cfg.tokenPerPoint)} token</b>${cfg.tokenMaxPerUser > 0 ? ` (trần ${formatTokens(cfg.tokenMaxPerUser)}/user)` : ""}, tối đa 1 lần/ngày.`,
                "",
                `⚠️ <b>Lưu ý điều kiện:</b>`,
                `• Mỗi người được mời chỉ tính 1 lần.`,
                `• Chỉ user <b>hoàn toàn mới</b> mới tính thưởng — người đã từng /start bot sẽ không nhận.`,
                cfg.ageFilterEnabled ? `• Tài khoản Telegram mới tạo dưới <b>${cfg.minTgAgeDays} ngày</b> (trừ Telegram Premium) sẽ tạm hoãn điểm &amp; quà mời tới khi đủ tuổi (đủ ngày bấm "✅ Kiểm tra Join" để nhận).` : null,
            ].filter((x) => x !== null);

            return editMenu(ctx, lines.join("\n"), {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard([
                    [Markup.button.callback("✅ Kiểm tra Join kênh", "REF:CHECK_JOIN")],
                    [navBtn("NAV_BACK", "⬅️ Quay lại Giới thiệu", "REFERRAL")],
                ]),
            });
        });

        // Kiểm tra Join thủ công (mở khóa cho user đã đủ tuổi sau thời gian chờ Age Gate)
        bot.action("REF:CHECK_JOIN", async (ctx) => {
            sendChatAction(ctx, "typing");
            const cfg = await getReferralConfig();
            const joined = await isGroupMember(ctx.from.id);
            if (!joined) {
                answerCallback(ctx, "❌ Bạn chưa tham gia kênh bắt buộc!", { show_alert: true });
                return editMenu(
                    ctx,
                    `📢 <b>BẠN CHƯA THAM GIA KÊNH</b>\n${DIVIDER}\nHãy tham gia kênh bên dưới rồi bấm lại <b>✅ Kiểm tra Join</b> để kích hoạt quyền lợi giới thiệu!`,
                    {
                        parse_mode: "HTML",
                        ...Markup.inlineKeyboard([
                            [Markup.button.url("📢 Tham gia kênh ngay", cfg.channelUrl)],
                            [Markup.button.callback("✅ Tôi đã vào — Kiểm tra lại", "REF:CHECK_JOIN")],
                            [navBtn("NAV_BACK", "⬅️ Quay lại", "REFERRAL")],
                        ]),
                    },
                );
            }

            const out = await runAndDeliverOnboarding(ctx, { alreadyVerified: true });
            if (out?.ageGate?.deferred) {
                return answerCallback(
                    ctx,
                    `⏳ Tài khoản Telegram chưa đủ ${out.ageGate.minDays} ngày tuổi (còn ~${out.ageGate.remainingDays} ngày). Hãy thử lại sau nhé!`,
                    { show_alert: true },
                );
            }
            if (out?.inviteGrants || out?.pointsAwarded || out?.welcomeReward) {
                answerCallback(ctx, "🎉 Xác minh thành công! Đã gửi phần thưởng vào chat!", { show_alert: true });
            } else {
                answerCallback(ctx, "✅ Tài khoản của bạn đã xác minh kênh đầy đủ!", { show_alert: true });
            }
            return showReferralMenu(ctx, { edit: true });
        });
    };

    /**
     * Xử lý tin nhắn văn bản cho `REF_WEL_CODE`, `REF_TOK_PASTE_SK:<pts>`,
     * VÀ hỗ trợ đổi mã `WEL...` ngay cả khi khách đang ở màn `REDEEM_GIFTCODE` thường!
     * Trả `true` nếu đã xử lý tin nhắn, `false` để nhường cho handler tiếp theo.
     */
    const handleTextInput = async (ctx) => {
        const pending = String(ctx.session?.pendingAction || "");
        if (!pending) return false;

        const rawText = String(ctx.message?.text || "").trim();
        if (!rawText || rawText.startsWith("/")) return false;
        const kwList = typeof MENU_KEYWORDS === "function" ? MENU_KEYWORDS() : MENU_KEYWORDS;
        if (kwList.some((kw) => rawText === kw || rawText.endsWith(" " + kw))) {
            ctx.session.pendingAction = null;
            return false;
        }

        // 1. Nhập mã WEL... (từ REF_WEL_CODE hoặc gõ mã WEL... trong REDEEM_GIFTCODE)
        const isWelInput = pending === "REF_WEL_CODE"
            || (pending === "REDEEM_GIFTCODE" && /^WEL[A-Z0-9]{6,16}$/i.test(rawText));

        if (isWelInput) {
            ctx.session.pendingAction = null;
            safeDelete(ctx, ctx.message.message_id).catch(() => {});

            // Nếu chưa xác minh kênh thì kiểm tra live trước khi đổi
            const joined = await isGroupMember(ctx.from.id);
            const res = await redeemWelcomeCode(ctx.from.id, rawText, { bypassJoinCheck: joined });
            if (!res.ok) {
                let errMsg = "Mã quà chào mừng không hợp lệ.";
                if (res.error === "NOT_YOUR_CODE") errMsg = "Mã này không tồn tại hoặc không thuộc tài khoản của bạn.";
                else if (res.error === "ALREADY_REDEEMED") errMsg = "Bạn đã sử dụng mã quà chào mừng này rồi!";
                else if (res.error === "CHANNEL_REQUIRED") errMsg = "Bạn cần tham gia kênh của shop trước khi đổi mã chào mừng.";
                else if (res.error === "DAY_CAP") errMsg = "Hôm nay shop đã phát hết suất quà chào mừng. Vui lòng quay lại vào ngày mai!";
                else if (res.error === "DISABLED") errMsg = "Chương trình mã quà chào mừng hiện đang tạm tắt.";
                else if (res.error === "GATEWAY_FAILED" || res.error === "GATEWAY_NOT_READY") {
                    errMsg = "Hệ thống cấp key đang bận. Mã của bạn CHƯA bị mất, vui lòng thử lại sau ít phút!";
                }

                if (pending === "REF_WEL_CODE") ctx.session.pendingAction = "REF_WEL_CODE";
                await ctx.reply(`❌ ${errMsg}`, {
                    parse_mode: "HTML",
                    ...Markup.inlineKeyboard([[navBtn("NAV_BACK", "⬅️ Về mục Giới thiệu", "REFERRAL")]]),
                });
                return true;
            }

            await sendGrantedKeyOrTopupDm(ctx.telegram, res.keyData, {
                header: `🌟 <b>[ĐỔI MÃ CHÀO MỪNG THÀNH CÔNG · ${escapeHtml(res.code)}]</b>`,
                icon: iconOf,
            });
            return true;
        }

        // 2. Dán chuỗi sk-... để nạp cộng dồn từ điểm giới thiệu
        if (pending.startsWith("REF_TOK_PASTE_SK:")) {
            const pts = Number(pending.split(":")[1]);
            ctx.session.pendingAction = null;
            safeDelete(ctx, ctx.message.message_id).catch(() => {});

            if (!rawText.startsWith("sk-")) {
                ctx.session.pendingAction = `REF_TOK_PASTE_SK:${pts}`;
                await ctx.reply(`❌ Chuỗi API key phải bắt đầu bằng <code>sk-...</code>. Hãy dán lại hoặc bấm Quay lại:`, {
                    parse_mode: "HTML",
                    ...Markup.inlineKeyboard([[navBtn("NAV_BACK", "⬅️ Quay lại", `REF:TOK_TOPUP_LIST:${pts}`)]]),
                });
                return true;
            }

            const res = await redeemPointsToTopup(ctx.from.id, pts, { rawSkKey: rawText });
            if (!res.ok) {
                await ctx.reply(`❌ <b>Chưa nạp được token:</b> ${escapeHtml(formatRedeemError(res))}`, {
                    parse_mode: "HTML",
                    ...Markup.inlineKeyboard([[navBtn("NAV_BACK", "⬅️ Quay lại", "REF:TOK")]]),
                });
                return true;
            }

            await sendGrantedKeyOrTopupDm(ctx.telegram, res.keyData, {
                header: `⚡ <b>[ĐỔI ĐIỂM NẠP KEY THÀNH CÔNG · -${pts}⭐]</b>\nSố điểm còn lại: <b>${res.remainingPoints}⭐</b>`,
                icon: iconOf,
            });
            return true;
        }

        // 3. Nhập 1–2 IPv4/IPv6 để đổi Key 1.5B dùng chung
        if (pending === "KEY1B_IPS") {
            ctx.session.pendingAction = null;
            safeDelete(ctx, ctx.message.message_id).catch(() => {});

            const res = await redeemKey1b(ctx.from.id, rawText);
            if (!res.ok) {
                if (["EMPTY_IPS", "TOO_MANY_IPS", "INVALID_IP", "DUPLICATE_IP"].includes(res.error)) {
                    ctx.session.pendingAction = "KEY1B_IPS";
                    let ipMsg = "Địa chỉ IP không hợp lệ.";
                    if (res.error === "TOO_MANY_IPS") ipMsg = "Chỉ được phép đăng ký tối đa 2 địa chỉ IP.";
                    else if (res.error === "DUPLICATE_IP") ipMsg = `Hai địa chỉ IP bị trùng nhau (${escapeHtml(res.invalidToken || "")}).`;
                    else if (res.error === "INVALID_IP") ipMsg = `<code>${escapeHtml(res.invalidToken || "")}</code> không phải địa chỉ IPv4/IPv6 hợp lệ.`;

                    await ctx.reply(
                        `❌ <b>${ipMsg}</b>\nHãy gửi lại 1 hoặc 2 địa chỉ IPv4/IPv6 cách nhau bởi dấu phẩy (VD: <code>113.161.72.15, 2001:ee0:4f9b::1</code>):`,
                        {
                            parse_mode: "HTML",
                            ...Markup.inlineKeyboard([[navBtn("NAV_BACK", "⬅️ Hủy", "KEY1B:INTRO")]]),
                        },
                    );
                    return true;
                }

                let failMsg = "Không thể đổi lúc này. Điểm của bạn CHƯA bị trừ!";
                if (res.error === "SOLD_OUT") failMsg = "Rất tiếc, suất cuối cùng của đợt này vừa được nhận hết!";
                else if (res.error === "ALREADY_CLAIMED") failMsg = "Bạn đã nhận Key trong đợt này rồi! Bấm bên dưới để xem lại key.";
                else if (res.error === "NOT_ENOUGH") failMsg = `Bạn không đủ điểm (cần ${res.requiredPoints}⭐, hiện có ${res.currentPoints}⭐).`;
                else if (res.error === "TOO_NEW") failMsg = "Tài khoản mới cần hoạt động tại shop tối thiểu 3 ngày để tham gia đổi thưởng.";
                else if (res.error === "DISABLED") failMsg = "Sự kiện hiện đang tạm đóng.";
                else if (res.error === "BANNED") failMsg = "Tài khoản của bạn đang bị khóa.";

                await ctx.reply(`❌ ${escapeHtml(failMsg)}`, {
                    parse_mode: "HTML",
                    ...Markup.inlineKeyboard([[Markup.button.callback("🔑 Xem trạng thái sự kiện", "KEY1B:INTRO")]]),
                });
                return true;
            }

            const lines = [
                `🎉 <b>[ĐỔI ${escapeHtml(res.displayName).toUpperCase()} THÀNH CÔNG · -${res.pointsUsed}⭐]</b>`,
                DIVIDER,
                `🔑 <b>API Key của đợt:</b>`,
                `<code>${escapeHtml(res.keyValue)}</code>`,
                `<i>(Chạm vào chuỗi key ở trên để sao chép)</i>`,
                "",
                `🌐 <b>IP đã đăng ký bảo vệ:</b> <code>${escapeHtml(res.ips.join(", "))}</code>`,
                `⭐ <b>Điểm còn lại:</b> <b>${res.remainingPoints} điểm</b>`,
            ];
            if (res.note) {
                lines.push("", `📌 <b>Hướng dẫn:</b>\n${escapeHtml(res.note)}`);
            }

            await ctx.reply(lines.join("\n"), {
                parse_mode: "HTML",
                disable_web_page_preview: true,
                ...Markup.inlineKeyboard([[navBtn("NAV_BACK", "⬅️ Về mục Giới thiệu", "REFERRAL")]]),
            });

            // Bắn thông báo rao mốc 25/50/75/90% hoặc Sold-out chạy nền
            if (res.milestoneAnnouncement) {
                getBotInfo()
                    .then((info) =>
                        announceKey1bMilestone({
                            telegram: ctx.telegram,
                            botUsername: info?.username || "",
                            announcement: res.milestoneAnnouncement,
                        }),
                    )
                    .catch((e) => console.error("[bot-referral] announceKey1bMilestone lỗi:", e.message));
            }
            return true;
        }

        return false;
    };

    return {
        register,
        showReferralMenu,
        showRedeemHubMenu,
        showApiKeyRewardsMenu,
        showKey1bIntro,
        showTokenRedeemMenu,
        runAndDeliverOnboarding,
        handleTextInput,
    };
}

export default { createReferralBotModule };
