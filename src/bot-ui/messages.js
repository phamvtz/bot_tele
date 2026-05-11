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

export function mainMenuMessage({ firstName = "bạn", balance = 0, productCount = 0 } = {}) {
    return `🏪 <b>${escapeHtml(getShopName())}</b>
${DIVIDER}
👋 Xin chào <b>${escapeHtml(firstName)}</b>!

💳 Số dư ví: <b>${formatCurrency(balance)}</b>
🛒 Đang bán: <b>${productCount} sản phẩm</b>
${DIVIDER}
<i>Chọn chức năng bên dưới để bắt đầu ↓</i>`;
}

export function categoriesMessage({ total = 0 } = {}) {
    return `🛒 <b>${escapeHtml(getShopName())}</b>
${DIVIDER}
📦 <b>Loại hàng đang bán:</b>
• 🔑 <b>[Code]</b>
  ↳ Mã kích hoạt
• 👤 <b>[Account]</b>
  ↳ Tài khoản + mật khẩu + 2FA (Tùy chọn)
• 💬 <b>[Support]</b>
  ↳ Hỗ trợ liên hệ

Chọn một danh mục để xem gói 👇`;
}

export function emptyCategoriesMessage() {
    return `🛒 <b>${escapeHtml(getShopName())}</b>
${DIVIDER}
Hiện shop chưa có sản phẩm đang mở bán.
Vui lòng quay lại sau hoặc liên hệ hỗ trợ.`;
}

export function productsMessage({ category, products = [], total = 0, page = 1, totalPages = 1, stockById = new Map(), emojiById = new Map() } = {}) {
    const categoryTitle = category
        ? `${renderTelegramEmoji(category.icon, category.iconEmojiId)} <b>${escapeHtml(category.name || "Sản phẩm")}</b>`
        : `<b>Sản phẩm</b>`;

    const hasStock = products.some(p => p.deliveryMode === "STOCK_LINES");
    const totalStock = products.reduce((sum, p) => {
        return sum + (p.deliveryMode === "STOCK_LINES" ? (stockById.get(p.id) || 0) : 0);
    }, 0);

    const stockLine = hasStock
        ? `📊 Tổng kho: <b>${totalStock} sản phẩm</b>`
        : `📊 Tổng: <b>${total} gói</b>`;
    const pageInfo = totalPages > 1 ? ` · Trang ${page}/${totalPages}` : "";

    return `${categoryTitle}
${DIVIDER}
${stockLine}${pageInfo}

Chọn gói bên dưới 👇`;
}

export function emptyProductsMessage(category) {
    const categoryTitle = category
        ? `${renderTelegramEmoji(category.icon, category.iconEmojiId)} <b>${escapeHtml(category.name || "Sản phẩm")}</b>`
        : `<b>Sản phẩm</b>`;

    return `${categoryTitle}
${DIVIDER}
Danh mục này chưa có sản phẩm.
Hãy chọn danh mục khác hoặc quay lại sau.`;
}

export function productDetailMessage({ product, quantity = 1, stockCount = null, soldCount = null } = {}) {
    const description = product?.description
        ? truncateText(product.description, 400)
        : null;
    const stockStatus = stockLabel(product, stockCount);
    const soldLine = soldCount > 0 ? `\n🔥 Đã bán: <b>${soldCount}</b>` : "";
    const descLine = description ? `\n\n<i>${escapeHtml(description)}</i>` : "";

    return `🧾 <b>${escapeHtml(product.name)}</b>
${DIVIDER}
💰 Giá: <b>${formatCurrency(product.price, product.currency)}</b>
📦 Tình trạng: <b>${escapeHtml(stockStatus)}</b>${soldLine}
🔢 Số lượng: <b>${quantity}</b>${descLine}
${DIVIDER}
<i>Điều chỉnh số lượng và bấm ⚡ Mua ngay ↓</i>`;
}

export function contactProductMessage({ product, adminUsername } = {}) {
    return `🧾 <b>${escapeHtml(product.name)}</b>
${DIVIDER}
💬 Sản phẩm này cần liên hệ admin để tư vấn và báo giá.

${escapeHtml(product.description || "Bấm nút bên dưới để chat trực tiếp với admin.")}
${DIVIDER}
👨‍💻 Admin: <b>@${escapeHtml(adminUsername || "admin")}</b>`;
}

export function checkoutMessage({ orderData, balance = 0, missing = 0 } = {}) {
    const discountLine = orderData.discount > 0
        ? `\n🎟️ Giảm giá: <b>-${formatCurrency(orderData.discount, orderData.currency)}</b>` : "";
    const missingLine = missing > 0
        ? `\n\n⚠️ Ví thiếu <b>${formatCurrency(missing)}</b> — nạp thêm hoặc chọn chuyển khoản MB.` : "";

    return `🛍️ <b>Chọn cách thanh toán</b>
${DIVIDER}
🗒️ Chi tiết đơn
📦 Sản phẩm: <b>${escapeHtml(orderData.productName)}</b>
🎁 Gói: <b>${escapeHtml(orderData.productName)}</b>
🔢 Số lượng: <b>${orderData.quantity}</b>
💵 Đơn giá: <b>${formatCurrency(orderData.amount, orderData.currency)}</b>${discountLine}
${DIVIDER}
💳 Tổng thanh toán: <b>${formatCurrency(orderData.finalAmount, orderData.currency)}</b>
💰 Số dư: <b>${formatCurrency(balance)}</b>${missingLine}

• Ví: trừ số dư (nhanh, không cần CK).
• MB: chuyển khoản QR tự động.`;
}

export function orderSuccessMessage({ order, orderData, balance = null, method = "wallet" } = {}) {
    const balanceLine = balance == null ? "" : `\n💰 Số dư còn lại: <b>${formatCurrency(balance)}</b>`;
    const methodIcon = method === "wallet" ? "💳 Ví nội bộ" : "🏦 Chuyển khoản";

    return `✅ <b>Đặt hàng thành công!</b>
${DIVIDER}
🧾 Mã đơn: <code>${escapeHtml(order.id.slice(-8).toUpperCase())}</code>
📦 Sản phẩm: <b>${escapeHtml(orderData.productName)}</b>
💵 Tổng tiền: <b>${formatCurrency(orderData.finalAmount, orderData.currency)}</b>
💳 Thanh toán: <b>${methodIcon}</b>
📌 Trạng thái: <b>${statusLabel(order.status)}</b>${balanceLine}
${DIVIDER}
<i>🚀 Hệ thống đang xử lý giao hàng tự động...</i>`;
}

export function ordersMessage(orders = []) {
    if (!orders.length) {
        return `📦 <b>Đơn hàng của bạn</b>
${DIVIDER}
Bạn chưa có đơn hàng nào.
Bấm <b>🛍️ Sản Phẩm</b> để mua hàng nhé!`;
    }

    const lines = orders.map((order, i) => {
        const name = truncateText(order.product?.name || "Sản phẩm", 30);
        return `<b>${i + 1}.</b> <code>${escapeHtml(order.id.slice(-8).toUpperCase())}</code> ${statusLabel(order.status)}\n   📦 ${escapeHtml(name)} · <b>${formatCurrency(order.finalAmount, order.currency)}</b>`;
    });

    return `📦 <b>Đơn hàng của bạn</b>
${DIVIDER}
${lines.join("\n\n")}`;
}

export function orderDetailMessage(order) {
    const pendingLine = order.status === "PENDING"
        ? `\n\n⏳ <i>Đang chờ xác nhận thanh toán...</i>` : "";
    const delivery = order.status === "DELIVERED" && order.deliveryContent
        ? `\n${DIVIDER}\n🔐 <b>Thông tin sản phẩm:</b>\n<code>${escapeHtml(order.deliveryContent.slice(0, 3200))}</code>`
        : pendingLine;

    return `📦 <b>Chi tiết đơn hàng</b>
${DIVIDER}
🧾 Mã đơn: <code>${escapeHtml(order.id.slice(-8).toUpperCase())}</code>
📌 Trạng thái: <b>${statusLabel(order.status)}</b>
📦 Sản phẩm: <b>${escapeHtml(order.product?.name || "Sản phẩm")}</b>
🔢 Số lượng: <b>${order.quantity}</b>
💵 Tổng tiền: <b>${formatCurrency(order.finalAmount, order.currency)}</b>
💳 Thanh toán: <b>${escapeHtml(order.paymentMethod || "Chưa chọn")}</b>
🕒 Thời gian: ${formatDateTime(order.createdAt)}${delivery}`;
}

export function accountMessage({ ctx, balance = 0, orderCount = 0, totalSpent = 0 } = {}) {
    const displayName = [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(" ") || ctx.from?.username || "Khách hàng";

    return `👤 <b>Tài khoản của bạn</b>
${DIVIDER}
🆔 Telegram ID: <code>${escapeHtml(String(ctx.from.id))}</code>
👤 Tên: <b>${escapeHtml(displayName)}</b>
${DIVIDER}
💳 Số dư ví: <b>${formatCurrency(balance)}</b>
📦 Tổng đơn hàng: <b>${orderCount}</b>
💸 Đã chi tiêu: <b>${formatCurrency(totalSpent)}</b>`;
}

export function supportMessage(adminUsername) {
    return `🆘 <b>Hỗ trợ khách hàng</b>
${DIVIDER}
Gặp vấn đề? Chúng tôi luôn sẵn sàng hỗ trợ!

👨‍💻 Admin: <b>@${escapeHtml(adminUsername || "admin")}</b>

<i>Khi liên hệ, vui lòng cung cấp mã đơn hàng nếu có.</i>`;
}

export function walletMessage(balance = 0) {
    return `💳 <b>Nạp tiền vào ví</b>
${DIVIDER}
💰 Số dư hiện tại: <b>${formatCurrency(balance)}</b>
${DIVIDER}
Chọn mệnh giá hoặc nhập số tuỳ chỉnh.
Sau khi CK <b>đúng nội dung</b>, ví tự động cộng tiền.`;
}

export function searchPromptMessage() {
    return `🔎 <b>Tìm sản phẩm</b>
${DIVIDER}
Hiện bot chưa bật tìm kiếm bằng từ khóa.
Vào danh mục để xem toàn bộ sản phẩm đang bán.`;
}

export function adminPanelMessage({ todayRevenue = 0, todayOrders = 0, newUsers = 0 } = {}) {
    return `🛠️ <b>Admin Panel</b>
${DIVIDER}
📅 Hôm nay:
💰 Doanh thu: <b>${formatCurrency(todayRevenue)}</b>
📦 Đơn hàng: <b>${todayOrders}</b>
👥 Người dùng mới: <b>${newUsers}</b>
${DIVIDER}
Chọn khu vực cần quản lý ↓`;
}
