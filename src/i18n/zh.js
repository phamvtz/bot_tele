// Chinese (Simplified) translations
export default {
    // General
    welcome: "你好 {name}！👋",
    shopName: "🏪 商店机器人",
    selectOption: "请选择功能：",
    back: "🔙 返回",
    cancel: "❌ 取消",
    confirm: "✅ 确认",
    success: "✅ 成功！",
    error: "❌ 错误：{message}",
    loading: "⏳ 处理中...",

    // Main menu
    menuProducts: "🛒 产品",
    menuOrders: "📦 订单",
    menuReferral: "👥 推荐",
    menuLanguage: "🌐 语言",
    menuHelp: "ℹ️ 帮助",

    // Products
    productList: "🛍️ 产品列表",
    productEmpty: "📭 暂无产品。",
    productDetail: "📦 *{name}*\n\n💰 价格：{price}\n📊 库存：{stock}",
    productOutOfStock: "❌ 缺货！",
    selectQuantity: "选择数量：",

    // Orders
    orderCreated: "✅ *订单已创建！*\n\n🆔 编号：`{orderId}`\n📦 {product}\n📊 数量：{qty}\n💰 总计：{amount}",
    orderDelivered: "✅ *订单 #{orderId} 已交付！*\n\n📦 {product}\n📊 数量：{qty}",
    orderCanceled: "❌ 订单 #{orderId} 已取消",
    orderHistory: "📦 *您的订单*",
    orderEmpty: "📭 您还没有订单。",
    orderExpire: "⏰ 订单将在 {mins} 分钟后过期。",
    payNow: "💳 立即付款",
    cancelOrder: "❌ 取消",

    // Payment
    selectPayment: "选择支付方式：",
    paymentStripe: "💳 国际信用卡",
    paymentVNPay: "🏦 VNPay",
    paymentMomo: "📱 MoMo",
    paymentBank: "🏦 银行转账",

    // Coupon
    enterCoupon: "输入优惠码（或跳过）：",
    couponApplied: "✅ 已应用优惠码：-{discount}",
    couponInvalid: "❌ 优惠码无效或已过期。",
    couponExpired: "❌ 优惠码已过期。",
    couponUsedUp: "❌ 优惠码使用次数已用完。",
    couponMinOrder: "❌ 最低订单金额：{min}",
    skipCoupon: "跳过",

    // Referral
    referralTitle: "👥 *推荐计划*",
    referralCode: "🔗 您的推荐码：`{code}`",
    referralLink: "📎 链接：{link}",
    referralEarnings: "💰 已获得：{amount}",
    referralCount: "👥 已推荐：{count} 人",
    referralCommission: "🎁 佣金：每单 {percent}%",

    // Stock alerts
    stockLow: "⚠️ *低库存提醒*\n\n📦 {product}：剩余 {count}",
    stockEmpty: "🚨 *缺货！*\n\n📦 {product} 已被自动下架。",

    // Admin
    adminPanel: "🔧 *管理面板*",
    adminProducts: "📦 产品",
    adminOrders: "📋 订单",
    adminStats: "📊 统计",
    adminCoupons: "🎫 优惠码",
    adminUsers: "👥 用户",
    adminSettings: "⚙️ 设置",
    adminBackup: "💾 备份",

    // Stats
    statsTitle: "📊 *统计*",
    statsToday: "📅 今天",
    statsWeek: "📆 本周",
    statsMonth: "🗓️ 本月",
    statsAll: "📈 全部",
    statsRevenue: "💰 收入：{amount}",
    statsOrders: "📦 订单：{count}",
    statsProducts: "🛍️ 产品：{count}",
    statsUsers: "👥 用户：{count}",

    // Rate limit
    rateLimited: "⏰ 操作过于频繁，请等待 {seconds} 秒。",

    // Language
    languageChanged: "✅ 语言已切换为中文。",
    selectLanguage: "🌐 请选择语言：",

    // Onboarding — join group gate
    joinGroupTitle: "📢 加入群组以继续",
    joinGroupPrompt: "在使用机器人和购买之前，您需要先加入我们的群组/频道。\n\n加入后，点击\"✅ 我已加入\"以继续。",
    joinGroupButton: "📢 加入群组",
    joinedButton: "✅ 我已加入",
    notJoinedYet: "您还没有加入群组。请加入后再试。",
    joinedOk: "✅ 谢谢！欢迎您。",

    // Help
    helpText: `📖 *使用说明*

1️⃣ 选择"产品"浏览商品
2️⃣ 选择产品和数量
3️⃣ 输入优惠码（可选）
4️⃣ 选择支付方式
5️⃣ 自动收到产品

💡 *提示：* 推荐好友即可赚取佣金！`,
};
