import prisma from '../../infrastructure/db.js';

export class StockService {
  /**
   * Reserves stock items for a pending order.
   * Throws if not enough available stock.
   */
  static async reserveStock(productId: string, quantity: number, orderId: string, reserveTimeMs: number) {
    return await prisma.$transaction(async (tx) => {
      // 1. Get available stock items with pessimistic lock (if DB supports it, Prisma handles via transactions)
      const availableStocks = await tx.stockItem.findMany({
        where: {
          productId,
          status: 'AVAILABLE'
        },
        take: quantity
      });

      if (availableStocks.length < quantity) {
        throw new Error('Not enough stock available to reserve');
      }

      const reservedUntil = new Date(Date.now() + reserveTimeMs);
      const stockIds = availableStocks.map(s => s.id);

      // 2. Reserve them
      await tx.stockItem.updateMany({
        where: {
          id: { in: stockIds }
        },
        data: {
          status: 'RESERVED',
          reservedByOrderId: orderId,
          reservedUntil
        }
      });

      // 3. Update Product stock count
      await tx.product.update({
        where: { id: productId },
        data: {
          stockCount: { decrement: quantity }
        }
      });

      return availableStocks;
    });
  }

  /**
   * Releases stock reservations if order expired.
   */
  static async releaseStock(orderId: string) {
    return await prisma.$transaction(async (tx) => {
      const reservedItems = await tx.stockItem.findMany({
        where: {
          reservedByOrderId: orderId,
          status: 'RESERVED'
        }
      });

      if (reservedItems.length === 0) return 0;

      // Group by productId to update counts
      const productCounts: Record<string, number> = {};
      reservedItems.forEach(item => {
        productCounts[item.productId] = (productCounts[item.productId] || 0) + 1;
      });

      // Update stock status
      await tx.stockItem.updateMany({
        where: {
          reservedByOrderId: orderId,
          status: 'RESERVED'
        },
        data: {
          status: 'AVAILABLE',
          reservedByOrderId: null,
          reservedUntil: null
        }
      });

      // Restore Product stock count
      for (const [productId, qty] of Object.entries(productCounts)) {
        await tx.product.update({
          where: { id: productId },
          data: {
            stockCount: { increment: qty }
          }
        });
      }

      return reservedItems.length;
    });
  }

  /**
   * Marks reserved stock as delivered when order is paid
   */
  static async deliverStock(orderId: string) {
    await prisma.stockItem.updateMany({
      where: {
        reservedByOrderId: orderId,
        status: 'RESERVED'
      },
      data: {
        status: 'DELIVERED',
        deliveredOrderId: orderId,
        deliveredAt: new Date()
      }
    });
  }
}
