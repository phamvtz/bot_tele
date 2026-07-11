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

    // Onboarding — join group gate
    joinGroupTitle: "📢 Join our group to continue",
    joinGroupPrompt: "You need to join our group/channel before using the bot and making purchases.\n\nAfter joining, tap \"✅ I've joined\" to continue.",
    joinGroupButton: "📢 Join group",
    joinedButton: "✅ I've joined",
    notJoinedYet: "You haven't joined the group yet. Please join and try again.",
    joinedOk: "✅ Thanks! Welcome aboard.",

    // Help menu
    helpTitle: "📖 *Help*\n\nChoose a topic:",
    helpBuying: "🛒 How to buy",
    helpPayment: "💳 Payment",
    helpReferralGuide: "👥 Referral program",
    helpContact: "📞 Contact support",
    helpWallet: "💰 Wallet and deposits",

    // Help - How to buy
    helpBuyingText: `🛒 *HOW TO BUY*

1. Tap "Buy".
2. Choose a category and product.
3. Check price, stock and quantity.
4. Pay with wallet, bank QR or USDT if enabled.
5. The bot delivers automatically after payment is confirmed.

Important:
• Pay before the order expires.
• Keep the order code if you need support.
• Contact admin if payment was sent but the order is not delivered.`,

    // Help - Payment
    helpPaymentText: `💳 *PAYMENT AND DELIVERY*

Wallet:
• Deposit once and buy many times.
• Fast one-tap checkout.
• Auto delivery after purchase.

Bank QR:
• Scan the QR with your banking app.
• Send the exact amount and transfer note.
• The system checks payments automatically.

USDT:
• TRC20/BEP20 may be available depending on shop settings.
• Send the exact USDT amount shown by the bot.`,

    // Help - Referral
    helpReferralText: `👥 *REFERRAL PROGRAM*

1. Open the Referral menu.
2. Share your link with friends.
3. When they start the bot and buy successfully, commission is recorded automatically.

The commission rate follows the shop configuration.`,

    // Help - Contact
    helpContactText: `📞 *CONTACT SUPPORT*

Contact admin when:
• You paid but have not received the product.
• The delivered product is incorrect.
• You need a refund or exchange.
• You have a question about the service.

Please include your order code and a screenshot if available.`,

    // Wallet help
    helpWalletText: `💰 *WALLET GUIDE*

Deposit:
1. Open Wallet.
2. Choose an amount or enter a custom amount.
3. Scan the QR or choose USDT if enabled.
4. Send the exact amount and wait for automatic credit.

Pay with wallet:
• If your balance is enough, choose wallet payment during checkout.
• The bot deducts balance and delivers automatically.`,

    // Legacy help
    helpText: `📖 *How to Use*

1️⃣ Select "Products" to browse
2️⃣ Choose product and quantity
3️⃣ Enter coupon code (optional)
4️⃣ Select payment method
5️⃣ Receive product automatically

💡 *Tip:* Refer friends to earn commission!`,
};
