import { Scenes } from 'telegraf';
import { SCENES } from '../../context.js';
import { Keyboards } from '../../ui/keyboards.js';
import { ProductService } from '../../../modules/product/ProductService.js';
const btn = (text, callback_data) => ({ text, callback_data });
const PAGE_SIZE = 8;
export const adminProductScene = new Scenes.BaseScene(SCENES.ADMIN_PRODUCT);
// ── Enter: Danh sách sản phẩm ────────────────────────────────────────────────
adminProductScene.enter(async (ctx) => {
    const s = ctx.session;
    delete s._prodName;
    delete s._prodPrice;
    delete s._prodStep;
    ctx.session.adminTargetProductId = undefined;
    const page = 0;
    const { products, totalPages } = await ProductService.getAllProducts(page, PAGE_SIZE);
    const activeCount = products.filter((p) => p.isActive).length;
    const text = `📦 <b>QUẢN LÝ SẢN PHẨM</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🟢 Đang bán: <b>${activeCount}</b>  🔴 Tắt: <b>${products.length - activeCount}</b>\n` +
        `Tổng: <b>${products.length}</b> | Trang 1/${Math.max(totalPages, 1)}`;
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
// ── Action: Bắt đầu tạo sản phẩm mới ────────────────────────────────────────
// (được kích hoạt từ regex admin:prod:([^:]+) khi productId = 'new')
adminProductScene.action(/^admin:prod:([^:]+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const productId = ctx.match[1];
    // Bắt đầu tạo mới
    if (productId === 'new') {
        const s = ctx.session;
        ctx.session.adminTargetProductId = 'NEW';
        delete s._prodName;
        delete s._prodStep;
        return ctx.editMessageText(`📝 <b>TẠO SẢN PHẨM MỚI</b>\n\nBước 1/3: Nhập tên sản phẩm:`, { parse_mode: 'HTML', reply_markup: Keyboards.backOnly('ADMIN_PRODUCT') });
    }
    // Xem chi tiết sản phẩm
    const product = await ProductService.getProductDetail(productId);
    if (!product)
        return;
    ctx.session.adminTargetProductId = productId;
    const text = `📦 <b>${product.name}</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `Trạng thái: ${product.isActive ? '🟢 Đang bán' : '🔴 Tạm dừng'}\n` +
        `💰 Giá: <b>${product.basePrice.toLocaleString('vi-VN')}đ</b>${product.vipPrice ? `  |  VIP: <b>${product.vipPrice.toLocaleString('vi-VN')}đ</b>` : ''}\n` +
        `📦 Tồn kho: <b>${product.stockMode === 'UNLIMITED' ? '♾️ Vô hạn' : product.stockCount}</b>\n` +
        `📂 Danh mục: <b>${product.category?.name ?? '— Chưa phân loại'}</b>\n` +
        `🆔 <code>${product.id}</code>`;
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
    await ctx.answerCbQuery(updated.isActive ? '🟢 Đã bật!' : '🔴 Đã tắt!', { show_alert: false });
    return ctx.scene.reenter();
});
// ── Action: Đổi tên sản phẩm ────────────────────────────────────────────────
adminProductScene.action(/^admin:prod:rename:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const productId = ctx.match[1];
    ctx.session.adminTargetProductId = productId;
    ctx.session._prodStep = 'rename';
    await ctx.reply(`✏️ <b>ĐỔI TÊN SẢN PHẨM</b>\n\nNhập tên mới:`, { parse_mode: 'HTML', reply_markup: Keyboards.backOnly('ADMIN_PRODUCT') });
});
// ── Action: Đổi icon sản phẩm ────────────────────────────────────────────────
adminProductScene.action(/^admin:prod:emoji:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const productId = ctx.match[1];
    ctx.session.adminTargetProductId = productId;
    ctx.session._prodStep = 'emoji';
    await ctx.reply(`🎭 <b>ĐỔI ICON SẢN PHẨM</b>\n\n` +
        `Gửi cho tôi <b>1 tin nhắn</b> chứa icon bạn muốn:\n\n` +
        `• <b>Emoji thường</b>: gửi ký tự emoji (vd: ✨ 🔥 💎)\n` +
        `• <b>Emoji động Telegram Premium</b>: gửi emoji premium trực tiếp\n\n` +
        `<i>Bot sẽ tự nhận diện và lưu icon phù hợp.</i>`, { parse_mode: 'HTML', reply_markup: Keyboards.backOnly('ADMIN_PRODUCT') });
});
// ── Action: Đặt mô tả sản phẩm ───────────────────────────────────────────────
adminProductScene.action(/^admin:prod:desc:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const productId = ctx.match[1];
    ctx.session.adminTargetProductId = productId;
    ctx.session._prodStep = 'desc';
    const product = await ProductService.getProductDetail(productId);
    const current = product?.shortDescription;
    await ctx.reply(`📝 <b>MÔ TẢ SẢN PHẨM</b>\n\n` +
        `${current ? `Mô tả hiện tại:\n<i>${current}</i>\n\n` : ''}` +
        `Nhập mô tả ngắn (1-2 dòng):\n` +
        `<i>Hiển thị trong trang chi tiết sản phẩm ở shop.</i>`, { parse_mode: 'HTML', reply_markup: Keyboards.backOnly('ADMIN_PRODUCT') });
});
// ── Action: Sửa giá ──────────────────────────────────────────────────────────
adminProductScene.action(/^admin:prod:price:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const productId = ctx.match[1];
    ctx.session.adminTargetProductId = productId;
    ctx.session._prodStep = 'price';
    await ctx.reply(`💰 <b>SỬA GIÁ SẢN PHẨM</b>\n\nNhập giá mới (VND)\nVí dụ: <code>50000</code>\nHoặc <code>50000 45000</code> cho giá thường và giá VIP:`, { parse_mode: 'HTML', reply_markup: Keyboards.backOnly('ADMIN_PRODUCT') });
});
// ── Action: Đổi danh mục sản phẩm ───────────────────────────────────────────
adminProductScene.action(/^admin:prod:setcat:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const productId = ctx.match[1];
    ctx.session.adminTargetProductId = productId;
    ctx.session._prodStep = 'setcat';
    // Hiện danh sách danh mục để chọn
    const categories = await ProductService.getAllCategories();
    if (!categories.length) {
        await ctx.reply('❌ Chưa có danh mục nào. Hãy tạo danh mục trước!', {
            reply_markup: Keyboards.backOnly('ADMIN_PRODUCT'),
        });
        return;
    }
    const rows = categories.map(c => [{
            text: `${c.isActive ? '🟢' : '🔴'} ${c.name}`,
            callback_data: `admin:prod:cat_pick:${productId}:${c.id}`,
        }]);
    rows.push([{ text: '⬅️ Huỷ', callback_data: 'back:ADMIN_PRODUCT' }]);
    await ctx.reply(`📂 <b>CHỌN DANH MỤC</b>\n\nChọn danh mục cho sản phẩm:`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: rows } });
});
// ── Action: Xác nhận chọn danh mục ──────────────────────────────────────────
adminProductScene.action(/^admin:prod:cat_pick:([^:]+):(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const productId = ctx.match[1];
    const categoryId = ctx.match[2];
    await ProductService.updateProduct(productId, { categoryId });
    // Lấy tên danh mục để báo thành công
    const categories = await ProductService.getAllCategories();
    const cat = categories.find(c => c.id === categoryId);
    ctx.session._prodStep = undefined;
    ctx.session.adminTargetProductId = undefined;
    await ctx.editMessageText(`✅ <b>Đã cập nhật danh mục!</b>\n\n📂 Danh mục: <b>${cat?.name ?? categoryId}</b>`, { parse_mode: 'HTML' });
    return ctx.scene.reenter();
});
// ── Text handler: xử lý tất cả bước nhập text ────────────────────────────────
// ── Thoát scene khi gõ lệnh (tránh bị kẹt session) ─────────────────────────
adminProductScene.command('start', async (ctx) => ctx.scene.enter('MAIN_MENU'));
adminProductScene.command('menu', async (ctx) => ctx.scene.enter('MAIN_MENU'));
adminProductScene.command('admin', async (ctx) => ctx.scene.enter('ADMIN_MENU'));
adminProductScene.command('wallet', async (ctx) => ctx.scene.enter('WALLET'));
adminProductScene.command('me', async (ctx) => ctx.scene.enter('PROFILE'));
adminProductScene.command('orders', async (ctx) => ctx.scene.enter('ORDERS'));
adminProductScene.command('topup', async (ctx) => ctx.scene.enter('DEPOSIT'));
adminProductScene.command('support', async (ctx) => ctx.scene.enter('SUPPORT'));
adminProductScene.on('text', async (ctx) => {
    // Bỏ qua nếu là lệnh — để command handlers xử lý
    if (ctx.message.text.startsWith('/'))
        return;
    const session = ctx.session;
    const s = session;
    const productId = session.adminTargetProductId;
    const text = ctx.message.text.trim();
    if (!productId)
        return;
    // ─── Tạo sản phẩm MỚI (3 bước) ──────────────────────────────────────────
    if (productId === 'NEW') {
        // Bước 1: Nhập tên
        if (!s._prodName) {
            s._prodName = text;
            s._prodStep = 'new_price';
            await ctx.reply(`✅ Tên: <b>${text}</b>\n\nBước 2/3: Nhập giá bán (vd: <code>50000</code>):`, { parse_mode: 'HTML', reply_markup: Keyboards.backOnly('ADMIN_PRODUCT') });
            return;
        }
        // Bước 2: Nhập giá → hiện danh sách danh mục
        if (s._prodStep === 'new_price') {
            const price = parseInt(text, 10);
            if (isNaN(price) || price <= 0) {
                return ctx.reply('❌ Giá không hợp lệ. Vui lòng nhập số nguyên dương.');
            }
            s._prodPrice = price;
            s._prodStep = 'new_cat';
            const categories = await ProductService.getAllCategories();
            if (!categories.length) {
                // Không có danh mục → tạo luôn không cần danh mục
                await _createProduct(ctx, s._prodName, price, null);
                return;
            }
            // Hiện danh sách danh mục dạng nút bấm
            const rows = categories.map(c => [{
                    text: `${c.isActive ? '🟢' : '🔴'} ${c.name}`,
                    callback_data: `admin:prod:newcat:${c.id}`,
                }]);
            rows.push([{ text: '⏭️ Bỏ qua (không chọn)', callback_data: 'admin:prod:newcat:none' }]);
            rows.push([{ text: '⬅️ Huỷ', callback_data: 'back:ADMIN_PRODUCT' }]);
            await ctx.reply(`✅ Tên: <b>${s._prodName}</b>\n💰 Giá: <b>${price.toLocaleString('vi-VN')}đ</b>\n\nBước 3/3: Chọn danh mục:`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: rows } });
            return;
        }
        return;
    }
    // ─── Đổi tên ─────────────────────────────────────────────────────────────
    if (s._prodStep === 'rename') {
        await ProductService.updateProduct(productId, { name: text });
        delete s._prodStep;
        session.adminTargetProductId = undefined;
        await ctx.reply(`✅ Đã đổi tên thành: <b>${text}</b>`, { parse_mode: 'HTML' });
        return ctx.scene.reenter();
    }
    // ─── Sửa giá ─────────────────────────────────────────────────────────────
    if (s._prodStep === 'price') {
        const parts = text.split(/\s+/);
        const basePrice = parseInt(parts[0], 10);
        const vipPrice = parts[1] ? parseInt(parts[1], 10) : undefined;
        if (isNaN(basePrice) || basePrice <= 0) {
            return ctx.reply('❌ Giá không hợp lệ. Vui lòng nhập số nguyên dương.');
        }
        await ProductService.updateProductPrice(productId, basePrice, vipPrice);
        delete s._prodStep;
        session.adminTargetProductId = undefined;
        await ctx.reply(`✅ Đã cập nhật giá: <b>${basePrice.toLocaleString('vi-VN')}đ</b>${vipPrice ? `  |  VIP: <b>${vipPrice.toLocaleString('vi-VN')}đ</b>` : ''}`, { parse_mode: 'HTML' });
        return ctx.scene.reenter();
    }
    // ─── Đổi icon (emoji thường) ─────────────────────────────────────────────
    if (s._prodStep === 'emoji') {
        // Ưu tiên: custom emoji entity trong message
        const entities = ctx.message.entities ?? [];
        const customEmojiEntity = entities.find((e) => e.type === 'custom_emoji');
        let emojiValue;
        let previewText;
        if (customEmojiEntity) {
            // Premium animated emoji → lưu dạng custom:ID
            emojiValue = `custom:${customEmojiEntity.custom_emoji_id}`;
            previewText =
                `✅ <b>Đã lưu Emoji Động Premium!</b>\n\n` +
                    `Icon mới: <tg-emoji emoji-id="${customEmojiEntity.custom_emoji_id}">📦</tg-emoji>\n\n` +
                    `<i>Emoji động này sẽ hiển thị trong trang sản phẩm.</i>`;
        }
        else {
            // Emoji thường → lưu trực tiếp
            emojiValue = text;
            previewText = `✅ <b>Đã lưu icon!</b>\n\nIcon mới: ${text}`;
        }
        await ProductService.updateProduct(productId, { thumbnailEmoji: emojiValue });
        delete s._prodStep;
        session.adminTargetProductId = undefined;
        await ctx.reply(previewText, { parse_mode: 'HTML' });
        return ctx.scene.reenter();
    }
    // ─── Đặt mô tả sản phẩm ──────────────────────────────────────────────────
    if (s._prodStep === 'desc') {
        await ProductService.updateProduct(productId, { shortDescription: text });
        delete s._prodStep;
        session.adminTargetProductId = undefined;
        await ctx.reply(`✅ <b>Đã lưu mô tả!</b>\n\n📝 <i>${text}</i>`, { parse_mode: 'HTML' });
        return ctx.scene.reenter();
    }
    // ─── Tạo mới: nhập emoji custom (sau khi chọn "Gửi Emoji Tùy Chỉnh") ────────
    if (s._prodStep === 'new_icon_custom') {
        if (!s._prodName || !s._prodPrice)
            return ctx.scene.reenter();
        const entities = ctx.message.entities ?? [];
        const customEmojiEntity = entities.find((e) => e.type === 'custom_emoji');
        const emoji = customEmojiEntity
            ? `custom:${customEmojiEntity.custom_emoji_id}`
            : text; // emoji thường
        const catId = s._prodCatId === '__none__' ? null : (s._prodCatId ?? null);
        return _createProduct(ctx, s._prodName, s._prodPrice, catId, emoji);
    }
});
// ── Action: Chọn danh mục khi tạo mới → tiếp theo chọn icon ─────────────────
const EMOJI_PRESETS = ['📱', '💻', '🎮', '📺', '✨', '🔥', '💎', '🎯', '🔑', '☁️', '🎵', '👑'];
adminProductScene.action(/^admin:prod:newcat:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const s = ctx.session;
    const catId = ctx.match[1] === 'none' ? null : ctx.match[1];
    if (ctx.session.adminTargetProductId !== 'NEW' || !s._prodName || !s._prodPrice) {
        return ctx.scene.reenter();
    }
    // Lưu catId vào session, chuyển sang bước chọn icon
    s._prodCatId = catId ?? '__none__';
    s._prodStep = 'new_icon';
    // Tạo bàn phím preset emoji (3 cột × 4 hàng)
    const presetRows = [];
    for (let i = 0; i < EMOJI_PRESETS.length; i += 4) {
        presetRows.push(EMOJI_PRESETS.slice(i, i + 4).map((e, j) => btn(e, `admin:prod:newicon:${i + j}`)));
    }
    presetRows.push([
        btn(`🎭 Gửi Emoji Tùy Chỉnh`, `admin:prod:newicon:custom`),
        btn(`⏭️ Bỏ qua (📦)`, `admin:prod:newicon:skip`),
    ]);
    await ctx.editMessageText(`✅ Tên: <b>${s._prodName}</b>\n💰 Giá: <b>${s._prodPrice.toLocaleString('vi-VN')}đ</b>\n\nBước 4/4: Chọn icon sản phẩm:`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: presetRows } });
});
// ── Action: Chọn icon preset hoặc skip khi tạo mới ──────────────────────────
adminProductScene.action(/^admin:prod:newicon:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const s = ctx.session;
    if (ctx.session.adminTargetProductId !== 'NEW' || !s._prodName || !s._prodPrice) {
        return ctx.scene.reenter();
    }
    const choice = ctx.match[1];
    const catId = s._prodCatId === '__none__' ? null : (s._prodCatId ?? null);
    if (choice === 'custom') {
        // Chờ admin gửi emoji → dùng step new_icon_custom
        s._prodStep = 'new_icon_custom';
        await ctx.editMessageText(`🎭 <b>GỬI EMOJI CỦA BẠN</b>\n\n` +
            `Gửi emoji thường hoặc <b>Emoji Premium</b> động của Telegram.\n` +
            `Bot sẽ tự nhận diện loại emoji.`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[btn('⬅️ Huỷ', 'back:ADMIN_PRODUCT')]] } });
        return;
    }
    // Preset hoặc skip
    const emoji = choice === 'skip' ? '📦' : (EMOJI_PRESETS[parseInt(choice, 10)] ?? '📦');
    await _createProduct(ctx, s._prodName, s._prodPrice, catId, emoji);
});
// ── Helper: tạo sản phẩm và reset session ───────────────────────────────────
async function _createProduct(ctx, name, price, categoryId, emoji = '📦') {
    const slug = name
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/gi, 'd')
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '') + '-' + Date.now();
    await ProductService.createProduct({
        name,
        slug,
        basePrice: price,
        productType: 'MANUAL_DELIVERY',
        deliveryType: 'SERVICE_ACTION',
        stockMode: 'UNLIMITED',
        thumbnailEmoji: emoji,
        ...(categoryId ? { categoryId } : {}),
    });
    const s = ctx.session;
    delete s._prodName;
    delete s._prodStep;
    delete s._prodPrice;
    delete s._prodCatId;
    ctx.session.adminTargetProductId = undefined;
    // Tìm tên danh mục để báo
    let catName = 'Không có danh mục';
    if (categoryId) {
        const cats = await ProductService.getAllCategories();
        catName = cats.find(c => c.id === categoryId)?.name ?? categoryId;
    }
    const replyMethod = ctx.callbackQuery
        ? (t, opts) => ctx.editMessageText(t, opts)
        : (t, opts) => ctx.reply(t, opts);
    await replyMethod(`✅ <b>TẠO SẢN PHẨM THÀNH CÔNG!</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `📦 Tên: <b>${name}</b>\n` +
        `💰 Giá: <b>${price.toLocaleString('vi-VN')}đ</b>\n` +
        `🎨 Icon: <b>${emoji.startsWith('custom:') ? '<tg-emoji emoji-id="' + emoji.slice(7) + '">📦</tg-emoji>' : emoji}</b>\n` +
        `📂 Danh mục: <b>${catName}</b>\n\n` +
        `<i>Vào chi tiết sản phẩm để nhập kho và bật bán!</i>`, { parse_mode: 'HTML' });
    return ctx.scene.reenter();
}
// ── Action: Chuyển sang nhập kho ────────────────────────────────────────────
adminProductScene.action(/^admin:stock:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    ctx.session.adminTargetProductId = ctx.match[1];
    return ctx.scene.enter(SCENES.ADMIN_STOCK);
});
// ── Navigation ────────────────────────────────────────────────────────────────
adminProductScene.action('back:ADMIN_PRODUCT', async (ctx) => {
    await ctx.answerCbQuery();
    const s = ctx.session;
    delete s._prodName;
    delete s._prodStep;
    delete s._prodPrice;
    delete s._prodCatId;
    ctx.session.adminTargetProductId = undefined;
    return ctx.scene.reenter();
});
adminProductScene.action('back:ADMIN_MENU', async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.scene.enter(SCENES.ADMIN_MENU);
});
