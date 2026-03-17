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

/**
 * Get or create wallet for user
 */
export async function getOrCreateWallet(telegramId) {
    const tgId = String(telegramId);

    const wallet = await prisma.wallet.upsert({
        where: { odelegramId: tgId },
        update: {},
        create: { odelegramId: tgId, balance: 0 },
    });

    return wallet;
}

/**
 * Get user balance
 */
export async function getBalance(telegramId) {
    const wallet = await getOrCreateWallet(telegramId);
    return wallet.balance;
}

/**
 * Create deposit transaction (pending)
 * Returns transaction with QR info
 */
export async function createDeposit(telegramId, amount) {
    const wallet = await getOrCreateWallet(telegramId);

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
 */
export async function confirmDeposit(transactionId, paymentRef) {
    const tx = await prisma.walletTransaction.findUnique({
        where: { id: transactionId },
        include: { wallet: true },
    });

    if (!tx) return { success: false, error: "Transaction not found" };
    if (tx.status !== TxStatus.PENDING) return { success: false, error: "Transaction already processed" };

    // Update wallet balance
    const newBalance = tx.wallet.balance + tx.amount;

    await prisma.$transaction([
        prisma.wallet.update({
            where: { id: tx.walletId },
            data: { balance: newBalance },
        }),
        prisma.walletTransaction.update({
            where: { id: transactionId },
            data: {
                status: TxStatus.SUCCESS,
                balanceAfter: newBalance,
                paymentRef,
            },
        }),
    ]);

    return { success: true, newBalance };
}

/**
 * Purchase with wallet balance
 */
export async function purchase(telegramId, amount, orderId, description) {
    const wallet = await getOrCreateWallet(telegramId);

    if (wallet.balance < amount) {
        return { success: false, error: "Số dư không đủ", balance: wallet.balance };
    }

    const newBalance = wallet.balance - amount;

    const [updatedWallet, tx] = await prisma.$transaction([
        prisma.wallet.update({
            where: { id: wallet.id },
            data: { balance: newBalance },
        }),
        prisma.walletTransaction.create({
            data: {
                walletId: wallet.id,
                type: TxType.PURCHASE,
                amount: -amount,
                balanceBefore: wallet.balance,
                balanceAfter: newBalance,
                description: description || `Thanh toán đơn hàng`,
                status: TxStatus.SUCCESS,
                orderId,
            },
        }),
    ]);

    return { success: true, newBalance, transaction: tx };
}

/**
 * Refund to wallet
 */
export async function refund(telegramId, amount, orderId, reason) {
    const wallet = await getOrCreateWallet(telegramId);
    const newBalance = wallet.balance + amount;

    const [updatedWallet, tx] = await prisma.$transaction([
        prisma.wallet.update({
            where: { id: wallet.id },
            data: { balance: newBalance },
        }),
        prisma.walletTransaction.create({
            data: {
                walletId: wallet.id,
                type: TxType.REFUND,
                amount,
                balanceBefore: wallet.balance,
                balanceAfter: newBalance,
                description: reason || `Hoàn tiền đơn hàng`,
                status: TxStatus.SUCCESS,
                orderId,
            },
        }),
    ]);

    return { success: true, newBalance, transaction: tx };
}

/**
 * Admin add balance
 */
export async function adminAddBalance(telegramId, amount, adminId, reason) {
    const wallet = await getOrCreateWallet(telegramId);
    const newBalance = wallet.balance + amount;

    const [updatedWallet, tx] = await prisma.$transaction([
        prisma.wallet.update({
            where: { id: wallet.id },
            data: { balance: newBalance },
        }),
        prisma.walletTransaction.create({
            data: {
                walletId: wallet.id,
                type: TxType.ADMIN_ADD,
                amount,
                balanceBefore: wallet.balance,
                balanceAfter: newBalance,
                description: reason || `Admin ${adminId} cộng tiền`,
                status: TxStatus.SUCCESS,
            },
        }),
    ]);

    return { success: true, newBalance, transaction: tx };
}

/**
 * Admin deduct balance
 */
export async function adminDeductBalance(telegramId, amount, adminId, reason) {
    const wallet = await getOrCreateWallet(telegramId);

    if (wallet.balance < amount) {
        return { success: false, error: "Số dư không đủ để trừ" };
    }

    const newBalance = wallet.balance - amount;

    const [updatedWallet, tx] = await prisma.$transaction([
        prisma.wallet.update({
            where: { id: wallet.id },
            data: { balance: newBalance },
        }),
        prisma.walletTransaction.create({
            data: {
                walletId: wallet.id,
                type: TxType.ADMIN_DEDUCT,
                amount: -amount,
                balanceBefore: wallet.balance,
                balanceAfter: newBalance,
                description: reason || `Admin ${adminId} trừ tiền`,
                status: TxStatus.SUCCESS,
            },
        }),
    ]);

    return { success: true, newBalance, transaction: tx };
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
 * Parse deposit content from bank transfer
 */
export function parseDepositContent(content) {
    // Format: NAP<telegramId><transactionId>
    const match = content.toUpperCase().match(/NAP(\d+)([A-Z0-9]{8})/);
    if (!match) return null;

    return {
        telegramId: match[1],
        transactionIdSuffix: match[2],
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
