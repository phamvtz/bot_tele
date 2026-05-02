import type { Prisma } from '@prisma/client';
import { E } from './emojis.js';

type User = Prisma.UserGetPayload<{ include: { wallet: true; vipLevel: true } }>;
type Product = Prisma.ProductGetPayload<{ include: { tags: true } }>;
type Order = Prisma.OrderGetPayload<{ include: { items: true } }>;
type DeliveredItem = Prisma.DeliveredItemGetPayload<{ include: { orderItem: true } }>;
type WalletTx = Prisma.WalletTransactionGetPayload<object>;
type Ticket = Prisma.TicketGetPayload<object>;
type PaymentRequest = Prisma.PaymentRequestGetPayload<object>;
type VipLevel = Prisma.VipLevelGetPayload<object>;

const DIV = `${E.DIVIDER}`.repeat(24);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function vnd(amount: number) {
  return `${amount.toLocaleString('vi-VN')}đ`;
}

/**
 * Render emoji cho sản phẩm:
 * - Nếu là `custom:EMOJI_ID` → dùng thẻ <tg-emoji> cho emoji động Telegram Premium
 * - Ngược lại → trả về chuỗi thường (emoji biểu tượng thông thường)
 */
export function renderEmoji(thumbnailEmoji: string | null | undefined, fallback = '📦'): string {
  if (!thumbnailEmoji) return fallback;
  if (thumbnailEmoji.startsWith('custom:')) {
    const id = thumbnailEmoji.slice(7);
    return `<tg-emoji emoji-id="${id}">${fallback}</tg-emoji>`;
  }
  return thumbnailEmoji;
}

/** Emoji dùng trong button text (không hỗ trợ tg-emoji), trả về fallback */
export function emojiChar(thumbnailEmoji: string | null | undefined, fallback = '📦'): string {
  if (!thumbnailEmoji) return fallback;
  if (thumbnailEmoji.startsWith('custom:')) return fallback;
  return thumbnailEmoji;
}

function vipProgressBar(totalSpent: number, nextThreshold: number): string {
  const pct = Math.min(Math.round((totalSpent / nextThreshold) * 10), 10);
  const filled = '█'.repeat(pct);
  const empty  = '░'.repeat(10 - pct);
  return `[${filled}${empty}] ${Math.round((totalSpent / nextThreshold) * 100)}%`;
}

function statusText(status: string): string {
  const map: Record<string, string> = {
    PENDING_PAYMENT: '⏳ Chờ thanh toán',
    PAID:            '💸 Đã thanh toán',
    PROCESSING:      '⚙️ Đang xử lý',
    DELIVERED:       '🚚 Đã giao hàng',
    COMPLETED:       '✅ Hoàn tất',
    CANCELLED:       '❌ Đã hủy',
    FAILED:          '⚠️ Thất bại',
    REFUNDED:        '🔙 Đã hoàn tiền',
  };
  return map[status] ?? status;
}

function txTypeText(type: string, direction: string): string {
  if (direction === 'IN') {
    const labels: Record<string, string> = {
      DEPOSIT:              '+  Nạp tiền',
      REFUND:               '+  Hoàn tiền',
      REFERRAL_COMMISSION:  '+  Hoa hồng',
      ADMIN_ADJUSTMENT:     '+  Admin cộng',
      VIP_BONUS:            '+  Thưởng VIP',
    };
    return labels[type] ?? `+  ${type}`;
  } else {
    const labels: Record<string, string> = {
      PAYMENT:          '-  Thanh toán',
      ADMIN_ADJUSTMENT: '-  Admin trừ',
      REVERSAL:         '-  Hoàn tác',
    };
    return labels[type] ?? `-  ${type}`;
  }
}

// ─── Messages ─────────────────────────────────────────────────────────────────

export const Messages = {

  welcome(user: any, botUsername: string): string {
    const name = user.firstName ? `${user.firstName} ${user.lastName ?? ''}`.trim() : (user.username ?? 'bạn');
    return (
      `👋 Chào mừng <b>${name}</b> đến với @${botUsername}\n\n` +
      `👋 Chào mừng đến với <b>Tài Khoản AI Giá Rẻ!</b>\n\n` +
      `🛍️ Mua gói dịch vụ số — thanh toán nhanh — giao hàng tự động.\n\n` +
      `⚡ <b>Lệnh nhanh</b>\n` +
      `• 🛍️ /products — Danh sách sản phẩm\n` +
      `• 📋 /menu — Menu chính\n` +
      `• 💰 /topup — Nạp tiền ví VNĐ\n` +
      `• 📦 /orders — Đơn hàng của bạn\n` +
      `• 💬 /support — Liên hệ hỗ trợ\n` +
      `• 👤 /me — Thông tin tài khoản`
    );
  },

  shopMenu(): string {
    return (
      `🛍️ <b>Chọn danh mục</b>\n\n` +
      `📦 <b>Loại hàng:</b>\n` +
      `• 🔑 [Code]\n` +
      `↳ Mã kích hoạt\n` +
      `• 👤 [Account]\n` +
      `↳ Tài khoản + mật khẩu + 2FA (Tùy chọn)\n` +
      `• 💬 [Support]\n` +
      `↳ Hỗ trợ liên hệ\n\n` +
      `Chọn một danh mục để xem gói 👇`
    );
  },

  shopCategory(categoryName: string, desc?: string | null, totalStock?: number): string {
    const stockLine = totalStock !== undefined
      ? `\n📊 Tổng kho: <b>${totalStock > 0 ? `${totalStock} sản phẩm` : '❌ Hết hàng'}</b>`
      : '';
    return (
      `${'━'.repeat(24)}\n` +
      `🏪 <b>${categoryName.toUpperCase()}</b>\n` +
      `${'━'.repeat(24)}\n` +
      `${desc ? `📝 <i>${desc}</i>\n` : ''}` +
      `${stockLine}\n\n` +
      `Chọn gói bên dưới 👇`
    );
  },

  productDetail(product: Product & { thumbnailEmoji?: string }, qty: number, vipPrice?: number | null): string {
    const price = vipPrice ?? product.basePrice;
    const emojiHtml = renderEmoji((product as any).thumbnailEmoji);
    const desc = (product as any).shortDescription;

    // Tính trạng thái kho
    let stockStatus: string;
    if (product.stockMode === 'UNLIMITED') {
      stockStatus = '♾️ Vô hạn';
    } else if (product.stockCount <= 0) {
      stockStatus = '❌ Hết hàng';
    } else if (product.stockCount <= 5) {
      stockStatus = `⚠️ Còn <b>${product.stockCount}</b> sản phẩm (sắp hết!)`;
    } else {
      stockStatus = `✅ Còn <b>${product.stockCount}</b> sản phẩm`;
    }

    return (
      `${'━'.repeat(24)}\n` +
      `${emojiHtml} <b>${product.name.toUpperCase()}</b>\n` +
      `${'━'.repeat(24)}\n` +
      `${desc ? `📝 <i>${desc}</i>\n\n` : ''}` +
      `📦 Tồn kho: ${stockStatus}\n` +
      `💵 Giá: <b>${vnd(price)}</b> / tài khoản\n` +
      `${vipPrice ? `💎 Giá VIP: <b>${vnd(vipPrice)}</b>\n` : ''}` +
      `${'━'.repeat(24)}\n` +
      `🛒 Đang chọn: <b>${qty}</b> tài khoản  |  Tổng: <b>${vnd(price * qty)}</b>\n\n` +
      `💡 <i>Nhấn +/- để thay đổi số lượng, bấm Mua ngay để tiếp tục.</i>`
    );
  },

  checkoutSummary(order: Order, productName: string, vipDiscount: number, couponDiscount: number): string {
    const items = order.items[0];
    const subtotal = order.subtotalAmount;
    const final = order.finalAmount;

    let text = `<b>Chọn cách thanh toán</b>\n\n`;
    text += `📝 Chi tiết đơn\n`;
    text += `📦 Gói: <b>${productName}</b>\n`;
    text += `🔢 Số lượng: <b>${items?.quantity ?? 1}</b>\n`;
    text += `💵 Đơn giá: <b>${vnd(subtotal / (items?.quantity ?? 1))}</b>\n\n`;
    text += `💸 Tổng thanh toán: <b>${vnd(final)}</b>\n`;
    text += `\n• Ví: trừ số dư (nhanh, không cần CK).`;
    return text;
  },

  paymentSuccess(order: Order, deliveredItems: DeliveredItem[]): string {
    let text = `${E.SUCCESS} <b>THANH TOÁN THÀNH CÔNG!</b>\n${DIV}\n`;
    text += `🧾 Mã đơn: <code>${order.orderCode}</code>\n`;
    text += `💰 Số tiền: <b>${vnd(order.finalAmount)}</b>\n`;
    text += `${DIV}\n`;

    if (deliveredItems.length > 0) {
      text += `${E.KEY} <b>DỮ LIỆU SẢN PHẨM CỦA BẠN:</b>\n\n`;
      deliveredItems.forEach(item => {
        text += `📦 <b>${item.orderItem.productNameSnapshot}</b>\n`;
        text += `<pre>${item.deliveredContent}</pre>\n\n`;
      });
      text += `⚠️ <i>Hãy lưu lại thông tin trên! Bạn có thể xem lại trong mục ${E.ORDERS} Đơn Hàng.</i>`;
    } else {
      text += `<i>Sản phẩm sẽ được xử lý và gửi cho bạn sớm.</i>`;
    }

    return text;
  },

  qrPayment(request: PaymentRequest, bankCode: string, accountNo: string, accountName: string): string {
    const expireTime = request.expiresAt.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

    return (
      `${E.BANK} <b>THÔNG TIN CHUYỂN KHOẢN</b>\n${DIV}\n` +
      `🏦 Ngân hàng: <b>${bankCode}</b>\n` +
      `💳 STK: <code>${accountNo}</code>\n` +
      `👤 Chủ TK: <b>${accountName}</b>\n` +
      `${DIV}\n` +
      `💰 Số tiền: <b>${vnd(request.amount)}</b>\n` +
      `📝 Nội dung CK: <code>${request.transferContent}</code>\n` +
      `${E.WARNING} <b>BẮT BUỘC GHI ĐÚNG NỘI DUNG!</b>\n` +
      `${DIV}\n` +
      `⏳ Hết hạn lúc: <b>${expireTime}</b>\n` +
      `<i>Hệ thống tự đối soát sau 1-3 phút khi nhận được tiền.</i>`
    );
  },

  depositSuccess(amount: number, newBalance: number): string {
    return (
      `✅ *NẠP TIỀN THÀNH CÔNG\!*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `💰 Số tiền nạp: *\+${vnd(amount)}*\n` +
      `💼 Số dư hiện tại: *${vnd(newBalance)}*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `_Cảm ơn bạn đã nạp tiền\!_`
    );
  },

  walletInfo(wallet: { balance: number; frozenBalance: number; totalDeposit: number; totalSpent: number; totalRefCommission: number }): string {
    return (
      `${E.WALLET} <b>VÍ CỦA TÔI</b>\n${DIV}\n` +
      `${E.MONEY} Số dư: <b>${vnd(wallet.balance)}</b>\n` +
      `${E.FROZEN} Đóng băng: <b>${vnd(wallet.frozenBalance)}</b>\n` +
      `${DIV}\n` +
      `📈 Tổng nạp: ${vnd(wallet.totalDeposit)}\n` +
      `📉 Tổng chi: ${vnd(wallet.totalSpent)}\n` +
      `💸 Hoa hồng: ${vnd(wallet.totalRefCommission)}`
    );
  },

  txHistory(txs: WalletTx[], page: number, totalPages: number): string {
    if (txs.length === 0) return `${E.HISTORY} Chưa có giao dịch nào.`;

    let text = `${E.HISTORY} <b>LỊCH SỬ GIAO DỊCH</b> (Trang ${page + 1}/${totalPages})\n${DIV}\n`;
    txs.forEach(tx => {
      const sign = tx.direction === 'IN' ? '+' : '-';
      const date = tx.createdAt.toLocaleDateString('vi-VN');
      text += `${sign}${vnd(tx.amount)} — ${txTypeText(tx.type, tx.direction)}\n`;
      text += `  <i>${tx.description ?? ''} | ${date}</i>\n`;
    });
    return text;
  },

  orderList(orders: Order[], page: number, totalPages: number): string {
    if (orders.length === 0) return `${E.ORDERS} Bạn chưa có đơn hàng nào.`;

    let text = `${E.ORDERS} <b>LỊCH SỬ ĐƠN HÀNG</b> (Trang ${page + 1}/${totalPages})\n${DIV}\n`;
    orders.forEach((o, i) => {
      const item = o.items[0];
      text += `<b>${(page * 10) + i + 1}. ${o.orderCode}</b>\n`;
      text += `   📦 ${item?.productNameSnapshot ?? 'N/A'} × ${item?.quantity ?? 1}\n`;
      text += `   💰 ${vnd(o.finalAmount)} — ${statusText(o.status)}\n`;
      text += `   📅 ${o.createdAt.toLocaleDateString('vi-VN')}\n\n`;
    });
    return text;
  },

  orderKeys(orderId: string, items: DeliveredItem[]): string {
    if (items.length === 0) return '❌ Không có dữ liệu giao hàng cho đơn này.';

    let text = `${E.KEY} <b>DỮ LIỆU SẢN PHẨM</b>\n${DIV}\n`;
    items.forEach(item => {
      text += `📦 <b>${item.orderItem.productNameSnapshot}</b>\n`;
      text += `<pre>${item.deliveredContent}</pre>\n\n`;
    });
    return text;
  },

  profile(user: User, nextVipLevel?: { name: string; spendingThreshold: number } | null): string {
    const name = user.firstName ? `${user.firstName} ${user.lastName ?? ''}`.trim() : (user.username ?? 'N/A');
    const vipLevel = user.vipLevel;
    const wallet   = user.wallet;
    const balance  = wallet?.balance ?? 0;
    const spent    = user.totalSpent;

    // VIP badge
    const vipBadge = vipLevel ? `💎 <b>${vipLevel.name}</b>` : '🔓 <b>Thường</b>';
    const vipDiscount = vipLevel?.percentDiscount ?? 0;

    // Progress bar đến level tiếp theo
    let progressLine = '';
    if (nextVipLevel) {
      const pct = Math.min(Math.round((spent / nextVipLevel.spendingThreshold) * 10), 10);
      const bar = '█'.repeat(pct) + '░'.repeat(10 - pct);
      const need = nextVipLevel.spendingThreshold - spent;
      progressLine = `\n📈 Tiến độ → <b>${nextVipLevel.name}</b>\n[${bar}] ${Math.round(pct * 10)}%\nCần thêm: <b>${vnd(need)}</b>\n`;
    } else if (vipLevel) {
      progressLine = `\n🏆 <i>Bạn đang ở hạng cao nhất!</i>\n`;
    }

    let text = `${E.USER} <b>TÀI KHOẢN CỦA TÔI</b>\n${DIV}\n`;
    text += `👤 Tên: <b>${name}</b>\n`;
    if (user.username) text += `🔗 @${user.username}\n`;
    text += `🆔 ID: <code>${user.telegramId}</code>\n`;
    text += `${DIV}\n`;
    text += `${E.VIP} Hạng: ${vipBadge}`;
    if (vipDiscount > 0) text += ` — giảm <b>${vipDiscount}%</b> mỗi đơn`;
    text += `\n`;
    text += progressLine;
    text += `${DIV}\n`;
    text += `💼 Số dư ví: <b>${vnd(balance)}</b>\n`;
    text += `📊 Tổng chi tiêu: <b>${vnd(spent)}</b>\n`;
    text += `📦 Tổng đơn hàng: <b>${user.totalOrders}</b>\n`;
    text += `📅 Tham gia: ${user.createdAt.toLocaleDateString('vi-VN')}\n`;
    text += `${DIV}\n`;
    text += `🎁 Mã giới thiệu: <code>${user.referralCode}</code>`;

    return text;
  },

  referralInfo(user: User, referralCount: number, totalCommission: number, commissionRate: number): string {
    return (
      `${E.REFERRAL} <b>CHƯƠNG TRÌNH GIỚI THIỆU</b>\n${DIV}\n` +
      `🔑 Mã của bạn: <code>${user.referralCode}</code>\n` +
      `${DIV}\n` +
      `👥 Đã giới thiệu: <b>${referralCount} người</b>\n` +
      `💰 Hoa hồng đã nhận: <b>${vnd(totalCommission)}</b>\n` +
      `📈 Tỉ lệ: <b>${commissionRate}%</b>\n` +
      `${DIV}\n` +
      `<i>Bạn sẽ nhận ${commissionRate}% giá trị mỗi đơn.</i>`
    );
  },

  supportMenu(openCount: number): string {
    return (
      `🎧 <b>HỖ TRỢ KHÁCH HÀNG</b>\n\n` +
      `👤 Liên hệ trực tiếp Admin: <b>@vanggohh</b>\n\n` +
      `Hoặc tạo Ticket hỗ trợ trên hệ thống:\n` +
      `📋 Ticket đang mở: <b>${openCount}</b>\n\n` +
      `<i>Đội ngũ Admin sẽ phản hồi sớm nhất có thể.</i>`
    );
  },

  ticketList(tickets: Ticket[], page: number, totalPages: number): string {
    if (tickets.length === 0) return `${E.SUPPORT} Bạn chưa có ticket nào.`;

    const statusMap: Record<string, string> = {
      OPEN:     '🟡 Đang mở',
      PENDING:  '🟠 Chờ xử lý',
      ANSWERED: '🟢 Đã trả lời',
      CLOSED:   '⚫ Đã đóng',
    };

    let text = `${E.HISTORY} <b>DANH SÁCH TICKET</b> (Trang ${page + 1}/${totalPages})\n${DIV}\n`;
    tickets.forEach((t, i) => {
      text += `<b>${(page * 5) + i + 1}. ${t.ticketCode}</b>\n`;
      text += `   📝 ${t.subject}\n`;
      text += `   ${statusMap[t.status] ?? t.status}\n\n`;
    });
    return text;
  },

  adminDashboard(stats: any): string {
    return (
      `👑 <b>BẢNG ĐIỀU KHIỂN ADMIN</b>\n\n` +
      
      `📅 <b>HÔM NAY</b>\n` +
      `├ Đơn hàng: <b>${stats.todayOrders}</b>\n` +
      `└ Doanh thu: <b>${vnd(stats.todayRevenue)}</b>\n\n` +
      
      `📆 <b>THÁNG NÀY</b>\n` +
      `├ Đơn hàng: <b>${stats.monthOrders}</b>\n` +
      `└ Doanh thu: <b>${vnd(stats.monthRevenue)}</b>\n\n` +

      `💰 <b>TỔNG QUAN</b>\n` +
      `├ Tổng doanh thu: <b>${vnd(stats.totalRevenue)}</b>\n` +
      `├ Tổng đơn hàng: <b>${stats.totalOrders}</b>\n` +
      `├ Tổng User: <b>${stats.totalUsers}</b> (Mới: ${stats.newUsers})\n` +
      `└ Tổng Sản Phẩm: <b>${stats.totalProducts}</b>\n\n` +

      `⚠️ Cảnh báo: <b>${stats.lowStockCount}</b> sản phẩm tồn kho thấp\n\n` +
      `<i>Chọn chức năng bên dưới 👇</i>`
    );
  },

  error(message: string): string {
    return `${E.ERROR} ${message}`;
  },

  loading(): string {
    return `${E.LOADING} Đang xử lý...`;
  },
};
