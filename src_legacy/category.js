import prisma from './lib/prisma.js';
import { Markup } from 'telegraf';

/**
 * Get all active categories ordered by order field
 */
export async function getActiveCategories() {
    return await prisma.category.findMany({
        where: { isActive: true },
        orderBy: { order: 'asc' },
        include: {
            _count: {
                select: { products: { where: { isActive: true } } }
            }
        }
    });
}

/**
 * Get category by ID
 */
export async function getCategoryById(id) {
    return await prisma.category.findUnique({
        where: { id },
        include: {
            products: {
                where: { isActive: true },
                orderBy: { createdAt: 'desc' }
            }
        }
    });
}

/**
 * Render category list for user
 */
export async function renderCategoryList() {
    const categories = await getActiveCategories();

    if (categories.length === 0) {
        return {
            text: "📭 *DANH MỤC TRỐNG*\n━━━━━━━━━━━━━━━━━━━━━━\n\n_Hiện tại chúng tôi chưa cập nhập sản phẩm mới. Vui lòng quay lại sau!_",
            keyboard: Markup.inlineKeyboard([[Markup.button.callback("🔙 Quay lại Menu", "BACK_HOME")]])
        };
    }

    const buttons = categories.map(cat => {
        const productCount = cat._count?.products || 0;
        return [Markup.button.callback(
            `${cat.icon} ${cat.name.toUpperCase()} (${productCount})`,
            `CATEGORY:${cat.id}`
        )];
    });

    buttons.push([Markup.button.callback("🔙 Quay lại Menu", "BACK_HOME")]);

    const text = 
        `🛒 *DANH MỤC SẢN PHẨM* 🛒\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `💡 _Vui lòng chọn nhóm sản phẩm bạn quan tâm bên dưới:_`;

    return {
        text,
        keyboard: Markup.inlineKeyboard(buttons)
    };
}

/**
 * Render products in a category
 */
export async function renderProductsInCategory(categoryId) {
    const category = await getCategoryById(categoryId);

    if (!category) {
        return {
            text: "❌ *LỖI:* Danh mục này không còn tồn tại.",
            keyboard: Markup.inlineKeyboard([[Markup.button.callback("🔙 Quay lại", "LIST_PRODUCTS")]])
        };
    }

    const products = category.products || [];

    if (products.length === 0) {
        return {
            text: 
                `${category.icon} *${category.name.toUpperCase()}*\n` +
                `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                `📭 Hiện tại danh mục này đang hết hàng.`,
            keyboard: Markup.inlineKeyboard([[Markup.button.callback("🔙 Quay lại Danh mục", "LIST_PRODUCTS")]])
        };
    }

    const productButtons = products.map(p => {
        const priceText = p.price === 0 ? "FREE" : `${p.price.toLocaleString()}đ`;
        return [Markup.button.callback(
            `📦 ${p.name} • ${priceText}`,
            `PRODUCT:${p.id}`
        )];
    });

    productButtons.push([Markup.button.callback("🔙 Quay lại Danh mục", "LIST_PRODUCTS")]);

    const text = 
        `${category.icon} *${category.name.toUpperCase()}* ${category.icon}\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `👇 *Danh sách sản phẩm đang bán:*`;

    return {
        text,
        keyboard: Markup.inlineKeyboard(productButtons)
    };
}
