import { beforeEach, describe, expect, it } from 'vitest';
import eventBus from './events.js';
describe('Bot event bus', () => {
    beforeEach(() => {
        eventBus.removeAllListeners();
    });
    it('emits payment received events to subscribers', async () => {
        const payload = {
            requestId: 'req-1',
            userId: 'user-1',
            telegramId: '123456789',
            amount: 50000,
            type: 'DEPOSIT',
        };
        let received;
        await new Promise((resolve) => {
            eventBus.onPaymentReceived((event) => {
                received = event;
                resolve();
            });
            eventBus.emitPaymentReceived(payload);
        });
        expect(received).toEqual(payload);
    });
    it('emits order completed events to subscribers', async () => {
        const payload = {
            order: {
                id: 'order-1',
                orderCode: 'ORD-001',
                finalAmount: 250000,
            },
            userId: 'user-1',
            telegramId: '123456789',
        };
        let received;
        await new Promise((resolve) => {
            eventBus.onOrderCompleted((event) => {
                received = event;
                resolve();
            });
            eventBus.emitOrderCompleted(payload);
        });
        expect(received).toEqual(payload);
    });
});
