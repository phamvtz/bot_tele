import { Scenes } from 'telegraf';
import { BotContext, SCENES } from '../../context.js';
import { Keyboards } from '../../ui/keyboards.js';
import { ProductService } from '../../../modules/product/ProductService.js';

export const adminCategoryScene = new Scenes.BaseScene<BotContext>(SCENES.ADMIN_CATEGORY);

// ── Enter: Danh sách danh mục ─────────────────────────────────────────────────

adminCategoryScene.enter(async (ctx) => {
  ctx.session._catStep = undefined;
  ctx.session._catName = undefined;

  const categories = await ProductService.getAllCategories();
  const text =
    `📂 <b>QUẢN LÝ DANH MỤC</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🟢 Đang bật: <b>${categories.filter(c => c.isActive).length}</b>  ` +
    `🔴 Tắt: <b>${categories.filter(c => !c.isActive).length}</b>\n` +
    `Tổng: <b>${categories.length}</b> danh mục`;

  const keyboard = Keyboards.adminCategories(categories);

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard })
      .catch(() => ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard }));
    await ctx.answerCbQuery().catch(() => {});
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
  }
});

// ── Action: Bật/Tắt danh mục ─────────────────────────────────────────────────

adminCategoryScene.action(/^admin:cat:toggle:(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const categoryId = ctx.match[1];
  const cats = await ProductService.getAllCategories();
  const cat = cats.find(c => c.id === categoryId);
  if (!cat) return;

  await ProductService.updateCategory(categoryId, { isActive: !cat.isActive });
  await ctx.answerCbQuery(cat.isActive ? '🔴 Đã tắt!' : '🟢 Đã bật!', { show_alert: false });
  return ctx.scene.reenter();
});

// ── Action: Đổi tên danh mục ─────────────────────────────────────────────────

adminCategoryScene.action(/^admin:cat:rename:(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const categoryId = ctx.match[1];
  ctx.session._catStep = `rename:${categoryId}`;

  await ctx.reply(
    `✏️ <b>ĐỔI TÊN DANH MỤC</b>\n\nNhập tên mới:`,
    { parse_mode: 'HTML', reply_markup: Keyboards.backOnly('ADMIN_CATEGORY') }
  );
});

// ── Action: Đặt mô tả danh mục ───────────────────────────────────────────────

adminCategoryScene.action(/^admin:cat:desc:(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const categoryId = ctx.match[1];
  ctx.session._catStep = `desc:${categoryId}`;

  await ctx.reply(
    `📝 <b>MÔ TẢ DANH MỤC</b>\n\n` +
    `Nhập mô tả ngắn cho danh mục này:\n` +
    `<i>(Hiển thị khi user vào danh mục trong shop)</i>`,
    { parse_mode: 'HTML', reply_markup: Keyboards.backOnly('ADMIN_CATEGORY') }
  );
});

// ── Action: Tạo danh mục mới (1 bước — slug tự động) ─────────────────────────

adminCategoryScene.action('admin:cat:new', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.session._catStep = 'name';
  ctx.session._catName = undefined;

  await ctx.editMessageText(
    `📂 <b>TẠO DANH MỤC MỚI</b>\n\nNhập tên danh mục:\n<i>(Slug sẽ tự tạo, bạn có thể thêm mô tả sau)</i>`,
    { parse_mode: 'HTML', reply_markup: Keyboards.backOnly('ADMIN_CATEGORY') }
  );
});

// ── Text handler ─────────────────────────────────────────────────────────────

adminCategoryScene.on('text', async (ctx) => {
  const text = ctx.message.text.trim();
  const step = ctx.session._catStep;

  // Bỏ qua nếu là lệnh
  if (ctx.message.text.startsWith('/')) return;

  if (!step) return;

  // ─── Đổi tên ─────────────────────────────────────────────────────────────
  if (step.startsWith('rename:')) {
    const categoryId = step.replace('rename:', '');
    await ProductService.updateCategory(categoryId, { name: text });
    ctx.session._catStep = undefined;

    await ctx.reply(`✅ Đã đổi tên: <b>${text}</b>`, { parse_mode: 'HTML' });
    return ctx.scene.reenter();
  }

  // ─── Sửa mô tả ───────────────────────────────────────────────────────────
  if (step.startsWith('desc:')) {
    const categoryId = step.replace('desc:', '');
    await ProductService.updateCategory(categoryId, { description: text });
    ctx.session._catStep = undefined;

    await ctx.reply(
      `✅ <b>Đã lưu mô tả!</b>\n\n📝 ${text}`,
      { parse_mode: 'HTML' }
    );
    return ctx.scene.reenter();
  }

  // ─── Tạo mới: nhập tên → tự tạo slug ────────────────────────────────────
  if (step === 'name') {
    const slug = text
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/gi, 'd')
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      + '-' + Date.now().toString().slice(-6);

    await ProductService.createCategory({ name: text, slug, emoji: '📦' });

    ctx.session._catStep = undefined;
    ctx.session._catName = undefined;

    await ctx.reply(
      `✅ <b>Tạo danh mục thành công!</b>\n\n` +
      `📁 <b>${text}</b>\n` +
      `<i>Dùng nút 📝 Mô tả để thêm mô tả cho danh mục.</i>`,
      { parse_mode: 'HTML' }
    );
    return ctx.scene.reenter();
  }
});

// ── Navigation ────────────────────────────────────────────────────────────────

adminCategoryScene.action('back:ADMIN_CATEGORY', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.session._catStep = undefined;
  ctx.session._catName = undefined;
  return ctx.scene.reenter();
});

adminCategoryScene.action('back:ADMIN_MENU', async (ctx) => {
  await ctx.answerCbQuery();
  return ctx.scene.enter(SCENES.ADMIN_MENU);
});
