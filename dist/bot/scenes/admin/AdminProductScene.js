import { Scenes } from 'telegraf';
import { SCENES } from '../../context.js';
import { Keyboards } from '../../ui/keyboards.js';
import { ProductService } from '../../../modules/product/ProductService.js';
const PAGE_SIZE = 8;
export const adminProductScene = new Scenes.BaseScene(SCENES.ADMIN_PRODUCT);
// ── Enter: Danh sách sản phẩm ────────────────────────────────────────────────
adminProductScene.enter(async (ctx) => {
    const page = 0;
    const { products, totalPages } = await ProductService.getAllProducts(page, PAGE_SIZE);
    const text = `📦 <b>QUẢN LÝ SẢN PHẨM</b>\n\nTổng: ${products.length} sản phẩm | Trang 1/${Math.max(totalPages, 1)}`;
    const keyboard = Keyboards.adminProducts(products, page, Math.max(totalPages, 1));
    if (ctx.callbackQuery) {
        await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard })
            .catch(() => ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard }));
        await ctx.answerCbQuery().catch(() => { });
    }
    else {
        await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
    }
});
// ── Action: Phân trang ───────────────────────────────────────────────────────
adminProductScene.action(/^admin:prod:page:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const page = parseInt(ctx.match[1], 10);
    const { products, totalPages } = await ProductService.getAllProducts(page, PAGE_SIZE);
    const text = `📦 <b>QUẢN LÝ SẢN PHẨM</b>\n\nTrang ${page + 1}/${Math.max(totalPages, 1)}`;
    await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        reply_markup: Keyboards.adminProducts(products, page, Math.max(totalPages, 1)),
    });
});
// ── Action: Xem / sửa sản phẩm ───────────────────────────────────────────────
adminProductScene.action(/^admin:prod:([^:]+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const productId = ctx.match[1];
    if (productId === 'new') {
        // Bắt đầu flow tạo sản phẩm mới
        ctx.session.adminTargetProductId = 'NEW';
        return ctx.editMessageText(`📝 <b>TẠO SẢN PHẨM MỚI</b>\n\nNhập tên sản phẩm:`, { parse_mode: 'HTML', reply_markup: Keyboards.backOnly('ADMIN_PRODUCT') });
    }
    const product = await ProductService.getProductDetail(productId);
    if (!product)
        return;
    ctx.session.adminTargetProductId = productId;
    const text = `📦 <b>${product.name}</b>\n` +
        `${'━'.repeat(20)}\n` +
        `ID: <code>${product.id}</code>\n` +
        `Tình trạng: ${product.isActive ? '✅ Đang bán' : '❌ Tạm dừng'}\n` +
        `Giá: <b>${product.basePrice.toLocaleString('vi-VN')}đ</b>\n` +
        `Giá VIP: <b>${product.vipPrice?.toLocaleString('vi-VN') ?? 'Chưa có'}đ</b>\n` +
        `Tồn kho: <b>${product.stockMode === 'UNLIMITED' ? 'Vô hạn' : product.stockCount}</b>\n` +
        `Danh mục: ${product.category?.name ?? 'Chưa phân loại'}`;
    await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        reply_markup: Keyboards.adminProductAction(productId, product.isActive),
    });
});
// ── Action: Bật/Tắt sản phẩm ────────────────────────────────────────────────
adminProductScene.action(/^admin:prod:toggle:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const productId = ctx.match[1];
    const updated = await ProductService.toggleProductActive(productId);
    await ctx.answerCbQuery(updated.isActive ? '✅ Đã bật sản phẩm!' : '❌ Đã tắt sản phẩm!', { show_alert: true });
    return ctx.scene.reenter();
});
// ── Action: Sửa giá ──────────────────────────────────────────────────────────
adminProductScene.action(/^admin:prod:price:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const productId = ctx.match[1];
    ctx.session.adminTargetProductId = productId;
    await ctx.editMessageText(`✏️ <b>SỬA GIÁ SẢN PHẨM</b>\n\nNhập giá mới (VND), ví dụ: 50000\nHoặc nhập "50000 45000" cho giá thường và giá VIP:`, { parse_mode: 'HTML', reply_markup: Keyboards.backOnly('ADMIN_PRODUCT') });
});
adminProductScene.on('text', async (ctx) => {
    const session = ctx.session;
    const productId = session.adminTargetProductId;
    if (!productId)
        return;
    const text = ctx.message.text.trim();
    // Luồng tạo sản phẩm MỚI
    if (productId === 'NEW') {
        const s = session;
        // Bước nhập tên
        if (!s._prodName) {
            s._prodName = text;
            await ctx.reply(`✅ Tên: <b>${text}</b>\n\nNhập giá bán (vd: 50000):`, { parse_mode: 'HTML', reply_markup: Keyboards.backOnly('ADMIN_PRODUCT') });
            return;
        }
        // Bước nhập giá và tạo
        if (s._prodName && !s._prodPrice) {
            const price = parseInt(text, 10);
            if (isNaN(price) || price <= 0) {
                return ctx.reply('❌ Giá không hợp lệ. Vui lòng nhập số nguyên dương.');
            }
            const slug = s._prodName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') + '-' + Date.now();
            const newProduct = await ProductService.createProduct({
                name: s._prodName,
                slug,
                basePrice: price,
                productType: 'MANUAL_DELIVERY',
                deliveryType: 'SERVICE_ACTION',
                stockMode: 'UNLIMITED',
                thumbnailEmoji: '📦'
            });
            const finalName = s._prodName;
            delete s._prodName;
            delete s._prodPrice;
            session.adminTargetProductId = undefined;
            await ctx.reply(`✅ <b>ĐÃ TẠO SẢN PHẨM THÀNH CÔNG!</b>\n\n📦 <b>${finalName}</b>\n💰 Giá: <b>${price.toLocaleString('vi-VN')}đ</b>\n\n<i>Hãy vào chi tiết sản phẩm để Sửa tồn kho hoặc Bật bán!</i>`, { parse_mode: 'HTML' });
            return ctx.scene.reenter();
        }
        return;
    }
    // Luồng sửa giá sản phẩm CŨ (productId khác 'NEW')
    const parts = text.split(/\s+/);
    const basePrice = parseInt(parts[0], 10);
    const vipPrice = parts[1] ? parseInt(parts[1], 10) : undefined;
    if (isNaN(basePrice) || basePrice <= 0) {
        return ctx.reply('❌ Giá không hợp lệ. Vui lòng nhập số nguyên dương.');
    }
    await ProductService.updateProductPrice(productId, basePrice, vipPrice);
    session.adminTargetProductId = undefined;
    await ctx.reply(`✅ Đã cập nhật giá sản phẩm: <b>${basePrice.toLocaleString('vi-VN')}đ</b>${vipPrice ? ` (VIP: ${vipPrice.toLocaleString('vi-VN')}đ)` : ''}`, {
        parse_mode: 'HTML',
    });
    return ctx.scene.reenter();
});
// ── Action: Chuyển sang admin:stock cho SP cụ thể ───────────────────────────
adminProductScene.action(/^admin:stock:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    ctx.session.adminTargetProductId = ctx.match[1];
    return ctx.scene.enter(SCENES.ADMIN_STOCK);
});
// ── Navigation ────────────────────────────────────────────────────────────────
adminProductScene.action('back:ADMIN_PRODUCT', async (ctx) => {
    await ctx.answerCbQuery();
    // Xóa session tạm
    const s = ctx.session;
    delete s._prodName;
    delete s._prodPrice;
    ctx.session.adminTargetProductId = undefined;
    return ctx.scene.reenter();
});
adminProductScene.action('back:ADMIN_MENU', async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.scene.enter(SCENES.ADMIN_MENU);
});
