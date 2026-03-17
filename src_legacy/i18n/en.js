// English translations
export default {
    // General
    welcome: "Hello {name}! 👋",
    shopName: "🏪 Shop Bot",
    selectOption: "Select an option:",
    back: "🔙 Back",
    cancel: "❌ Cancel",
    confirm: "✅ Confirm",
    success: "✅ Success!",
    error: "❌ Error: {message}",
    loading: "⏳ Processing...",

    // Main menu
    menuProducts: "🛒 Products",
    menuOrders: "📦 Orders",
    menuReferral: "👥 Referral",
    menuLanguage: "🌐 Language",
    menuHelp: "ℹ️ Help",

    // Products
    productList: "🛍️ Product List",
    productEmpty: "📭 No products available.",
    productDetail: "📦 *{name}*\n\n💰 Price: {price}\n📊 Stock: {stock}",
    productOutOfStock: "❌ Out of stock!",
    selectQuantity: "Select quantity:",

    // Orders
    orderCreated: "✅ *Order created!*\n\n🆔 ID: `{orderId}`\n📦 {product}\n📊 Qty: {qty}\n💰 Total: {amount}",
    orderDelivered: "✅ *Order #{orderId} delivered!*\n\n📦 {product}\n📊 Qty: {qty}",
    orderCanceled: "❌ Order #{orderId} canceled",
    orderHistory: "📦 *Your Orders*",
    orderEmpty: "📭 You have no orders yet.",
    orderExpire: "⏰ Order expires in {mins} minutes.",
    payNow: "💳 Pay Now",
    cancelOrder: "❌ Cancel",

    // Payment
    selectPayment: "Select payment method:",
    paymentStripe: "💳 Credit Card",
    paymentVNPay: "🏦 VNPay",
    paymentMomo: "📱 MoMo",
    paymentBank: "🏦 Bank Transfer",

    // Coupon
    enterCoupon: "Enter coupon code (or skip):",
    couponApplied: "✅ Coupon applied: -{discount}",
    couponInvalid: "❌ Invalid or expired coupon.",
    couponExpired: "❌ Coupon has expired.",
    couponUsedUp: "❌ Coupon usage limit reached.",
    couponMinOrder: "❌ Minimum order: {min}",
    skipCoupon: "Skip",

    // Referral
    referralTitle: "👥 *Referral Program*",
    referralCode: "🔗 Your code: `{code}`",
    referralLink: "📎 Link: {link}",
    referralEarnings: "💰 Earned: {amount}",
    referralCount: "👥 Referred: {count} users",
    referralCommission: "🎁 Commission: {percent}% per order",

    // Stock alerts
    stockLow: "⚠️ *Low Stock Alert*\n\n📦 {product}: {count} remaining",
    stockEmpty: "🚨 *Out of Stock!*\n\n📦 {product} has been disabled.",

    // Admin
    adminPanel: "🔧 *Admin Panel*",
    adminProducts: "📦 Products",
    adminOrders: "📋 Orders",
    adminStats: "📊 Statistics",
    adminCoupons: "🎫 Coupons",
    adminUsers: "👥 Users",
    adminSettings: "⚙️ Settings",
    adminBackup: "💾 Backup",

    // Stats
    statsTitle: "📊 *Statistics*",
    statsToday: "📅 Today",
    statsWeek: "📆 This Week",
    statsMonth: "🗓️ This Month",
    statsAll: "📈 All Time",
    statsRevenue: "💰 Revenue: {amount}",
    statsOrders: "📦 Orders: {count}",
    statsProducts: "🛍️ Products: {count}",
    statsUsers: "👥 Users: {count}",

    // Rate limit
    rateLimited: "⏰ Too many requests. Please wait {seconds} seconds.",

    // Language
    languageChanged: "✅ Language changed to English.",
    selectLanguage: "🌐 Select language:",

    // Help
    helpText: `📖 *How to Use*

1️⃣ Select "Products" to browse
2️⃣ Choose product and quantity
3️⃣ Enter coupon code (optional)
4️⃣ Select payment method
5️⃣ Receive product automatically

💡 *Tip:* Refer friends to earn commission!`,
};
