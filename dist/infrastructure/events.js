import { EventEmitter } from 'events';
// ─── Event Names ─────────────────────────────────────────────────────────────
export const BOT_EVENTS = {
    ORDER_COMPLETED: 'ORDER_COMPLETED',
    PAYMENT_RECEIVED: 'PAYMENT_RECEIVED',
    USER_REGISTERED: 'USER_REGISTERED',
    LOW_STOCK_ALERT: 'LOW_STOCK_ALERT',
};
// ─── Typed EventEmitter ───────────────────────────────────────────────────────
class BotEventBus extends EventEmitter {
    emitOrderCompleted(payload) {
        this.emit(BOT_EVENTS.ORDER_COMPLETED, payload);
    }
    emitPaymentReceived(payload) {
        this.emit(BOT_EVENTS.PAYMENT_RECEIVED, payload);
    }
    emitUserRegistered(payload) {
        this.emit(BOT_EVENTS.USER_REGISTERED, payload);
    }
    emitLowStockAlert(productId, productName, remaining) {
        this.emit(BOT_EVENTS.LOW_STOCK_ALERT, { productId, productName, remaining });
    }
    onOrderCompleted(listener) {
        this.on(BOT_EVENTS.ORDER_COMPLETED, listener);
    }
    onPaymentReceived(listener) {
        this.on(BOT_EVENTS.PAYMENT_RECEIVED, listener);
    }
    onUserRegistered(listener) {
        this.on(BOT_EVENTS.USER_REGISTERED, listener);
    }
}
// Singleton Event Bus
export const eventBus = new BotEventBus();
export default eventBus;
