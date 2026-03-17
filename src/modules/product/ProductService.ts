import prisma from '../../infrastructure/db.js';

export class ProductService {
  static async listActiveProducts(categoryId?: string) {
    return prisma.product.findMany({
      where: {
        isActive: true,
      },
      orderBy: { sortOrder: 'asc' }
    });
  }

  static async getProductDetail(productId: string) {
    return prisma.product.findUnique({
      where: { id: productId },
      include: {
        tags: true
      }
    });
  }

  static async validatePurchaseQuantity(productId: string, quantity: number) {
    const product = await prisma.product.findUnique({
      where: { id: productId }
    });

    if (!product) throw new Error('Product not found');
    if (!product.isActive) throw new Error('Product is not active');
    
    if (quantity < product.minQty) {
      throw new Error(`Minimum quantity is ${product.minQty}`);
    }
    if (quantity > product.maxQty) {
      throw new Error(`Maximum quantity is ${product.maxQty}`);
    }

    if (product.stockMode !== 'UNLIMITED' && product.stockCount < quantity) {
      throw new Error('Not enough stock available');
    }

    return product;
  }
}
