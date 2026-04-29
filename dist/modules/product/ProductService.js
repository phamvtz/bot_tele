import prisma from '../../infrastructure/db.js';
export class ProductService {
    // ─── Listing ───────────────────────────────────────────────────────────────
    static async listActiveCategories() {
        return prisma.category.findMany({
            where: { isActive: true },
            orderBy: { sortOrder: 'asc' },
        });
    }
    static async listFeaturedProducts(limit = 10) {
        return prisma.product.findMany({
            where: { isActive: true, isFeatured: true },
            include: { tags: true, category: true },
            orderBy: { sortOrder: 'asc' },
            take: limit,
        });
    }
    static async listProductsByCategory(categoryId, page = 0, limit = 10) {
        const [products, total] = await Promise.all([
            prisma.product.findMany({
                where: { isActive: true, categoryId },
                include: { tags: true, category: true },
                orderBy: { sortOrder: 'asc' },
                skip: page * limit,
                take: limit,
            }),
            prisma.product.count({ where: { isActive: true, categoryId } }),
        ]);
        return { products, total, totalPages: Math.ceil(total / limit), page };
    }
    static async listActiveProducts(page = 0, limit = 10) {
        const [products, total] = await Promise.all([
            prisma.product.findMany({
                where: { isActive: true },
                include: { tags: true, category: true },
                orderBy: { sortOrder: 'asc' },
                skip: page * limit,
                take: limit,
            }),
            prisma.product.count({ where: { isActive: true } }),
        ]);
        return { products, total, totalPages: Math.ceil(total / limit), page };
    }
    static async getProductDetail(productId) {
        return prisma.product.findUnique({
            where: { id: productId },
            include: { tags: true, category: true },
        });
    }
    // ─── Validation ────────────────────────────────────────────────────────────
    static async validatePurchaseQuantity(productId, quantity) {
        const product = await prisma.product.findUnique({
            where: { id: productId },
        });
        if (!product)
            throw new Error('Product not found');
        if (!product.isActive)
            throw new Error('Product is not active');
        if (quantity < product.minQty) {
            throw new Error(`Số lượng tối thiểu là ${product.minQty}`);
        }
        if (quantity > product.maxQty) {
            throw new Error(`Số lượng tối đa là ${product.maxQty}`);
        }
        if (product.stockMode !== 'UNLIMITED' && product.stockCount < quantity) {
            throw new Error('Not enough stock available');
        }
        return product;
    }
    // ─── Admin CRUD ────────────────────────────────────────────────────────────
    static async getAllCategories() {
        return prisma.category.findMany({ orderBy: { sortOrder: 'asc' } });
    }
    static async createCategory(data) {
        return prisma.category.create({ data });
    }
    static async updateCategory(categoryId, data) {
        return prisma.category.update({ where: { id: categoryId }, data });
    }
    static async getAllProducts(page = 0, limit = 10) {
        const [products, total] = await Promise.all([
            prisma.product.findMany({
                include: { tags: true, category: true },
                orderBy: { createdAt: 'desc' },
                skip: page * limit,
                take: limit,
            }),
            prisma.product.count(),
        ]);
        return { products, total, totalPages: Math.ceil(total / limit), page };
    }
    static async toggleProductActive(productId) {
        const product = await prisma.product.findUnique({ where: { id: productId } });
        if (!product)
            throw new Error('Product not found');
        return prisma.product.update({
            where: { id: productId },
            data: { isActive: !product.isActive },
        });
    }
    static async updateProductPrice(productId, basePrice, vipPrice) {
        return prisma.product.update({
            where: { id: productId },
            data: { basePrice, ...(vipPrice !== undefined ? { vipPrice } : {}) },
        });
    }
    static async createProduct(data) {
        return prisma.product.create({ data: { ...data, isActive: true } });
    }
}
