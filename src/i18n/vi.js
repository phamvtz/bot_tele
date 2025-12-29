// Vietnamese translations
export default {
    // General
    welcome: "Xin chào {name}! 👋",
    shopName: "🏪 Shop Bot",
    selectOption: "Chọn chức năng:",
    back: "🔙 Quay lại",
    cancel: "❌ Huỷ",
    confirm: "✅ Xác nhận",
    success: "✅ Thành công!",
    error: "❌ Lỗi: {message}",
    loading: "⏳ Đang xử lý...",

    // Main menu
    menuProducts: "🛒 Sản phẩm",
    menuOrders: "📦 Đơn hàng",
    menuReferral: "👥 Giới thiệu",
    menuLanguage: "🌐 Ngôn ngữ",
    menuHelp: "ℹ️ Trợ giúp",

    // Products
    productList: "🛍️ Danh sách sản phẩm",
    productEmpty: "📭 Chưa có sản phẩm nào.",
    productDetail: "📦 *{name}*\n\n💰 Giá: {price}\n📊 Còn: {stock} sản phẩm",
    productOutOfStock: "❌ Hết hàng!",
    selectQuantity: "Chọn số lượng:",

    // Orders
    orderCreated: "✅ *Đơn hàng đã tạo!*\n\n🆔 Mã: `{orderId}`\n📦 {product}\n📊 Số lượng: {qty}\n💰 Tổng: {amount}",
    orderDelivered: "✅ *Đơn #{orderId} đã giao!*\n\n📦 {product}\n📊 Số lượng: {qty}",
    orderCanceled: "❌ Đã huỷ đơn #{orderId}",
    orderHistory: "📦 *Đơn hàng của bạn*",
    orderEmpty: "📭 Bạn chưa có đơn hàng nào.",
    orderExpire: "⏰ Đơn hết hạn sau {mins} phút.",
    payNow: "💳 Thanh toán ngay",
    cancelOrder: "❌ Huỷ đơn",

    // Payment
    selectPayment: "Chọn phương thức thanh toán:",
    paymentStripe: "💳 Thẻ quốc tế",
    paymentVNPay: "🏦 VNPay",
    paymentMomo: "📱 MoMo",
    paymentBank: "🏦 Chuyển khoản",

    // Coupon
    enterCoupon: "Nhập mã giảm giá (hoặc bỏ qua):",
    couponApplied: "✅ Áp dụng mã: -{discount}",
    couponInvalid: "❌ Mã không hợp lệ hoặc đã hết hạn.",
    couponExpired: "❌ Mã đã hết hạn.",
    couponUsedUp: "❌ Mã đã hết lượt sử dụng.",
    couponMinOrder: "❌ Đơn tối thiểu: {min}",
    skipCoupon: "Bỏ qua",

    // Referral
    referralTitle: "👥 *Chương trình giới thiệu*",
    referralCode: "🔗 Mã giới thiệu của bạn: `{code}`",
    referralLink: "📎 Link: {link}",
    referralEarnings: "💰 Đã nhận: {amount}",
    referralCount: "👥 Đã giới thiệu: {count} người",
    referralCommission: "🎁 Hoa hồng: {percent}% mỗi đơn",

    // Stock alerts
    stockLow: "⚠️ *Cảnh báo tồn kho thấp*\n\n📦 {product}: còn {count} sản phẩm",
    stockEmpty: "🚨 *Hết hàng!*\n\n📦 {product} đã được tự động tắt.",

    // Admin
    adminPanel: "🔧 *Admin Panel*",
    adminProducts: "📦 Quản lý sản phẩm",
    adminOrders: "📋 Đơn hàng",
    adminStats: "📊 Thống kê",
    adminCoupons: "🎫 Mã giảm giá",
    adminUsers: "👥 Người dùng",
    adminSettings: "⚙️ Cài đặt",
    adminBackup: "💾 Backup",

    // Stats
    statsTitle: "📊 *Thống kê*",
    statsToday: "📅 Hôm nay",
    statsWeek: "📆 Tuần này",
    statsMonth: "🗓️ Tháng này",
    statsAll: "📈 Tất cả",
    statsRevenue: "💰 Doanh thu: {amount}",
    statsOrders: "📦 Đơn hàng: {count}",
    statsProducts: "🛍️ Sản phẩm: {count}",
    statsUsers: "👥 Người dùng: {count}",

    // Rate limit
    rateLimited: "⏰ Bạn đang thao tác quá nhanh. Vui lòng đợi {seconds} giây.",

    // Language
    languageChanged: "✅ Đã đổi ngôn ngữ sang Tiếng Việt.",
    selectLanguage: "🌐 Chọn ngôn ngữ:",

    // Help menu
    helpTitle: "📖 *Trợ giúp*\n\nChọn chủ đề:",
    helpBuying: "🛒 Cách mua hàng",
    helpPayment: "💳 Thanh toán",
    helpReferralGuide: "👥 Giới thiệu bạn bè",
    helpContact: "📞 Liên hệ hỗ trợ",

    // Help - How to buy
    helpBuyingText: `🛒 *HƯỚNG DẪN MUA HÀNG*

━━━━━━━━━━━━━━━━━

*Bước 1:* Xem sản phẩm
• Bấm "🛒 Sản phẩm" ở menu chính
• Xem giá và số lượng còn

*Bước 2:* Chọn sản phẩm
• Bấm vào sản phẩm muốn mua
• Chọn số lượng: 1, 2, 3, 5, 10

*Bước 3:* Mã giảm giá
• Nhập mã nếu có
• Hoặc bấm "Bỏ qua"

*Bước 4:* Thanh toán
• Chọn phương thức thanh toán
• Làm theo hướng dẫn

*Bước 5:* Nhận hàng
• Sản phẩm gửi tự động!
• Kiểm tra tin nhắn từ bot

━━━━━━━━━━━━━━━━━

⚠️ *Lưu ý quan trọng:*
• Đơn hàng hết hạn sau 30 phút
• Lưu mã đơn để tra cứu: /order <mã>
• Liên hệ admin nếu gặp vấn đề`,

    // Help - Payment
    helpPaymentText: `💳 *PHƯƠNG THỨC THANH TOÁN*

━━━━━━━━━━━━━━━━━
💳 *THẺ QUỐC TẾ*
━━━━━━━━━━━━━━━━━
• Visa, Mastercard, JCB, Amex
• Thanh toán qua Stripe bảo mật
• Giao hàng ngay sau thanh toán

━━━━━━━━━━━━━━━━━
🏦 *VNPAY*
━━━━━━━━━━━━━━━━━
• Quét QR bằng app ngân hàng
• Hỗ trợ tất cả ngân hàng VN
• Xử lý tự động tức thì

━━━━━━━━━━━━━━━━━
📱 *MOMO*
━━━━━━━━━━━━━━━━━
• Thanh toán qua ví MoMo
• Nhanh chóng, tiện lợi
• Giao hàng ngay

━━━━━━━━━━━━━━━━━
🏦 *CHUYỂN KHOẢN*
━━━━━━━━━━━━━━━━━
• Quét mã QR VietQR
• Tự động điền số tiền
• ⚠️ GHI ĐÚNG NỘI DUNG!
• Admin xác nhận 5-15 phút`,

    // Help - Referral
    helpReferralText: `👥 *CHƯƠNG TRÌNH GIỚI THIỆU*

━━━━━━━━━━━━━━━━━
💰 *CÁCH NHẬN HOA HỒNG*
━━━━━━━━━━━━━━━━━

1️⃣ *Lấy link giới thiệu*
   Bấm "👥 Giới thiệu" ở menu

2️⃣ *Chia sẻ cho bạn bè*
   Gửi link qua Telegram, Zalo, FB...

3️⃣ *Bạn bè đăng ký*
   Họ bấm vào link và Start bot

4️⃣ *Nhận hoa hồng tự động*
   Mỗi khi họ mua hàng thành công

━━━━━━━━━━━━━━━━━
📊 *THÔNG TIN*
━━━━━━━━━━━━━━━━━

🎁 Hoa hồng: *5%* mỗi đơn hàng
👥 Không giới hạn số người giới thiệu
💰 Số dư tích luỹ trong tài khoản

💡 _Mời càng nhiều, nhận càng nhiều!_`,

    // Help - Contact
    helpContactText: `📞 *LIÊN HỆ HỖ TRỢ*

━━━━━━━━━━━━━━━━━
🆘 *KHI NÀO CẦN HỖ TRỢ?*
━━━━━━━━━━━━━━━━━

• Thanh toán nhưng chưa nhận hàng
• Sản phẩm nhận không đúng
• Muốn hoàn tiền / đổi sản phẩm
• Có câu hỏi về dịch vụ
• Báo lỗi ứng dụng

━━━━━━━━━━━━━━━━━
📱 *CÁCH LIÊN HỆ*
━━━━━━━━━━━━━━━━━

Gửi tin nhắn cho admin với:
• Mã đơn hàng (nếu có)
• Mô tả vấn đề chi tiết
• Screenshot nếu cần

⏰ Thời gian phản hồi: 5-30 phút

━━━━━━━━━━━━━━━━━

💡 *Mẹo:* Lưu mã đơn hàng để tra cứu nhanh!
Dùng lệnh: /order <mã_đơn>`,

    // Legacy help (fallback)
    helpText: `📖 *Hướng dẫn sử dụng*

1️⃣ Chọn "Sản phẩm" để xem danh sách
2️⃣ Chọn sản phẩm và số lượng
3️⃣ Nhập mã giảm giá (nếu có)
4️⃣ Chọn phương thức thanh toán
5️⃣ Nhận hàng tự động

💡 *Mẹo:* Giới thiệu bạn bè để nhận hoa hồng!`,
};
