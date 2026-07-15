/**
 * Wallet Module - Internal Balance System
 * 
 * Features:
 * - Get/Create wallet for user
 * - Deposit money (nạp tiền)
 * - Purchase with balance (thanh toán)
 * - Refund (hoàn tiền)
 * - Admin add/deduct balance
 * - Transaction history
 */

import { prisma } from "./db.js";
import { fetchBankHistory } from "./bank-history.js";
import { balanceCache } from "./lib/cache.js";
import { bankAmountsMatch } from "./payment/amounts.js";

// Transaction types
export const TxType = {
    DEPOSIT: "DEPOSIT",
    PURCHASE: "PURCHASE",
    REFUND: "REFUND",
    ADMIN_ADD: "ADMIN_ADD",
    ADMIN_DEDUCT: "ADMIN_DEDUCT",
};

// Transaction status
export const TxStatus = {
    PENDING: "PENDING",
    SUCCESS: "SUCCESS",
    FAILED: "FAILED",
};

const _walletCache = new Map();
const _purchaseLocks = new Map();
function _walletCacheGet(tgId) {
    const e = _walletCache.get(tgId);
    if (e && Date.now() - e.ts < 15000) return e.value;
    _walletCache.delete(tgId);
    return null;
}
function _walletCacheSet(tgId, wallet) { _walletCache.set(tgId, { value: wallet, ts: Date.now() }); }
export function invalidateWalletCache(telegramId) { if (telegramId) _walletCache.delete(String(telegramId)); }

export async function getOrCreateWallet(telegramId) {
    const tgId = String(telegramId);
    const cached = _walletCacheGet(tgId);
    if (cached) return cached;

    let wallet = await prisma.wallet.findUnique({ where: { odelegramId: tgId } });
    if (!wallet) {
        wallet = await prisma.wallet.create({ data: { odelegramId: tgId, balance: 0 } });
    }
    _walletCacheSet(tgId, wallet);
    return wallet;
}

/**
 * Get user balance (cached 10s)
 */
export async function getBalance(telegramId) {
    const key = String(telegramId);
    const cached = balanceCache.get(key);
    if (cached !== undefined) return cached;
    const wallet = await getOrCreateWallet(telegramId);
    balanceCache.set(key, wallet.balance);
    return wallet.balance;
}

/**
 * Invalidate balance cache for a user — gọi sau mọi thao tác đổi số dư.
 */
function invalidateBalance(telegramId) {
    if (telegramId !== null && telegramId !== undefined) {
        const tgId = String(telegramId);
        balanceCache.invalidate(tgId);
        invalidateWalletCache(tgId);
    }
}

/**
 * Create deposit transaction (pending)
 * Returns transaction with QR info
 */
export async function createDeposit(telegramId, amount) {
    const wallet = await getOrCreateWallet(telegramId);

    // Expire stale PENDING deposits for this wallet (older than 15 min)
    const expireBefore = new Date(Date.now() - 15 * 60 * 1000);
    await prisma.walletTransaction.updateMany({
        where: {
            walletId: wallet.id,
            type: TxType.DEPOSIT,
            status: TxStatus.PENDING,
            createdAt: { lt: expireBefore },
        },
        data: { status: "EXPIRED" },
    });

    const transaction = await prisma.walletTransaction.create({
        data: {
            walletId: wallet.id,
            type: TxType.DEPOSIT,
            amount,
            balanceBefore: wallet.balance,
            balanceAfter: wallet.balance + amount,
            description: `Nạp ${amount.toLocaleString()}đ vào ví`,
            status: TxStatus.PENDING,
        },
    });

    return transaction;
}

/**
 * Confirm deposit (called by IPN webhook)
 *
 * Flow an toàn:
 *  1. Atomic claim: chỉ 1 caller chuyển PENDING → SUCCESS (idempotent).
 *  2. Tăng số dư ví bằng $inc (atomic, không lost-update).
 *  3. Cập nhật lại balanceAfter cho transaction để khớp số dư thật.
 *
 * Nếu bước 2 fail (mất kết nối DB...), tx đã ở SUCCESS nhưng ví chưa cộng:
 *  - Tự revert tx về PENDING để lần IPN sau hoặc bank-poller retry được.
 */
export async function confirmDeposit(transactionId, paymentRef) {
    // Atomic gate: chỉ 1 caller thắng, tránh double-confirm
    const claimed = await prisma.walletTransaction.updateMany({
        where: { id: transactionId, status: TxStatus.PENDING },
        data: { status: TxStatus.SUCCESS, paymentRef },
    });

    if (claimed.count === 0) return { success: false, error: "Transaction already processed" };

    const tx = await prisma.walletTransaction.findUnique({
        where: { id: transactionId },
        include: { wallet: true },
    });

    if (!tx?.wallet) {
        // Revert vì không tìm thấy ví → caller có thể retry hoặc admin xử lý tay
        // Phải xóa paymentRef để bank-poller có thể retry (nó skip event đã có paymentRef).
        await prisma.walletTransaction.update({
            where: { id: transactionId },
            data: { status: TxStatus.PENDING, paymentRef: null },
        }).catch(() => {});
        return { success: false, error: "Wallet not found" };
    }

    try {
        // increment tránh lost-update khi có nhiều giao dịch cùng lúc
        const updatedWallet = await prisma.wallet.update({
            where: { id: tx.walletId },
            data: { balance: { increment: tx.amount } },
        });

        await prisma.walletTransaction.update({
            where: { id: transactionId },
            data: { balanceAfter: updatedWallet.balance },
        });

        invalidateBalance(updatedWallet.odelegramId);
        return { success: true, newBalance: updatedWallet.balance };
    } catch (err) {
        // Cộng ví fail → revert tx (cả status + paymentRef) để lần sau retry.
        // Nếu giữ paymentRef, bank-poller sẽ skip event này → tx kẹt PENDING mãi.
        await prisma.walletTransaction.update({
            where: { id: transactionId },
            data: { status: TxStatus.PENDING, paymentRef: null },
        }).catch(() => {});
        console.error("confirmDeposit failed to credit wallet, reverted:", err.message);
        return { success: false, error: `Credit wallet failed: ${err.message}` };
    }
}

export async function confirmDepositByBankScan(transactionId, telegramId) {
    const tx = await prisma.walletTransaction.findUnique({
        where: { id: transactionId },
        include: { wallet: true },
    });

    if (!tx) return { success: false, error: "Transaction not found" };
    if (tx.type !== TxType.DEPOSIT) return { success: false, error: "Transaction is not a deposit" };
    if (!tx.wallet) return { success: false, error: "Wallet not found" };
    if (String(tx.wallet.odelegramId) !== String(telegramId)) {
        return { success: false, error: "Unauthorized deposit lookup" };
    }
    if (tx.status === TxStatus.SUCCESS) {
        return { success: true, alreadyProcessed: true, newBalance: tx.wallet.balance, paymentRef: tx.paymentRef || null };
    }

    const txSuffix = tx.id.slice(-8).toUpperCase();
    const items = await fetchBankHistory();
    const matchedItem = items.find((item) => {
        const depositInfo = parseDepositContent(item.content || "");
        if (!depositInfo) return false;
        if (depositInfo.telegramId !== String(telegramId)) return false;
        if (depositInfo.transactionIdSuffix !== txSuffix) return false;
        if (!bankAmountsMatch(item.amount, tx.amount)) return false;
        if (!item.transactionId) return false;
        return true;
    });

    if (!matchedItem) {
        return { success: false, error: "Deposit not found in bank history yet" };
    }

    const result = await confirmDeposit(transactionId, matchedItem.transactionId);
    return {
        ...result,
        matched: matchedItem,
        paymentRef: matchedItem.transactionId,
    };
}

/**
 * Purchase with wallet balance
 */
export async function purchase(telegramId, amount, orderId, description) {
    const lockKey = String(orderId || `${telegramId}:${amount}`);
    const previous = _purchaseLocks.get(lockKey) || Promise.resolve();
    const task = previous.then(async () => {
        const debitAmount = Math.round(Number(amount));
        if (!Number.isSafeInteger(debitAmount) || debitAmount <= 0) {
            return { success: false, error: "Số tiền thanh toán không hợp lệ" };
        }

        if (orderId) {
            const existing = await prisma.walletTransaction.findFirst({
                where: { orderId, type: TxType.PURCHASE, status: TxStatus.SUCCESS },
            });
            if (existing) {
                const currentWallet = await getOrCreateWallet(telegramId);
                return { success: true, alreadyProcessed: true, newBalance: currentWallet.balance, transaction: existing };
            }
        }

        const wallet = await getOrCreateWallet(telegramId);
        const claimed = await prisma.wallet.updateMany({
            where: { id: wallet.id, balance: { gte: debitAmount } },
            data: { balance: { increment: -debitAmount } },
        });
        if (claimed.count === 0) {
            const current = await prisma.wallet.findUnique({ where: { id: wallet.id } });
            return { success: false, error: "Số dư không đủ", balance: current?.balance || 0 };
        }

        const updatedWallet = await prisma.wallet.findUnique({ where: { id: wallet.id } });
        try {
            const tx = await prisma.walletTransaction.create({
                data: {
                    walletId: wallet.id,
                    type: TxType.PURCHASE,
                    amount: -debitAmount,
                    balanceBefore: updatedWallet.balance + debitAmount,
                    balanceAfter: updatedWallet.balance,
                    description: description || `Thanh toán đơn hàng`,
                    status: TxStatus.SUCCESS,
                    orderId,
                },
            });
            invalidateBalance(telegramId);
            return { success: true, newBalance: updatedWallet.balance, transaction: tx };
        } catch (error) {
            await prisma.wallet.update({
                where: { id: wallet.id },
                data: { balance: { increment: debitAmount } },
            });
            invalidateBalance(telegramId);
            throw error;
        }
    });

    const tail = task.catch(() => {});
    _purchaseLocks.set(lockKey, tail);
    try {
        return await task;
    } finally {
        if (_purchaseLocks.get(lockKey) === tail) _purchaseLocks.delete(lockKey);
    }
}

/**
 * Refund to wallet
 *
 * Order an toàn (vì $transaction trong adapter này không atomic):
 *  1. Tạo tx PENDING (audit trail trước, có log nếu DB fail sau).
 *  2. Tăng số dư bằng $inc — atomic, tránh lost-update khi nhiều thao tác đồng thời.
 *  3. Cập nhật tx → SUCCESS với balanceAfter thực tế.
 *  Nếu bước 2 fail: tx ở PENDING/FAILED, không có khoản nào bị "treo" mà thiếu log.
 */
export async function refund(telegramId, amount, orderId, reason) {
    const wallet = await getOrCreateWallet(telegramId);

    const tx = await prisma.walletTransaction.create({
        data: {
            walletId: wallet.id,
            type: TxType.REFUND,
            amount,
            balanceBefore: wallet.balance,
            balanceAfter: wallet.balance + amount, // ước lượng — sẽ cập nhật lại
            description: reason || `Hoàn tiền đơn hàng`,
            status: TxStatus.PENDING,
            orderId,
        },
    });

    try {
        const updatedWallet = await prisma.wallet.update({
            where: { id: wallet.id },
            data: { balance: { increment: amount } },
        });

        await prisma.walletTransaction.update({
            where: { id: tx.id },
            data: { status: TxStatus.SUCCESS, balanceAfter: updatedWallet.balance },
        });

        invalidateBalance(telegramId);
        return { success: true, newBalance: updatedWallet.balance, transaction: { ...tx, status: TxStatus.SUCCESS, balanceAfter: updatedWallet.balance } };
    } catch (err) {
        await prisma.walletTransaction.update({
            where: { id: tx.id },
            data: { status: TxStatus.FAILED },
        }).catch(() => {});
        console.error("refund failed:", err.message);
        return { success: false, error: err.message };
    }
}

/**
 * Admin add balance — order tx-create → wallet-inc → tx-success như refund
 */
export async function adminAddBalance(telegramId, amount, adminId, reason) {
    const wallet = await getOrCreateWallet(telegramId);

    const tx = await prisma.walletTransaction.create({
        data: {
            walletId: wallet.id,
            type: TxType.ADMIN_ADD,
            amount,
            balanceBefore: wallet.balance,
            balanceAfter: wallet.balance + amount,
            description: reason || `Admin ${adminId} cộng tiền`,
            status: TxStatus.PENDING,
        },
    });

    try {
        const updatedWallet = await prisma.wallet.update({
            where: { id: wallet.id },
            data: { balance: { increment: amount } },
        });

        await prisma.walletTransaction.update({
            where: { id: tx.id },
            data: { status: TxStatus.SUCCESS, balanceAfter: updatedWallet.balance },
        });

        invalidateBalance(telegramId);
        return { success: true, newBalance: updatedWallet.balance, transaction: { ...tx, status: TxStatus.SUCCESS, balanceAfter: updatedWallet.balance } };
    } catch (err) {
        await prisma.walletTransaction.update({
            where: { id: tx.id },
            data: { status: TxStatus.FAILED },
        }).catch(() => {});
        console.error("adminAddBalance failed:", err.message);
        return { success: false, error: err.message };
    }
}

/**
 * Admin deduct balance — atomic decrement + auto rollback nếu kết quả âm
 */
export async function adminDeductBalance(telegramId, amount, adminId, reason) {
    const wallet = await getOrCreateWallet(telegramId);

    if (wallet.balance < amount) {
        return { success: false, error: "Số dư không đủ để trừ" };
    }

    const tx = await prisma.walletTransaction.create({
        data: {
            walletId: wallet.id,
            type: TxType.ADMIN_DEDUCT,
            amount: -amount,
            balanceBefore: wallet.balance,
            balanceAfter: wallet.balance - amount,
            description: reason || `Admin ${adminId} trừ tiền`,
            status: TxStatus.PENDING,
        },
    });

    try {
        const updatedWallet = await prisma.wallet.update({
            where: { id: wallet.id },
            data: { balance: { increment: -amount } },
        });

        // Nếu race với purchase khác làm số dư âm → rollback ngay và đánh fail
        if (updatedWallet.balance < 0) {
            await prisma.wallet.update({
                where: { id: wallet.id },
                data: { balance: { increment: amount } },
            }).catch(() => {});
            await prisma.walletTransaction.update({
                where: { id: tx.id },
                data: { status: TxStatus.FAILED, description: `${reason || "Admin trừ tiền"} — rollback (số dư không đủ)` },
            }).catch(() => {});
            invalidateBalance(telegramId);
            return { success: false, error: "Số dư không đủ để trừ" };
        }

        await prisma.walletTransaction.update({
            where: { id: tx.id },
            data: { status: TxStatus.SUCCESS, balanceAfter: updatedWallet.balance },
        });

        invalidateBalance(telegramId);
        return { success: true, newBalance: updatedWallet.balance, transaction: { ...tx, status: TxStatus.SUCCESS, balanceAfter: updatedWallet.balance } };
    } catch (err) {
        await prisma.walletTransaction.update({
            where: { id: tx.id },
            data: { status: TxStatus.FAILED },
        }).catch(() => {});
        console.error("adminDeductBalance failed:", err.message);
        return { success: false, error: err.message };
    }
}

/**
 * Get transaction history
 */
export async function getTransactionHistory(telegramId, limit = 10) {
    const wallet = await getOrCreateWallet(telegramId);

    const transactions = await prisma.walletTransaction.findMany({
        where: { walletId: wallet.id },
        orderBy: { createdAt: "desc" },
        take: limit,
    });

    return transactions;
}

/**
 * Format transaction for display
 */
export function formatTransaction(tx) {
    const typeEmoji = {
        [TxType.DEPOSIT]: "💰",
        [TxType.PURCHASE]: "🛒",
        [TxType.REFUND]: "↩️",
        [TxType.ADMIN_ADD]: "➕",
        [TxType.ADMIN_DEDUCT]: "➖",
    };

    const typeLabel = {
        [TxType.DEPOSIT]: "Nạp tiền",
        [TxType.PURCHASE]: "Mua hàng",
        [TxType.REFUND]: "Hoàn tiền",
        [TxType.ADMIN_ADD]: "Admin cộng",
        [TxType.ADMIN_DEDUCT]: "Admin trừ",
    };

    const emoji = typeEmoji[tx.type] || "📝";
    const label = typeLabel[tx.type] || tx.type;
    const sign = tx.amount >= 0 ? "+" : "";
    const status = tx.status === TxStatus.SUCCESS ? "✅" : tx.status === TxStatus.PENDING ? "⏳" : "❌";

    const date = new Date(tx.createdAt).toLocaleString("vi-VN");

    return `${emoji} ${label} ${status}\n   ${sign}${tx.amount.toLocaleString()}đ | Còn: ${tx.balanceAfter.toLocaleString()}đ\n   ${date}`;
}

/**
 * Generate deposit content for QR
 */
export function generateDepositContent(telegramId, transactionId) {
    const shortTxId = transactionId.slice(-8).toUpperCase();
    return `NAP${telegramId}${shortTxId}`;
}

/**
 * Parse deposit content from bank transfer.
 *
 * Expected format: `NAP{telegramId}{8 last chars of txId}`
 *   - telegramId: 7-12 digits
 *   - tx suffix: 8 chars [A-Z0-9]
 *
 * Bank may add metadata (eg. "FT12345 NAP1234567ABCD0123 NDOI"), nên ta:
 *   1. Tách theo whitespace tìm token bắt đầu bằng NAP.
 *   2. Hoặc fallback regex compact (không có space).
 */
export function parseDepositContent(content) {
    const normalized = String(content || "").toUpperCase().trim();
    if (!normalized) return null;

    // Pattern: NAP + (digits, telegramId) + (8 chars, suffix)
    const TOKEN_RE = /^NAP(\d{6,15})([A-Z0-9]{8})$/;

    // Tokenized — handle "NAP1234ABCD0123 OTHER STUFF"
    for (const part of normalized.split(/\s+/)) {
        const m = part.match(TOKEN_RE);
        if (m) {
            return { telegramId: m[1], transactionIdSuffix: m[2] };
        }
    }

    // Fallback: compact string. Use boundary `(?![A-Z0-9])` to avoid eating extra chars.
    const compactMatch = normalized.match(/NAP(\d{6,15})([A-Z0-9]{8})(?![A-Z0-9])/);
    if (!compactMatch) return null;

    return {
        telegramId: compactMatch[1],
        transactionIdSuffix: compactMatch[2],
    };
}

/**
 * Find pending deposit by content
 */
export async function findPendingDeposit(telegramId, transactionIdSuffix) {
    const wallet = await prisma.wallet.findUnique({
        where: { odelegramId: String(telegramId) },
    });

    if (!wallet) return null;

    const pendingDeposits = await prisma.walletTransaction.findMany({
        where: {
            walletId: wallet.id,
            type: TxType.DEPOSIT,
            status: TxStatus.PENDING,
        },
        orderBy: { createdAt: "desc" },
        take: 10,
    });

    // Find by transaction ID suffix
    const deposit = pendingDeposits.find(
        (d) => d.id.slice(-8).toUpperCase() === transactionIdSuffix
    );

    return deposit;
}

export default {
    getOrCreateWallet,
    getBalance,
    createDeposit,
    confirmDeposit,
    confirmDepositByBankScan,
    purchase,
    refund,
    adminAddBalance,
    adminDeductBalance,
    getTransactionHistory,
    formatTransaction,
    generateDepositContent,
    parseDepositContent,
    findPendingDeposit,
    TxType,
    TxStatus,
};
