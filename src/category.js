import { Markup } from "telegraf";
import prisma from "./lib/prisma.js";
import { buildCategoriesKeyboard, buildProductsKeyboard, navBtn } from "./bot-ui/keyboards.js";
import {
    categoriesMessage,
    emptyCategoriesMessage,
    emptyProductsMessage,
    productsMessage,
} from "./bot-ui/messages.js";
import { truncateText, escapeHtml, DIVIDER } from "./bot-ui/format.js";
import { getProductEmojis } from "./emoji-map.js";
import { getStockCount } from "./inventory.js";
import { iconOf } from "./menu-config.js";
import { applyFlashToProducts, getActiveFlashOffers } from "./flash-sale.js";

const CATEGORY_PAGE_SIZE = 50;
const PRODUCT_PAGE_SIZE = 6;
// TTL dài vì danh mục/sản phẩm gần như không đổi, và invalidateCategoryCache()
// đã được gọi ở mọi đường sửa dữ liệu (admin bot, API web, server) — 20 call site.
// Với Mongo Atlas ở xa (~200ms/query), TTL 60s làm khách phải chờ query thật liên tục.
const CACHE_TTL = 1800000; // 30 phút

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
                // unlisted: { not: true } — KHÔNG dùng `unlisted: false`. Document cũ
                // trong Mongo chưa có field này; `not: true` → $ne: true nên vẫn khớp,
                // còn `false` sẽ làm toàn bộ hàng cũ biến mất khỏi shop.
                select: { products: { where: { isActive: true, unlisted: { not: true } } } },
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
                where: { isActive: true, unlisted: { not: true } },
                orderBy: { createdAt: "desc" },
            },
        },
    });
    if (result) cacheSet(key, result);
    return result;
}

// Tồn kho: dùng getStockCount (inventory.js) — đã cache 30s/product và dùng
// countDocuments ở tầng Mongo. TRÁNH groupBy vì adapter Mongo groupBy phải findMany
// TOÀN BỘ StockItem doc (kể cả field content nặng) rồi đếm trong JS — rất tốn mỗi
// lần khách xem danh sách. Đếm song song, tận dụng cache chung + invalidate khi bán.
async function getStockCounts(products) {
    const stockProducts = products.filter(p => p.deliveryMode === "STOCK_LINES");
    if (!stockProducts.length) return new Map();
    const counts = await Promise.all(
        stockProducts.map(p => getStockCount(p.id).catch(() => 0))
    );
    return new Map(stockProducts.map((p, i) => [p.id, counts[i]]));
}

/**
 * Ưu đãi flash sale là THEO TỪNG KHÁCH, còn `_cache` ở trên là DÙNG CHUNG và sống
 * 30 phút. Vì vậy việc áp giá phải xảy ra SAU khi đọc cache và trên BẢN COPY —
 * `applyFlashToProducts` spread chứ không mutate, nên không có đường nào để giá giảm
 * của một người nằm lại trong cache rồi hiện cho người khác.
 *
 * `telegramId` bỏ trống (caller cũ, hoặc ngữ cảnh không có người dùng như background
 * job) → không có ưu đãi, hệt hành vi trước đây.
 */
async function withFlashPrices(products, { telegramId = null, isAdmin = false } = {}) {
    if (!telegramId || isAdmin || !products?.length) return products || [];
    return applyFlashToProducts(products, telegramId, { isAdmin });
}

async function flashOffersById(products, { telegramId = null, isAdmin = false } = {}) {
    if (!telegramId || isAdmin || !products?.length) return new Map();
    return getActiveFlashOffers(telegramId, products.map((p) => p?.id), { isAdmin });
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
        where: { isActive: true, unlisted: { not: true } },
        orderBy: [{ createdAt: "desc" }],
    });
    cacheSet("all_active_products", result);
    return result;
}

export async function renderAllProducts(page = 1, { lang = "vi", telegramId = null, isAdmin = false } = {}) {
    const products = await getAllActiveProducts();
    const copy = categoryCopy(lang);

    if (!products.length) {
        return {
            text: `<b>${copy.all}</b>\n\n${copy.empty}\n${copy.retry}`,
            keyboard: Markup.inlineKeyboard([[navBtn("BACK_HOME", copy.menu, "BACK_HOME")]]),
            parseMode: "HTML",
        };
    }

    const totalPages = Math.max(1, Math.ceil(products.length / ALL_PRODUCTS_PAGE_SIZE));
    const safePage = Math.min(Math.max(Number(page) || 1, 1), totalPages);
    const start = (safePage - 1) * ALL_PRODUCTS_PAGE_SIZE;
    // Áp flash sale CHỈ cho trang đang hiện — tra cả kho sản phẩm là phí một query lớn
    // cho những món khách chưa lật tới.
    const visibleProducts = await withFlashPrices(products.slice(start, start + ALL_PRODUCTS_PAGE_SIZE), { telegramId, isAdmin });
    const flashById = await flashOffersById(visibleProducts, { telegramId, isAdmin });
    // Chỉ cần stockById để hiện tồn kho. soldById/emojiById từng được fetch ở đây
    // nhưng KHÔNG được dùng trong render → bỏ để tiết kiệm 2 query mỗi lần bấm.
    const stockById = await getStockCounts(visibleProducts);

    const rows = visibleProducts.map((product) => {
        const pct = Number(flashById.get(product.id)?.discountPct) || 0;
        let label;
        if (product.deliveryMode === "STOCK_LINES") {
            const count = stockById.get(product.id) ?? 0;
            const stockTag = count > 0 ? `[${count}]` : `[${copy.out}]`;
            label = `${pct ? "⚡ " : ""}${stockTag} ${truncateText(product.name, pct ? 24 : 28).toUpperCase()}${pct ? ` −${pct}%` : ""}`;
        } else {
            label = `${pct ? "⚡ " : ""}${truncateText(product.name, pct ? 28 : 32).toUpperCase()}${pct ? ` −${pct}%` : ""}`;
        }
        return [{ text: label, callback_data: `product:${product.id}` }];
    });

    if (totalPages > 1) {
        const nav = [];
        if (safePage > 1) nav.push(navBtn("NAV_PREV", copy.previous, `all_products:${safePage - 1}`));
        if (safePage < totalPages) nav.push(navBtn("NAV_NEXT", copy.next, `all_products:${safePage + 1}`));
        if (nav.length) rows.push(nav);
    }

    rows.push([
        navBtn("NAV_CATS", copy.categories, "LIST_PRODUCTS"),
        navBtn("BACK_HOME", copy.menu, "BACK_HOME"),
    ]);

    const pageTag = totalPages > 1 ? `  ·  ${copy.page} <b>${safePage}/${totalPages}</b>` : "";
    return {
        text: `<b>${iconOf("TITLE_PRODUCTS")} ${copy.all}</b>\n${DIVIDER}\n${iconOf("TITLE_PRODUCTS")} <b>${products.length}</b> ${copy.onSale}${pageTag}\n\n${iconOf("PROMPT_CHOOSE")} ${copy.choose}`,
        keyboard: Markup.inlineKeyboard(rows),
        parseMode: "HTML",
    };
}

export async function renderProductsInCategory(categoryId, page = 1, { lang = "vi", telegramId = null, isAdmin = false } = {}) {
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
    const visibleProducts = await withFlashPrices(products.slice(start, start + PRODUCT_PAGE_SIZE), { telegramId, isAdmin });
    // soldById từng được fetch ở đây nhưng KHÔNG dùng trong render (compactProductLabel
    // chỉ đọc stockById; productsMessage không nhận soldById) → bỏ để tiết kiệm 1 query.
    const [stockById, emojiById, flashById] = await Promise.all([
        getStockCounts(visibleProducts),
        getProductEmojis(visibleProducts),
        flashOffersById(visibleProducts, { telegramId, isAdmin }),
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
        text += `\n\n${iconOf("DELIVERY_DESC")} ${escapeHtml(category.description)}`;
    }

    return {
        text,
        keyboard: buildProductsKeyboard(visibleProducts, {
            categoryId,
            page: safePage,
            totalPages,
            stockById,
            category,
            emojiById,
            lang,
            flashById,
        }),
        parseMode: "HTML",
        imageFileId: category.imageFileId || null,
    };
}
