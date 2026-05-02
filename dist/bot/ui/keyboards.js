import { E } from './emojis.js';
import { emojiChar } from './messages.js';
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
    persistentMenu() {
        return {
            keyboard: [
                [{ text: '🛍️ Sản Phẩm' }, { text: '💬 Hỗ trợ' }],
                [{ text: '👛 Ví' }, { text: '👤 Tài khoản' }],
            ],
            resize_keyboard: true,
            is_persistent: true,
        };
    },
    mainMenu() {
        return kb([
            [btn(`🛍️ Sản Phẩm`, 'scene:SHOP'), btn(`💰 Nạp tiền`, 'scene:DEPOSIT')],
            [btn(`👤 TÀI KHOẢN`, 'scene:PROFILE'), btn(`📦 Đơn hàng`, 'scene:ORDERS')],
            [btn(`💬 Hỗ trợ`, 'scene:SUPPORT'), btn(`❌ Đóng`, 'close')],
        ]);
    },
    // ─── Shop ──────────────────────────────────────────────────────────────────
    /**
     * Menu shop chính:
     * ─ Danh mục: 2 cột / hàng (tạo làm nổi bật)
     * ─ Sản phẩm không danh mục: hiện trực tiếp 1/hàng với emoji + giá
     */
    shopMenu(categories, uncategorized = []) {
        const rows = [];
        // Danh mục: 2 cột mỗi hàng — vừa khung bot, có khoảng cách rõ
        for (let i = 0; i < categories.length; i += 2) {
            const row = [];
            const c0 = categories[i];
            const c1 = categories[i + 1];
            row.push(btn(`${c0.name}`, `_cls:success:shop:cat:${c0.id}`));
            if (c1)
                row.push(btn(`${c1.name}`, `_cls:success:shop:cat:${c1.id}`));
            rows.push(row);
        }
        // Sản phẩm không danh mục: hiện trực tiếp
        for (const p of uncategorized) {
            const inStock = p.stockMode === 'UNLIMITED' || p.stockCount > 0;
            const stockStr = p.stockMode === 'UNLIMITED' ? '' : inStock ? ` [✅${p.stockCount}]` : ' [🚫 Hết]';
            const prefix = inStock ? '_cls:success:' : '_cls:danger:';
            const shortName = p.name.length > 28 ? p.name.slice(0, 26) + '…' : p.name;
            const emoji = emojiChar(p.thumbnailEmoji, '📦');
            rows.push([btn(`${emoji} ${shortName} — ${p.basePrice.toLocaleString('vi-VN')}đ${stockStr}`, `${prefix}shop:prod:${p.id}`)]);
        }
        rows.push([btn(`🔄 Làm mới`, 'scene:SHOP')]);
        rows.push([btn(`🔙 Quay lại`, 'back:main')]);
        return kb(rows);
    },
    // Alias cũ — giữ tương thích
    shopCategories(categories) {
        return this.shopMenu(categories, []);
    },
    productList(products, page, totalPages, categoryId) {
        const rows = products.map(p => {
            const isUnlimited = p.stockMode === 'UNLIMITED';
            const inStock = isUnlimited || p.stockCount > 0;
            const colorPrefix = inStock ? '_cls:success:' : '_cls:danger:';
            const emoji = emojiChar(p.thumbnailEmoji, '📦');
            const stockStr = isUnlimited
                ? ''
                : inStock
                    ? ` [${p.stockCount}]`
                    : ` [Hết]`;
            return [
                btn(`${emoji} ${p.name} - ${p.basePrice.toLocaleString('vi-VN')}đ${stockStr}`, `${colorPrefix}shop:prod:${p.id}`)
            ];
        });
        if (totalPages > 1) {
            rows.push(paginationRow(page, totalPages, categoryId ? `shop:cat:${categoryId}:page` : 'shop:page'));
        }
        rows.push([btn(`🔄 Làm mới`, categoryId ? `_cls:success:shop:cat:${categoryId}` : 'scene:SHOP')]);
        rows.push([btn(`🔙 Quay lại`, 'scene:SHOP')]);
        return kb(rows);
    },
    productDetail(product, qty, hasVip) {
        const isTracked = product.stockMode === 'TRACKED';
        const outOfStock = isTracked && product.stockCount <= 0;
        const backBtn_ = btn(`🔙 Quay lại`, product.categoryId ? `_cls:success:shop:cat:${product.categoryId}` : 'scene:SHOP');
        if (outOfStock) {
            return kb([
                [btn(`🚫 HẾT HÀNG — Không thể mua`, 'noop')],
                [backBtn_, btn(`❌ Đóng`, `close`)],
            ]);
        }
        // Nếu TRACKED, giới hạn qty theo stock còn lại
        const maxAllowed = isTracked ? Math.min(product.stockCount, product.maxQty) : product.maxQty;
        const qtys = [1, 2, 3, 5, 10].filter(q => q <= maxAllowed);
        const rows = [];
        // Hàng số lượng
        if (qtys.length > 0) {
            rows.push(qtys.slice(0, 3).map(q => btn(`${q}`, `shop:buy:${product.id}:${q}`)));
            if (qtys.length > 3) {
                rows.push(qtys.slice(3).map(q => btn(`${q}`, `shop:buy:${product.id}:${q}`)));
            }
        }
        rows.push([btn(`📝 Nhập số khác`, `shop:qty:custom:${product.id}`)]);
        rows.push([backBtn_, btn(`❌ Đóng`, `close`)]);
        return kb(rows);
    },
    // ─── Checkout ──────────────────────────────────────────────────────────────
    checkout(orderId, walletBalance, finalAmount, productId) {
        const rows = [];
        if (walletBalance >= finalAmount) {
            rows.push([
                btn(`🏦 MBBank`, `pay:qr:${orderId}`),
                btn(`💳 Trừ ví`, `pay:wallet:${orderId}`)
            ]);
        }
        else {
            rows.push([
                btn(`🏦 MBBank`, `pay:qr:${orderId}`),
                btn(`💳 Trừ ví`, `checkout:deposit_hint`)
            ]);
        }
        rows.push([
            btn(`🔙 Quay lại Sản Phẩm`, productId ? `shop:prod:${productId}` : 'scene:SHOP'),
            btn(`🔙 Quay lại Menu`, `back:main`)
        ]);
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
            [{ text: `👤 Nhắn tin trực tiếp Admin`, url: 'https://t.me/vanggohh' }],
            [btn(`✏️ Tạo Ticket Mới`, 'support:create'), btn(`📜 Xem Ticket`, 'support:list:0')],
            [homeBtn()],
        ]);
    },
    // ─── Admin ─────────────────────────────────────────────────────────────────
    adminMenu() {
        return kb([
            [btn(`📦 Sản Phẩm`, 'admin:products'), btn(`📁 Danh Mục`, 'admin:categories')],
            [btn(`📥 Nhập Kho`, 'admin:stock'), btn(`📊 Thống Kê`, 'admin:stats')],
            [btn(`👥 Users`, 'admin:users'), btn(`💰 Chỉnh Số Dư`, 'admin:balance')],
            [btn(`🧾 Đơn Hàng`, 'admin:orders'), btn(`📢 Broadcast`, 'admin:broadcast')],
            [btn(`❌ Đóng Panel`, 'back:main')],
        ]);
    },
    adminOrders(orders, page, totalPages) {
        const rows = orders.map(o => [
            btn(`${getOrderEmoji(o.status)} ${o.orderCode} — ${o.finalAmount.toLocaleString('vi-VN')}đ`, `admin:order:detail:${o.id}`)
        ]);
        if (totalPages > 1)
            rows.push(paginationRow(page, totalPages, 'admin:order:page'));
        rows.push([backBtn('ADMIN_MENU')]);
        return kb(rows);
    },
    adminOrderDetail(orderId, status, hasDelivered = false) {
        const rows = [];
        if (hasDelivered) {
            rows.push([btn(`🔑 Xem Đầy Đủ Dữ Liệu`, `admin:order:keys:${orderId}`)]);
        }
        if (status !== 'CANCELLED' && status !== 'REFUNDED') {
            rows.push([btn(`❌ Hủy Phiếu / Hoàn Tiền`, `admin:order:refund:${orderId}`)]);
        }
        rows.push([backBtn('ADMIN_ORDERS')]);
        return kb(rows);
    },
    adminCategories(categories) {
        const rows = [];
        // Mỗi danh mục 2 hàng:
        // Hàng 1: [🟢/🔴 Tên] [✏️ Tên] [⏸️/▶️]
        // Hàng 2: [📝 Mô tả]
        categories.forEach(c => {
            rows.push([
                btn(`${c.isActive ? '🟢' : '🔴'} ${c.name}`, `noop`),
                btn(`✏️ Đổi tên`, `admin:cat:rename:${c.id}`),
                btn(c.isActive ? `⏸️ Tắt` : `▶️ Bật`, `admin:cat:toggle:${c.id}`),
            ]);
            rows.push([
                btn(`📝 Mô tả`, `admin:cat:desc:${c.id}`),
            ]);
        });
        rows.push([btn(`➕ Thêm Danh Mục Mới`, 'admin:cat:new')]);
        rows.push([backBtn('ADMIN_MENU')]);
        return kb(rows);
    },
    adminCategoryDetail(categoryId, name, isActive) {
        return kb([
            [btn(isActive ? '🔴 Tắt Danh Mục' : '🟢 Bật Danh Mục', `admin:cat:toggle:${categoryId}`),
                btn('✏️ Đổi Tên', `admin:cat:rename:${categoryId}`)],
            [backBtn('ADMIN_CATEGORY')],
        ]);
    },
    adminProducts(products, page, totalPages) {
        const rows = [];
        // Mỗi sản phẩm 3 hàng:
        // Hàng 1: [🟢/🔴 Tên — Giá] (hiển thị, không bấm)
        // Hàng 2: [✏️ Tên] [💰 Giá] [📥 Kho] [⏸️/▶️]
        // Hàng 3: [🎭 Icon] [📂 Danh mục]
        products.forEach(p => {
            const prod = p;
            rows.push([
                btn(`${prod.isActive ? '🟢' : '🔴'} ${prod.name} — ${prod.basePrice.toLocaleString('vi-VN')}đ`, `noop`)
            ]);
            rows.push([
                btn(`✏️ Tên`, `admin:prod:rename:${prod.id}`),
                btn(`💰 Giá`, `admin:prod:price:${prod.id}`),
                btn(`📥 Kho`, `admin:stock:${prod.id}`),
                btn(prod.isActive ? `⏸️ Tắt` : `▶️ Bật`, `admin:prod:toggle:${prod.id}`),
            ]);
            rows.push([
                btn(`🎭 Icon`, `admin:prod:emoji:${prod.id}`),
                btn(`📂 Danh mục`, `admin:prod:setcat:${prod.id}`),
                btn(`📝 Mô tả`, `admin:prod:desc:${prod.id}`),
            ]);
        });
        if (totalPages > 1)
            rows.push(paginationRow(page, totalPages, 'admin:prod:page'));
        rows.push([btn(`➕ Thêm Sản Phẩm Mới`, 'admin:prod:new')]);
        rows.push([backBtn('ADMIN_MENU')]);
        return kb(rows);
    },
    adminProductAction(productId, isActive) {
        return kb([
            [
                btn(isActive ? '🔴 Tắt SP' : '🟢 Bật SP', `admin:prod:toggle:${productId}`),
                btn('✏️ Đổi Tên', `admin:prod:rename:${productId}`),
            ],
            [
                btn(`📥 Nhập Kho`, `admin:stock:${productId}`),
                btn(`💰 Sửa Giá`, `admin:prod:price:${productId}`),
            ],
            [
                btn(`📂 Đổi Danh Mục`, `admin:prod:setcat:${productId}`),
                btn(`🎭 Đổi Icon`, `admin:prod:emoji:${productId}`),
            ],
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
