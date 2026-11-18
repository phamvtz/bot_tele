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

    // Help menu
    helpTitle: "📖 *帮助*\n\n请选择主题：",
    helpBuying: "🛒 如何购买",
    helpPayment: "💳 支付",
    helpReferralGuide: "👥 推荐好友",
    helpContact: "📞 联系客服",
    helpWallet: "💰 钱包和充值",

    // Help - How to buy
    helpBuyingText: `🛒 <b>如何购买</b>

1. 点击“购买”。
2. 选择分类和商品。
3. 检查价格、库存和数量。
4. 使用钱包、银行二维码或 USDT 支付。
5. 支付确认后，机器人会自动发货。

注意：
• 请在订单过期前完成支付。
• 如需客服帮助，请保留订单编号。
• 已付款但未收到商品时，请联系管理员。`,

    // Help - Payment
    helpPaymentText: `💳 <b>支付和发货</b>

钱包：
• 先充值，之后可快速购买。
• 一键付款。
• 购买成功后自动发货。

银行二维码：
• 使用银行 App 扫描二维码。
• 请转入准确金额和备注。
• 系统会自动检查到账。

USDT：
• 是否支持 TRC20/BEP20 取决于店铺设置。
• 请转入机器人显示的准确 USDT 数量。`,

    // Help - Referral
    helpReferralText: `🔥 <b>邀请好友 — 奖励密钥 {minTokens}–{maxTokens} + 好友密钥 {tokens}</b>
成功邀请 1 人，双方均可领奖。

🔰 <b>您：</b> 1 个 <b>{referrerKeyDays} 天</b>奖励密钥 — 机器人自动创建，<b>无需购买</b>。每成功邀请 1 人随机累加 <b>{minTokens}–{maxTokens} token</b>；过期后下次邀请自动生成新密钥。
👉 获取密钥：打开 <b>推荐与积分</b> → 点击 <b>复制奖励密钥</b>，也可在 <code>/mykey</code> 查看。

🎁 <b>被邀请人：</b> 独立 <b>{tokens} token</b> 密钥，有效期 <b>{days}</b>。

<b>操作步骤：</b>
1️⃣ 发送您的专属邀请链接（在 <b>推荐与积分</b> 菜单或输入 <code>/ref</code> 获取）。
2️⃣ 好友通过链接进入机器人（符合条件的账号），完成验证并加入频道。
3️⃣ 机器人确认加入频道后自动向双方发放奖励。

⚠️ 每位被邀请人仅计 1 次。
• 不限邀请人数。
🈶 里程碑奖励 <b>5 人: +{milestone5} · 10 人: +{milestone10} · 20 人: +{milestone20}</b>。
🈶 每日排行前 1–2–3 名：<b>{top1} / {top2} / {top3} token</b>。
⭐ 好友通过链接进入并加入频道 → 获得 <b>{pointJoin} 积分</b>；首笔购买额外加 <b>+{pointPurchase} 积分</b>。
💎 积分兑换 API token（<code>/tok</code>）：<b>1 积分 = {tokenPerPoint} token</b>。
⚠️ 仅限<b>全新用户</b>计奖 — 之前发送过 <code>/start</code> 的账号不计入。`,

    // Help - Contact
    helpContactText: `📞 *联系客服*

以下情况请联系管理员：
• 已付款但未收到商品。
• 收到的商品不正确。
• 需要退款或更换商品。
• 对服务有疑问。

请附上订单编号，如有截图也请一并发送。`,

    // Wallet help
    helpWalletText: `💰 <b>钱包指南</b>

充值：
1. 打开钱包。
2. 选择金额或输入自定义金额。
3. 扫描二维码，或选择已开启的 USDT 支付。
4. 转入准确金额，等待系统自动入账。

钱包付款：
• 余额足够时，下单后选择钱包付款。
• 机器人会扣除余额并自动发货。`,

    // Legacy help
    helpText: `📖 *使用说明*

1️⃣ 选择"产品"浏览商品
2️⃣ 选择产品和数量
3️⃣ 输入优惠码（可选）
4️⃣ 选择支付方式
5️⃣ 自动收到产品

💡 *提示：* 推荐好友即可赚取佣金！`,
};
