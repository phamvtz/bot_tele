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
            text: "📭 *Hiện không có danh mục nào*\n\n_Vui lòng quay lại sau!_",
            keyboard: Markup.inlineKeyboard([[Markup.button.callback("🔙 Quay lại", "BACK_HOME")]])
        };
    }

    const buttons = categories.map(cat => {
        const productCount = cat._count?.products || 0;
        return [Markup.button.callback(
            `${cat.icon} ${cat.name} (${productCount})`,
            `CATEGORY:${cat.id}`
        )];
    });

    buttons.push([Markup.button.callback("🔙 Quay lại", "BACK_HOME")]);

    return {
        text: "🛒 *DANH MỤC SẢN PHẨM*\n\n📁 Chọn danh mục bạn muốn xem:",
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
            text: "❌ Danh mục không tồn tại",
            keyboard: Markup.inlineKeyboard([[Markup.button.callback("🔙 Quay lại", "LIST_PRODUCTS")]])
        };
    }

    const products = category.products || [];

    if (products.length === 0) {
        return {
            text: `${category.icon} *${category.name}*\n\n📭 Hiện chưa có sản phẩm nào trong danh mục này`,
            keyboard: Markup.inlineKeyboard([[Markup.button.callback("🔙 Danh mục", "LIST_PRODUCTS")]])
        };
    }

    const productButtons = products.map(p => {
        const priceText = p.price === 0 ? "Liên hệ" : `${p.price.toLocaleString()}đ`;
        return [Markup.button.callback(
            `${p.name} - ${priceText}`,
            `PRODUCT:${p.id}`
        )];
    });

    productButtons.push([Markup.button.callback("🔙 Danh mục", "LIST_PRODUCTS")]);

    return {
        text: `${category.icon} *${category.name}*\n\n📦 Chọn sản phẩm:`,
        keyboard: Markup.inlineKeyboard(productButtons)
    };
}
