import { E } from './emojis.js';
// ─── Helper ───────────────────────────────────────────────────────────────────
function kb(buttons) {
    return { inline_keyboard: buttons };
}
function btn(text, data) {
    return { text, callback_data: data };
}
function backBtn(scene) {
    return btn(`${E.BACK} Quay lại`, `back:${scene}`);
}
function homeBtn() {
    return btn(`${E.HOME} Menu chính`, 'back:main');
}
// ─── Pagination ───────────────────────────────────────────────────────────────
export function paginationRow(page, totalPages, prefix) {
    const row = [];
    if (page > 0)
        row.push(btn(`${E.PREV} Trước`, `${prefix}:${page - 1}`));
    row.push(btn(`${page + 1}/${totalPages}`, 'noop'));
    if (page < totalPages - 1)
        row.push(btn(`Sau ${E.PAGE_NEXT}`, `${prefix}:${page + 1}`));
    return row;
}
// ─── Main Menu ────────────────────────────────────────────────────────────────
export const Keyboards = {
    mainMenu() {
        return kb([
            [btn(`${E.SHOP} Cửa Hàng`, 'scene:SHOP'), btn(`${E.WALLET} Ví Của Tôi`, 'scene:WALLET')],
            [btn(`${E.ORDERS} Đơn Hàng`, 'scene:ORDERS'), btn(`${E.USER} Tài Khoản`, 'scene:PROFILE')],
            [btn(`${E.SUPPORT} Hỗ Trợ`, 'scene:SUPPORT'), btn(`${E.REFERRAL} Giới Thiệu`, 'scene:REFERRAL')],
        ]);
    },
    // ─── Shop ──────────────────────────────────────────────────────────────────
    shopCategories(categories) {
        const rows = [];
        // 2 cột mỗi hàng
        for (let i = 0; i < categories.length; i += 2) {
            const row = [];
            row.push(btn(`${categories[i].emoji} ${categories[i].name}`, `shop:cat:${categories[i].id}`));
            if (categories[i + 1]) {
                row.push(btn(`${categories[i + 1].emoji} ${categories[i + 1].name}`, `shop:cat:${categories[i + 1].id}`));
            }
            rows.push(row);
        }
        rows.push([btn(`${E.STAR} Sản phẩm nổi bật`, 'shop:featured')]);
        rows.push([homeBtn()]);
        return kb(rows);
    },
    productList(products, page, totalPages, categoryId) {
        const rows = products.map(p => [
            btn(`${p.thumbnailEmoji} ${p.name} — ${p.basePrice.toLocaleString('vi-VN')}đ${p.stockMode !== 'UNLIMITED' ? ` (${p.stockCount})` : ''}`, `shop:prod:${p.id}`)
        ]);
        if (totalPages > 1) {
            rows.push(paginationRow(page, totalPages, categoryId ? `shop:cat:${categoryId}:page` : 'shop:page'));
        }
        rows.push([backBtn('SHOP')]);
        return kb(rows);
    },
    productDetail(product, qty, hasVip) {
        const price = (hasVip && product.vipPrice) ? product.vipPrice : product.basePrice;
        return kb([
            [
                btn(`${E.CANCEL} ➖`, `shop:qty:${product.id}:dec`),
                btn(`  ${qty}  `, 'noop'),
                btn(`➕ ${E.CONFIRM}`, `shop:qty:${product.id}:inc`),
            ],
            [btn(`${E.BUY} Mua Ngay — ${(price * qty).toLocaleString('vi-VN')}đ`, `shop:buy:${product.id}:${qty}`)],
            [backBtn('SHOP')],
        ]);
    },
    // ─── Checkout ──────────────────────────────────────────────────────────────
    checkout(orderId, walletBalance, finalAmount) {
        const rows = [];
        rows.push([btn(`${E.EDIT} Nhập Mã Giảm Giá`, `checkout:coupon:${orderId}`)]);
        if (walletBalance >= finalAmount) {
            rows.push([btn(`${E.WALLET} Thanh Toán Bằng Ví (${walletBalance.toLocaleString('vi-VN')}đ)`, `pay:wallet:${orderId}`)]);
        }
        else {
            rows.push([btn(`${E.WALLET} Ví không đủ số dư (${walletBalance.toLocaleString('vi-VN')}đ)`, 'checkout:deposit_hint')]);
        }
        rows.push([btn(`${E.BANK} Chuyển Khoản QR`, `pay:qr:${orderId}`)]);
        rows.push([btn(`${E.CANCEL} Hủy Đơn`, `order:cancel:${orderId}`)]);
        return kb(rows);
    },
    // ─── Wallet ────────────────────────────────────────────────────────────────
    walletMenu() {
        return kb([
            [btn(`${E.DEPOSIT} Nạp Tiền`, 'scene:DEPOSIT')],
            [btn(`${E.HISTORY} Lịch Sử Giao Dịch`, 'wallet:history:0')],
            [homeBtn()],
        ]);
    },
    depositAmounts() {
        const amounts = [50_000, 100_000, 200_000, 500_000, 1_000_000];
        const rows = [];
        for (let i = 0; i < amounts.length; i += 2) {
            const row = [btn(`${amounts[i].toLocaleString('vi-VN')}đ`, `deposit:amount:${amounts[i]}`)];
            if (amounts[i + 1])
                row.push(btn(`${amounts[i + 1].toLocaleString('vi-VN')}đ`, `deposit:amount:${amounts[i + 1]}`));
            rows.push(row);
        }
        rows.push([btn(`${E.EDIT} Nhập số tiền khác`, 'deposit:custom')]);
        rows.push([backBtn('WALLET')]);
        return kb(rows);
    },
    depositPending(requestId) {
        return kb([
            [btn(`${E.REFRESH} Kiểm Tra Trạng Thái`, `deposit:check:${requestId}`)],
            [btn(`${E.CANCEL} Hủy Yêu Cầu`, `deposit:cancel:${requestId}`)],
        ]);
    },
    walletHistory(page, totalPages) {
        const rows = [];
        if (totalPages > 1)
            rows.push(paginationRow(page, totalPages, 'wallet:history'));
        rows.push([backBtn('WALLET')]);
        return kb(rows);
    },
    // ─── Orders ────────────────────────────────────────────────────────────────
    orderList(orders, page, totalPages) {
        const rows = orders.map(o => [
            btn(`${getOrderEmoji(o.status)} ${o.orderCode} — ${o.finalAmount.toLocaleString('vi-VN')}đ`, `order:detail:${o.id}`)
        ]);
        if (totalPages > 1)
            rows.push(paginationRow(page, totalPages, 'order:page'));
        rows.push([homeBtn()]);
        return kb(rows);
    },
    orderDetail(orderId, status) {
        const rows = [];
        if (status === 'COMPLETED' || status === 'DELIVERED') {
            rows.push([btn(`${E.KEY} Xem Dữ Liệu Sản Phẩm`, `order:keys:${orderId}`)]);
        }
        if (status === 'COMPLETED') {
            rows.push([btn(`${E.SUPPORT} Báo Lỗi Sản Phẩm`, `support:new:${orderId}`)]);
        }
        rows.push([backBtn('ORDERS')]);
        return kb(rows);
    },
    // ─── Profile ───────────────────────────────────────────────────────────────
    profileMenu() {
        return kb([
            [btn(`${E.REFERRAL} Chương Trình Giới Thiệu`, 'scene:REFERRAL')],
            [homeBtn()],
        ]);
    },
    referralMenu(botUsername, referralCode) {
        const link = `https://t.me/${botUsername}?start=${referralCode}`;
        return kb([
            [btn(`${E.COPY} Sao Chép Link`, `referral:copy:${encodeURIComponent(link)}`)],
            [btn(`${E.HISTORY} Lịch Sử Hoa Hồng`, 'referral:history:0')],
            [backBtn('PROFILE')],
        ]);
    },
    // ─── Support ───────────────────────────────────────────────────────────────
    supportMenu() {
        return kb([
            [btn(`${E.EDIT} Tạo Ticket Mới`, 'support:create')],
            [btn(`${E.HISTORY} Xem Ticket Của Tôi`, 'support:list:0')],
            [homeBtn()],
        ]);
    },
    // ─── Admin ─────────────────────────────────────────────────────────────────
    adminMenu() {
        return kb([
            [btn(`${E.PACKAGE} Quản Lý Sản Phẩm`, 'admin:products'), btn(`${E.STOCK} Nhập Kho`, 'admin:stock')],
            [btn(`${E.USER} Quản Lý Users`, 'admin:users'), btn(`${E.WALLET} Điều Chỉnh Số Dư`, 'admin:balance')],
            [btn(`${E.HISTORY} Quản Lý Đơn Hàng`, 'admin:orders'), btn(`${E.CHART} Thống Kê`, 'admin:stats')],
            [btn(`${E.BROADCAST} Broadcast`, 'admin:broadcast'), btn(`${E.PACKAGE} Quản Lý Danh Mục`, 'admin:categories')],
            [btn(`${E.CLOSE} Thoát Admin`, 'back:main')],
        ]);
    },
    adminOrders(orders, page, totalPages) {
        const rows = orders.map(o => [
            btn(`${getOrderEmoji(o.status)} ${o.orderCode} — ${o.finalAmount.toLocaleString('vi-VN')}đ`, `admin:order:${o.id}`)
        ]);
        if (totalPages > 1)
            rows.push(paginationRow(page, totalPages, 'admin:order:page'));
        rows.push([backBtn('ADMIN_MENU')]);
        return kb(rows);
    },
    adminOrderDetail(orderId) {
        return kb([
            [btn(`${E.KEY} Xem Dữ Liệu Sản Phẩm`, `admin:order:keys:${orderId}`)],
            [btn(`${E.CANCEL} Hủy Phiếu / Hoàn Tiền`, `admin:order:refund:${orderId}`)],
            [backBtn('ADMIN_ORDERS')],
        ]);
    },
    adminCategories(categories) {
        const rows = categories.map(c => [
            btn(`${c.emoji} ${c.name} (${c.isActive ? 'Bật' : 'Tắt'})`, `admin:cat:edit:${c.id}`)
        ]);
        rows.push([btn(`${E.EDIT} Thêm Danh Mục Mới`, 'admin:cat:new')]);
        rows.push([backBtn('ADMIN_MENU')]);
        return kb(rows);
    },
    adminProducts(products, page, totalPages) {
        const rows = products.map(p => [
            btn(`${p.isActive ? '✅' : '❌'} ${p.name} — ${p.basePrice.toLocaleString('vi-VN')}đ`, `admin:prod:${p.id}`)
        ]);
        if (totalPages > 1)
            rows.push(paginationRow(page, totalPages, 'admin:prod:page'));
        rows.push([btn(`${E.EDIT} Thêm Sản Phẩm Mới`, 'admin:prod:new')]);
        rows.push([backBtn('ADMIN_MENU')]);
        return kb(rows);
    },
    adminProductAction(productId, isActive) {
        return kb([
            [btn(isActive ? `${E.CANCEL} Tắt Sản Phẩm` : `${E.CONFIRM} Bật Sản Phẩm`, `admin:prod:toggle:${productId}`)],
            [btn(`${E.STOCK} Nhập Kho Sản Phẩm Này`, `admin:stock:${productId}`)],
            [btn(`${E.EDIT} Sửa Giá`, `admin:prod:price:${productId}`)],
            [backBtn('ADMIN_PRODUCT')],
        ]);
    },
    adminUsers(page, totalPages) {
        const rows = [];
        if (totalPages > 1)
            rows.push(paginationRow(page, totalPages, 'admin:users:page'));
        rows.push([btn(`${E.SEARCH} Tìm User`, 'admin:user:search')]);
        rows.push([backBtn('ADMIN_MENU')]);
        return kb(rows);
    },
    adminUserAction(userId) {
        return kb([
            [btn(`${E.WALLET} Cộng Tiền`, `admin:balance:add:${userId}`), btn(`${E.CANCEL} Trừ Tiền`, `admin:balance:sub:${userId}`)],
            [btn(`${E.CANCEL} Ban User`, `admin:user:ban:${userId}`)],
            [backBtn('ADMIN_USER')],
        ]);
    },
    confirm(yesData, noData) {
        return kb([
            [btn(`${E.CONFIRM} Xác Nhận`, yesData), btn(`${E.CANCEL} Hủy`, noData)],
        ]);
    },
    backOnly(scene) {
        return kb([[backBtn(scene)]]);
    },
};
// ─── Helpers ──────────────────────────────────────────────────────────────────
function getOrderEmoji(status) {
    const map = {
        PENDING_PAYMENT: '⏳',
        PAID: '💸',
        PROCESSING: '⚙️',
        DELIVERED: '🚚',
        COMPLETED: '✅',
        CANCELLED: '❌',
        FAILED: '⚠️',
        REFUNDED: '🔙',
    };
    return map[status] ?? '❓';
}
