import prisma from '../../infrastructure/db.js';
export class AdminService {
    /**
     * Flow 12.2: Create a new Product
     */
    static async createProduct(adminId, data) {
        // Audit Log Creation
        const product = await prisma.product.create({
            data: {
                ...data,
                isActive: true,
            }
        });
        await prisma.auditLog.create({
            data: {
                adminId,
                actionType: 'CREATE_PRODUCT',
                targetType: 'PRODUCT',
                targetId: product.id,
                newDataJson: JSON.stringify(data)
            }
        });
        return product;
    }
    /**
     * Flow 12.3: Import Stock from Text line by line
     */
    static async importStockText(adminId, productId, textLines) {
        const validLines = textLines.map(l => l.trim()).filter(l => l.length > 0);
        if (validLines.length === 0)
            throw new Error('Không có dòng hợp lệ nào');
        // Kiểm tra sản phẩm tồn tại
        const product = await prisma.product.findUnique({ where: { id: productId } });
        if (!product)
            throw new Error('Sản phẩm không tồn tại');
        // Phát hiện duplicate — lấy tất cả content hiện có
        const existingItems = await prisma.stockItem.findMany({
            where: { productId, status: { in: ['AVAILABLE', 'RESERVED'] } },
            select: { content: true }
        });
        const existingSet = new Set(existingItems.map(i => i.content.trim()));
        const newLines = validLines.filter(l => !existingSet.has(l));
        const dupeLines = validLines.filter(l => existingSet.has(l));
        if (newLines.length === 0) {
            return { importedCount: 0, dupeCount: dupeLines.length, batchId: null, skipped: dupeLines };
        }
        // Tạo batch log
        const batch = await prisma.stockImportBatch.create({
            data: {
                productId,
                totalItems: validLines.length,
                validItems: newLines.length,
                invalidItems: dupeLines.length,
                sourceType: 'TEXT',
                createdByAdminId: adminId
            }
        });
        // Insert stock items (sequential để tránh MongoDB deadlock)
        await prisma.stockItem.createMany({
            data: newLines.map(line => ({
                productId,
                content: line,
                status: 'AVAILABLE',
                importBatchId: batch.id
            }))
        });
        // Cập nhật stockCount
        await prisma.product.update({
            where: { id: productId },
            data: { stockCount: { increment: newLines.length } }
        });
        // Audit log
        await prisma.auditLog.create({
            data: {
                adminId,
                actionType: 'IMPORT_STOCK_TEXT',
                targetType: 'PRODUCT',
                targetId: productId,
                newDataJson: JSON.stringify({ imported: newLines.length, dupes: dupeLines.length })
            }
        });
        return { importedCount: newLines.length, dupeCount: dupeLines.length, batchId: batch.id, skipped: dupeLines };
    }
    /**
     * Add/Subtract balance manually for a user (Flow 12.4)
     */
    static async adjustUserBalance(adminId, userId, amount, isAddition, reason) {
        if (amount <= 0)
            throw new Error('Amount must be positive');
        const wallet = await prisma.wallet.findUnique({ where: { userId } });
        if (!wallet)
            throw new Error('User wallet not found');
        const balanceBefore = wallet.balance;
        const balanceAfter = isAddition ? (balanceBefore + amount) : (balanceBefore - amount);
        if (!isAddition && balanceAfter < 0) {
            throw new Error('Số dư hiện tại không đủ để trừ');
        }
        const updatedWallet = await prisma.wallet.update({
            where: { id: wallet.id },
            data: { balance: balanceAfter }
        });
        await prisma.walletTransaction.create({
            data: {
                userId,
                walletId: wallet.id,
                type: 'ADMIN_ADJUSTMENT',
                direction: isAddition ? 'IN' : 'OUT',
                amount,
                balanceBefore,
                balanceAfter,
                referenceType: 'MANUAL',
                referenceId: adminId,
                description: reason
            }
        });
        await prisma.auditLog.create({
            data: {
                adminId,
                actionType: isAddition ? 'ADD_BALANCE' : 'SUBTRACT_BALANCE',
                targetType: 'USER',
                targetId: userId,
                oldDataJson: JSON.stringify({ balance: balanceBefore }),
                newDataJson: JSON.stringify({ balance: balanceAfter, reason })
            }
        });
        return updatedWallet;
    }
}
