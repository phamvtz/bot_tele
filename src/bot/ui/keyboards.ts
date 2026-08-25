import { InlineKeyboardMarkup } from 'telegraf/types';
import type { Prisma } from '@prisma/client';
import { E } from './emojis.js';
import { emojiChar } from './messages.js';

type Product = Prisma.ProductGetPayload<{ include: { tags: true; category: true } }>;
type Category = Prisma.CategoryGetPayload<object>;
type Order = Prisma.OrderGetPayload<{ include: { items: true } }>;
type WalletTx = Prisma.WalletTransactionGetPayload<object>;

// ─── Helper ───────────────────────────────────────────────────────────────────

function kb(buttons: { text: string; callback_data: string }[][]): InlineKeyboardMarkup {
  return { inline_keyboard: buttons };
}

function btn(text: string, data: string) {
  return { text, callback_data: data };
}

function backBtn(scene: string) {
  return btn(`${E.BACK} Quay lại`, `back:${scene}`);
}

function homeBtn() {
  return btn(`${E.HOME} Menu chính`, 'back:main');
}

// ─── Pagination ───────────────────────────────────────────────────────────────

export function paginationRow(page: number, totalPages: number, prefix: string) {
  const row: { text: string; callback_data: string }[] = [];
  if (page > 0) row.push(btn(`${E.PREV} Trước`, `${prefix}:${page - 1}`));
  row.push(btn(`${page + 1}/${totalPages}`, 'noop'));
  if (page < totalPages - 1) row.push(btn(`Sau ${E.PAGE_NEXT}`, `${prefix}:${page + 1}`));
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

  mainMenu(user?: any): InlineKeyboardMarkup {
    const rows: { text: string; callback_data: string }[][] = [];

    // Nút trạng thái Hạng & Số dư (Màu XANH LÁ - _cls:success: như Hình 2 & Hình 3)
    if (user && (user.wallet || user.vipLevel)) {
      const rank = user.vipLevel?.name || 'Đồng';
      const balance = user.wallet?.balance ?? 0;
      rows.push([
        btn(`📊 Hạng: ${rank} | Số dư: ${balance.toLocaleString('vi-VN')} VNĐ`, '_cls:success:scene:PROFILE')
      ]);
    }

    // Các nút menu điều hướng (Màu XANH DƯƠNG / TEAL - _cls:primary: như Hình 3, giữ nguyên 100% nội dung)
    rows.push([
      btn(`🛍️ Sản Phẩm`, '_cls:primary:scene:SHOP'),
      btn(`💰 Nạp tiền`, '_cls:primary:scene:DEPOSIT')
    ]);
    rows.push([
      btn(`👤 TÀI KHOẢN`, '_cls:primary:scene:PROFILE'),
      btn(`📦 Đơn hàng`, '_cls:primary:scene:ORDERS')
    ]);
    rows.push([
      btn(`💬 Hỗ trợ`, '_cls:primary:scene:SUPPORT'),
      btn(`❌ Đóng`, '_cls:primary:close')
    ]);

    return kb(rows);
  },

  // ─── Shop ──────────────────────────────────────────────────────────────────

  /**
   * Menu shop chính:
   * ─ Danh mục: 2 cột / hàng
   * ─ Sản phẩm không danh mục: hiện trực tiếp 1/hàng với emoji + giá
   */
  shopMenu(categories: Category[], uncategorized: any[] = []): InlineKeyboardMarkup {
    const rows: { text: string; callback_data: string }[][] = [];

    // Danh mục: 2 cột mỗi hàng (Màu dark teal _cls:primary:)
    for (let i = 0; i < categories.length; i += 2) {
      const row = [];
      const c0 = categories[i];
      const c1 = categories[i + 1];
      row.push(btn(`${c0.name}`, `_cls:primary:shop:cat:${c0.id}`));
      if (c1) row.push(btn(`${c1.name}`, `_cls:primary:shop:cat:${c1.id}`));
      rows.push(row);
    }

    // Sản phẩm không danh mục:
    // Hết hàng -> Màu ĐỎ (_cls:danger:) như Hình 1
    // Còn hàng -> Màu XANH LÁ (_cls:success:) như Hình 2
    for (const p of uncategorized) {
      const inStock = p.stockMode === 'UNLIMITED' || p.stockCount > 0;
      const prefix = inStock ? '_cls:success:' : '_cls:danger:';
      const shortName = p.name.length > 28 ? p.name.slice(0, 26) + '…' : p.name;
      const emoji = emojiChar(p.thumbnailEmoji, '📦');
      const text = inStock
        ? `${emoji} ${shortName} | ${p.basePrice.toLocaleString('vi-VN')}đ${p.stockMode === 'UNLIMITED' ? '' : ` [${p.stockCount}]`}`
        : `${emoji} ${shortName} | ${p.basePrice.toLocaleString('vi-VN')}đ | Hết hàng`;
      rows.push([btn(
        text,
        `${prefix}shop:prod:${p.id}`
      )]);
    }

    rows.push([btn(`🔄 Làm mới`, '_cls:primary:scene:SHOP')]);
    rows.push([btn(`🔙 Quay lại`, '_cls:primary:back:main')]);
    return kb(rows);
  },

  // Alias cũ — giữ tương thích
  shopCategories(categories: Category[]): InlineKeyboardMarkup {
    return this.shopMenu(categories, []);
  },

  productList(products: Product[], page: number, totalPages: number, categoryId?: string): InlineKeyboardMarkup {
    const rows = products.map(p => {
      const isUnlimited = p.stockMode === 'UNLIMITED';
      const inStock     = isUnlimited || p.stockCount > 0;

      // Hết hàng -> Màu ĐỎ (_cls:danger:) như Hình 1: [Emoji Tên | Giá | Hết hàng]
      // Còn hàng -> Màu XANH LÁ (_cls:success:) như Hình 2
      const colorPrefix = inStock ? '_cls:success:' : '_cls:danger:';
      const emoji       = emojiChar(p.thumbnailEmoji, '📦');
      const stockStr    = isUnlimited
        ? ''
        : inStock
          ? ` [${p.stockCount}]`
          : ` | Hết hàng`;

      const text = inStock
        ? `${emoji} ${p.name} | ${p.basePrice.toLocaleString('vi-VN')}đ${stockStr}`
        : `${emoji} ${p.name} | ${p.basePrice.toLocaleString('vi-VN')}đ | Hết hàng`;

      return [
        btn(
          text,
          `${colorPrefix}shop:prod:${p.id}`
        )
      ];
    });

    if (totalPages > 1) {
      rows.push(paginationRow(page, totalPages, categoryId ? `shop:cat:${categoryId}:page` : 'shop:page'));
    }

    rows.push([btn(`🔄 Làm mới`, categoryId ? `_cls:primary:shop:cat:${categoryId}` : 'scene:SHOP')]);
    rows.push([btn(`🔙 Quay lại Danh Mục`, 'scene:SHOP')]);
    return kb(rows);
  },

  productDetail(product: Product, qty: number, hasVip: boolean): InlineKeyboardMarkup {
    const isTracked    = product.stockMode === 'TRACKED';
    const outOfStock   = isTracked && product.stockCount <= 0;
    const backBtn_     = btn(`🔙 Quay lại`, product.categoryId ? `_cls:success:shop:cat:${product.categoryId}` : 'scene:SHOP');

    if (outOfStock) {
      return kb([
        [btn(`🚫 HẾT HÀNG — Không thể mua`, 'noop')],
        [backBtn_, btn(`❌ Đóng`, `close`)],
      ]);
    }

    // Nếu TRACKED, giới hạn qty theo stock còn lại
    const maxAllowed = isTracked ? Math.min(product.stockCount, product.maxQty) : product.maxQty;
    const qtys = [1, 2, 3, 5, 10].filter(q => q <= maxAllowed);

    const rows: { text: string; callback_data: string }[][] = [];

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

  checkout(orderId: string, walletBalance: number, finalAmount: number, productId?: string): InlineKeyboardMarkup {
    const rows: { text: string; callback_data: string }[][] = [];

    if (walletBalance >= finalAmount) {
      rows.push([
        btn(`🏦 MBBank`, `pay:qr:${orderId}`),
        btn(`💳 Trừ ví`, `pay:wallet:${orderId}`)
      ]);
    } else {
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

  walletMenu(): InlineKeyboardMarkup {
    return kb([
      [btn(`${E.DEPOSIT} Nạp Tiền`, 'scene:DEPOSIT')],
      [btn(`${E.HISTORY} Lịch Sử Giao Dịch`, 'wallet:history:0')],
      [homeBtn()],
    ]);
  },

  depositAmounts(): InlineKeyboardMarkup {
    const amounts = [50_000, 100_000, 200_000, 500_000, 1_000_000];
    const rows: { text: string; callback_data: string }[][] = [];

    for (let i = 0; i < amounts.length; i += 2) {
      const row = [btn(`${amounts[i].toLocaleString('vi-VN')}đ`, `deposit:amount:${amounts[i]}`)];
      if (amounts[i + 1]) row.push(btn(`${amounts[i + 1].toLocaleString('vi-VN')}đ`, `deposit:amount:${amounts[i + 1]}`));
      rows.push(row);
    }

    rows.push([btn(`${E.EDIT} Nhập số tiền khác`, 'deposit:custom')]);
    rows.push([backBtn('WALLET')]);
    return kb(rows);
  },

  depositPending(requestId: string): InlineKeyboardMarkup {
    return kb([
      [btn(`${E.REFRESH} Kiểm Tra Trạng Thái`, `deposit:check:${requestId}`)],
      [btn(`${E.CANCEL} Hủy Yêu Cầu`, `deposit:cancel:${requestId}`)],
    ]);
  },

  walletHistory(page: number, totalPages: number): InlineKeyboardMarkup {
    const rows: { text: string; callback_data: string }[][] = [];
    if (totalPages > 1) rows.push(paginationRow(page, totalPages, 'wallet:history'));
    rows.push([backBtn('WALLET')]);
    return kb(rows);
  },

  // ─── Orders ────────────────────────────────────────────────────────────────

  orderList(orders: Order[], page: number, totalPages: number): InlineKeyboardMarkup {
    const rows = orders.map(o => [
      btn(`${getOrderEmoji(o.status)} ${o.orderCode} — ${o.finalAmount.toLocaleString('vi-VN')}đ`, `order:detail:${o.id}`)
    ]);

    if (totalPages > 1) rows.push(paginationRow(page, totalPages, 'order:page'));
    rows.push([homeBtn()]);
    return kb(rows);
  },

  orderDetail(orderId: string, status: string): InlineKeyboardMarkup {
    const rows: { text: string; callback_data: string }[][] = [];

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

  profileMenu(): InlineKeyboardMarkup {
    return kb([
      [btn(`${E.REFERRAL} Chương Trình Giới Thiệu`, 'scene:REFERRAL')],
      [homeBtn()],
    ]);
  },

  referralMenu(botUsername: string, referralCode: string): InlineKeyboardMarkup {
    const link = `https://t.me/${botUsername}?start=${referralCode}`;
    return kb([
      [btn(`${E.COPY} Sao Chép Link`, `referral:copy:${encodeURIComponent(link)}`)],
      [btn(`${E.HISTORY} Lịch Sử Hoa Hồng`, 'referral:history:0')],
      [backBtn('PROFILE')],
    ]);
  },

  // ─── Support ───────────────────────────────────────────────────────────────

  supportMenu(): InlineKeyboardMarkup {
    return kb([
      [{ text: `👤 Nhắn tin trực tiếp Admin`, url: 'https://t.me/vanggohh' } as any],
      [btn(`✏️ Tạo Ticket Mới`, 'support:create'), btn(`📜 Xem Ticket`, 'support:list:0')],
      [homeBtn()],
    ]);
  },

  // ─── Admin ─────────────────────────────────────────────────────────────────

  adminMenu(): InlineKeyboardMarkup {
    return kb([
      [btn(`📦 Sản Phẩm`, 'admin:products'), btn(`📁 Danh Mục`, 'admin:categories')],
      [btn(`📥 Nhập Kho`, 'admin:stock'), btn(`📊 Thống Kê`, 'admin:stats')],
      [btn(`👥 Users`, 'admin:users'), btn(`💰 Chỉnh Số Dư`, 'admin:balance')],
      [btn(`🧾 Đơn Hàng`, 'admin:orders'), btn(`📢 Broadcast`, 'admin:broadcast')],
      [btn(`❌ Đóng Panel`, 'back:main')],
    ]);
  },

  adminOrders(orders: Order[], page: number, totalPages: number): InlineKeyboardMarkup {
    const rows = orders.map(o => [
      btn(`${getOrderEmoji(o.status)} ${o.orderCode} — ${o.finalAmount.toLocaleString('vi-VN')}đ`, `admin:order:detail:${o.id}`)
    ]);
    if (totalPages > 1) rows.push(paginationRow(page, totalPages, 'admin:order:page'));
    rows.push([backBtn('ADMIN_MENU')]);
    return kb(rows);
  },

  adminOrderDetail(orderId: string, status?: string, hasDelivered = false): InlineKeyboardMarkup {
    const rows: { text: string; callback_data: string }[][] = [];

    if (hasDelivered) {
      rows.push([btn(`🔑 Xem Đầy Đủ Dữ Liệu`, `admin:order:keys:${orderId}`)]);
    }
    if (status !== 'CANCELLED' && status !== 'REFUNDED') {
      rows.push([btn(`❌ Hủy Phiếu / Hoàn Tiền`, `admin:order:refund:${orderId}`)]);
    }
    rows.push([backBtn('ADMIN_ORDERS')]);
    return kb(rows);
  },

  adminCategories(categories: Category[]): InlineKeyboardMarkup {
    const rows: { text: string; callback_data: string }[][] = [];

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

  adminCategoryDetail(categoryId: string, name: string, isActive: boolean): InlineKeyboardMarkup {
    return kb([
      [btn(isActive ? '🔴 Tắt Danh Mục' : '🟢 Bật Danh Mục', `admin:cat:toggle:${categoryId}`),
       btn('✏️ Đổi Tên', `admin:cat:rename:${categoryId}`)],
      [backBtn('ADMIN_CATEGORY')],
    ]);
  },

  adminProducts(products: Prisma.ProductGetPayload<object>[], page: number, totalPages: number): InlineKeyboardMarkup {
    const rows: { text: string; callback_data: string }[][] = [];

    // Mỗi sản phẩm 3 hàng:
    // Hàng 1: [🟢/🔴 Tên — Giá] (hiển thị, không bấm)
    // Hàng 2: [✏️ Tên] [💰 Giá] [📥 Kho] [⏸️/▶️]
    // Hàng 3: [🎭 Icon] [📂 Danh mục]
    products.forEach(p => {
      const prod = p as any;
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

    if (totalPages > 1) rows.push(paginationRow(page, totalPages, 'admin:prod:page'));
    rows.push([btn(`➕ Thêm Sản Phẩm Mới`, 'admin:prod:new')]);
    rows.push([backBtn('ADMIN_MENU')]);
    return kb(rows);
  },

  adminProductAction(productId: string, isActive: boolean): InlineKeyboardMarkup {
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

  adminUsers(page: number, totalPages: number): InlineKeyboardMarkup {
    const rows: { text: string; callback_data: string }[][] = [];
    if (totalPages > 1) rows.push(paginationRow(page, totalPages, 'admin:users:page'));
    rows.push([btn(`${E.SEARCH} Tìm User`, 'admin:user:search')]);
    rows.push([backBtn('ADMIN_MENU')]);
    return kb(rows);
  },

  adminUserAction(userId: string): InlineKeyboardMarkup {
    return kb([
      [btn(`${E.WALLET} Cộng Tiền`, `admin:balance:add:${userId}`), btn(`${E.CANCEL} Trừ Tiền`, `admin:balance:sub:${userId}`)],
      [btn(`${E.CANCEL} Ban User`, `admin:user:ban:${userId}`)],
      [backBtn('ADMIN_USER')],
    ]);
  },

  confirm(yesData: string, noData: string): InlineKeyboardMarkup {
    return kb([
      [btn(`${E.CONFIRM} Xác Nhận`, yesData), btn(`${E.CANCEL} Hủy`, noData)],
    ]);
  },

  backOnly(scene: string): InlineKeyboardMarkup {
    return kb([[backBtn(scene)]]);
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getOrderEmoji(status: string): string {
  const map: Record<string, string> = {
    PENDING_PAYMENT: '⏳',
    PAID:            '💸',
    PROCESSING:      '⚙️',
    DELIVERED:       '🚚',
    COMPLETED:       '✅',
    CANCELLED:       '❌',
    FAILED:          '⚠️',
    REFUNDED:        '🔙',
  };
  return map[status] ?? '❓';
}
