// Vietnamese translations
export default {
    // General
    // welcome: removed — bot now uses getWelcomeGreeting() from DB (settable in admin panel)
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

    // Onboarding — yêu cầu tham gia nhóm
    joinGroupTitle: "📢 Tham gia nhóm để tiếp tục",
    joinGroupPrompt: "Bạn cần tham gia nhóm/kênh của chúng tôi trước khi sử dụng bot và mua hàng.\n\nSau khi tham gia, bấm \"✅ Tôi đã tham gia\" để tiếp tục.",
    joinGroupButton: "📢 Tham gia nhóm",
    joinedButton: "✅ Tôi đã tham gia",
    notJoinedYet: "Bạn chưa tham gia nhóm. Vui lòng tham gia rồi thử lại.",
    joinedOk: "✅ Cảm ơn! Chào mừng bạn.",

    // Help menu
    helpTitle: "📖 *Trợ giúp*\n\nChọn chủ đề:",
    helpBuying: "🛒 Cách mua hàng",
    helpPayment: "💳 Thanh toán",
    helpReferralGuide: "👥 Giới thiệu bạn bè",
    helpContact: "📞 Liên hệ hỗ trợ",

    // Help - How to buy
    helpBuyingText: `🛒 <b>HƯỚNG DẪN MUA HÀNG</b>

━━━━━━━━━━━━━━━━━

<b>Bước 1:</b> Xem sản phẩm
• Bấm "🛒 Mua hàng" ở menu chính
• Xem giá và số lượng còn

<b>Bước 2:</b> Chọn sản phẩm
• Bấm vào sản phẩm muốn mua
• Chọn số lượng: 1, 2, 3, 5, 10
  hoặc bấm "Số khác" để nhập tự do

<b>Bước 3:</b> Mã giảm giá
• Nhập mã nếu có
• Hoặc bấm "Bỏ qua"

<b>Bước 4:</b> Thanh toán
• Chọn "💰 Thanh toán bằng ví" nếu đủ số dư
• Hoặc "🏦 Chuyển khoản QR" để thanh toán trực tiếp

<b>Bước 5:</b> Nhận hàng
• Sản phẩm gửi tự động!
• Kiểm tra tin nhắn từ bot

━━━━━━━━━━━━━━━━━

⚠️ <b>Lưu ý quan trọng:</b>
• Đơn hàng hết hạn sau 30 phút
• Lưu mã đơn để tra cứu: /order &lt;mã&gt;
• Liên hệ admin nếu gặp vấn đề`,

    // Help - Payment
    helpPaymentText: `💳 <b>PHƯƠNG THỨC THANH TOÁN</b>

━━━━━━━━━━━━━━━━━
💰 <b>SỐ DƯ VÍ (Khuyến khích)</b>
━━━━━━━━━━━━━━━━━
• Nạp tiền 1 lần, mua nhiều lần
• Thanh toán siêu nhanh, 1 click
• Giao hàng tự động ngay lập tức

📥 <b>Cách nạp tiền:</b>
1. Bấm "💰 Số dư và Nạp tiền"
2. Chọn số tiền muốn nạp
3. Quét QR chuyển khoản
4. Số dư tự động cộng trong 1-3 phút

━━━━━━━━━━━━━━━━━
🏦 <b>CHUYỂN KHOẢN QR</b>
━━━━━━━━━━━━━━━━━
• Quét mã QR VietQR bằng app ngân hàng
• Số tiền và nội dung tự động điền sẵn
• ⚠️ GHI ĐÚNG NỘI DUNG chuyển khoản!
• Đơn hàng xác nhận tự động 1-3 phút

━━━━━━━━━━━━━━━━━

💡 <b>Mẹo:</b> Nạp sẵn tiền vào ví để mua nhanh hơn!`,

    // Help - Referral
    helpReferralText: `🔥 <b>MỜI BẠN — KEY THƯỞNG {minTokens}–{maxTokens} + KEY BẠN BÈ {tokens}</b>
Mời 1 người là cả hai bên đều nhận được quà.

🔰 <b>Bạn:</b> 1 key thưởng hạn <b>{referrerKeyDays} ngày</b> — bot tự tạo, <b>không cần mua key</b>. Mỗi người mời thành công cộng ngẫu nhiên <b>{minTokens}–{maxTokens} token</b>; hết hạn thì lượt sau tạo key mới.
👉 Lấy key: menu <b>Giới thiệu &amp; Điểm</b> → bấm <b>Copy key thưởng</b> (giữ dòng key). Cũng có trong <code>/mykey</code>.

🎁 <b>Người được mời:</b> key riêng <b>{tokens} token</b>, hạn <b>{days}</b>.

<b>Cách làm:</b>
1️⃣ Gửi link giới thiệu riêng của bạn (xem trong mục <b>Giới thiệu &amp; Điểm</b> hoặc gõ <code>/ref</code>).
2️⃣ Người được mời vào bot bằng link, dùng tài khoản đủ điều kiện, pass captcha nếu có và join channel.
3️⃣ Bot xác nhận channel join rồi tự gửi thưởng cho cả hai.

⚠️ Mỗi người được mời chỉ tính 1 lần.
• Không giới hạn số người mời.
🈶 Bonus mốc <b>5 người: +{milestone5} · 10 người: +{milestone10} · 20 người: +{milestone20}</b>.
🈶 Top 1–2–3 mỗi ngày: <b>{top1} / {top2} / {top3} token</b>.
⭐ Bạn bè vào link + join channel của shop → nhận <b>{pointJoin} điểm</b> (bot tự kiểm tra); mua đơn đầu tiên nhận thêm <b>+{pointPurchase} điểm</b>.
💎 Đổi điểm lấy token API (<code>/tok</code>): <b>1 điểm = {tokenPerPoint} token</b>.
⚠️ Chỉ user <b>hoàn toàn mới</b> mới tính thưởng — người đã từng <code>/start</code> bot sẽ không nhận.`,

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

1️⃣ Chọn "Mua hàng" để xem danh sách
2️⃣ Chọn sản phẩm và số lượng
3️⃣ Nhập mã giảm giá (nếu có)
4️⃣ Thanh toán bằng ví hoặc QR
5️⃣ Nhận hàng tự động

💡 *Mẹo:* Nạp sẵn tiền vào ví để mua nhanh hơn!`,

    // Wallet help
    helpWallet: "💰 Ví và Nạp tiền",
    helpWalletText: `💰 <b>HƯỚNG DẪN SỬ DỤNG VÍ</b>

━━━━━━━━━━━━━━━━━
📥 <b>NẠP TIỀN VÀO VÍ</b>
━━━━━━━━━━━━━━━━━

1. Bấm "💰 Số dư và Nạp tiền"
2. Chọn số tiền: 50k, 100k, 200k, 500k
   hoặc bấm "Số khác" để nhập tự do
3. Quét mã QR bằng app ngân hàng
4. ⚠️ GHI ĐÚNG NỘI DUNG chuyển khoản
5. Đợi 1-3 phút, số dư tự động cộng

━━━━━━━━━━━━━━━━━
🛒 <b>THANH TOÁN BẰNG VÍ</b>
━━━━━━━━━━━━━━━━━

• Khi mua hàng, nếu đủ số dư:
  → Bấm "💰 Thanh toán bằng ví"
  → Trừ tiền ngay, giao hàng tự động!

• Nếu không đủ số dư:
  → Bấm "💳 Nạp tiền" để nạp thêm
  → Hoặc "🏦 QR trực tiếp" để CK luôn

━━━━━━━━━━━━━━━━━
📊 <b>LỊCH SỬ GIAO DỊCH</b>
━━━━━━━━━━━━━━━━━

• Bấm "📊 Lịch sử giao dịch" ở menu
• Xem các giao dịch nạp/mua gần đây
• Hiển thị số dư trước/sau mỗi GD

━━━━━━━━━━━━━━━━━

💡 <b>Mẹo:</b> Nạp sẵn tiền để mua hàng siêu nhanh!`,
};
