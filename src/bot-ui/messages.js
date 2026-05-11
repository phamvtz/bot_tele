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
    return `👋 Chào mừng <b>${escapeHtml(firstName)}</b> đến với <b>${escapeHtml(getShopName())}</b>!

🛍️ Mua gói dịch vụ số — thanh toán nhanh — giao hàng tự động.

${DIVIDER}
⚡ <b>Lệnh nhanh</b>
• 🛍️ /products — Danh sách sản phẩm
• 📋 /menu — Menu chính
• 💰 /topup — Nạp tiền vào ví VNĐ
• 📦 /orders — Đơn hàng của bạn
• 💬 /support — Liên hệ hỗ trợ
• 👤 /me — Thông tin tài khoản
${DIVIDER}
💳 Số dư ví: <b>${formatCurrency(balance)}</b>
📦 Đang bán: <b>${productCount} sản phẩm</b>`;
}

export function categoriesMessage({ total = 0 } = {}) {
    return `🛒 <b>${escapeHtml(getShopName())}</b>

📦 <b>Loại hàng đang bán:</b>
• 🔑 <b>[Code]</b> — Mã kích hoạt phần mềm
• 👤 <b>[Account]</b> — Tài khoản + mật khẩu + 2FA (Tùy chọn)
• 💬 <b>[Support]</b> — Hỗ trợ liên hệ

Chọn một danh mục để xem gói 👇`;
}

export function emptyCategoriesMessage() {
    return `📂 <b>Danh mục sản phẩm</b>

Hiện shop chưa có danh mục đang mở bán.
Vui lòng quay lại sau hoặc liên hệ hỗ trợ.`;
}

export function productsMessage({ category, products = [], total = 0, page = 1, totalPages = 1, stockById = new Map(), emojiById = new Map() } = {}) {
    const categoryTitle = category
        ? `${renderTelegramEmoji(category.icon, category.iconEmojiId)} <b>${escapeHtml(category.name || "Sản phẩm")}</b>`
        : `<b>Sản phẩm</b>`;

    const totalStock = products.reduce((sum, p) => {
        if (p.deliveryMode !== "STOCK_LINES") return sum;
        return sum + (stockById.get(p.id) || 0);
    }, 0);
    const stockLine = products.some(p => p.deliveryMode === "STOCK_LINES")
        ? `📊 Tổng kho: <b>${totalStock} sản phẩm</b>`
        : `📊 Tổng: <b>${total} gói</b>`;

    return `${categoryTitle}

${stockLine}

Chọn gói bên dưới 👇`;
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
    const discountLine = orderData.discount > 0
        ? `\n🎫 Giảm giá: <b>-${formatCurrency(orderData.discount, orderData.currency)}</b>` : "";
    const missingLine = missing > 0
        ? `\n⚠️ Cần nạp thêm: <b>${formatCurrency(missing)}</b>` : "";

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
