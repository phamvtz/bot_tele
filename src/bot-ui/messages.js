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

function valueLine(label, value) {
    return `<b>${label}</b>: ${value}`;
}

function productName(product) {
    return escapeHtml(product?.name || "Sản phẩm");
}

export function mainMenuMessage({ firstName = "bạn", balance = 0, productCount = 0 } = {}) {
    const greetingTemplate = getWelcomeGreetingSync() ?? DEFAULT_WELCOME_GREETING;
    const greeting = greetingTemplate.replace(/\{name\}/g, escapeHtml(firstName));
    return `<b>${escapeHtml(getShopName())}</b>
${DIVIDER}
${greeting}

${valueLine("Ví", `<b>${formatCurrency(balance)}</b>`)}
${valueLine("Sản phẩm đang bán", `<b>${productCount}</b>`)}

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

export function checkoutMessage({ orderData, balance = 0, missing = 0 } = {}) {
    const discountLine = orderData.discount > 0
        ? `\n💸 <b>Giảm giá:</b> <b>-${formatCurrency(orderData.discount, orderData.currency)}</b>`
        : "";
    const missingLine = missing > 0
        ? `\n\n⚠️ Ví thiếu <b>${formatCurrency(missing)}</b> — nạp thêm hoặc thanh toán QR.`
        : "";

    return `🛒 <b>XÁC NHẬN THANH TOÁN</b>
${DIVIDER}
📦 <b>${escapeHtml(orderData.productName)}</b>
🔢 Số lượng: <b>${orderData.quantity}</b>
💰 Tạm tính: <b>${formatCurrency(orderData.amount, orderData.currency)}</b>${discountLine}
${DIVIDER}
💳 Cần thanh toán: <b>${formatCurrency(orderData.finalAmount, orderData.currency)}</b>
👛 Số dư ví: <b>${formatCurrency(balance)}</b>${missingLine}

👇 Chọn phương thức thanh toán`;
}

export function orderSuccessMessage({ order, orderData, balance = null, method = "wallet" } = {}) {
    const balanceLine = balance == null ? "" : `\n👛 Số dư còn lại: <b>${formatCurrency(balance)}</b>`;
    const methodLabel = method === "wallet" ? "Ví nội bộ" : "Chuyển khoản QR";

    return `✅ <b>ĐẶT HÀNG THÀNH CÔNG</b>
${DIVIDER}
🆔 <code>${escapeHtml(order.id.slice(-8).toUpperCase())}</code>
📦 <b>${escapeHtml(orderData.productName)}</b>
💰 <b>${formatCurrency(orderData.finalAmount, orderData.currency)}</b>  ·  💳 ${methodLabel}
${statusLabel(order.status)}${balanceLine}

⚙️ Hệ thống đang xử lý giao hàng tự động.`;
}

export function ordersMessage(orders = []) {
    if (!orders.length) {
        return `📦 <b>ĐƠN HÀNG CỦA BẠN</b>
${DIVIDER}
Bạn chưa có đơn hàng nào.

Bấm <b>Mua hàng</b> để xem danh mục sản phẩm.`;
    }

    const lines = orders.map((order, index) => {
        const name = truncateText(order.product?.name || "Sản phẩm", 30);
        return `<b>${index + 1}.</b> <code>${escapeHtml(order.id.slice(-8).toUpperCase())}</code>  ${statusLabel(order.status)}
└ ${escapeHtml(name)}  ·  <b>${formatCurrency(order.finalAmount, order.currency)}</b>`;
    });

    return `📦 <b>ĐƠN HÀNG CỦA BẠN</b>
${DIVIDER}
${lines.join("\n\n")}`;
}

export function orderDetailMessage(order) {
    const pendingLine = order.status === "PENDING"
        ? `\n\n⏳ Đơn chờ xác nhận. Nếu đã chuyển khoản, bấm <b>Làm mới</b> sau ít phút.`
        : "";
    const delivery = order.status === "DELIVERED" && order.deliveryContent
        ? `\n${DIVIDER}\n📬 <b>Thông tin giao hàng</b>\n<code>${escapeHtml(order.deliveryContent.slice(0, 3200))}</code>`
        : pendingLine;

    return `📋 <b>CHI TIẾT ĐƠN HÀNG</b>
${DIVIDER}
🆔 <code>${escapeHtml(order.id.slice(-8).toUpperCase())}</code>  ·  ${statusLabel(order.status)}
📦 <b>${escapeHtml(order.product?.name || "Sản phẩm")}</b>
🔢 x${order.quantity}  ·  💰 <b>${formatCurrency(order.finalAmount, order.currency)}</b>
💳 ${escapeHtml(order.paymentMethod || "Chưa chọn")}  ·  🕐 ${formatDateTime(order.createdAt)}${delivery}`;
}

export function accountMessage({ ctx, balance = 0, orderCount = 0, totalSpent = 0 } = {}) {
    const displayName = [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(" ") || ctx.from?.username || "Khách hàng";

    return `<b>Tài khoản</b>
${DIVIDER}
${valueLine("Telegram ID", `<code>${escapeHtml(String(ctx.from.id))}</code>`)}
${valueLine("Tên", `<b>${escapeHtml(displayName)}</b>`)}
${valueLine("Số dư ví", `<b>${formatCurrency(balance)}</b>`)}
${valueLine("Tổng đơn", `<b>${orderCount}</b>`)}
${valueLine("Đã chi tiêu", `<b>${formatCurrency(totalSpent)}</b>`)}`;
}

export function supportMessage(adminUsername) {
    return `<b>Hỗ trợ khách hàng</b>
${DIVIDER}
Cần hỗ trợ thanh toán, đơn hàng hoặc sản phẩm?

${valueLine("Admin", `<b>@${escapeHtml(adminUsername || "admin")}</b>`)}

Khi liên hệ, hãy gửi kèm mã đơn nếu bạn đã đặt hàng.`;
}

export function walletMessage(balance = 0) {
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
