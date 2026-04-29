import { describe, expect, it } from 'vitest';
import { Messages } from './messages.js';
describe('Messages', () => {
    it('formats wallet information with VND values', () => {
        const text = Messages.walletInfo({
            balance: 12345,
            frozenBalance: 500,
            totalDeposit: 50000,
            totalSpent: 15000,
            totalRefCommission: 3000,
        });
        expect(text).toContain('VÍ CỦA TÔI');
        expect(text).toContain((12345).toLocaleString('vi-VN'));
        expect(text).toContain((50000).toLocaleString('vi-VN'));
        expect(text).toContain((15000).toLocaleString('vi-VN'));
        expect(text).toContain((3000).toLocaleString('vi-VN'));
    });
    it('formats an order list entry', () => {
        const text = Messages.orderList([
            {
                orderCode: 'ORD-123',
                finalAmount: 250000,
                status: 'COMPLETED',
                createdAt: new Date('2026-04-25T00:00:00.000Z'),
                items: [{ productNameSnapshot: 'Nạp game', quantity: 2 }],
            },
        ], 0, 1);
        expect(text).toContain('LỊCH SỬ ĐƠN HÀNG');
        expect(text).toContain('ORD-123');
        expect(text).toContain('Nạp game');
        expect(text).toContain('Hoàn tất');
        expect(text).toContain((250000).toLocaleString('vi-VN'));
    });
    it('formats deposit success text', () => {
        const text = Messages.depositSuccess(50000, 125000);
        expect(text).toContain('NẠP TIỀN THÀNH CÔNG');
        expect(text).toContain((50000).toLocaleString('vi-VN'));
        expect(text).toContain((125000).toLocaleString('vi-VN'));
    });
});
