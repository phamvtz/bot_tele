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
import { getWelcomeGreetingSync, DEFAULT_WELCOME_GREETING, DEFAULT_WELCOME_SUBTITLE, getProductDisplaySettingsSync, getMenuIconsSync, getMenuIconIdsSync } from "../menu-config.js";

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

export function mainMenuMessage({ firstName = "bạn", balance = 0, productCount = 0, memberCount = null, vipEmoji = "👤", vipName = "Thường", totalSpent = 0, nextLevelName = null, nextLevelMinSpent = 0, lang = "vi" } = {}) {
    const greetingTemplate = getWelcomeGreetingSync() ?? DEFAULT_WELCOME_GREETING;
    const greeting = greetingTemplate.replace(/\{name\}/g, escapeHtml(firstName));
    if (lang) {
        const localizedVipProgress = nextLevelName
            ? ` · ${formatCurrency(totalSpent)} / ${formatCurrency(nextLevelMinSpent)} → ${nextLevelName}`
            : ` · Max 🏆`;
        const localizedMemberLine = memberCount != null
            ? `\n${valueLine(msgLabel(lang, "members"), `<b>${memberCount.toLocaleString("vi-VN")}</b>`)}`
            : "";
        return `<b>${escapeHtml(getShopName())}</b>
${DIVIDER}
${greeting}

${valueLine(msgLabel(lang, "wallet"), `<b>${formatCurrency(balance)}</b>`)}
${valueLine(msgLabel(lang, "productsOnSale"), `<b>${productCount}</b>`)}\
${localizedMemberLine}
${valueLine("VIP", `<b>${vipEmoji} ${vipName}</b>${localizedVipProgress}`)}

${DEFAULT_WELCOME_SUBTITLE}`;
    }
    const vipProgress = nextLevelName
        ? ` · ${formatCurrency(totalSpent)} / ${formatCurrency(nextLevelMinSpent)} → ${nextLevelName}`
        : ` · Max 🏆`;
    const memberLine = memberCount != null ? `\n${valueLine("Thành viên", `<b>${memberCount.toLocaleString("vi-VN")}</b>`)}` : "";
    return `<b>${escapeHtml(getShopName())}</b>
${DIVIDER}
${greeting}

${valueLine("Ví", `<b>${formatCurrency(balance)}</b>`)}
${valueLine("Sản phẩm đang bán", `<b>${productCount}</b>`)}\
${memberLine}
${valueLine("VIP", `<b>${vipEmoji} ${vipName}</b>${vipProgress}`)}

${DEFAULT_WELCOME_SUBTITLE}`;
}

export function categoriesMessage({ total = 0, productTotal = 0 } = {}) {
    const productLine = productTotal > 0 ? `  ·  <b>${productTotal}</b> gói` : "";

    return `<b>🗂 Danh mục sản phẩm</b>
${DIVIDER}
📁 <b>${total}</b> danh mục${productLine}

👇 Chọn danh mục để xem gói đang mở bán`;
}

export function emptyCategoriesMessage() {
    return `<b>${escapeHtml(getShopName())}</b>
${DIVIDER}
Shop chưa có sản phẩm đang mở bán.

Bạn có thể quay lại sau hoặc liên hệ hỗ trợ để được tư vấn.`;
}

export function productsMessage({ category, products = [], total = 0, page = 1, totalPages = 1, stockById = new Map() } = {}) {
    const title = category
        ? `${renderTelegramEmoji(category.icon, category.iconEmojiId)} <b>${escapeHtml(category.name || "Sản phẩm")}</b>`
        : `<b>🛍 Sản phẩm</b>`;
    const hasStock = products.some((product) => product.deliveryMode === "STOCK_LINES");
    const totalStock = products.reduce((sum, product) => {
        return sum + (product.deliveryMode === "STOCK_LINES" ? (stockById.get(product.id) || 0) : 0);
    }, 0);
    const pageTag = totalPages > 1 ? `  ·  Trang <b>${page}/${totalPages}</b>` : "";
    const statsLine = hasStock
        ? `📦 Còn <b>${totalStock}</b> tài khoản${pageTag}`
        : `🛍 <b>${total}</b> gói đang mở bán${pageTag}`;

    return `${title}
${DIVIDER}
${statsLine}

👇 Chọn gói bên dưới để đặt hàng`;
}

export function emptyProductsMessage(category) {
    const title = category
        ? `${renderTelegramEmoji(category.icon, category.iconEmojiId)} <b>${escapeHtml(category.name || "Sản phẩm")}</b>`
        : `<b>Sản phẩm</b>`;

    return `${title}
${DIVIDER}
Danh mục này chưa có sản phẩm khả dụng.

Hãy quay lại danh mục khác hoặc thử lại sau.`;
}

export function productDetailMessage({ product, stockCount = null, soldCount = null } = {}) {
    const d = getProductDisplaySettingsSync();
    const icons = getMenuIconsSync();
    const iconIds = getMenuIconIdsSync();
    const ic = (key, fallback) => renderTelegramEmoji(icons[key] ?? fallback, iconIds[key] ?? null);

    const rawIcon = product?.icon;
    const cleanIcon = (rawIcon && rawIcon !== "🟢" && rawIcon !== "🔴") ? rawIcon : "📦";
    const iconPart = renderTelegramEmoji(cleanIcon, product?.iconEmojiId);
    const name = escapeHtml(product?.name || "Sản phẩm");

    const lines = [`${iconPart} <b>${name}</b>`];

    if (d.price) {
        const price = formatCurrency(product?.price || 0, product?.currency);
        lines.push(`${ic("FIELD_PRICE", "💰")} <b>Giá:</b> ${price}`);
    }

    if (d.stock) {
        let stockStr;
        if (product?.deliveryMode !== "STOCK_LINES") {
            stockStr = "Còn hàng";
        } else if (stockCount !== null && stockCount <= 0) {
            stockStr = "Hết hàng ❌";
        } else if (stockCount !== null) {
            stockStr = `${stockCount.toLocaleString("vi-VN")} tài khoản`;
        } else {
            stockStr = "Còn hàng";
        }
        lines.push(`${ic("FIELD_STOCK", "📦")} <b>Tồn kho:</b> ${stockStr}`);
    }

    if (d.sold) {
        lines.push(`${ic("FIELD_SOLD", "📊")} <b>Đã bán:</b> ${(soldCount ?? 0).toLocaleString("vi-VN")} tài khoản`);
    }

    if (d.description && product?.description) {
        const desc = truncateText(product.description, 400);
        lines.push(`${ic("FIELD_DESC", "💬")} <b>Mô tả:</b>\n<blockquote>${escapeHtml(desc)}</blockquote>`);
    }

    if (product?.note) {
        const note = truncateText(product.note, 250);
        lines.push(`${ic("FIELD_NOTE", "⚠️")} <b>Lưu ý:</b>\n${escapeHtml(note)}`);
    }

    return lines.join("\n");
}

export function contactProductMessage({ product, adminUsername } = {}) {
    const description = product?.description || "Gói này cần admin kiểm tra và báo giá trực tiếp.";

    return `<b>${productName(product)}</b>
${DIVIDER}
Gói này cần tư vấn trước khi đặt.

${escapeHtml(description)}

${valueLine("Liên hệ", `<b>@${escapeHtml(adminUsername || "admin")}</b>`)}`;
}

export function checkoutMessage({ orderData, balance = 0, missing = 0, lang = "vi" } = {}) {
    const icons = getMenuIconsSync();
    const iconIds = getMenuIconIdsSync();
    const ic = (key, fallback) => renderTelegramEmoji(icons[key] ?? fallback, iconIds[key] ?? null);

    const qtyDiscountLine = orderData.quantityDiscount > 0
        ? `\n${ic("ORDER_DISCOUNT", "💸")} <b>Giảm SL${orderData.quantityDiscountPercent ? ` (-${orderData.quantityDiscountPercent}%)` : ""}:</b> <b>-${formatCurrency(orderData.quantityDiscount, orderData.currency)}</b>`
        : "";
    const couponDiscountLine = orderData.couponDiscount > 0
        ? `\n${ic("ORDER_DISCOUNT", "🎟️")} <b>Coupon:</b> <b>-${formatCurrency(orderData.couponDiscount, orderData.currency)}</b>`
        : "";
    // Fallback: nếu không tách được, dùng tổng discount (đơn cũ)
    const discountLine = (qtyDiscountLine || couponDiscountLine)
        ? `${qtyDiscountLine}${couponDiscountLine}`
        : (orderData.discount > 0
            ? `\n${ic("ORDER_DISCOUNT", "💸")} <b>Giảm giá:</b> <b>-${formatCurrency(orderData.discount, orderData.currency)}</b>`
            : "");
    const missingLine = missing > 0
        ? `\n\n⚠️ Ví thiếu <b>${formatCurrency(missing)}</b> — nạp thêm hoặc thanh toán QR.`
        : "";

    if (lang) {
        const localizedMissing = missing > 0
            ? `\n\n⚠️ ${msgLabel(lang, "walletMissing").replace("{amount}", formatCurrency(missing))}`
            : "";
        return `🛒 <b>${msgLabel(lang, "checkoutTitle")}</b>
${DIVIDER}
${ic("ORDER_PRODUCT", "📦")} <b>${escapeHtml(orderData.productName)}</b>
${ic("ORDER_QTY", "🔢")} ${msgLabel(lang, "quantity")}: <b>${orderData.quantity}</b>
${ic("ORDER_TOTAL", "💰")} ${msgLabel(lang, "subtotal")}: <b>${formatCurrency(orderData.amount, orderData.currency)}</b>${discountLine}
${DIVIDER}
${ic("ORDER_PAYMENT", "💳")} ${msgLabel(lang, "amountDue")}: <b>${formatCurrency(orderData.finalAmount, orderData.currency)}</b>
${ic("ORDER_WALLET", "👛")} ${msgLabel(lang, "walletBalance")}: <b>${formatCurrency(balance)}</b>${localizedMissing}

👇 ${msgLabel(lang, "choosePayment")}`;
    }

    return `🛒 <b>XÁC NHẬN THANH TOÁN</b>
${DIVIDER}
${ic("ORDER_PRODUCT", "📦")} <b>${escapeHtml(orderData.productName)}</b>
${ic("ORDER_QTY", "🔢")} Số lượng: <b>${orderData.quantity}</b>
${ic("ORDER_TOTAL", "💰")} Tạm tính: <b>${formatCurrency(orderData.amount, orderData.currency)}</b>${discountLine}
${DIVIDER}
${ic("ORDER_PAYMENT", "💳")} Cần thanh toán: <b>${formatCurrency(orderData.finalAmount, orderData.currency)}</b>
${ic("ORDER_WALLET", "👛")} Số dư ví: <b>${formatCurrency(balance)}</b>${missingLine}

👇 Chọn phương thức thanh toán`;
}

export function orderSuccessMessage({ order, orderData, balance = null, method = "wallet" } = {}) {
    const icons = getMenuIconsSync();
    const iconIds = getMenuIconIdsSync();
    const ic = (key, fallback) => renderTelegramEmoji(icons[key] ?? fallback, iconIds[key] ?? null);

    const balanceLine = balance == null ? "" : `\n${ic("ORDER_WALLET", "👛")} Số dư còn lại: <b>${formatCurrency(balance)}</b>`;
    const methodLabel = method === "wallet" ? "Ví nội bộ" : "Chuyển khoản QR";

    return `✅ <b>ĐẶT HÀNG THÀNH CÔNG</b>
${DIVIDER}
${ic("ORDER_ID", "🆔")} <code>${escapeHtml(order.id.slice(-8).toUpperCase())}</code>
${ic("ORDER_PRODUCT", "📦")} <b>${escapeHtml(orderData.productName)}</b>
${ic("ORDER_TOTAL", "💰")} <b>${formatCurrency(orderData.finalAmount, orderData.currency)}</b>  ·  ${ic("ORDER_PAYMENT", "💳")} ${methodLabel}
${statusLabel(order.status)}${balanceLine}

⚙️ Hệ thống đang xử lý giao hàng tự động.`;
}

export function ordersMessage(orders = [], { lang = "vi" } = {}) {
    const icons = getMenuIconsSync();
    const iconIds = getMenuIconIdsSync();
    const ic = (key, fallback) => renderTelegramEmoji(icons[key] ?? fallback, iconIds[key] ?? null);
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
└ ${escapeHtml(name)}  ·  <b>${formatCurrency(order.finalAmount, order.currency)}</b>`;
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
    const icons = getMenuIconsSync();
    const iconIds = getMenuIconIdsSync();
    const ic = (key, fallback) => renderTelegramEmoji(icons[key] ?? fallback, iconIds[key] ?? null);
    if (lang) {
        const pendingLine = order.status === "PENDING"
            ? `\n\n⏳ ${msgLabel(lang, "pendingOrder")}`
            : "";
        const delivery = order.status === "DELIVERED" && order.deliveryContent
            ? `\n${DIVIDER}\n${ic("ORDER_DELIVERY", "📬")} <b>${msgLabel(lang, "deliveryInfo")}</b>\n${formatDeliveryInline(order.deliveryContent)}`
            : pendingLine;

        return `📋 <b>${msgLabel(lang, "orderDetailTitle")}</b>
${DIVIDER}
${ic("ORDER_ID", "🆔")} <code>${escapeHtml(order.id.slice(-8).toUpperCase())}</code>  ·  ${statusLabel(order.status)}
${ic("ORDER_PRODUCT", "📦")} <b>${escapeHtml(order.product?.name || "Product")}</b>
${ic("ORDER_QTY", "🔢")} x${order.quantity}  ·  ${ic("ORDER_TOTAL", "💰")} <b>${formatCurrency(order.finalAmount, order.currency)}</b>
${ic("ORDER_PAYMENT", "💳")} ${escapeHtml(order.paymentMethod || msgLabel(lang, "notSelected"))}  ·  ${ic("ORDER_TIME", "🕐")} ${formatDateTime(order.createdAt)}${delivery}`;
    }

    const pendingLine = order.status === "PENDING"
        ? `\n\n⏳ Đơn chờ xác nhận. Nếu đã chuyển khoản, bấm <b>Làm mới</b> sau ít phút.`
        : "";
    const delivery = order.status === "DELIVERED" && order.deliveryContent
        ? `\n${DIVIDER}\n${ic("ORDER_DELIVERY", "📬")} <b>Thông tin giao hàng</b>\n${formatDeliveryInline(order.deliveryContent)}`
        : pendingLine;

    return `📋 <b>CHI TIẾT ĐƠN HÀNG</b>
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
${valueLine(msgLabel(lang, "walletBalance"), `<b>${formatCurrency(balance)}</b>`)}
${valueLine(msgLabel(lang, "totalOrders"), `<b>${orderCount}</b>`)}
${valueLine(msgLabel(lang, "totalSpent"), `<b>${formatCurrency(totalSpent)}</b>`)}`;
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
        return `<b>${msgLabel(lang, "walletTitle")}</b>
${DIVIDER}
${valueLine(msgLabel(lang, "currentBalance"), `<b>${formatCurrency(balance)}</b>`)}

${msgLabel(lang, "walletIntro")}`;
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
