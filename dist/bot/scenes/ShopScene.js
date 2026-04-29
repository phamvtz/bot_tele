import { Scenes } from 'telegraf';
import { SCENES } from '../context.js';
import { Messages } from '../ui/messages.js';
import { Keyboards } from '../ui/keyboards.js';
import { ProductService } from '../../modules/product/ProductService.js';
const PRODUCTS_PER_PAGE = 8;
export const shopScene = new Scenes.BaseScene(SCENES.SHOP);
// ── Enter: Hiển thị danh mục ────────────────────────────────────────────────
shopScene.enter(async (ctx) => {
    ctx.session.shopPage = 0;
    const categories = await ProductService.listActiveCategories();
    const text = Messages.shopHome();
    const keyboard = Keyboards.shopCategories(categories);
    if (ctx.callbackQuery) {
        await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard })
            .catch(() => ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard }));
        await ctx.answerCbQuery().catch(() => { });
    }
    else {
        await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
    }
});
// ── Action: Chọn danh mục ────────────────────────────────────────────────────
shopScene.action(/^shop:cat:([^:]+)(?::page:(\d+))?$/, async (ctx) => {
    await ctx.answerCbQuery();
    const categoryId = ctx.match[1];
    const page = ctx.match[2] ? parseInt(ctx.match[2], 10) : 0;
    const { products, totalPages } = await ProductService.listProductsByCategory(categoryId, page, PRODUCTS_PER_PAGE);
    if (products.length === 0) {
        return ctx.editMessageText('📭 Danh mục này chưa có sản phẩm nào.', {
            reply_markup: Keyboards.backOnly('SHOP'),
        });
    }
    await ctx.editMessageText(`🛍️ *Danh sách sản phẩm*`, {
        parse_mode: 'HTML',
        reply_markup: Keyboards.productList(products, page, totalPages, categoryId),
    });
});
// ── Action: Sản phẩm nổi bật ─────────────────────────────────────────────────
shopScene.action('shop:featured', async (ctx) => {
    await ctx.answerCbQuery();
    const products = await ProductService.listFeaturedProducts();
    if (products.length === 0) {
        return ctx.editMessageText('⭐ Chưa có sản phẩm nổi bật.', {
            reply_markup: Keyboards.backOnly('SHOP'),
        });
    }
    await ctx.editMessageText(`⭐ *Sản Phẩm Nổi Bật*`, {
        parse_mode: 'HTML',
        reply_markup: Keyboards.productList(products, 0, 1),
    });
});
// ── Action: Xem chi tiết sản phẩm ────────────────────────────────────────────
shopScene.action(/^shop:prod:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const productId = ctx.match[1];
    const product = await ProductService.getProductDetail(productId);
    if (!product) {
        return ctx.answerCbQuery('❌ Không tìm thấy sản phẩm!', { show_alert: true });
    }
    // Lưu vào session cart
    const userVipPrice = ctx.user.vipLevel ? product.vipPrice ?? null : null;
    const unitPrice = userVipPrice ?? product.basePrice;
    ctx.session.cart = {
        productId: product.id,
        productName: product.name,
        productEmoji: product.thumbnailEmoji ?? '📦',
        unitPrice,
        vipPrice: product.vipPrice ?? undefined,
        quantity: product.minQty,
        maxQty: product.maxQty,
        stockMode: product.stockMode,
    };
    const text = Messages.productDetail(product, product.minQty, userVipPrice);
    const keyboard = Keyboards.productDetail(product, product.minQty, !!ctx.user.vipLevel);
    await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
    });
});
// ── Action: Tăng/Giảm số lượng ───────────────────────────────────────────────
shopScene.action(/^shop:qty:(.+):(inc|dec)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const productId = ctx.match[1];
    const direction = ctx.match[2];
    const cart = ctx.session.cart;
    if (!cart || cart.productId !== productId) {
        return ctx.answerCbQuery('❌ Phiên hết hạn, vui lòng chọn lại sản phẩm.', { show_alert: true });
    }
    if (direction === 'inc' && cart.quantity < cart.maxQty) {
        cart.quantity++;
    }
    else if (direction === 'dec' && cart.quantity > 1) {
        cart.quantity--;
    }
    const product = await ProductService.getProductDetail(productId);
    if (!product)
        return;
    const userVipPrice = ctx.user.vipLevel ? product.vipPrice ?? null : null;
    const text = Messages.productDetail(product, cart.quantity, userVipPrice);
    const keyboard = Keyboards.productDetail(product, cart.quantity, !!ctx.user.vipLevel);
    await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
    });
});
// ── Action: Bấm Mua Ngay ─────────────────────────────────────────────────────
shopScene.action(/^shop:buy:(.+):(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.scene.enter(SCENES.CHECKOUT);
});
// ── Action: Back về shop ─────────────────────────────────────────────────────
shopScene.action('back:SHOP', async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.scene.reenter();
});
shopScene.action('back:main', async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.scene.enter(SCENES.MAIN_MENU);
});
shopScene.action('noop', (ctx) => ctx.answerCbQuery());
