import { Scenes } from 'telegraf';
import { BotContext, SCENES } from '../context.js';
import { Messages } from '../ui/messages.js';
import { Keyboards } from '../ui/keyboards.js';
import { ProductService } from '../../modules/product/ProductService.js';

const PRODUCTS_PER_PAGE = 8;

export const shopScene = new Scenes.BaseScene<BotContext>(SCENES.SHOP);

// ── Enter: Hiển thị danh mục ────────────────────────────────────────────────

shopScene.enter(async (ctx) => {
  if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => { });

  // Deep link từ kênh thông báo — mở thẳng sản phẩm
  if (ctx.session.directProductId) {
    const productId = ctx.session.directProductId;
    ctx.session.directProductId = undefined;

    const product = await ProductService.getProductDetail(productId);
    if (product) {
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
      await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
      return;
    }
  }

  ctx.session.shopPage = 0;
  const [categories, uncategorized] = await Promise.all([
    ProductService.listActiveCategories(),
    ProductService.listUncategorizedProducts(),
  ]);

  const text = Messages.shopMenu();
  const keyboard = Keyboards.shopMenu(categories, uncategorized);

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard })
      .catch(() => ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard }));
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
  }
});

// ── Action: Chọn danh mục — hỗ trợ cả prefix _cls:success: ————————————————————

shopScene.action(/^(?:_cls:[^:]+:)?shop:cat:([^:]+)(?::page:(\d+))?$/, async (ctx) => {
  await ctx.answerCbQuery();
  const categoryId = ctx.match[1];
  const page = ctx.match[2] ? parseInt(ctx.match[2], 10) : 0;

  const { products, totalPages } = await ProductService.listProductsByCategory(categoryId, page, PRODUCTS_PER_PAGE);

  if (products.length === 0) {
    return ctx.editMessageText('📭 Danh mục này chưa có sản phẩm nào.', {
      reply_markup: Keyboards.backOnly('SHOP'),
    });
  }

  const categoryName = products[0]?.category?.name ?? 'Sản phẩm';
  const categoryDesc = (products[0]?.category as any)?.description ?? null;

  await ctx.editMessageText(Messages.shopCategory(categoryName, categoryDesc), {
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

  await ctx.editMessageText(`⭐ <b>Sản Phẩm Nổi Bật</b>`, {
    parse_mode: 'HTML',
    reply_markup: Keyboards.productList(products, 0, 1),
  });
});

// ── Action: Xem chi tiết sản phẩm — hỗ trợ prefix _cls: ─────────────────────

shopScene.action(/^(?:_cls:[^:]+:)?shop:prod:(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const productId = ctx.match[1];
  const product = await ProductService.getProductDetail(productId);

  if (!product) {
    return ctx.answerCbQuery('❌ Không tìm thấy sản phẩm!', { show_alert: true });
  }

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

  await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard });
});

// ── Action: Tăng/Giảm số lượng ───────────────────────────────────────────────

shopScene.action(/^shop:qty:(.+):(inc|dec)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const productId = ctx.match[1];
  const direction = ctx.match[2] as 'inc' | 'dec';
  const cart = ctx.session.cart;

  if (!cart || cart.productId !== productId) {
    return ctx.answerCbQuery('❌ Phiên hết hạn, vui lòng chọn lại sản phẩm.', { show_alert: true });
  }

  if (direction === 'inc' && cart.quantity < cart.maxQty) cart.quantity++;
  else if (direction === 'dec' && cart.quantity > 1) cart.quantity--;

  const product = await ProductService.getProductDetail(productId);
  if (!product) return;

  const userVipPrice = ctx.user.vipLevel ? product.vipPrice ?? null : null;
  const text = Messages.productDetail(product, cart.quantity, userVipPrice);
  const keyboard = Keyboards.productDetail(product, cart.quantity, !!ctx.user.vipLevel);

  await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard });
});

// ── Action: Nhập số khác ─────────────────────────────────────────────────────

shopScene.action(/^shop:qty:custom:(.+)$/, async (ctx) => {
  await ctx.answerCbQuery('💡 Vui lòng chọn số lượng có sẵn trên màn hình!', { show_alert: true });
});

// ── Action: Bấm Mua Ngay ─────────────────────────────────────────────────────

shopScene.action(/^shop:buy:(.+):(\d+)$/, async (ctx) => {
  const productId = ctx.match[1];
  const qty = parseInt(ctx.match[2], 10);

  // ── Guard: kiểm tra hàng tồn kho TRƯỚC khi vào checkout ──────────────────
  const product = await ProductService.getProductDetail(productId);
  if (!product) {
    return ctx.answerCbQuery('❌ Không tìm thấy sản phẩm!', { show_alert: true });
  }
  if (!product.isActive) {
    return ctx.answerCbQuery('❌ Sản phẩm đã ngừng bán!', { show_alert: true });
  }
  if (product.stockMode === 'TRACKED' && product.stockCount <= 0) {
    return ctx.answerCbQuery('🚫 Sản phẩm đã hết hàng, vui lòng chờ nhập kho!', { show_alert: true });
  }
  if (product.stockMode === 'TRACKED' && product.stockCount < qty) {
    return ctx.answerCbQuery(`⚠️ Chỉ còn ${product.stockCount} sản phẩm trong kho!`, { show_alert: true });
  }

  await ctx.answerCbQuery();

  const userVipPrice = ctx.user.vipLevel ? product.vipPrice ?? null : null;
  ctx.session.cart = {
    productId: product.id,
    productName: product.name,
    productEmoji: product.thumbnailEmoji ?? '📦',
    unitPrice: userVipPrice ?? product.basePrice,
    vipPrice: product.vipPrice ?? undefined,
    quantity: qty,
    maxQty: product.maxQty,
    stockMode: product.stockMode,
  };

  return ctx.scene.enter(SCENES.CHECKOUT);
});

// ── Navigation ───────────────────────────────────────────────────────────────

shopScene.action('back:SHOP', async (ctx) => {
  await ctx.answerCbQuery();
  return ctx.scene.reenter();
});

shopScene.action('back:main', async (ctx) => {
  await ctx.answerCbQuery();
  return ctx.scene.enter(SCENES.MAIN_MENU);
});

shopScene.action('noop', (ctx) => ctx.answerCbQuery());
