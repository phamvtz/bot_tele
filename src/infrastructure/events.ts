import { EventEmitter } from 'events';
import type { Prisma } from '@prisma/client';

type Order = Prisma.OrderGetPayload<object>;
type User = Prisma.UserGetPayload<object>;

// ─── Typed Event Payloads ────────────────────────────────────────────────────

export interface OrderCompletedPayload {
  order: Order;
  userId: string;
  telegramId: string;
}

export interface PaymentReceivedPayload {
  requestId: string;
  userId: string;
  telegramId: string;
  amount: number;
  type: 'DEPOSIT' | 'ORDER_PAYMENT';
  orderId?: string;
}

export interface UserRegisteredPayload {
  user: User;
  referredByCode?: string;
}

// ─── Event Names ─────────────────────────────────────────────────────────────

export const BOT_EVENTS = {
  ORDER_COMPLETED: 'ORDER_COMPLETED',
  PAYMENT_RECEIVED: 'PAYMENT_RECEIVED',
  USER_REGISTERED: 'USER_REGISTERED',
  LOW_STOCK_ALERT: 'LOW_STOCK_ALERT',
} as const;

export type BotEventName = (typeof BOT_EVENTS)[keyof typeof BOT_EVENTS];

// ─── Typed EventEmitter ───────────────────────────────────────────────────────

class BotEventBus extends EventEmitter {
  emitOrderCompleted(payload: OrderCompletedPayload) {
    this.emit(BOT_EVENTS.ORDER_COMPLETED, payload);
  }

  emitPaymentReceived(payload: PaymentReceivedPayload) {
    this.emit(BOT_EVENTS.PAYMENT_RECEIVED, payload);
  }

  emitUserRegistered(payload: UserRegisteredPayload) {
    this.emit(BOT_EVENTS.USER_REGISTERED, payload);
  }

  emitLowStockAlert(productId: string, productName: string, remaining: number) {
    this.emit(BOT_EVENTS.LOW_STOCK_ALERT, { productId, productName, remaining });
  }

  onOrderCompleted(listener: (payload: OrderCompletedPayload) => void) {
    this.on(BOT_EVENTS.ORDER_COMPLETED, listener);
  }

  onPaymentReceived(listener: (payload: PaymentReceivedPayload) => void) {
    this.on(BOT_EVENTS.PAYMENT_RECEIVED, listener);
  }

  onUserRegistered(listener: (payload: UserRegisteredPayload) => void) {
    this.on(BOT_EVENTS.USER_REGISTERED, listener);
  }
}

// Singleton Event Bus
export const eventBus = new BotEventBus();
export default eventBus;
