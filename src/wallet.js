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

    let wallet = await prisma.wallet.findUnique({
        where: { odelegramId: tgId },
    });

    if (!wallet) {
        wallet = await prisma.wallet.create({
            data: { odelegramId: tgId, balance: 0 },
        });
    }

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

    if (!tx?.wallet) return { success: false, error: "Wallet not found" };

    // increment tránh lost-update khi có nhiều giao dịch cùng lúc
    const updatedWallet = await prisma.wallet.update({
        where: { id: tx.walletId },
        data: { balance: { increment: tx.amount } },
    });

    await prisma.walletTransaction.update({
        where: { id: transactionId },
        data: { balanceAfter: updatedWallet.balance },
    });

    return { success: true, newBalance: updatedWallet.balance };
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
        if (Math.abs(Number(item.amount || 0) - Number(tx.amount || 0)) > 1000) return false;
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
    const normalized = String(content || "").toUpperCase().trim();
    if (!normalized) return null;

    // Preserve token boundaries so bank-added trailing metadata does not get folded
    // into the deposit code after whitespace removal.
    const token = normalized
        .split(/\s+/)
        .find((part) => /^NAP[A-Z0-9]{9,}$/.test(part));

    if (token) {
        const payload = token.slice(3);
        if (/^\d+[A-Z0-9]{8}$/.test(payload)) {
            return {
                telegramId: payload.slice(0, -8),
                transactionIdSuffix: payload.slice(-8),
            };
        }
    }

    // Fallback for providers that deliver only a compact string without spaces.
    const compactMatch = normalized.match(/NAP(\d+)([A-Z0-9]{8})(?![A-Z0-9])/);
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
