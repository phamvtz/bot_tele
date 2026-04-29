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
            throw new Error('No valid stock lines found');
        return await prisma.$transaction(async (tx) => {
            // Create Batch Log
            const batch = await tx.stockImportBatch.create({
                data: {
                    productId,
                    totalItems: validLines.length,
                    validItems: validLines.length,
                    sourceType: 'TEXT',
                    createdByAdminId: adminId
                }
            });
            // Insert Items
            const stockData = validLines.map(line => ({
                productId,
                content: line,
                status: 'AVAILABLE',
                importBatchId: batch.id
            }));
            await tx.stockItem.createMany({ data: stockData });
            // Update Product Stock Count
            await tx.product.update({
                where: { id: productId },
                data: { stockCount: { increment: validLines.length } }
            });
            // Audit Log Creation
            await tx.auditLog.create({
                data: {
                    adminId,
                    actionType: 'IMPORT_STOCK_TEXT',
                    targetType: 'PRODUCT',
                    targetId: productId,
                    newDataJson: JSON.stringify({ count: validLines.length })
                }
            });
            return { importedCount: validLines.length, batchId: batch.id };
        });
    }
    /**
     * Add/Subtract balance manually for a user (Flow 12.4)
     */
    static async adjustUserBalance(adminId, userId, amount, isAddition, reason) {
        if (amount <= 0)
            throw new Error('Amount must be positive');
        return await prisma.$transaction(async (tx) => {
            const wallet = await tx.wallet.findUnique({ where: { userId } });
            if (!wallet)
                throw new Error('User wallet not found');
            const balanceBefore = wallet.balance;
            const balanceAfter = isAddition ? (balanceBefore + amount) : (balanceBefore - amount);
            if (!isAddition && balanceAfter < 0) {
                throw new Error('Current balance is lower than deduction amount');
            }
            const updatedWallet = await tx.wallet.update({
                where: { id: wallet.id },
                data: { balance: balanceAfter }
            });
            await tx.walletTransaction.create({
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
            await tx.auditLog.create({
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
        });
    }
}
