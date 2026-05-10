import prisma from "./lib/prisma.js";
import { buildCategoriesKeyboard, buildProductsKeyboard } from "./bot-ui/keyboards.js";
import {
    categoriesMessage,
    emptyCategoriesMessage,
    emptyProductsMessage,
    productsMessage,
} from "./bot-ui/messages.js";

const CATEGORY_PAGE_SIZE = 10;
const PRODUCT_PAGE_SIZE = 6;

export async function getActiveCategories() {
    return await prisma.category.findMany({
        where: { isActive: true },
        orderBy: [{ order: "asc" }, { name: "asc" }],
        include: {
            _count: {
                select: { products: { where: { isActive: true } } },
            },
        },
    });
}

export async function getCategoryById(id) {
    return await prisma.category.findUnique({
        where: { id },
        include: {
            products: {
                where: { isActive: true },
                orderBy: { createdAt: "desc" },
            },
        },
    });
}

async function getStockCounts(products) {
    const stockProductIds = products
        .filter((product) => product.deliveryMode === "STOCK_LINES")
        .map((product) => product.id);

    if (!stockProductIds.length) return new Map();

    const counts = await prisma.stockItem.groupBy({
        by: ["productId"],
        where: {
            productId: { in: stockProductIds },
            isSold: false,
        },
        _count: { _all: true },
    });

    return new Map(counts.map((item) => [item.productId, item._count._all]));
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

    return {
        text: categoriesMessage({ total: categories.length }),
        keyboard: buildCategoriesKeyboard(visibleCategories, { page: safePage, totalPages }),
        parseMode: "HTML",
    };
}

export async function renderProductsInCategory(categoryId, page = 1) {
    const category = await getCategoryById(categoryId);
    if (!category) {
        return {
            text: "❌ Danh mục không tồn tại hoặc đã bị tắt.",
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
    const stockById = await getStockCounts(visibleProducts);

    return {
        text: productsMessage({
            category,
            products: visibleProducts,
            total: products.length,
            page: safePage,
            totalPages,
            stockById,
        }),
        keyboard: buildProductsKeyboard(visibleProducts, {
            categoryId,
            page: safePage,
            totalPages,
        }),
        parseMode: "HTML",
    };
}
