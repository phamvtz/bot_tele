import { Markup } from "telegraf";
import prisma from "./lib/prisma.js";
import { buildCategoriesKeyboard, buildProductsKeyboard } from "./bot-ui/keyboards.js";
import {
    categoriesMessage,
    emptyCategoriesMessage,
    emptyProductsMessage,
    productsMessage,
} from "./bot-ui/messages.js";
import { formatCurrency, truncateText } from "./bot-ui/format.js";
import { getProductEmojis } from "./emoji-map.js";

const CATEGORY_PAGE_SIZE = 50;
const PRODUCT_PAGE_SIZE = 6;
const CACHE_TTL = 30000; // 30s

const _cache = new Map();
function cacheGet(key) {
    const entry = _cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > CACHE_TTL) { _cache.delete(key); return null; }
    return entry.value;
}
function cacheSet(key, value) { _cache.set(key, { value, ts: Date.now() }); }
export function invalidateCategoryCache() { _cache.clear(); }

export async function getActiveCategories() {
    const cached = cacheGet("active_categories");
    if (cached) return cached;
    const result = await prisma.category.findMany({
        where: { isActive: true },
        orderBy: [{ order: "asc" }, { name: "asc" }],
        include: {
            _count: {
                select: { products: { where: { isActive: true } } },
            },
        },
    });
    cacheSet("active_categories", result);
    return result;
}

export async function getCategoryById(id) {
    const key = `category_${id}`;
    const cached = cacheGet(key);
    if (cached) return cached;
    const result = await prisma.category.findUnique({
        where: { id },
        include: {
            products: {
                where: { isActive: true },
                orderBy: { createdAt: "desc" },
            },
        },
    });
    if (result) cacheSet(key, result);
    return result;
}

async function getStockCounts(products) {
    const stockProducts = products.filter(p => p.deliveryMode === "STOCK_LINES");
    if (!stockProducts.length) return new Map();

    const counts = await Promise.all(
        stockProducts.map(p => prisma.stockItem.count({ where: { productId: p.id, isSold: false } }))
    );
    return new Map(stockProducts.map((p, i) => [p.id, counts[i]]));
}

async function getSoldCounts(products) {
    if (!products.length) return new Map();
    const counts = await Promise.all(
        products.map(p => prisma.order.count({ where: { productId: p.id, status: { in: ["PAID", "DELIVERED"] } } }))
    );
    return new Map(products.map((p, i) => [p.id, counts[i]]));
}

export async function renderCategoryList(page = 1) {
    const categories = await getActiveCategories();
    if (!categories.length) {
        return {
            text: emptyCategoriesMessage(),
            keyboard: buildCategoriesKeyboard([]),
            parseMode: "HTML",
        };
    }

    const totalPages = Math.max(1, Math.ceil(categories.length / CATEGORY_PAGE_SIZE));
    const safePage = Math.min(Math.max(Number(page) || 1, 1), totalPages);
    const start = (safePage - 1) * CATEGORY_PAGE_SIZE;
    const visibleCategories = categories.slice(start, start + CATEGORY_PAGE_SIZE);
    const productTotal = categories.reduce((sum, category) => {
        return sum + (category._count?.products || 0);
    }, 0);

    return {
        text: categoriesMessage({ total: categories.length, productTotal }),
        keyboard: buildCategoriesKeyboard(visibleCategories, { page: safePage, totalPages }),
        parseMode: "HTML",
    };
}

const ALL_PRODUCTS_PAGE_SIZE = 8;

export async function renderAllProducts(page = 1) {
    const products = await prisma.product.findMany({
        where: { isActive: true },
        orderBy: [{ createdAt: "desc" }],
    });

    if (!products.length) {
        return {
            text: `<b>Tất cả sản phẩm</b>\n\nHiện shop chưa có sản phẩm đang mở bán.\nHãy quay lại sau hoặc liên hệ hỗ trợ.`,
            keyboard: Markup.inlineKeyboard([[Markup.button.callback("🏠 Menu", "BACK_HOME")]]),
            parseMode: "HTML",
        };
    }

    const totalPages = Math.max(1, Math.ceil(products.length / ALL_PRODUCTS_PAGE_SIZE));
    const safePage = Math.min(Math.max(Number(page) || 1, 1), totalPages);
    const start = (safePage - 1) * ALL_PRODUCTS_PAGE_SIZE;
    const visibleProducts = products.slice(start, start + ALL_PRODUCTS_PAGE_SIZE);
    const [stockById, soldById, emojiById] = await Promise.all([
        getStockCounts(visibleProducts),
        getSoldCounts(visibleProducts),
        getProductEmojis(visibleProducts),
    ]);

    const rows = visibleProducts.map((product) => {
        const price = product.price > 0 ? formatCurrency(product.price, product.currency) : "Miễn phí";
        const emoji = emojiById.get(product.id);
        const sold = soldById.get(product.id) ?? 0;
        const soldSuffix = sold > 0 ? ` · Đã bán ${sold}` : "";
        let label;
        if (product.deliveryMode === "STOCK_LINES") {
            const count = stockById.get(product.id) ?? 0;
            if (count <= 0) {
                label = `🔴 ${truncateText(product.name, 22)} · ${price} · Hết${soldSuffix}`;
            } else {
                label = `🟢 ${truncateText(product.name, 22)} · ${price} · Còn ${count}${soldSuffix}`;
            }
        } else {
            const icon = emoji?.char || "🟢";
            label = `${icon} ${truncateText(product.name, 26)} · ${price}${soldSuffix}`;
        }
        const btn = { text: label, callback_data: `product:${product.id}` };
        if (emoji?.id) btn.icon_custom_emoji_id = emoji.id;
        return [btn];
    });

    if (totalPages > 1) {
        const nav = [];
        if (safePage > 1) nav.push(Markup.button.callback("‹ Trước", `all_products:${safePage - 1}`));
        if (safePage < totalPages) nav.push(Markup.button.callback("Sau ›", `all_products:${safePage + 1}`));
        if (nav.length) rows.push(nav);
    }

    rows.push([
        Markup.button.callback("📁 Danh mục", "LIST_PRODUCTS"),
        Markup.button.callback("🏠 Menu", "BACK_HOME"),
    ]);

    return {
        text: `<b>Tất cả sản phẩm</b>\n\nTìm thấy <b>${products.length}</b> sản phẩm đang mở bán.\nTrang <b>${safePage}/${totalPages}</b>.`,
        keyboard: Markup.inlineKeyboard(rows),
        parseMode: "HTML",
    };
}

export async function renderProductsInCategory(categoryId, page = 1) {
    const category = await getCategoryById(categoryId);
    if (!category) {
        return {
            text: "Danh mục không tồn tại hoặc đã bị tắt.",
            keyboard: buildCategoriesKeyboard([]),
            parseMode: "HTML",
        };
    }

    const products = category.products || [];
    if (!products.length) {
        return {
            text: emptyProductsMessage(category),
            keyboard: buildProductsKeyboard([], { categoryId, page: 1, totalPages: 1 }),
            parseMode: "HTML",
        };
    }

    const totalPages = Math.max(1, Math.ceil(products.length / PRODUCT_PAGE_SIZE));
    const safePage = Math.min(Math.max(Number(page) || 1, 1), totalPages);
    const start = (safePage - 1) * PRODUCT_PAGE_SIZE;
    const visibleProducts = products.slice(start, start + PRODUCT_PAGE_SIZE);
    const [stockById, soldById, emojiById] = await Promise.all([
        getStockCounts(visibleProducts),
        getSoldCounts(visibleProducts),
        getProductEmojis(visibleProducts),
    ]);

    return {
        text: productsMessage({
            category,
            products: visibleProducts,
            total: products.length,
            page: safePage,
            totalPages,
            stockById,
            emojiById,
        }),
        keyboard: buildProductsKeyboard(visibleProducts, {
            categoryId,
            page: safePage,
            totalPages,
            stockById,
            soldById,
            category,
            emojiById,
        }),
        parseMode: "HTML",
    };
}
