import { Context, Scenes } from 'telegraf';
import type { Prisma } from '@prisma/client';

type User = Prisma.UserGetPayload<object>;
type Wallet = Prisma.WalletGetPayload<object>;
type VipLevel = Prisma.VipLevelGetPayload<object>;

// ─── Custom Session Data ──────────────────────────────────────────────────────

export interface BotSessionData extends Scenes.SceneSessionData {
  // Shopping cart
  cart?: {
    productId:    string;
    productName:  string;
    productEmoji: string;
    unitPrice:    number;
    vipPrice?:    number;
    quantity:     number;
    maxQty:       number;
    stockMode:    string;
  };

  // Order flow
  pendingOrderId?:     string;
  pendingOrderCode?:   string;
  pendingOrderAmount?: number;

  // Deposit flow
  depositAmount?:    number;
  depositRequestId?: string;

  // Coupon
  couponCode?:     string;
  appliedCoupon?:  { code: string; discountAmount: number };
  waitingForCoupon?: boolean;

  // Pagination
  shopPage?:  number;
  orderPage?: number;
  txPage?:    number;

  // Support ticket creation steps
  ticketSubject?: string;

  // Admin flow
  adminTargetUserId?:      string;
  adminTargetProductId?:   string;
  adminStockPendingLines?: string[]; // lines chờ xác nhận khi nhập kho
  _broadcastStep?: 'compose' | 'confirm';
  _broadcastMsg?:  string;
  _adjustMode?:    'add' | 'sub';
  _catStep?:       string;
  _catName?:       string;
  _catEmoji?:      string;

  // Deep link navigation
  directProductId?: string; // từ /start prod_XXX (nút Mua ngay trên kênh)
}

// ─── Injected User ────────────────────────────────────────────────────────────

export type UserWithRelations = User & {
  wallet:   Wallet | null;
  vipLevel: VipLevel | null;
};

// ─── Bot Context ──────────────────────────────────────────────────────────────
//
// Telegraf v4 pattern: extend base Context and manually declare session + scene.
// ctx.session is typed as BotSessionData — we handle scene.session internally.
// Stage<BotContext> requires an `as any` cast on the scenes array.

export interface BotContext extends Context {
  /** Session — typed as our full BotSessionData */
  session: BotSessionData;

  /** Scene manager */
  // @ts-ignore — Telegraf v4 internal constraint; works correctly at runtime
  scene: Scenes.SceneContextScene<BotContext, BotSessionData>;

  /** Authenticated user (injected by authMiddleware) */
  user: UserWithRelations;

  /** Quick VND formatter */
  formatVND: (amount: number) => string;
}

// ─── Scene Registry ───────────────────────────────────────────────────────────

export type BotSceneName =
  | 'MAIN_MENU'
  | 'SHOP'
  | 'CHECKOUT'
  | 'DEPOSIT'
  | 'WALLET'
  | 'ORDERS'
  | 'PROFILE'
  | 'REFERRAL'
  | 'SUPPORT'
  | 'ADMIN_MENU'
  | 'ADMIN_PRODUCT'
  | 'ADMIN_STOCK'
  | 'ADMIN_USER'
  | 'ADMIN_BROADCAST'
  | 'ADMIN_CATEGORY'
  | 'ADMIN_ORDERS';

export const SCENES: Record<BotSceneName, BotSceneName> = {
  MAIN_MENU:       'MAIN_MENU',
  SHOP:            'SHOP',
  CHECKOUT:        'CHECKOUT',
  DEPOSIT:         'DEPOSIT',
  WALLET:          'WALLET',
  ORDERS:          'ORDERS',
  PROFILE:         'PROFILE',
  REFERRAL:        'REFERRAL',
  SUPPORT:         'SUPPORT',
  ADMIN_MENU:      'ADMIN_MENU',
  ADMIN_PRODUCT:   'ADMIN_PRODUCT',
  ADMIN_STOCK:     'ADMIN_STOCK',
  ADMIN_USER:      'ADMIN_USER',
  ADMIN_ORDERS:    'ADMIN_ORDERS',
  ADMIN_BROADCAST: 'ADMIN_BROADCAST',
  ADMIN_CATEGORY:  'ADMIN_CATEGORY',
};
