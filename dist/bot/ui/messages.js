import { E } from './emojis.js';
const DIV = `${E.DIVIDER}`.repeat(24);
// ─── Helpers ──────────────────────────────────────────────────────────────────
function vnd(amount) {
    return `${amount.toLocaleString('vi-VN')}đ`;
}
function vipProgressBar(totalSpent, nextThreshold) {
    const pct = Math.min(Math.round((totalSpent / nextThreshold) * 10), 10);
    const filled = '█'.repeat(pct);
    const empty = '░'.repeat(10 - pct);
    return `[${filled}${empty}] ${Math.round((totalSpent / nextThreshold) * 100)}%`;
}
function statusText(status) {
    const map = {
        PENDING_PAYMENT: '⏳ Chờ thanh toán',
        PAID: '💸 Đã thanh toán',
        PROCESSING: '⚙️ Đang xử lý',
        DELIVERED: '🚚 Đã giao hàng',
        COMPLETED: '✅ Hoàn tất',
        CANCELLED: '❌ Đã hủy',
        FAILED: '⚠️ Thất bại',
        REFUNDED: '🔙 Đã hoàn tiền',
    };
    return map[status] ?? status;
}
function txTypeText(type, direction) {
    if (direction === 'IN') {
        const labels = {
            DEPOSIT: '+  Nạp tiền',
            REFUND: '+  Hoàn tiền',
            REFERRAL_COMMISSION: '+  Hoa hồng',
            ADMIN_ADJUSTMENT: '+  Admin cộng',
            VIP_BONUS: '+  Thưởng VIP',
        };
        return labels[type] ?? `+  ${type}`;
    }
    else {
        const labels = {
            PAYMENT: '-  Thanh toán',
            ADMIN_ADJUSTMENT: '-  Admin trừ',
            REVERSAL: '-  Hoàn tác',
        };
        return labels[type] ?? `-  ${type}`;
    }
}
// ─── Messages ─────────────────────────────────────────────────────────────────
export const Messages = {
    welcome(user) {
        const name = user.firstName || user.username || 'bạn';
        const balance = user.wallet?.balance ?? 0;
        const vip = user.vipLevel?.name ?? 'Thành viên';
        return (`${E.BOT} <b>Chào mừng, ${name}!</b>\n` +
            `${DIV}\n` +
            `${E.VIP} Hạng: <b>${vip}</b>\n` +
            `${E.WALLET} Số dư: <b>${vnd(balance)}</b>\n` +
            `${DIV}\n` +
            `<i>Chọn tính năng bên dưới:</i>`);
    },
    shopHome() {
        return `${E.SHOP} <b>CỬA HÀNG SỐ</b>\n${DIV}\nChọn danh mục sản phẩm:`;
    },
    productDetail(product, qty, vipPrice) {
        const price = vipPrice ?? product.basePrice;
        const stockText = product.stockMode === 'UNLIMITED' ? 'Vô hạn' : `${product.stockCount}`;
        const tagText = product.tags.map(t => `[${t.tagText}]`).join(' ');
        let text = `${product.thumbnailEmoji ?? E.PACKAGE} <b>${product.name}</b>\n${DIV}\n`;
        if (product.shortDescription)
            text += `📝 ${product.shortDescription}\n\n`;
        text += `${E.MONEY} Giá: <b>${vnd(product.basePrice)}</b>\n`;
        if (vipPrice && vipPrice < product.basePrice) {
            text += `${E.DIAMOND} Giá VIP: <b>${vnd(vipPrice)}</b>\n`;
        }
        text += `${E.PACKAGE} Tồn kho: <b>${stockText}</b>\n`;
        if (tagText)
            text += `🏷️ ${tagText}\n`;
        text += `\n${DIV}\n`;
        text += `Số lượng đang chọn: <b>${qty}</b>\n`;
        text += `${E.ARROW} Tổng: <b>${vnd(price * qty)}</b>`;
        return text;
    },
    checkoutSummary(order, productName, vipDiscount, couponDiscount) {
        const items = order.items[0];
        const subtotal = order.subtotalAmount;
        const final = order.finalAmount;
        let text = `🧾 <b>XÁC NHẬN ĐƠN HÀNG</b>\n${DIV}\n`;
        text += `📦 Sản phẩm: <b>${productName}</b>\n`;
        text += `🔢 Số lượng: <b>${items?.quantity ?? 1}</b>\n`;
        text += `${DIV}\n`;
        text += `Tạm tính:        <b>${vnd(subtotal)}</b>\n`;
        if (vipDiscount > 0)
            text += `${E.DIAMOND} Giảm VIP:      <b>-${vnd(vipDiscount)}</b>\n`;
        if (couponDiscount > 0)
            text += `🏷️ Mã giảm giá: <b>-${vnd(couponDiscount)}</b>\n`;
        text += `${DIV}\n`;
        text += `💰 <b>Tổng thanh toán: ${vnd(final)}</b>\n`;
        text += `\n⏳ Đơn hết hạn sau <b>15 phút</b>.`;
        return text;
    },
    paymentSuccess(order, deliveredItems) {
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
        }
        else {
            text += `<i>Sản phẩm sẽ được xử lý và gửi cho bạn sớm.</i>`;
        }
        return text;
    },
    qrPayment(request, bankCode, accountNo, accountName) {
        const expireTime = request.expiresAt.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
        return (`${E.BANK} <b>THÔNG TIN CHUYỂN KHOẢN</b>\n${DIV}\n` +
            `🏦 Ngân hàng: <b>${bankCode}</b>\n` +
            `💳 STK: <code>${accountNo}</code>\n` +
            `👤 Chủ TK: <b>${accountName}</b>\n` +
            `${DIV}\n` +
            `💰 Số tiền: <b>${vnd(request.amount)}</b>\n` +
            `📝 Nội dung CK: <code>${request.transferContent}</code>\n` +
            `${E.WARNING} <b>BẮT BUỘC GHI ĐÚNG NỘI DUNG!</b>\n` +
            `${DIV}\n` +
            `⏳ Hết hạn lúc: <b>${expireTime}</b>\n` +
            `<i>Hệ thống tự đối soát sau 1-3 phút khi nhận được tiền.</i>`);
    },
    depositSuccess(amount, newBalance) {
        return (`${E.SUCCESS} <b>NẠP TIỀN THÀNH CÔNG!</b>\n${DIV}\n` +
            `💰 Số tiền nạp: <b>${vnd(amount)}</b>\n` +
            `💵 Số dư hiện tại: <b>${vnd(newBalance)}</b>`);
    },
    walletInfo(wallet) {
        return (`${E.WALLET} <b>VÍ CỦA TÔI</b>\n${DIV}\n` +
            `${E.MONEY} Số dư: <b>${vnd(wallet.balance)}</b>\n` +
            `${E.FROZEN} Đóng băng: <b>${vnd(wallet.frozenBalance)}</b>\n` +
            `${DIV}\n` +
            `📈 Tổng nạp: ${vnd(wallet.totalDeposit)}\n` +
            `📉 Tổng chi: ${vnd(wallet.totalSpent)}\n` +
            `💸 Hoa hồng: ${vnd(wallet.totalRefCommission)}`);
    },
    txHistory(txs, page, totalPages) {
        if (txs.length === 0)
            return `${E.HISTORY} Chưa có giao dịch nào.`;
        let text = `${E.HISTORY} <b>LỊCH SỬ GIAO DỊCH</b> (Trang ${page + 1}/${totalPages})\n${DIV}\n`;
        txs.forEach(tx => {
            const sign = tx.direction === 'IN' ? '+' : '-';
            const date = tx.createdAt.toLocaleDateString('vi-VN');
            text += `${sign}${vnd(tx.amount)} — ${txTypeText(tx.type, tx.direction)}\n`;
            text += `  <i>${tx.description ?? ''} | ${date}</i>\n`;
        });
        return text;
    },
    orderList(orders, page, totalPages) {
        if (orders.length === 0)
            return `${E.ORDERS} Bạn chưa có đơn hàng nào.`;
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
    orderKeys(orderId, items) {
        if (items.length === 0)
            return '❌ Không có dữ liệu giao hàng cho đơn này.';
        let text = `${E.KEY} <b>DỮ LIỆU SẢN PHẨM</b>\n${DIV}\n`;
        items.forEach(item => {
            text += `📦 <b>${item.orderItem.productNameSnapshot}</b>\n`;
            text += `<pre>${item.deliveredContent}</pre>\n\n`;
        });
        return text;
    },
    profile(user) {
        const name = user.firstName ? `${user.firstName} ${user.lastName ?? ''}`.trim() : (user.username ?? 'N/A');
        const vipLevel = user.vipLevel;
        const wallet = user.wallet;
        let text = `${E.USER} <b>TÀI KHOẢN CỦA TÔI</b>\n${DIV}\n`;
        text += `👤 Tên: <b>${name}</b>\n`;
        if (user.username)
            text += `🔗 Username: @${user.username}\n`;
        text += `🆔 Telegram ID: <code>${user.telegramId}</code>\n`;
        text += `${DIV}\n`;
        text += `${E.VIP} Hạng VIP: <b>${vipLevel?.name ?? 'Chưa có'}</b>\n`;
        text += `📊 Tổng chi: <b>${vnd(user.totalSpent)}</b>\n`;
        if (vipLevel) {
            const discount = vipLevel.percentDiscount;
            if (discount > 0)
                text += `${E.DIAMOND} Ưu đãi hiện tại: <b>-${discount}%</b> mỗi đơn\n`;
        }
        text += `${DIV}\n`;
        text += `📅 Tham gia: ${user.createdAt.toLocaleDateString('vi-VN')}\n`;
        text += `📦 Tổng đơn: <b>${user.totalOrders}</b>\n`;
        text += `🎁 Mã giới thiệu: <code>${user.referralCode}</code>`;
        return text;
    },
    referralInfo(user, referralCount, totalCommission, commissionRate) {
        return (`${E.REFERRAL} <b>CHƯƠNG TRÌNH GIỚI THIỆU</b>\n${DIV}\n` +
            `🔑 Mã của bạn: <code>${user.referralCode}</code>\n` +
            `${DIV}\n` +
            `👥 Đã giới thiệu: <b>${referralCount} người</b>\n` +
            `💰 Hoa hồng đã nhận: <b>${vnd(totalCommission)}</b>\n` +
            `📈 Tỉ lệ: <b>${commissionRate}%</b>\n` +
            `${DIV}\n` +
            `<i>Bạn sẽ nhận ${commissionRate}% giá trị mỗi đơn.</i>`);
    },
    supportMenu(openCount) {
        return (`${E.SUPPORT} <b>HỖ TRỢ KHÁCH HÀNG</b>\n${DIV}\n` +
            `📋 Ticket đang mở: <b>${openCount}</b>\n` +
            `${DIV}\n` +
            `<i>Đội hỗ trợ sẽ phản hồi trong 24 giờ.</i>`);
    },
    ticketList(tickets, page, totalPages) {
        if (tickets.length === 0)
            return `${E.SUPPORT} Bạn chưa có ticket nào.`;
        const statusMap = {
            OPEN: '🟡 Đang mở',
            PENDING: '🟠 Chờ xử lý',
            ANSWERED: '🟢 Đã trả lời',
            CLOSED: '⚫ Đã đóng',
        };
        let text = `${E.HISTORY} <b>DANH SÁCH TICKET</b> (Trang ${page + 1}/${totalPages})\n${DIV}\n`;
        tickets.forEach((t, i) => {
            text += `<b>${(page * 5) + i + 1}. ${t.ticketCode}</b>\n`;
            text += `   📝 ${t.subject}\n`;
            text += `   ${statusMap[t.status] ?? t.status}\n\n`;
        });
        return text;
    },
    adminDashboard(stats) {
        return (`${E.ADMIN} <b>BẢNG ĐIỀU KHIỂN ADMIN</b>\n${DIV}\n` +
            `📊 Hôm nay: <b>${stats.todayOrders} đơn</b> | <b>${vnd(stats.todayRevenue)}</b>\n` +
            `👥 Users: <b>${stats.totalUsers}</b> | Mới hôm nay: <b>${stats.newUsers}</b>\n` +
            `${E.WARNING} Tồn kho thấp: <b>${stats.lowStockCount} sản phẩm</b>\n` +
            `${DIV}`);
    },
    error(message) {
        return `${E.ERROR} ${message}`;
    },
    loading() {
        return `${E.LOADING} Đang xử lý...`;
    },
};
