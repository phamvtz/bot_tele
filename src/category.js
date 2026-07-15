import { Markup } from "telegraf";
import prisma from "./lib/prisma.js";
import { buildCategoriesKeyboard, buildProductsKeyboard, navBtn } from "./bot-ui/keyboards.js";
import {
    categoriesMessage,
    emptyCategoriesMessage,
    emptyProductsMessage,
    productsMessage,
} from "./bot-ui/messages.js";
import { formatCurrency, truncateText, escapeHtml, DIVIDER } from "./bot-ui/format.js";
import { getProductEmojis } from "./emoji-map.js";

const CATEGORY_PAGE_SIZE = 50;
const PRODUCT_PAGE_SIZE = 6;
const CACHE_TTL = 60000; // 60s

const CATEGORY_COPY = {
    vi: { all: "Tất cả sản phẩm", empty: "Hiện shop chưa có sản phẩm đang mở bán.", retry: "Hãy quay lại sau hoặc liên hệ hỗ trợ.", onSale: "gói đang mở bán", choose: "Chọn gói bên dưới để đặt hàng", previous: "Trước", next: "Sau", categories: "Danh mục", menu: "Menu", page: "Trang", out: "Hết", missing: "Danh mục không tồn tại hoặc đã bị tắt." },
    en: { all: "All products", empty: "There are no products on sale yet.", retry: "Please check back later or contact support.", onSale: "products on sale", choose: "Choose a product below to place an order", previous: "Previous", next: "Next", categories: "Categories", menu: "Menu", page: "Page", out: "Out", missing: "This category does not exist or is disabled." },
    zh: { all: "全部商品", empty: "商店暂时没有在售商品。", retry: "请稍后再来或联系客服。", onSale: "件商品在售", choose: "请选择下方商品下单", previous: "上一页", next: "下一页", categories: "分类", menu: "菜单", page: "页", out: "缺货", missing: "此分类不存在或已停用。" },
};

function categoryCopy(lang = "vi") {
    return CATEGORY_COPY[lang] || CATEGORY_COPY.vi;
}

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
    const rows = await prisma.stockItem.groupBy({
        by: ["productId"],
        where: { productId: { in: stockProducts.map(p => p.id) }, isSold: false },
        _count: { _all: true },
    });
    return new Map(rows.map(r => [r.productId, r._count._all]));
}

async function getSoldCounts(products) {
    if (!products.length) return new Map();
    const rows = await prisma.order.groupBy({
        by: ["productId"],
        where: { productId: { in: products.map(p => p.id) }, status: { in: ["PAID", "DELIVERED"] } },
        _count: { _all: true },
    });
    return new Map(rows.map(r => [r.productId, r._count._all]));
}

export async function renderCategoryList(page = 1, { lang = "vi" } = {}) {
    const categories = await getActiveCategories();
    if (!categories.length) {
        return {
            text: emptyCategoriesMessage(lang),
            keyboard: buildCategoriesKeyboard([], { lang }),
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
        text: categoriesMessage({ total: categories.length, productTotal, lang }),
        keyboard: buildCategoriesKeyboard(visibleCategories, { page: safePage, totalPages, lang }),
        parseMode: "HTML",
    };
}

const ALL_PRODUCTS_PAGE_SIZE = 8;

async function getAllActiveProducts() {
    const cached = cacheGet("all_active_products");
    if (cached) return cached;
    const result = await prisma.product.findMany({
        where: { isActive: true },
        orderBy: [{ createdAt: "desc" }],
    });
    cacheSet("all_active_products", result);
    return result;
}

export async function renderAllProducts(page = 1, { lang = "vi" } = {}) {
    const products = await getAllActiveProducts();
    const copy = categoryCopy(lang);

    if (!products.length) {
        return {
            text: `<b>${copy.all}</b>\n\n${copy.empty}\n${copy.retry}`,
            keyboard: Markup.inlineKeyboard([[Markup.button.callback(`🏠 ${copy.menu}`, "BACK_HOME")]]),
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
        let label;
        if (product.deliveryMode === "STOCK_LINES") {
            const count = stockById.get(product.id) ?? 0;
            const stockTag = count > 0 ? `[${count}]` : `[${copy.out}]`;
            label = `${stockTag} ${truncateText(product.name, 28).toUpperCase()}`;
        } else {
            label = truncateText(product.name, 32).toUpperCase();
        }
        return [{ text: label, callback_data: `product:${product.id}` }];
    });

    if (totalPages > 1) {
        const nav = [];
        if (safePage > 1) nav.push(Markup.button.callback(`‹ ${copy.previous}`, `all_products:${safePage - 1}`));
        if (safePage < totalPages) nav.push(Markup.button.callback(`${copy.next} ›`, `all_products:${safePage + 1}`));
        if (nav.length) rows.push(nav);
    }

    rows.push([
        navBtn("NAV_CATS", copy.categories, "LIST_PRODUCTS"),
        navBtn("BACK_HOME", copy.menu, "BACK_HOME"),
    ]);

    const pageTag = totalPages > 1 ? `  ·  ${copy.page} <b>${safePage}/${totalPages}</b>` : "";
    return {
        text: `<b>🛍 ${copy.all}</b>\n${DIVIDER}\n🛍 <b>${products.length}</b> ${copy.onSale}${pageTag}\n\n👇 ${copy.choose}`,
        keyboard: Markup.inlineKeyboard(rows),
        parseMode: "HTML",
    };
}

export async function renderProductsInCategory(categoryId, page = 1, { lang = "vi" } = {}) {
    const category = await getCategoryById(categoryId);
    if (!category) {
        return {
            text: categoryCopy(lang).missing,
            keyboard: buildCategoriesKeyboard([], { lang }),
            parseMode: "HTML",
        };
    }

    const products = category.products || [];
    if (!products.length) {
        return {
            text: emptyProductsMessage(category, lang),
            keyboard: buildProductsKeyboard([], { categoryId, page: 1, totalPages: 1, lang }),
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

    let text = productsMessage({
        category,
        products: visibleProducts,
        total: products.length,
        page: safePage,
        totalPages,
        stockById,
        emojiById,
        lang,
    });

    if (category.description) {
        text += `\n\n📋 ${escapeHtml(category.description)}`;
    }

    return {
        text,
        keyboard: buildProductsKeyboard(visibleProducts, {
            categoryId,
            page: safePage,
            totalPages,
            stockById,
            soldById,
            category,
            emojiById,
            lang,
        }),
        parseMode: "HTML",
        imageFileId: category.imageFileId || null,
    };
}
