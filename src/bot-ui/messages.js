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

function valueLine(label, value) {
    return `<b>${label}</b>: ${value}`;
}

function productName(product) {
    return escapeHtml(product?.name || "Sản phẩm");
}

export function mainMenuMessage({ firstName = "bạn", balance = 0, productCount = 0 } = {}) {
    return `<b>${escapeHtml(getShopName())}</b>
${DIVIDER}
Chào <b>${escapeHtml(firstName)}</b>. Đây là bảng điều khiển mua hàng của bạn.

${valueLine("Ví", `<b>${formatCurrency(balance)}</b>`)}
${valueLine("Sản phẩm đang bán", `<b>${productCount}</b>`)}

Chọn một thao tác bên dưới để tiếp tục.`;
}

export function categoriesMessage({ total = 0, productTotal = 0 } = {}) {
    const productLine = productTotal > 0
        ? `\n${valueLine("Tổng gói", `<b>${productTotal}</b>`)}`
        : "";

    return `<b>Danh mục sản phẩm</b>
${DIVIDER}
${valueLine("Danh mục", `<b>${total}</b>`)}${productLine}

Chọn một danh mục để xem các gói đang mở bán.`;
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
        : `<b>Sản phẩm</b>`;
    const hasStock = products.some((product) => product.deliveryMode === "STOCK_LINES");
    const totalStock = products.reduce((sum, product) => {
        return sum + (product.deliveryMode === "STOCK_LINES" ? (stockById.get(product.id) || 0) : 0);
    }, 0);
    const pageLine = totalPages > 1 ? `\n${valueLine("Trang", `<b>${page}/${totalPages}</b>`)}` : "";
    const stockLine = hasStock
        ? valueLine("Kho khả dụng", `<b>${totalStock}</b>`)
        : valueLine("Số gói", `<b>${total}</b>`);

    return `${title}
${DIVIDER}
${stockLine}${pageLine}

Chọn gói bên dưới để xem chi tiết và đặt hàng.`;
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

export function productDetailMessage({ product, quantity = 1, stockCount = null, soldCount = null } = {}) {
    const description = product?.description ? truncateText(product.description, 400) : "";
    const note = product?.note ? truncateText(product.note, 250) : "";
    const stockStatus = stockLabel(product, stockCount);
    const total = Number(product?.price || 0) * Number(quantity || 1);
    const codeLine = product?.code ? `\n${valueLine("Mã gói", `<code>${escapeHtml(product.code)}</code>`)}` : "";
    const soldLine = soldCount > 0 ? `\n${valueLine("Đã bán", `<b>${soldCount}</b>`)}` : "";
    const descLine = description ? `\n\n${escapeHtml(description)}` : "";
    const noteLine = note ? `\n\n⚠️ <b>Lưu ý</b>\n${escapeHtml(note)}` : "";

    return `<b>${productName(product)}</b>
${DIVIDER}${codeLine}
${valueLine("Giá", `<b>${formatCurrency(product?.price || 0, product?.currency)}</b>`)}
${valueLine("Kho", `<b>${escapeHtml(stockStatus)}</b>`)}${soldLine}
${valueLine("Số lượng", `<b>${quantity}</b>`)}
${valueLine("Tạm tính", `<b>${formatCurrency(total, product?.currency)}</b>`)}${descLine}${noteLine}

Điều chỉnh số lượng hoặc bấm mua ngay.`;
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
        ? `\n${valueLine("Giảm giá", `<b>-${formatCurrency(orderData.discount, orderData.currency)}</b>`)}`
        : "";
    const missingLine = missing > 0
        ? `\n\nVí còn thiếu <b>${formatCurrency(missing)}</b>. Bạn có thể nạp thêm hoặc thanh toán bằng QR.`
        : "";

    return `<b>Xác nhận thanh toán</b>
${DIVIDER}
${valueLine("Sản phẩm", `<b>${escapeHtml(orderData.productName)}</b>`)}
${valueLine("Số lượng", `<b>${orderData.quantity}</b>`)}
${valueLine("Tạm tính", `<b>${formatCurrency(orderData.amount, orderData.currency)}</b>`)}${discountLine}
${valueLine("Cần thanh toán", `<b>${formatCurrency(orderData.finalAmount, orderData.currency)}</b>`)}
${valueLine("Số dư ví", `<b>${formatCurrency(balance)}</b>`)}${missingLine}

Chọn phương thức thanh toán.`;
}

export function orderSuccessMessage({ order, orderData, balance = null, method = "wallet" } = {}) {
    const balanceLine = balance == null ? "" : `\n${valueLine("Số dư còn lại", `<b>${formatCurrency(balance)}</b>`)}`;
    const methodLabel = method === "wallet" ? "Ví nội bộ" : "Chuyển khoản QR";

    return `<b>Đặt hàng thành công</b>
${DIVIDER}
${valueLine("Mã đơn", `<code>${escapeHtml(order.id.slice(-8).toUpperCase())}</code>`)}
${valueLine("Sản phẩm", `<b>${escapeHtml(orderData.productName)}</b>`)}
${valueLine("Tổng tiền", `<b>${formatCurrency(orderData.finalAmount, orderData.currency)}</b>`)}
${valueLine("Thanh toán", `<b>${methodLabel}</b>`)}
${valueLine("Trạng thái", `<b>${statusLabel(order.status)}</b>`)}${balanceLine}

Hệ thống đang xử lý giao hàng tự động.`;
}

export function ordersMessage(orders = []) {
    if (!orders.length) {
        return `<b>Đơn hàng của bạn</b>
${DIVIDER}
Bạn chưa có đơn hàng nào.

Bấm <b>Mua hàng</b> để xem danh mục sản phẩm.`;
    }

    const lines = orders.map((order, index) => {
        const name = truncateText(order.product?.name || "Sản phẩm", 34);
        return `<b>${index + 1}.</b> <code>${escapeHtml(order.id.slice(-8).toUpperCase())}</code> · ${statusLabel(order.status)}
${escapeHtml(name)} · <b>${formatCurrency(order.finalAmount, order.currency)}</b>`;
    });

    return `<b>Đơn hàng của bạn</b>
${DIVIDER}
${lines.join("\n\n")}`;
}

export function orderDetailMessage(order) {
    const pendingLine = order.status === "PENDING"
        ? `\n\nĐơn đang chờ xác nhận thanh toán. Nếu đã chuyển khoản, hãy bấm làm mới sau ít phút.`
        : "";
    const delivery = order.status === "DELIVERED" && order.deliveryContent
        ? `\n${DIVIDER}\n<b>Thông tin giao hàng</b>\n<code>${escapeHtml(order.deliveryContent.slice(0, 3200))}</code>`
        : pendingLine;

    return `<b>Chi tiết đơn hàng</b>
${DIVIDER}
${valueLine("Mã đơn", `<code>${escapeHtml(order.id.slice(-8).toUpperCase())}</code>`)}
${valueLine("Trạng thái", `<b>${statusLabel(order.status)}</b>`)}
${valueLine("Sản phẩm", `<b>${escapeHtml(order.product?.name || "Sản phẩm")}</b>`)}
${valueLine("Số lượng", `<b>${order.quantity}</b>`)}
${valueLine("Tổng tiền", `<b>${formatCurrency(order.finalAmount, order.currency)}</b>`)}
${valueLine("Thanh toán", `<b>${escapeHtml(order.paymentMethod || "Chưa chọn")}</b>`)}
${valueLine("Thời gian", formatDateTime(order.createdAt))}${delivery}`;
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
