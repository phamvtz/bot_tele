import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => {
    const tx = {
        stockImportBatch: {
            create: vi.fn(async () => ({ id: 'batch-1' })),
        },
        stockItem: {
            createMany: vi.fn(async () => ({ count: 0 })),
        },
        product: {
            update: vi.fn(async () => ({ id: 'product-1' })),
        },
        auditLog: {
            create: vi.fn(async () => ({ id: 'audit-1' })),
        },
    };
    return {
        tx,
        prisma: {
            $transaction: vi.fn(async (callback) => callback(tx)),
        },
    };
});
vi.mock('../../infrastructure/db.js', () => ({
    default: mocks.prisma,
}));
import { AdminService } from './AdminService.js';
describe('AdminService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });
    it('imports tk|mk|2fa stock lines without altering the payload', async () => {
        const result = await AdminService.importStockText('admin-1', 'product-1', [
            ' user@example.com|FakePassword123!|JBSWY3DPEHPK3PXP ',
            '',
            'second@example.com|AnotherPassword456!|MFRGGZDFMZTWQ2LK',
        ]);
        expect(result).toEqual({ importedCount: 2, batchId: 'batch-1' });
        expect(mocks.tx.stockImportBatch.create).toHaveBeenCalledWith({
            data: {
                productId: 'product-1',
                totalItems: 2,
                validItems: 2,
                sourceType: 'TEXT',
                createdByAdminId: 'admin-1',
            },
        });
        expect(mocks.tx.stockItem.createMany).toHaveBeenCalledWith({
            data: [
                {
                    productId: 'product-1',
                    content: 'user@example.com|FakePassword123!|JBSWY3DPEHPK3PXP',
                    status: 'AVAILABLE',
                    importBatchId: 'batch-1',
                },
                {
                    productId: 'product-1',
                    content: 'second@example.com|AnotherPassword456!|MFRGGZDFMZTWQ2LK',
                    status: 'AVAILABLE',
                    importBatchId: 'batch-1',
                },
            ],
        });
        expect(mocks.tx.product.update).toHaveBeenCalledWith({
            where: { id: 'product-1' },
            data: { stockCount: { increment: 2 } },
        });
    });
});
