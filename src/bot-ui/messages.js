import {
    DIVIDER,
    escapeHtml,
    formatCurrency,
    formatDateTime,
    getShopName,
    renderTelegramEmoji,
    statusLabel,
    stockLabel,
    truncateText,
} from "./format.js";
import { getWelcomeGreetingSync, DEFAULT_WELCOME_GREETING, DEFAULT_WELCOME_SUBTITLE, getProductDisplaySettingsSync, getMenuIconsSync, getMenuIconIdsSync, DEFAULT_ICONS } from "../menu-config.js";
import { formatRateHint, formatUsdPrimary, liveUsdVndRate, orderDisplayRate } from "../money-display.js";
import { flashBadge, flashPricePair } from "../flash-sale-text.js";
import { formatTokens } from "../apikey-pricing.js";

/**
 * Render icon của 1 key thành HTML (kèm <tg-emoji> nếu admin đã gán custom emoji ID).
 * Đọc cache mỗi lần gọi nên admin đổi icon là áp dụng ngay, không cần restart.
 * Chỉ dùng cho message text gửi với parse_mode "HTML".
 */
function ic(key, fallback) {
    const icons = getMenuIconsSync();
    const iconIds = getMenuIconIdsSync();
    return renderTelegramEmoji(icons[key] ?? DEFAULT_ICONS[key] ?? fallback, iconIds[key] ?? null);
}

const MSG_LABELS = {
    vi: {
        customer: "bạn",
        wallet: "Ví",
        productsOnSale: "Sản phẩm đang bán",
        members: "Thành viên",
        account: "Tài khoản",
        name: "Tên",
        walletBalance: "Số dư ví",
        totalOrders: "Tổng đơn",
        totalSpent: "Đã chi tiêu",
        supportTitle: "Hỗ trợ khách hàng",
        supportIntro: "Cần hỗ trợ thanh toán, đơn hàng hoặc sản phẩm?",
        supportNote: "Khi liên hệ, hãy gửi kèm mã đơn nếu bạn đã đặt hàng.",
        walletTitle: "Ví của bạn",
        currentBalance: "Số dư hiện tại",
        walletIntro: "Chọn mệnh giá nạp hoặc nhập số tiền khác. Chuyển đúng số tiền và đúng nội dung để hệ thống cộng ví tự động.",
        orderListTitle: "ĐƠN HÀNG CỦA BẠN",
        noOrders: "Bạn chưa có đơn hàng nào.",
        buyPrompt: "Bấm <b>Mua hàng</b> để xem danh mục sản phẩm.",
        orderDetailTitle: "CHI TIẾT ĐƠN HÀNG",
        pendingOrder: "Đơn chờ xác nhận. Nếu đã chuyển khoản, bấm <b>Làm mới</b> sau ít phút.",
        deliveryInfo: "Thông tin giao hàng",
        notSelected: "Chưa chọn",
        checkoutTitle: "XÁC NHẬN THANH TOÁN",
        quantity: "Số lượng",
        subtotal: "Tạm tính",
        amountDue: "Cần thanh toán",
        choosePayment: "Chọn phương thức thanh toán",
        walletMissing: "Ví thiếu <b>{amount}</b> — nạp thêm hoặc thanh toán QR.",
        productFallback: "Sản phẩm",
        categoriesTitle: "Danh mục sản phẩm",
        categoryCount: "danh mục",
        packages: "gói",
        chooseCategory: "Chọn danh mục để xem gói đang mở bán",
        emptyShop: "Shop chưa có sản phẩm đang mở bán.",
        emptyShopHint: "Bạn có thể quay lại sau hoặc liên hệ hỗ trợ để được tư vấn.",
        page: "Trang",
        accountsAvailable: "tài khoản còn lại",
        packagesOnSale: "gói đang mở bán",
        choosePackage: "Chọn gói bên dưới để đặt hàng",
        emptyCategory: "Danh mục này chưa có sản phẩm khả dụng.",
        emptyCategoryHint: "Hãy quay lại danh mục khác hoặc thử lại sau.",
        price: "Giá",
        stock: "Tồn kho",
        inStock: "Còn hàng",
        outOfStock: "Hết hàng",
        accounts: "tài khoản",
        sold: "Đã bán",
        description: "Mô tả",
        note: "Lưu ý",
    },
    en: {
        customer: "you",
        wallet: "Wallet",
        productsOnSale: "Products on sale",
        members: "Members",
        account: "Account",
        name: "Name",
        walletBalance: "Wallet balance",
        totalOrders: "Total orders",
        totalSpent: "Total spent",
        supportTitle: "Customer support",
        supportIntro: "Need help with payment, orders or products?",
        supportNote: "When contacting support, include your order code if you have one.",
        walletTitle: "Your wallet",
        currentBalance: "Current balance",
        walletIntro: "Choose a deposit amount or enter another amount. Send the exact amount and note so the system can credit your wallet automatically.",
        orderListTitle: "YOUR ORDERS",
        noOrders: "You have no orders yet.",
        buyPrompt: "Tap <b>Buy</b> to browse products.",
        orderDetailTitle: "ORDER DETAILS",
        pendingOrder: "Order is waiting for confirmation. If you have paid, tap <b>Refresh</b> after a few minutes.",
        deliveryInfo: "Delivery information",
        notSelected: "Not selected",
        checkoutTitle: "CONFIRM PAYMENT",
        quantity: "Quantity",
        subtotal: "Subtotal",
        amountDue: "Amount due",
        choosePayment: "Choose a payment method",
        walletMissing: "Wallet is short <b>{amount}</b> — deposit more or pay by QR.",
        productFallback: "Product",
        categoriesTitle: "Product categories",
        categoryCount: "categories",
        packages: "products",
        chooseCategory: "Choose a category to browse available products",
        emptyShop: "There are no products on sale yet.",
        emptyShopHint: "Please check back later or contact support.",
        page: "Page",
        accountsAvailable: "accounts available",
        packagesOnSale: "products on sale",
        choosePackage: "Choose a product below to place an order",
        emptyCategory: "This category has no available products.",
        emptyCategoryHint: "Choose another category or try again later.",
        price: "Price",
        stock: "Stock",
        inStock: "In stock",
        outOfStock: "Out of stock",
        accounts: "accounts",
        sold: "Sold",
        description: "Description",
        note: "Note",
    },
    zh: {
        customer: "您",
        wallet: "钱包",
        productsOnSale: "在售商品",
        members: "成员",
        account: "账户",
        name: "名称",
        walletBalance: "钱包余额",
        totalOrders: "订单总数",
        totalSpent: "已消费",
        supportTitle: "客服支持",
        supportIntro: "需要支付、订单或商品帮助？",
        supportNote: "联系客服时，请附上订单编号。",
        walletTitle: "您的钱包",
        currentBalance: "当前余额",
        walletIntro: "请选择充值金额或输入其他金额。请转入准确金额和备注，系统会自动入账。",
        orderListTitle: "您的订单",
        noOrders: "您还没有订单。",
        buyPrompt: "点击 <b>购买</b> 查看商品。",
        orderDetailTitle: "订单详情",
        pendingOrder: "订单等待确认。如已付款，请几分钟后点击 <b>刷新</b>。",
        deliveryInfo: "发货信息",
        notSelected: "未选择",
        checkoutTitle: "确认支付",
        quantity: "数量",
        subtotal: "小计",
        amountDue: "应付金额",
        choosePayment: "请选择支付方式",
        walletMissing: "钱包还差 <b>{amount}</b>，请充值或使用二维码支付。",
        productFallback: "商品",
        categoriesTitle: "商品分类",
        categoryCount: "个分类",
        packages: "件商品",
        chooseCategory: "请选择分类查看在售商品",
        emptyShop: "商店暂时没有在售商品。",
        emptyShopHint: "请稍后再来或联系客服。",
        page: "页",
        accountsAvailable: "个账户有货",
        packagesOnSale: "件商品在售",
        choosePackage: "请选择下方商品下单",
        emptyCategory: "此分类暂时没有可用商品。",
        emptyCategoryHint: "请选择其他分类或稍后再试。",
        price: "价格",
        stock: "库存",
        inStock: "有货",
        outOfStock: "缺货",
        accounts: "个账户",
        sold: "已售",
        description: "描述",
        note: "注意",
    },
};

function msgLabel(lang = "vi", key) {
    return MSG_LABELS[lang]?.[key] || MSG_LABELS.vi[key] || key;
}

function valueLine(label, value) {
    return `<b>${label}</b>: ${value}`;
}

// Extract accounts from deliveryContent and format compactly for in-chat display
function formatDeliveryInline(content) {
    if (!content) return "";
    // New compact format: lines after "── Tài khoản ──"
    const newSplit = content.split(/──\s*Tài khoản\s*──/i);
    if (newSplit.length > 1) {
        const accounts = newSplit[1].trim().split(/\n\n+/).filter(Boolean);
        return accounts.map(a => `<code>${escapeHtml(a.trim())}</code>`).join("\n");
    }
    // Legacy format: find lines after "DANH SÁCH TÀI KHOẢN"
    const legacySplit = content.split(/DANH SÁCH TÀI KHOẢN[\s=]*/i);
    if (legacySplit.length > 1) {
        const accounts = legacySplit[1].trim().split(/\n\n+/).filter(Boolean);
        return accounts.map(a => `<code>${escapeHtml(a.trim())}</code>`).join("\n");
    }
    // Fallback: show first 800 chars
    return `<code>${escapeHtml(content.slice(0, 800))}</code>`;
}

function productName(product) {
    return escapeHtml(product?.name || "Sản phẩm");
}

export function buildMainMenuReferralSection(referralGuide = null, lang = "vi") {
    if (!referralGuide?.enabled) return "";

    const minM = formatTokens(referralGuide.inviteReferrerMinTokens ?? 2_000_000);
    const maxM = formatTokens(referralGuide.inviteReferrerMaxTokens ?? 7_000_000);
    const friendM = formatTokens(referralGuide.inviteTokenAmount ?? 20_000_000);
    const refKeyDays = referralGuide.inviteReferrerKeyDays ?? 30;
    const friendDays = referralGuide.inviteTokenDays ?? 1;
    const maxInvites = Number(referralGuide.inviteMaxPerReferrer) || 0;
    const ptsJoin = Number(referralGuide.pointJoinChannel ?? 1);
    const link = String(referralGuide.link || "").trim();

    if (lang === "en") {
        const friendValidity = friendDays > 0 ? `valid <b>${friendDays}d</b>` : "<b>no expiry</b>";
        const lines = [
            DIVIDER,
            `🔥 <b>INVITE FRIENDS — ${minM}–${maxM} BONUS KEY + ${friendM} FRIEND KEY</b>`,
            `Invite 1 person and both sides get rewarded.`,
            "",
            `🔰 <b>You:</b> 1 bonus key valid <b>${refKeyDays} days</b> — auto-created by bot, <b>no purchase needed</b>. Each verified invite adds random <b>${minM}–${maxM} tokens</b>; once expired, the next invite creates a new key.`,
            `👉 Get key: <b>Referral &amp; Points</b> → tap <b>Copy bonus key</b>. Also saved in /mykey.`,
            "",
            `🎁 <b>Invited friend:</b> dedicated <b>${friendM} token</b> key, ${friendValidity}.`,
            "",
            `<b>How it works:</b>`,
            `1️⃣ Send your personal referral link.`,
            `2️⃣ Your friend opens the bot via your link with an eligible account, passes captcha if any, and joins the channel.`,
            `3️⃣ Bot verifies channel membership and automatically sends rewards to both.`,
            "",
            `⚠️ Each invited user counts once.`,
            maxInvites > 0 ? `• Up to <b>${maxInvites}</b> invites per referrer.` : `• Unlimited number of invites.`,
        ];
        if (referralGuide.milestoneEnabled !== false) {
            const m5 = formatTokens(referralGuide.milestone5Tokens ?? 15_000_000);
            const m10 = formatTokens(referralGuide.milestone10Tokens ?? 25_000_000);
            const m20 = formatTokens(referralGuide.milestone20Tokens ?? 50_000_000);
            lines.push(`🈶 Milestones <b>5 invites: +${m5} · 10 invites: +${m10} · 20 invites: +${m20}</b>.`);
        }
        if (referralGuide.dailyTopEnabled !== false) {
            const t1 = formatTokens(referralGuide.dailyTop1Tokens ?? 50_000_000);
            const t2 = formatTokens(referralGuide.dailyTop2Tokens ?? 30_000_000);
            const t3 = formatTokens(referralGuide.dailyTop3Tokens ?? 15_000_000);
            lines.push(`🈶 Daily Top 1–2–3: <b>${t1} / ${t2} / ${t3} tokens</b>.`);
        }
        if (ptsJoin > 0) {
            lines.push(`⭐ Friend enters via link + joins shop channel → you earn <b>${ptsJoin} point${ptsJoin > 1 ? "s" : ""}</b> (auto-checked).`);
        }
        lines.push(`⚠️ Only <b>brand-new</b> users qualify — anyone who has previously used /start will not receive invite gifts.`);
        if (link) lines.push(escapeHtml(link));
        lines.push(DIVIDER);
        return lines.join("\n");
    }

    if (lang === "zh") {
        const friendValidity = friendDays > 0 ? `有效期 <b>${friendDays} 天</b>` : "<b>永不过期</b>";
        const lines = [
            DIVIDER,
            `🔥 <b>邀请好友 — 奖励密钥 ${minM}–${maxM} + 好友密钥 ${friendM}</b>`,
            `成功邀请 1 人，双方均可领奖。`,
            "",
            `🔰 <b>您：</b> 1 个 <b>${refKeyDays} 天</b>奖励密钥 — 机器人自动创建，<b>无需购买</b>。每成功邀请 1 人随机累加 <b>${minM}–${maxM} token</b>；过期后下次邀请自动生成新密钥。`,
            `👉 获取密钥：打开 <b>推荐与积分</b> → 点击 <b>复制奖励密钥</b>，也可在 /mykey 查看。`,
            "",
            `🎁 <b>被邀请人：</b> 独立 <b>${friendM} token</b> 密钥，${friendValidity}。`,
            "",
            `<b>操作步骤：</b>`,
            `1️⃣ 发送您的专属邀请链接。`,
            `2️⃣ 好友通过链接进入机器人（符合条件的账号），完成验证并加入频道。`,
            `3️⃣ 机器人确认加入频道后自动向双方发放奖励。`,
            "",
            `⚠️ 每位被邀请人仅计 1 次。`,
            maxInvites > 0 ? `• 每人最多计奖 <b>${maxInvites}</b> 位好友。` : `• 不限邀请人数。`,
        ];
        if (referralGuide.milestoneEnabled !== false) {
            const m5 = formatTokens(referralGuide.milestone5Tokens ?? 15_000_000);
            const m10 = formatTokens(referralGuide.milestone10Tokens ?? 25_000_000);
            const m20 = formatTokens(referralGuide.milestone20Tokens ?? 50_000_000);
            lines.push(`🈶 里程碑奖励 <b>5 人: +${m5} · 10 人: +${m10} · 20 人: +${m20}</b>。`);
        }
        if (referralGuide.dailyTopEnabled !== false) {
            const t1 = formatTokens(referralGuide.dailyTop1Tokens ?? 50_000_000);
            const t2 = formatTokens(referralGuide.dailyTop2Tokens ?? 30_000_000);
            const t3 = formatTokens(referralGuide.dailyTop3Tokens ?? 15_000_000);
            lines.push(`🈶 每日排行前 1–2–3 名：<b>${t1} / ${t2} / ${t3} token</b>。`);
        }
        if (ptsJoin > 0) {
            lines.push(`⭐ 好友通过链接进入 + 加入频道 → 获得 <b>${ptsJoin} 积分</b>（自动检测）。`);
        }
        lines.push(`⚠️ 仅限<b>全新用户</b>计奖 — 之前发送过 /start 的账号不计入。`);
        if (link) lines.push(escapeHtml(link));
        lines.push(DIVIDER);
        return lines.join("\n");
    }

    const friendValidity = friendDays > 0 ? `hạn <b>${friendDays} ngày</b>` : "<b>không giới hạn ngày</b>";
    const lines = [
        DIVIDER,
        `🔥 <b>MỜI BẠN — KEY THƯỞNG ${minM}–${maxM} + KEY BẠN BÈ ${friendM}</b>`,
        `Mời 1 người là cả hai bên đều nhận được quà.`,
        "",
        `🔰 <b>Bạn:</b> 1 key thưởng hạn <b>${refKeyDays} ngày</b> — bot tự tạo, <b>không cần mua key</b>. Mỗi người mời thành công cộng ngẫu nhiên <b>${minM}–${maxM} token</b>; hết hạn thì lượt sau tạo key mới.`,
        `👉 Lấy key: menu <b>Giới thiệu &amp; Điểm</b> → bấm <b>Copy key thưởng</b> (giữ dòng key). Cũng có trong /mykey.`,
        "",
        `🎁 <b>Người được mời:</b> key riêng <b>${friendM} token</b>, ${friendValidity}.`,
        "",
        `<b>Cách làm:</b>`,
        `1️⃣ Gửi link giới thiệu riêng của bạn.`,
        `2️⃣ Người được mời vào bot bằng link, dùng tài khoản đủ điều kiện, pass captcha nếu có và join channel.`,
        `3️⃣ Bot xác nhận channel join rồi tự gửi thưởng cho cả hai.`,
        "",
        `⚠️ Mỗi người được mời chỉ tính 1 lần.`,
        maxInvites > 0 ? `• Tối đa <b>${maxInvites}</b> người mời nhận thưởng.` : `• Không giới hạn số người mời.`,
    ];
    if (referralGuide.milestoneEnabled !== false) {
        const m5 = formatTokens(referralGuide.milestone5Tokens ?? 15_000_000);
        const m10 = formatTokens(referralGuide.milestone10Tokens ?? 25_000_000);
        const m20 = formatTokens(referralGuide.milestone20Tokens ?? 50_000_000);
        lines.push(`🈶 Bonus mốc <b>5 người: +${m5} · 10 người: +${m10} · 20 người: +${m20}</b>.`);
    }
    if (referralGuide.dailyTopEnabled !== false) {
        const t1 = formatTokens(referralGuide.dailyTop1Tokens ?? 50_000_000);
        const t2 = formatTokens(referralGuide.dailyTop2Tokens ?? 30_000_000);
        const t3 = formatTokens(referralGuide.dailyTop3Tokens ?? 15_000_000);
        lines.push(`🈶 Top 1–2–3 mỗi ngày: <b>${t1} / ${t2} / ${t3} token</b>.`);
    }
    if (ptsJoin > 0) {
        lines.push(`⭐ Bạn bè vào link + join channel của shop → bạn nhận <b>${ptsJoin} điểm</b> (bot tự kiểm tra).`);
    }
    lines.push(`⚠️ Chỉ user <b>hoàn toàn mới</b> mới tính thưởng — người đã từng /start bot sẽ không nhận.`);
    if (link) lines.push(escapeHtml(link));
    lines.push(DIVIDER);
    return lines.join("\n");
}

export function mainMenuMessage({ firstName = "bạn", balance = 0, productCount = 0, memberCount = null, vipEmoji = "👤", vipName = "Thường", totalSpent = 0, nextLevelName = null, nextLevelMinSpent = 0, lang = "vi", referralGuide = null } = {}) {
    const greetingTemplate = getWelcomeGreetingSync() ?? DEFAULT_WELCOME_GREETING;
    const greeting = greetingTemplate.replace(/\{name\}/g, escapeHtml(firstName));
    const refBlock = buildMainMenuReferralSection(referralGuide, lang || "vi");

    if (lang) {
        const localizedVipProgress = nextLevelName
            ? ` · ${formatCurrency(totalSpent)} / ${formatCurrency(nextLevelMinSpent)} → ${nextLevelName}`
            : ` · Max ${ic("VIP_MAX", "🏆")}`;
        const localizedMemberLine = memberCount != null
            ? `\n${valueLine(msgLabel(lang, "members"), `<b>${memberCount.toLocaleString("vi-VN")}</b>`)}`
            : "";
        if (refBlock) {
            const rankLabel = lang === "en" ? "Member tier" : lang === "zh" ? "会员等级" : "Hạng thành viên";
            const chooseLine = lang === "en"
                ? `Choose an action below ${ic("PROMPT_CHOOSE", "👇")}`
                : lang === "zh"
                    ? `请在下方选择操作 ${ic("PROMPT_CHOOSE", "👇")}`
                    : `Chọn bên dưới ${ic("PROMPT_CHOOSE", "👇")}`;
            return `<b>${escapeHtml(getShopName())}</b>
${DIVIDER}
${greeting}

${valueLine(msgLabel(lang, "wallet"), `<b>${formatUsdPrimary(balance, "VND", { lang, rate: liveUsdVndRate() })}</b>`)}
${valueLine(msgLabel(lang, "productsOnSale"), `<b>${productCount}</b>`)}\
${localizedMemberLine}

${chooseLine}
${refBlock}
🏅 ${valueLine(rankLabel, `<b>${vipEmoji} ${vipName}</b>${localizedVipProgress}`)}`;
        }
        return `<b>${escapeHtml(getShopName())}</b>
${DIVIDER}
${greeting}

${valueLine(msgLabel(lang, "wallet"), `<b>${formatUsdPrimary(balance, "VND", { lang, rate: liveUsdVndRate() })}</b>`)}
${valueLine(msgLabel(lang, "productsOnSale"), `<b>${productCount}</b>`)}\
${localizedMemberLine}
${valueLine("VIP", `<b>${vipEmoji} ${vipName}</b>${localizedVipProgress}`)}

${DEFAULT_WELCOME_SUBTITLE}`;
    }
    const vipProgress = nextLevelName
        ? ` · ${formatCurrency(totalSpent)} / ${formatCurrency(nextLevelMinSpent)} → ${nextLevelName}`
        : ` · Max ${ic("VIP_MAX", "🏆")}`;
    const memberLine = memberCount != null ? `\n${valueLine("Thành viên", `<b>${memberCount.toLocaleString("vi-VN")}</b>`)}` : "";
    if (refBlock) {
        return `<b>${escapeHtml(getShopName())}</b>
${DIVIDER}
${greeting}

${valueLine("Ví", `<b>${formatCurrency(balance)}</b>`)}
${valueLine("Sản phẩm đang bán", `<b>${productCount}</b>`)}\
${memberLine}

Chọn bên dưới ${ic("PROMPT_CHOOSE", "👇")}
${refBlock}
🏅 ${valueLine("Hạng thành viên", `<b>${vipEmoji} ${vipName}</b>${vipProgress}`)}`;
    }
    return `<b>${escapeHtml(getShopName())}</b>
${DIVIDER}
${greeting}

${valueLine("Ví", `<b>${formatCurrency(balance)}</b>`)}
${valueLine("Sản phẩm đang bán", `<b>${productCount}</b>`)}\
${memberLine}
${valueLine("VIP", `<b>${vipEmoji} ${vipName}</b>${vipProgress}`)}

${DEFAULT_WELCOME_SUBTITLE}`;
}

export function categoriesMessage({ total = 0, productTotal = 0, lang = "vi" } = {}) {
    const productLine = productTotal > 0 ? `  ·  <b>${productTotal}</b> ${msgLabel(lang, "packages")}` : "";

    return `<b>${ic("TITLE_CATEGORIES", "🗂")} ${msgLabel(lang, "categoriesTitle")}</b>
${DIVIDER}
${ic("NAV_CATS", "📁")} <b>${total}</b> ${msgLabel(lang, "categoryCount")}${productLine}

${ic("PROMPT_CHOOSE", "👇")} ${msgLabel(lang, "chooseCategory")}`;
}

export function emptyCategoriesMessage(lang = "vi") {
    return `<b>${escapeHtml(getShopName())}</b>
${DIVIDER}
${msgLabel(lang, "emptyShop")}

${msgLabel(lang, "emptyShopHint")}`;
}

export function productsMessage({ category, products = [], total = 0, page = 1, totalPages = 1, stockById = new Map(), lang = "vi" } = {}) {
    const title = category
        ? `${renderTelegramEmoji(category.icon, category.iconEmojiId)} <b>${escapeHtml(category.name || msgLabel(lang, "productFallback"))}</b>`
        : `<b>${ic("TITLE_PRODUCTS", "🛍")} ${msgLabel(lang, "productFallback")}</b>`;
    const hasStock = products.some((product) => product.deliveryMode === "STOCK_LINES");
    const totalStock = products.reduce((sum, product) => {
        return sum + (product.deliveryMode === "STOCK_LINES" ? (stockById.get(product.id) || 0) : 0);
    }, 0);
    const pageTag = totalPages > 1 ? `  ·  ${msgLabel(lang, "page")} <b>${page}/${totalPages}</b>` : "";
    const statsLine = hasStock
        ? `${ic("FIELD_STOCK", "📦")} <b>${totalStock}</b> ${msgLabel(lang, "accountsAvailable")}${pageTag}`
        : `${ic("TITLE_PRODUCTS", "🛍")} <b>${total}</b> ${msgLabel(lang, "packagesOnSale")}${pageTag}`;

    return `${title}
${DIVIDER}
${statsLine}

${ic("PROMPT_CHOOSE", "👇")} ${msgLabel(lang, "choosePackage")}`;
}

export function emptyProductsMessage(category, lang = "vi") {
    const title = category
        ? `${renderTelegramEmoji(category.icon, category.iconEmojiId)} <b>${escapeHtml(category.name || msgLabel(lang, "productFallback"))}</b>`
        : `<b>${msgLabel(lang, "productFallback")}</b>`;

    return `${title}
${DIVIDER}
${msgLabel(lang, "emptyCategory")}

${msgLabel(lang, "emptyCategoryHint")}`;
}

export function productDetailMessage({ product, stockCount = null, soldCount = null, lang = "vi", flash = null } = {}) {
    const d = getProductDisplaySettingsSync();

    const rawIcon = product?.icon;
    // Bỏ dot trạng thái cũ (🟢/🔴) nếu lỡ bị lưu làm icon sản phẩm — rơi về icon mặc định.
    const defaultProductIcon = getMenuIconsSync().FIELD_STOCK ?? DEFAULT_ICONS.FIELD_STOCK;
    const cleanIcon = (rawIcon && rawIcon !== "🟢" && rawIcon !== "🔴") ? rawIcon : defaultProductIcon;
    const iconPart = renderTelegramEmoji(cleanIcon, product?.iconEmojiId ?? (rawIcon ? null : getMenuIconIdsSync().FIELD_STOCK ?? null));
    const name = escapeHtml(product?.name || msgLabel(lang, "productFallback"));

    const lines = [`${iconPart} <b>${name}</b>`];

    if (d.price) {
        const rate = liveUsdVndRate();
        // Ưu đãi flash sale của CHÍNH khách đang xem. `product.price` đã là giá SAU giảm
        // (caller áp bằng applyFlashToProduct), còn `flash.priceBefore` là giá niêm yết
        // — nên chỗ này chỉ việc vẽ cặp gạch ngang, không tự tính lại %.
        // `flash` null/undefined → hệt hành vi cũ, không có gì đổi với khách không nhận.
        const hasFlash = Number(flash?.pct) > 0;
        const price = hasFlash
            ? flashPricePair({
                priceBefore: flash.priceBefore,
                priceAfter: product?.price || 0,
                currency: product?.currency,
                lang,
                pct: flash.pct,
                rate,
            })
            : formatUsdPrimary(product?.price || 0, product?.currency, { lang, rate });
        lines.push(`${ic("FIELD_PRICE", "💰")} <b>${msgLabel(lang, "price")}:</b> ${price}`);
        if (hasFlash) {
            const badge = flashBadge({ pct: flash.pct, expiresAt: flash.expiresAt, lang });
            if (badge) lines.push(badge);
        }
    }

    if (d.stock) {
        let stockStr;
        if (product?.deliveryMode !== "STOCK_LINES") {
            stockStr = msgLabel(lang, "inStock");
        } else if (stockCount !== null && stockCount <= 0) {
            stockStr = `${msgLabel(lang, "outOfStock")} ${ic("STATUS_ERROR", "❌")}`;
        } else if (stockCount !== null) {
            stockStr = `${stockCount.toLocaleString("vi-VN")} ${msgLabel(lang, "accounts")}`;
        } else {
            stockStr = msgLabel(lang, "inStock");
        }
        lines.push(`${ic("FIELD_STOCK", "📦")} <b>${msgLabel(lang, "stock")}:</b> ${stockStr}`);
    }

    if (d.sold) {
        lines.push(`${ic("FIELD_SOLD", "📊")} <b>${msgLabel(lang, "sold")}:</b> ${(soldCount ?? 0).toLocaleString("vi-VN")} ${msgLabel(lang, "accounts")}`);
    }

    if (d.description && product?.description) {
        const desc = truncateText(product.description, 400);
        lines.push(`${ic("FIELD_DESC", "💬")} <b>${msgLabel(lang, "description")}:</b>\n<blockquote>${escapeHtml(desc)}</blockquote>`);
    }

    if (product?.note) {
        const note = truncateText(product.note, 250);
        lines.push(`${ic("FIELD_NOTE", "⚠️")} <b>${msgLabel(lang, "note")}:</b>\n${escapeHtml(note)}`);
    }

    return lines.join("\n");
}

export function contactProductMessage({ product, adminUsername, lang = "vi" } = {}) {
    const copy = lang === "en"
        ? { fallback: "This product requires an admin to confirm availability and price.", intro: "Please contact support before ordering.", contact: "Contact" }
        : lang === "zh"
            ? { fallback: "此商品需要管理员确认库存和价格。", intro: "下单前请先联系客服。", contact: "联系" }
            : { fallback: "Gói này cần admin kiểm tra và báo giá trực tiếp.", intro: "Gói này cần tư vấn trước khi đặt.", contact: "Liên hệ" };
    const description = product?.description || copy.fallback;

    return `<b>${productName(product)}</b>
${DIVIDER}
${copy.intro}

${escapeHtml(description)}

${valueLine(copy.contact, `<b>@${escapeHtml(adminUsername || "admin")}</b>`)}`;
}

export function checkoutMessage({ orderData, balance = 0, missing = 0, lang = "vi" } = {}) {

    const qtyDiscountLine = orderData.quantityDiscount > 0
    ? `\n${ic("ORDER_DISCOUNT", "💸")} <b>Giảm SL${orderData.quantityDiscountPercent ? ` (-${orderData.quantityDiscountPercent}%)` : ""}:</b> <b>-${formatUsdPrimary(orderData.quantityDiscount, orderData.currency, { lang, rate: orderDisplayRate(orderData) })}</b>`
        : "";
    const couponDiscountLine = orderData.couponDiscount > 0
    ? `\n${ic("ORDER_DISCOUNT", "🎟️")} <b>Coupon:</b> <b>-${formatUsdPrimary(orderData.couponDiscount, orderData.currency, { lang, rate: orderDisplayRate(orderData) })}</b>`
        : "";
    const vipDiscountLine = orderData.vipDiscount > 0
    ? `\n${ic("VIP_DISCOUNT", "🎁")} <b>Giảm VIP${orderData.vipDiscountPercent ? ` (-${orderData.vipDiscountPercent}%)` : ""}:</b> <b>-${formatUsdPrimary(orderData.vipDiscount, orderData.currency, { lang, rate: orderDisplayRate(orderData) })}</b>`
        : "";
    // Fallback: nếu không tách được, dùng tổng discount (đơn cũ)
    const discountLine = (qtyDiscountLine || couponDiscountLine || vipDiscountLine)
        ? `${qtyDiscountLine}${couponDiscountLine}${vipDiscountLine}`
        : (orderData.discount > 0
    ? `\n${ic("ORDER_DISCOUNT", "💸")} <b>Giảm giá:</b> <b>-${formatUsdPrimary(orderData.discount, orderData.currency, { lang, rate: orderDisplayRate(orderData) })}</b>`
            : "");
    const missingLine = missing > 0
        ? `\n\n${ic("STATUS_WARNING", "⚠️")} Ví thiếu <b>${formatCurrency(missing)}</b> — nạp thêm hoặc thanh toán QR.`
        : "";

    // Flash sale được trừ THẲNG vào đơn giá, nên "Tạm tính" ở trên ĐÃ là số sau giảm.
    // Vì vậy dòng này chỉ là NHÃN giải thích, không phải một khoản trừ thứ hai — hiện
    // nó như một khoản giảm nữa là khách nhẩm ra một số tiền khác số bot sắp thu.
    const flashLine = Number(orderData.flashPct) > 0
        ? `\n${flashBadge({ pct: orderData.flashPct, expiresAt: orderData.flashExpiresAt, lang })}`
        : "";

    if (lang) {
        const localizedMissing = missing > 0
            ? `\n\n${ic("STATUS_WARNING", "⚠️")} ${msgLabel(lang, "walletMissing").replace("{amount}", formatUsdPrimary(missing, "VND", { lang, rate: liveUsdVndRate() }))}`
            : "";
        const walletOnlyLine = orderData.requiresWalletTopup
            ? (lang === "en"
                ? `\n\n${ic("STATUS_WARNING", "⚠️")} USD-priced products: Please top up via Binance ID, then pay from wallet balance.`
                : lang === "zh"
                    ? `\n\n${ic("STATUS_WARNING", "⚠️")} USD 商品：请先通过币安 ID 充值钱包，再用余额支付。`
                    : `\n\n${ic("STATUS_WARNING", "⚠️")} Sản phẩm giá USD: Quý khách vui lòng nạp ví bằng Binance ID rồi bấm 'Trừ ví'.`)
            : "";
        return `${ic("LIST_PRODUCTS", "🛒")} <b>${msgLabel(lang, "checkoutTitle")}</b>
${DIVIDER}
${ic("ORDER_PRODUCT", "📦")} <b>${escapeHtml(orderData.productName)}</b>
${ic("ORDER_QTY", "🔢")} ${msgLabel(lang, "quantity")}: <b>${orderData.quantity}</b>
${ic("ORDER_TOTAL", "💰")} ${msgLabel(lang, "subtotal")}: <b>${formatUsdPrimary(orderData.amount, orderData.currency, { lang, rate: orderDisplayRate(orderData) })}</b>${flashLine}${discountLine}
${DIVIDER}
${ic("ORDER_PAYMENT", "💳")} ${msgLabel(lang, "amountDue")}: <b>${formatUsdPrimary(orderData.finalAmount, orderData.currency, { lang, rate: orderDisplayRate(orderData) })}</b>
${ic("ORDER_WALLET", "👛")} ${msgLabel(lang, "walletBalance")}: <b>${formatUsdPrimary(balance, "VND", { lang, rate: liveUsdVndRate() })}</b>
${ic("EXCHANGE_RATE", "💱")} ${formatRateHint(lang)}${localizedMissing}${walletOnlyLine}

${ic("PROMPT_CHOOSE", "👇")} ${msgLabel(lang, "choosePayment")}`;
    }

    return `${ic("LIST_PRODUCTS", "🛒")} <b>XÁC NHẬN THANH TOÁN</b>
${DIVIDER}
${ic("ORDER_PRODUCT", "📦")} <b>${escapeHtml(orderData.productName)}</b>
${ic("ORDER_QTY", "🔢")} Số lượng: <b>${orderData.quantity}</b>
${ic("ORDER_TOTAL", "💰")} Tạm tính: <b>${formatCurrency(orderData.amount, orderData.currency)}</b>${flashLine}${discountLine}
${DIVIDER}
${ic("ORDER_PAYMENT", "💳")} Cần thanh toán: <b>${formatCurrency(orderData.finalAmount, orderData.currency)}</b>
${ic("ORDER_WALLET", "👛")} Số dư ví: <b>${formatCurrency(balance)}</b>${missingLine}

${ic("PROMPT_CHOOSE", "👇")} Chọn phương thức thanh toán`;
}

export function orderSuccessMessage({ order, orderData, balance = null, method = "wallet" } = {}) {

    const lang = orderData.lang || "vi";
    const balanceLine = balance == null ? "" : `\n${ic("ORDER_WALLET", "👛")} Số dư còn lại: <b>${formatUsdPrimary(balance, "VND", { lang, rate: liveUsdVndRate() })}</b>`;
    const methodLabel = method === "wallet" ? "Ví nội bộ" : "Chuyển khoản QR";
    // Biên nhận phải nói rõ khách được giá flash sale — đây là bằng chứng họ sẽ giữ
    // lại để đối chiếu nếu sau này thấy giá đã về mức cũ.
    const flashLine = Number(orderData.flashPct) > 0
        ? `\n${flashBadge({ pct: orderData.flashPct, expiresAt: orderData.flashExpiresAt, lang })}`
        : "";

    return `${ic("STATUS_SUCCESS", "✅")} <b>ĐẶT HÀNG THÀNH CÔNG</b>
${DIVIDER}
${ic("ORDER_ID", "🆔")} <code>${escapeHtml(order.id.slice(-8).toUpperCase())}</code>
${ic("ORDER_PRODUCT", "📦")} <b>${escapeHtml(orderData.productName)}</b>
${ic("ORDER_TOTAL", "💰")} <b>${formatUsdPrimary(orderData.finalAmount, orderData.currency, { lang, rate: orderDisplayRate(orderData) })}</b>  ·  ${ic("ORDER_PAYMENT", "💳")} ${methodLabel}${flashLine}
${statusLabel(order.status)}${balanceLine}

${ic("AUTO_DELIVERY", "⚙️")} Hệ thống đang xử lý giao hàng tự động.`;
}

export function ordersMessage(orders = [], { lang = "vi" } = {}) {
    if (lang && !orders.length) {
        return `${ic("ORDER_PRODUCT", "📦")} <b>${msgLabel(lang, "orderListTitle")}</b>
${DIVIDER}
${msgLabel(lang, "noOrders")}

${msgLabel(lang, "buyPrompt")}`;
    }

    if (!orders.length) {
        return `${ic("ORDER_PRODUCT", "📦")} <b>ĐƠN HÀNG CỦA BẠN</b>
${DIVIDER}
Bạn chưa có đơn hàng nào.

Bấm <b>Mua hàng</b> để xem danh mục sản phẩm.`;
    }

    const lines = orders.map((order, index) => {
        const name = truncateText(order.product?.name || "Sản phẩm", 30);
        return `<b>${index + 1}.</b> <code>${escapeHtml(order.id.slice(-8).toUpperCase())}</code>  ${statusLabel(order.status)}
└ ${escapeHtml(name)}  ·  <b>${formatUsdPrimary(order.finalAmount, order.currency, { lang, rate: orderDisplayRate(order) })}</b>`;
    });

    if (lang) {
        return `${ic("ORDER_PRODUCT", "📦")} <b>${msgLabel(lang, "orderListTitle")}</b>
${DIVIDER}
${lines.join("\n\n")}`;
    }

    return `${ic("ORDER_PRODUCT", "📦")} <b>ĐƠN HÀNG CỦA BẠN</b>
${DIVIDER}
${lines.join("\n\n")}`;
}

export function orderDetailMessage(order, { lang = "vi" } = {}) {
    if (lang) {
        const pendingLine = order.status === "PENDING"
            ? `\n\n⏳ ${msgLabel(lang, "pendingOrder")}`
            : "";
        const delivery = order.status === "DELIVERED" && order.deliveryContent
            ? `\n${DIVIDER}\n${ic("ORDER_DELIVERY", "📬")} <b>${msgLabel(lang, "deliveryInfo")}</b>\n${formatDeliveryInline(order.deliveryContent)}`
            : pendingLine;

        return `${ic("MY_ORDERS", "📋")} <b>${msgLabel(lang, "orderDetailTitle")}</b>
${DIVIDER}
${ic("ORDER_ID", "🆔")} <code>${escapeHtml(order.id.slice(-8).toUpperCase())}</code>  ·  ${statusLabel(order.status)}
${ic("ORDER_PRODUCT", "📦")} <b>${escapeHtml(order.product?.name || "Product")}</b>
${ic("ORDER_QTY", "🔢")} x${order.quantity}  ·  ${ic("ORDER_TOTAL", "💰")} <b>${formatUsdPrimary(order.finalAmount, order.currency, { lang, rate: orderDisplayRate(order) })}</b>
${ic("ORDER_PAYMENT", "💳")} ${escapeHtml(order.paymentMethod || msgLabel(lang, "notSelected"))}  ·  ${ic("ORDER_TIME", "🕐")} ${formatDateTime(order.createdAt)}${delivery}`;
    }

    const pendingLine = order.status === "PENDING"
        ? `\n\n⏳ Đơn chờ xác nhận. Nếu đã chuyển khoản, bấm <b>Làm mới</b> sau ít phút.`
        : "";
    const delivery = order.status === "DELIVERED" && order.deliveryContent
        ? `\n${DIVIDER}\n${ic("ORDER_DELIVERY", "📬")} <b>Thông tin giao hàng</b>\n${formatDeliveryInline(order.deliveryContent)}`
        : pendingLine;

    return `${ic("MY_ORDERS", "📋")} <b>CHI TIẾT ĐƠN HÀNG</b>
${DIVIDER}
${ic("ORDER_ID", "🆔")} <code>${escapeHtml(order.id.slice(-8).toUpperCase())}</code>  ·  ${statusLabel(order.status)}
${ic("ORDER_PRODUCT", "📦")} <b>${escapeHtml(order.product?.name || "Sản phẩm")}</b>
${ic("ORDER_QTY", "🔢")} x${order.quantity}  ·  ${ic("ORDER_TOTAL", "💰")} <b>${formatCurrency(order.finalAmount, order.currency)}</b>
${ic("ORDER_PAYMENT", "💳")} ${escapeHtml(order.paymentMethod || "Chưa chọn")}  ·  ${ic("ORDER_TIME", "🕐")} ${formatDateTime(order.createdAt)}${delivery}`;
}

export function accountMessage({ ctx, balance = 0, orderCount = 0, totalSpent = 0, lang = "vi" } = {}) {
    if (lang) {
        const displayName = [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(" ") || ctx.from?.username || "Customer";
        return `<b>${msgLabel(lang, "account")}</b>
${DIVIDER}
${valueLine("Telegram ID", `<code>${escapeHtml(String(ctx.from.id))}</code>`)}
${valueLine(msgLabel(lang, "name"), `<b>${escapeHtml(displayName)}</b>`)}
${valueLine(msgLabel(lang, "walletBalance"), `<b>${formatUsdPrimary(balance, "VND", { lang, rate: liveUsdVndRate() })}</b>`)}
${valueLine(msgLabel(lang, "totalOrders"), `<b>${orderCount}</b>`)}
${valueLine(msgLabel(lang, "totalSpent"), `<b>${formatUsdPrimary(totalSpent, "VND", { lang, rate: liveUsdVndRate() })}</b>`)}`;
    }
    const displayName = [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(" ") || ctx.from?.username || "Khách hàng";

    return `<b>Tài khoản</b>
${DIVIDER}
${valueLine("Telegram ID", `<code>${escapeHtml(String(ctx.from.id))}</code>`)}
${valueLine("Tên", `<b>${escapeHtml(displayName)}</b>`)}
${valueLine("Số dư ví", `<b>${formatCurrency(balance)}</b>`)}
${valueLine("Tổng đơn", `<b>${orderCount}</b>`)}
${valueLine("Đã chi tiêu", `<b>${formatCurrency(totalSpent)}</b>`)}`;
}

export function supportMessage(adminUsername, { lang = "vi" } = {}) {
    if (lang) {
        return `<b>${msgLabel(lang, "supportTitle")}</b>
${DIVIDER}
${msgLabel(lang, "supportIntro")}

${valueLine("Admin", `<b>@${escapeHtml(adminUsername || "admin")}</b>`)}

${msgLabel(lang, "supportNote")}`;
    }
    return `<b>Hỗ trợ khách hàng</b>
${DIVIDER}
Cần hỗ trợ thanh toán, đơn hàng hoặc sản phẩm?

${valueLine("Admin", `<b>@${escapeHtml(adminUsername || "admin")}</b>`)}

Khi liên hệ, hãy gửi kèm mã đơn nếu bạn đã đặt hàng.`;
}

export function walletMessage(balance = 0, { lang = "vi" } = {}) {
    if (lang) {
        const intro = lang === "en"
            ? "USD is the main shop currency. Choose a top-up method below; VND/CNY are shown as equivalents for easier transfers."
            : lang === "zh"
                ? "店铺以 USD 为主币种。请选择下方充值方式，VND/CNY 仅作为等值参考，方便转账。"
                : "USD là đơn vị chính của shop. Chọn phương thức nạp bên dưới; VND/CNY chỉ là quy đổi tương đương để chuyển khoản dễ hơn.";
        return `<b>${msgLabel(lang, "walletTitle")}</b>
${DIVIDER}
${valueLine(msgLabel(lang, "currentBalance"), `<b>${formatUsdPrimary(balance, "VND", { lang, rate: liveUsdVndRate() })}</b>`)}
${valueLine("Rate", `<b>${formatRateHint(lang)}</b>`)}

${intro}`;
    }
    return `<b>Ví của bạn</b>
${DIVIDER}
${valueLine("Số dư hiện tại", `<b>${formatCurrency(balance)}</b>`)}

Chọn mệnh giá nạp hoặc nhập số tiền khác. Chuyển đúng số tiền và đúng nội dung để hệ thống cộng ví tự động.`;
}

export function searchPromptMessage() {
    return `<b>Tìm sản phẩm</b>
${DIVIDER}
Tìm kiếm bằng từ khóa chưa được bật trong bot.

Bạn có thể xem toàn bộ sản phẩm theo danh mục.`;
}

export function adminPanelMessage({ todayRevenue = 0, todayOrders = 0, newUsers = 0 } = {}) {
    return `<b>Admin Panel</b>
${DIVIDER}
${valueLine("Doanh thu hôm nay", `<b>${formatCurrency(todayRevenue)}</b>`)}
${valueLine("Đơn hàng hôm nay", `<b>${todayOrders}</b>`)}
${valueLine("Người dùng mới", `<b>${newUsers}</b>`)}

Chọn khu vực cần quản lý.`;
}
