import prisma from '../../infrastructure/db.js';
import cache, { CacheKeys, CacheTTL } from '../../infrastructure/cache.js';

export class ProductService {
  // ─── Listing ───────────────────────────────────────────────────────────────

  static async listActiveCategories() {
    const cached = cache.get<any[]>(CacheKeys.CATEGORIES);
    if (cached) return cached;

    const categories = await prisma.category.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
    cache.set(CacheKeys.CATEGORIES, categories, CacheTTL.CATEGORIES);
    return categories;
  }

  static async listFeaturedProducts(limit = 10) {
    const cached = cache.get<any[]>(CacheKeys.FEATURED);
    if (cached) return cached;

    const products = await prisma.product.findMany({
      where: { isActive: true, isFeatured: true },
      include: { tags: true, category: true },
      orderBy: { sortOrder: 'asc' },
      take: limit,
    });
    cache.set(CacheKeys.FEATURED, products, CacheTTL.PRODUCTS);
    return products;
  }

  static async listProductsByCategory(
    categoryId: string,
    page = 0,
    limit = 10
  ) {
    const cacheKey = CacheKeys.categoryProducts(categoryId, page);
    const cached = cache.get<any>(cacheKey);
    if (cached) return cached;

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

    const result = { products, total, totalPages: Math.ceil(total / limit), page };
    cache.set(cacheKey, result, CacheTTL.PRODUCTS);
    return result;
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

  /** Sản phẩm ACTIVE không thuộc danh mục nào → hiển thị thẳng trong menu shop */
  static async listUncategorizedProducts(limit = 20) {
    const cacheKey = 'products:uncategorized';
    const cached = cache.get<any[]>(cacheKey);
    if (cached) return cached;

    const products = await prisma.product.findMany({
      where: { isActive: true, categoryId: null },
      include: { tags: true },          // category luôn null → bỏ join
      orderBy: { sortOrder: 'asc' },
      take: limit,
    });
    cache.set(cacheKey, products, CacheTTL.PRODUCTS);
    return products;
  }

  static async getProductDetail(productId: string) {
    const cacheKey = CacheKeys.productDetail(productId);
    const cached = cache.get<any>(cacheKey);
    if (cached) return cached;

    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: { tags: true, category: true },
    });
    if (product) cache.set(cacheKey, product, CacheTTL.PRODUCT_DETAIL);
    return product;
  }

  // Invalidate product caches (gọi sau khi admin thay đổi sản phẩm/danh mục)
  static invalidateProductCaches() {
    cache.invalidatePrefix('products:');
    cache.invalidatePrefix('product:');
    cache.invalidate(CacheKeys.CATEGORIES);
    cache.invalidate(CacheKeys.FEATURED);
  }

  // ─── Validation ────────────────────────────────────────────────────────────

  static async validatePurchaseQuantity(productId: string, quantity: number) {
    const product = await prisma.product.findUnique({
      where: { id: productId },
    });

    if (!product) throw new Error('Không tìm thấy sản phẩm');
    if (!product.isActive) throw new Error('Sản phẩm đã ngừng bán');

    if (quantity < product.minQty) {
      throw new Error(`Số lượng tối thiểu là ${product.minQty}`);
    }
    if (quantity > product.maxQty) {
      throw new Error(`Số lượng tối đa là ${product.maxQty}`);
    }
    if (product.stockMode === 'TRACKED' && product.stockCount <= 0) {
      throw new Error('⚠️ Sản phẩm đã hết hàng!');
    }
    if (product.stockMode === 'TRACKED' && product.stockCount < quantity) {
      throw new Error(`⚠️ Chỉ còn ${product.stockCount} sản phẩm trong kho!`);
    }

    return product;
  }

  // ─── Admin CRUD ────────────────────────────────────────────────────────────

  static async getAllCategories() {
    return prisma.category.findMany({ orderBy: { sortOrder: 'asc' } });
  }

  static async createCategory(data: {
    name: string;
    slug: string;
    emoji?: string;
    description?: string;
  }) {
    return prisma.category.create({ data });
  }

  static async updateCategory(categoryId: string, data: {
    name?: string;
    emoji?: string;
    isActive?: boolean;
    description?: string;
  }) {
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

  static async toggleProductActive(productId: string) {
    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new Error('Product not found');
    return prisma.product.update({
      where: { id: productId },
      data: { isActive: !product.isActive },
    });
  }

  static async updateProductPrice(productId: string, basePrice: number, vipPrice?: number) {
    return prisma.product.update({
      where: { id: productId },
      data: { basePrice, ...(vipPrice !== undefined ? { vipPrice } : {}) },
    });
  }

  static async createProduct(data: {
    name: string;
    slug: string;
    basePrice: number;
    productType: 'AUTO_DELIVERY' | 'MANUAL_DELIVERY' | 'SERVICE';
    deliveryType: 'DIGITAL_CODE' | 'ACCOUNT' | 'SERVICE_ACTION';
    stockMode: 'TRACKED' | 'UNLIMITED' | 'MANUAL';
    categoryId?: string;
    thumbnailEmoji?: string;
    shortDescription?: string;
  }) {
    return prisma.product.create({ data: { ...data, isActive: true } });
  }

  static async updateProduct(productId: string, data: {
    name?: string;
    thumbnailEmoji?: string;
    shortDescription?: string;
    categoryId?: string;
  }) {
    ProductService.invalidateProductCaches();
    return prisma.product.update({ where: { id: productId }, data });
  }
}
