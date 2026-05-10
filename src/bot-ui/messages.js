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
    return `🛍️ <b>${escapeHtml(getShopName())}</b>

Chào mừng <b>${escapeHtml(firstName)}</b> đến với hệ thống mua hàng tự động.
Sản phẩm luôn được cập nhật, thao tác nhanh, giao hàng tự động sau khi thanh toán.

${DIVIDER}
🔥 Sản phẩm nổi bật: <b>${productCount}</b>
⚡ Giao hàng tự động
🔐 Thanh toán an toàn
📦 Quản lý đơn hàng dễ dàng

💳 Số dư ví: <b>${formatCurrency(balance)}</b>

Bạn muốn làm gì hôm nay?`;
}

export function categoriesMessage({ total = 0 } = {}) {
    return `📂 <b>Danh mục sản phẩm</b>

Chọn danh mục bạn muốn xem.
Bạn có thể quay lại menu chính bất cứ lúc nào.

${DIVIDER}
Hiện có <b>${total}</b> danh mục đang mở bán.`;
}

export function emptyCategoriesMessage() {
    return `📂 <b>Danh mục sản phẩm</b>

Hiện shop chưa có danh mục đang mở bán.
Vui lòng quay lại sau hoặc liên hệ hỗ trợ.`;
}

export function productsMessage({ category, products = [], total = 0, page = 1, totalPages = 1, stockById = new Map() } = {}) {
    const lines = products.map((product, index) => {
        const number = (page - 1) * products.length + index + 1;
        const stock = product.deliveryMode === "STOCK_LINES" ? stockById.get(product.id) || 0 : "Còn hàng";
        const stockText = product.deliveryMode === "STOCK_LINES" ? `Còn: ${stock}` : stock;
        return `${number}. <b>${escapeHtml(product.name)}</b>
💰 ${formatCurrency(product.price, product.currency)}
📦 ${escapeHtml(stockText)}`;
    });

    const categoryTitle = category
        ? `${renderTelegramEmoji(category.icon, category.iconEmojiId)} <b>${escapeHtml(category.name || "Sản phẩm")}</b>`
        : `<b>Sản phẩm</b>`;

    return `🛒 ${categoryTitle}

Tìm thấy <b>${total}</b> sản phẩm trong danh mục này.

${DIVIDER}
${lines.join("\n\n")}

Chọn sản phẩm bên dưới để xem chi tiết.
Trang ${page}/${totalPages}`;
}

export function emptyProductsMessage(category) {
    const categoryTitle = category
        ? `${renderTelegramEmoji(category.icon, category.iconEmojiId)} <b>${escapeHtml(category.name || "Sản phẩm")}</b>`
        : `<b>Sản phẩm</b>`;

    return `🛒 ${categoryTitle}

Chưa có sản phẩm nào trong danh mục này.
Hãy chọn danh mục khác hoặc quay lại sau.`;
}

export function productDetailMessage({ product, quantity = 1, stockCount = null, soldCount = null } = {}) {
    const description = product?.description
        ? truncateText(product.description, 520)
        : "Sản phẩm số, giao hàng tự động sau khi thanh toán thành công.";
    const stockStatus = stockLabel(product, stockCount);
    const soldLine = soldCount == null ? "" : `\n⭐ Đã bán: ${soldCount}`;

    return `🧾 <b>${escapeHtml(product.name)}</b>

💰 Giá: <b>${formatCurrency(product.price, product.currency)}</b>
📦 Tình trạng: <b>${escapeHtml(stockStatus)}</b>${soldLine}
🔢 Số lượng chọn: <b>${quantity}</b>

${DIVIDER}
${escapeHtml(description)}

Chọn số lượng và tiếp tục mua hàng.`;
}

export function contactProductMessage({ product, adminUsername } = {}) {
    return `🧾 <b>${escapeHtml(product.name)}</b>

💬 Sản phẩm này cần liên hệ admin để tư vấn và báo giá.

${DIVIDER}
${escapeHtml(product.description || "Bấm nút bên dưới để chat trực tiếp với admin.")}

Admin: <b>@${escapeHtml(adminUsername || "admin")}</b>`;
}

export function checkoutMessage({ orderData, balance = 0, missing = 0 } = {}) {
    return `✅ <b>Xác nhận đơn hàng</b>

${DIVIDER}
Sản phẩm: <b>${escapeHtml(orderData.productName)}</b>
Số lượng: <b>${orderData.quantity}</b>
Tạm tính: ${formatCurrency(orderData.amount, orderData.currency)}
Giảm giá: ${formatCurrency(orderData.discount || 0, orderData.currency)}
Tổng tiền: <b>${formatCurrency(orderData.finalAmount, orderData.currency)}</b>
Số dư ví: <b>${formatCurrency(balance)}</b>
${missing > 0 ? `Cần thêm: <b>${formatCurrency(missing)}</b>\n` : ""}Sau khi xác nhận, hệ thống sẽ tạo đơn hàng và hướng dẫn thanh toán.`;
}

export function orderSuccessMessage({ order, orderData, balance = null, method = "wallet" } = {}) {
    const balanceLine = balance == null ? "" : `\nSố dư còn lại: <b>${formatCurrency(balance)}</b>`;
    const methodText = method === "wallet" ? "Ví nội bộ" : "Chuyển khoản QR";

    return `🎉 <b>Đặt hàng thành công!</b>

Mã đơn: <code>${escapeHtml(order.id.slice(-8).toUpperCase())}</code>
Sản phẩm: <b>${escapeHtml(orderData.productName)}</b>
Tổng tiền: <b>${formatCurrency(orderData.finalAmount, orderData.currency)}</b>
Thanh toán: <b>${methodText}</b>
Trạng thái: <b>${statusLabel(order.status)}</b>${balanceLine}

Hệ thống đang xử lý giao hàng tự động.`;
}

export function ordersMessage(orders = []) {
    if (!orders.length) {
        return `📦 <b>Đơn hàng của bạn</b>

Bạn chưa có đơn hàng nào.
Hãy chọn sản phẩm để bắt đầu mua hàng.`;
    }

    const lines = orders.map((order, index) => `${index + 1}. <code>${escapeHtml(order.id.slice(-8).toUpperCase())}</code>
💰 ${formatCurrency(order.finalAmount, order.currency)}
📌 ${statusLabel(order.status)}
🕒 ${formatDateTime(order.createdAt)}
🧾 ${escapeHtml(order.product?.name || "Sản phẩm")}`);

    return `📦 <b>Đơn hàng của bạn</b>

${lines.join("\n\n")}`;
}

export function orderDetailMessage(order) {
    const delivery = order.status === "DELIVERED" && order.deliveryContent
        ? `\n\n🔐 <b>Thông tin sản phẩm:</b>\n<code>${escapeHtml(order.deliveryContent.slice(0, 3200))}</code>`
        : "";

    return `📦 <b>Chi tiết đơn hàng</b>

Mã đơn: <code>${escapeHtml(order.id.slice(-8).toUpperCase())}</code>
Trạng thái: <b>${statusLabel(order.status)}</b>
Tổng tiền: <b>${formatCurrency(order.finalAmount, order.currency)}</b>
Thời gian: ${formatDateTime(order.createdAt)}

${DIVIDER}
Sản phẩm: <b>${escapeHtml(order.product?.name || "Sản phẩm")}</b>
Số lượng: ${order.quantity}
Thanh toán: ${escapeHtml(order.paymentMethod || "Chưa chọn")}${delivery}`;
}

export function accountMessage({ ctx, balance = 0, orderCount = 0, totalSpent = 0 } = {}) {
    const displayName = [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(" ") || ctx.from?.username || "Khách hàng";

    return `👤 <b>Tài khoản của bạn</b>

ID Telegram: <code>${escapeHtml(ctx.from.id)}</code>
Tên: <b>${escapeHtml(displayName)}</b>
Số dư: <b>${formatCurrency(balance)}</b>
Tổng đơn: <b>${orderCount}</b>
Đã chi tiêu: <b>${formatCurrency(totalSpent)}</b>`;
}

export function supportMessage(adminUsername) {
    return `🆘 <b>Hỗ trợ khách hàng</b>

Nếu bạn cần hỗ trợ, vui lòng chọn một mục bên dưới.
Khi liên hệ admin, hãy gửi kèm mã đơn nếu có.

Admin: <b>@${escapeHtml(adminUsername || "admin")}</b>`;
}

export function walletMessage(balance = 0) {
    return `💳 <b>Nạp tiền vào ví</b>

Số dư hiện tại: <b>${formatCurrency(balance)}</b>

Chọn số tiền muốn nạp. Sau khi chuyển khoản đúng số tiền và nội dung, ví sẽ được cộng tự động.`;
}

export function searchPromptMessage() {
    return `🔎 <b>Tìm sản phẩm</b>

Hiện bot chưa bật tìm kiếm bằng từ khóa trong chat.
Bạn có thể vào danh mục để xem toàn bộ sản phẩm đang bán.`;
}

export function adminPanelMessage({ todayRevenue = 0, todayOrders = 0, newUsers = 0 } = {}) {
    return `🛠️ <b>Admin Panel</b>

Hôm nay:
💰 Doanh thu: <b>${formatCurrency(todayRevenue)}</b>
📦 Đơn hàng: <b>${todayOrders}</b>
👥 Người dùng mới: <b>${newUsers}</b>

Chọn khu vực cần quản lý.`;
}
