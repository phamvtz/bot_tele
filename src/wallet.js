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
import { iconOf } from "./menu-config.js";

/**
 * Đơn này trả bằng VÍ nội bộ?
 *
 * Đối xứng với `isCryptoPaymentMethod` bên payment/crypto.js và `isPaidUpfrontMethod`
 * bên delivery.js. Tách ra vì "ví" khác "đã trả trước" đúng một chỗ quan trọng: tiền
 * trong ví là của SHOP và đảo ngược được, còn chuyển khoản ngân hàng / on-chain thì
 * KHÔNG. Vì vậy:
 *   - quyết định CÓ HOÀN TIỀN không  → `isPaidUpfrontMethod` (cả ba phương thức);
 *   - quyết định tra `WalletTransaction` PURCHASE / promote đơn ví → hàm NÀY.
 * Hai việc đó từng được gác bằng cùng một chuỗi `"wallet"` viết tay ở mỗi nơi, và đó
 * chính là cách đơn QR/USDT bị mất tiền khi khách tự huỷ.
 */
export function isWalletPaymentMethod(method) {
    return String(method || "").toLowerCase() === "wallet";
}

// Transaction types
export const TxType = {
    DEPOSIT: "DEPOSIT",
    PURCHASE: "PURCHASE",
    REFUND: "REFUND",
    REFUND_REVERSAL: "REFUND_REVERSAL",
    ADMIN_ADD: "ADMIN_ADD",
    ADMIN_DEDUCT: "ADMIN_DEDUCT",
    GIFTCODE: "GIFTCODE",
};

// Transaction status
export const TxStatus = {
    PENDING: "PENDING",
    SUCCESS: "SUCCESS",
    FAILED: "FAILED",
    // Deposit PENDING quá hạn, không còn được confirm. Phải nằm trong enum: mọi
    // chỗ lọc/thống kê theo TxStatus sẽ bỏ sót nếu chỉ là chuỗi literal rời.
    EXPIRED: "EXPIRED",
};

const _walletCache = new Map();
const _purchaseLocks = new Map();
const _refundLocks = new Map();
const _refundReversalLocks = new Map();

async function withKeyedLock(lockMap, key, operation) {
    const lockKey = String(key);
    const previous = lockMap.get(lockKey) || Promise.resolve();
    const task = previous.then(operation);
    const tail = task.catch(() => {});
    lockMap.set(lockKey, tail);
    try {
        return await task;
    } finally {
        if (lockMap.get(lockKey) === tail) lockMap.delete(lockKey);
    }
}
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
        try {
            wallet = await prisma.wallet.create({ data: { odelegramId: tgId, balance: 0 } });
        } catch (error) {
            // Hai request đầu tiên của cùng user có thể cùng insert; unique index
            // quyết định winner, request còn lại đọc lại thay vì báo lỗi giả.
            wallet = await prisma.wallet.findUnique({ where: { odelegramId: tgId } }).catch(() => null);
            if (!wallet) throw error;
        }
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

    // Expire deposit cũ + tạo deposit mới ĐỘC LẬP nhau (create dùng wallet.balance có sẵn,
    // không phụ thuộc kết quả expire) → chạy song song để user thấy QR nhanh hơn.
    const expireBefore = new Date(Date.now() - 15 * 60 * 1000);
    const [, transaction] = await Promise.all([
        prisma.walletTransaction.updateMany({
            where: {
                walletId: wallet.id,
                type: TxType.DEPOSIT,
                status: TxStatus.PENDING,
                createdAt: { lt: expireBefore },
            },
            data: { status: TxStatus.EXPIRED },
        }),
        prisma.walletTransaction.create({
            data: {
                walletId: wallet.id,
                type: TxType.DEPOSIT,
                amount,
                balanceBefore: wallet.balance,
                balanceAfter: wallet.balance + amount,
                description: `Nạp ${amount.toLocaleString()}đ vào ví`,
                status: TxStatus.PENDING,
            },
        }),
    ]);

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
    // Atomic gate: chỉ 1 caller thắng, tránh double-confirm.
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
        await prisma.walletTransaction.update({
            where: { id: transactionId },
            data: { status: TxStatus.PENDING, paymentRef: null },
        }).catch(() => {});
        return { success: false, error: "Wallet not found" };
    }

    let updatedWallet;
    try {
        // Bước tài chính duy nhất. Chỉ khi bước này fail mới được mở transaction
        // lại để poller/IPN retry.
        updatedWallet = await prisma.wallet.update({
            where: { id: tx.walletId },
            data: { balance: { increment: tx.amount } },
        });
    } catch (err) {
        await prisma.walletTransaction.update({
            where: { id: transactionId },
            data: { status: TxStatus.PENDING, paymentRef: null },
        }).catch(() => {});
        console.error("confirmDeposit failed to credit wallet, reverted:", err.message);
        return { success: false, error: `Credit wallet failed: ${err.message}` };
    }

    let auditPending = false;
    try {
        await prisma.walletTransaction.update({
            where: { id: transactionId },
            data: { balanceAfter: updatedWallet.balance },
        });
    } catch (err) {
        // Tiền đã cộng. Tuyệt đối không reset SUCCESS/PENDING vì lần retry sẽ cộng
        // thêm lần nữa; giữ paymentRef làm hàng rào replay và báo để reconcile audit.
        auditPending = true;
        console.error("confirmDeposit credited but balanceAfter update failed:", err.message);
    }

    invalidateBalance(updatedWallet.odelegramId);
    return { success: true, auditPending, newBalance: updatedWallet.balance };
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
            try {
                await prisma.wallet.update({
                    where: { id: wallet.id },
                    data: { balance: { increment: debitAmount } },
                });
            } catch (rollbackError) {
                console.error("purchase rollback failed:", rollbackError);
            }
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

/** Tìm giao dịch ví đã trừ thành công cho một order. */
export async function findSuccessfulWalletPurchase(orderId, db = prisma) {
    if (!orderId) return null;
    return db.walletTransaction.findFirst({
        where: { orderId: String(orderId), type: TxType.PURCHASE, status: TxStatus.SUCCESS },
        orderBy: { createdAt: "asc" },
    });
}

/**
 * Khôi phục khe hở order PENDING -> wallet debit -> order PAID.
 * Nếu tiền đã bị trừ, transaction SUCCESS là nguồn sự thật và order phải được
 * promote idempotently thay vì bị expiration job hủy mất.
 */
export async function promoteSettledWalletOrder(orderId, db = prisma) {
    const purchaseTx = await findSuccessfulWalletPurchase(orderId, db);
    if (!purchaseTx) return { promoted: false, settled: false };

    const claimed = await db.order.updateMany({
        where: { id: String(orderId), status: "PENDING", paymentMethod: "wallet" },
        data: {
            status: "PAID",
            paymentRef: purchaseTx.id || `WALLET:${orderId}`,
            walletSettledAt: new Date(),
        },
    });
    const order = await db.order.findUnique({ where: { id: String(orderId) } }).catch(() => null);
    return {
        promoted: claimed.count > 0,
        settled: true,
        transaction: purchaseTx,
        order,
    };
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
    const refundAmount = Math.round(Number(amount));
    if (!Number.isSafeInteger(refundAmount) || refundAmount <= 0) {
        return { success: false, error: "Số tiền hoàn không hợp lệ" };
    }

    return withKeyedLock(_refundLocks, orderId || `${telegramId}:${refundAmount}`, async () => {
        // Một đơn chỉ được có một khoản hoàn thành công/đang xử lý. Điều này chặn
        // delivery recovery cộng tiền lại khi Telegram gửi thông báo bị lỗi.
        if (orderId) {
            const existing = await prisma.walletTransaction.findFirst({
                where: {
                    orderId,
                    type: TxType.REFUND,
                    status: { in: [TxStatus.SUCCESS, TxStatus.PENDING] },
                },
                orderBy: { createdAt: "asc" },
            });
            if (existing) {
                const wallet = await getOrCreateWallet(telegramId);
                return {
                    success: true,
                    alreadyProcessed: true,
                    newBalance: wallet.balance,
                    transaction: existing,
                };
            }
        }

        const wallet = await getOrCreateWallet(telegramId);
        let tx;
        try {
            tx = await prisma.walletTransaction.create({
                data: {
                    walletId: wallet.id,
                    type: TxType.REFUND,
                    amount: refundAmount,
                    balanceBefore: wallet.balance,
                    balanceAfter: wallet.balance + refundAmount,
                    description: reason || `Hoàn tiền đơn hàng`,
                    status: TxStatus.PENDING,
                    orderId,
                    ...(orderId ? { refundKey: `REFUND:${orderId}` } : {}),
                },
            });
        } catch (error) {
            // Một process khác có thể vừa tạo refundKey trước process hiện tại.
            const raced = orderId ? await prisma.walletTransaction.findFirst({
                where: { orderId, type: TxType.REFUND, status: { in: [TxStatus.SUCCESS, TxStatus.PENDING] } },
                orderBy: { createdAt: "asc" },
            }).catch(() => null) : null;
            if (raced) {
                const currentWallet = await getOrCreateWallet(telegramId);
                return { success: true, alreadyProcessed: true, newBalance: currentWallet.balance, transaction: raced };
            }
            throw error;
        }

        let updatedWallet;
        let auditPending = false;
        try {
            updatedWallet = await prisma.wallet.update({
                where: { id: wallet.id },
                data: { balance: { increment: refundAmount } },
            });
        } catch (err) {
            await prisma.walletTransaction.update({
                where: { id: tx.id },
                data: { status: TxStatus.FAILED },
            }).catch(() => {});
            console.error("refund failed to credit wallet:", err.message);
            return { success: false, error: err.message };
        }

        try {
            await prisma.walletTransaction.update({
                where: { id: tx.id },
                data: { status: TxStatus.SUCCESS, balanceAfter: updatedWallet.balance },
            });
        } catch (err) {
            // Tiền đã được cộng. Giữ PENDING để mọi lần retry nhận ra giao dịch này
            // và tuyệt đối không cộng lại; admin vẫn nhìn thấy audit chưa hoàn tất.
            console.error("refund credited but audit status update failed:", err.message);
            auditPending = true;
        }

        invalidateBalance(telegramId);
        return {
            success: true,
            auditPending,
            newBalance: updatedWallet.balance,
            transaction: { ...tx, status: TxStatus.SUCCESS, balanceAfter: updatedWallet.balance },
        };
    });
}

/**
 * Thu hồi đúng một khoản hoàn tiền đã chọn từ web admin.
 * Giao dịch đối ứng giữ nguyên lịch sử thay vì xóa/sửa số tiền cũ.
 */
export async function reverseRefundTransaction(refundTransactionId, adminId, db = prisma) {
    return withKeyedLock(_refundReversalLocks, refundTransactionId, async () => {
        const refundTx = await db.walletTransaction.findUnique({ where: { id: refundTransactionId } });
        if (!refundTx) return { success: false, code: "NOT_FOUND", error: "Không tìm thấy giao dịch hoàn tiền" };
        if (refundTx.type !== TxType.REFUND || refundTx.status !== TxStatus.SUCCESS || refundTx.amount <= 0) {
            return { success: false, code: "INVALID_TRANSACTION", error: "Chỉ thu hồi được khoản hoàn tiền đã thành công" };
        }

        const existing = await db.walletTransaction.findFirst({
            where: { reversalOfId: refundTx.id, type: TxType.REFUND_REVERSAL, status: TxStatus.SUCCESS },
        });
        if (existing || refundTx.reversalTransactionId) {
            return { success: true, alreadyProcessed: true, transaction: existing, newBalance: existing?.balanceAfter };
        }

        const wallet = await db.wallet.findUnique({ where: { id: refundTx.walletId } });
        if (!wallet) return { success: false, code: "WALLET_NOT_FOUND", error: "Không tìm thấy ví nhận tiền hoàn" };

        const claimed = await db.wallet.updateMany({
            where: { id: wallet.id, balance: { gte: refundTx.amount } },
            data: { balance: { increment: -refundTx.amount } },
        });
        if (claimed.count === 0) {
            return {
                success: false,
                code: "INSUFFICIENT_BALANCE",
                error: `Số dư ví không đủ để thu hồi ${refundTx.amount.toLocaleString("vi-VN")}đ`,
            };
        }

        const updatedWallet = await db.wallet.findUnique({ where: { id: wallet.id } });
        let reversalTx;
        try {
            reversalTx = await db.walletTransaction.create({
                data: {
                    walletId: wallet.id,
                    type: TxType.REFUND_REVERSAL,
                    amount: -refundTx.amount,
                    balanceBefore: updatedWallet.balance + refundTx.amount,
                    balanceAfter: updatedWallet.balance,
                    description: `Thu hồi khoản hoàn #${refundTx.id.slice(-8).toUpperCase()} bởi admin ${adminId}`,
                    status: TxStatus.SUCCESS,
                    orderId: refundTx.orderId || null,
                    reversalOfId: refundTx.id,
                    paymentRef: `REFUND_REVERSAL:${refundTx.id}`,
                },
            });
        } catch (error) {
            await db.wallet.update({
                where: { id: wallet.id },
                data: { balance: { increment: refundTx.amount } },
            }).catch(() => {});

            const raced = await db.walletTransaction.findFirst({
                where: { reversalOfId: refundTx.id, type: TxType.REFUND_REVERSAL, status: TxStatus.SUCCESS },
            }).catch(() => null);
            if (raced) return { success: true, alreadyProcessed: true, transaction: raced, newBalance: raced.balanceAfter };
            throw error;
        }

        await db.walletTransaction.update({
            where: { id: refundTx.id },
            data: {
                reversedAt: new Date(),
                reversedBy: String(adminId),
                reversalTransactionId: reversalTx.id,
            },
        }).catch((error) => console.error("mark refund reversed failed:", error.message));

        invalidateBalance(wallet.odelegramId);
        return { success: true, newBalance: updatedWallet.balance, transaction: reversalTx };
    });
}

/**
 * Cộng tiền vào ví với type tuỳ ý (GIFTCODE, ADMIN_ADD...).
 *
 * Thứ tự tx-create → wallet-inc → tx-success giống refund/adminAddBalance: nếu
 * bước cộng ví fail thì tx nằm ở FAILED, không có khoản nào "cộng lặng" mà thiếu log.
 * Caller nào cần chống double-credit phải tự có gate riêng (giftcode.js dùng
 * unique redeemKey) — hàm này không tự idempotent.
 */
export async function creditWallet(telegramId, amount, { type = TxType.ADMIN_ADD, description = null, orderId = null } = {}) {
    const creditAmount = Math.round(Number(amount));
    if (!Number.isSafeInteger(creditAmount) || creditAmount <= 0) {
        return { success: false, error: "Số tiền cộng không hợp lệ" };
    }

    const wallet = await getOrCreateWallet(telegramId);

    const tx = await prisma.walletTransaction.create({
        data: {
            walletId: wallet.id,
            type,
            amount: creditAmount,
            balanceBefore: wallet.balance,
            balanceAfter: wallet.balance + creditAmount,
            description: description || "Cộng tiền vào ví",
            status: TxStatus.PENDING,
            orderId,
        },
    });

    try {
        const updatedWallet = await prisma.wallet.update({
            where: { id: wallet.id },
            data: { balance: { increment: creditAmount } },
        });

        await prisma.walletTransaction.update({
            where: { id: tx.id },
            data: { status: TxStatus.SUCCESS, balanceAfter: updatedWallet.balance },
        }).catch((err) => {
            // Tiền đã cộng — chỉ log trạng thái chưa kịp cập nhật, không rollback.
            console.error("creditWallet credited but status update failed:", err.message);
        });

        invalidateBalance(telegramId);
        return {
            success: true,
            newBalance: updatedWallet.balance,
            transaction: { ...tx, status: TxStatus.SUCCESS, balanceAfter: updatedWallet.balance },
        };
    } catch (err) {
        await prisma.walletTransaction.update({
            where: { id: tx.id },
            data: { status: TxStatus.FAILED },
        }).catch(() => {});
        console.error("creditWallet failed:", err.message);
        return { success: false, error: err.message };
    }
}

/**
 * Admin add balance — order tx-create → wallet-inc → tx-success như refund
 */
export async function adminAddBalance(telegramId, amount, adminId, reason) {
    const creditAmount = Math.round(Number(amount));
    if (!Number.isSafeInteger(creditAmount) || creditAmount <= 0) {
        return { success: false, error: "Số tiền cộng không hợp lệ" };
    }

    const wallet = await getOrCreateWallet(telegramId);
    const tx = await prisma.walletTransaction.create({
        data: {
            walletId: wallet.id,
            type: TxType.ADMIN_ADD,
            amount: creditAmount,
            balanceBefore: wallet.balance,
            balanceAfter: wallet.balance + creditAmount,
            description: reason || `Admin ${adminId} cộng tiền`,
            status: TxStatus.PENDING,
        },
    });

    let updatedWallet;
    try {
        updatedWallet = await prisma.wallet.update({
            where: { id: wallet.id },
            data: { balance: { increment: creditAmount } },
        });
    } catch (err) {
        await prisma.walletTransaction.update({
            where: { id: tx.id },
            data: { status: TxStatus.FAILED },
        }).catch(() => {});
        console.error("adminAddBalance failed before wallet credit:", err.message);
        return { success: false, error: err.message };
    }

    let auditPending = false;
    try {
        await prisma.walletTransaction.update({
            where: { id: tx.id },
            data: { status: TxStatus.SUCCESS, balanceAfter: updatedWallet.balance },
        });
    } catch (err) {
        auditPending = true;
        console.error("adminAddBalance credited but audit update failed:", err.message);
    }

    invalidateBalance(telegramId);
    return {
        success: true,
        auditPending,
        newBalance: updatedWallet.balance,
        transaction: { ...tx, status: TxStatus.SUCCESS, balanceAfter: updatedWallet.balance },
    };
}

/**
 * Admin deduct balance — atomic decrement + auto rollback nếu kết quả âm
 */
export async function adminDeductBalance(telegramId, amount, adminId, reason) {
    const debitAmount = Math.round(Number(amount));
    if (!Number.isSafeInteger(debitAmount) || debitAmount <= 0) {
        return { success: false, error: "Số tiền trừ không hợp lệ" };
    }

    const wallet = await getOrCreateWallet(telegramId);
    const tx = await prisma.walletTransaction.create({
        data: {
            walletId: wallet.id,
            type: TxType.ADMIN_DEDUCT,
            amount: -debitAmount,
            balanceBefore: wallet.balance,
            balanceAfter: wallet.balance - debitAmount,
            description: reason || `Admin ${adminId} trừ tiền`,
            status: TxStatus.PENDING,
        },
    });

    let claimed;
    try {
        // Điều kiện và decrement nằm trong cùng một atomic update, không còn cửa sổ
        // race làm ví âm rồi phải rollback best-effort.
        claimed = await prisma.wallet.updateMany({
            where: { id: wallet.id, balance: { gte: debitAmount } },
            data: { balance: { increment: -debitAmount } },
        });
    } catch (err) {
        await prisma.walletTransaction.update({ where: { id: tx.id }, data: { status: TxStatus.FAILED } }).catch(() => {});
        console.error("adminDeductBalance wallet debit failed:", err.message);
        return { success: false, error: err.message };
    }
    if (!claimed.count) {
        await prisma.walletTransaction.update({ where: { id: tx.id }, data: { status: TxStatus.FAILED } }).catch(() => {});
        return { success: false, error: "Số dư không đủ để trừ" };
    }

    // Từ đây tiền đã bị trừ. Lỗi đọc lại/audit không được đổi kết quả thành failed,
    // nếu không admin bấm lại sẽ trừ lần hai.
    let auditPending = false;
    let updatedWallet;
    try {
        updatedWallet = await prisma.wallet.findUnique({ where: { id: wallet.id } });
    } catch (err) {
        auditPending = true;
        console.error("adminDeductBalance debited but balance read failed:", err.message);
    }
    updatedWallet ||= { ...wallet, balance: wallet.balance - debitAmount };
    try {
        await prisma.walletTransaction.update({
            where: { id: tx.id },
            data: { status: TxStatus.SUCCESS, balanceAfter: updatedWallet.balance },
        });
    } catch (err) {
        auditPending = true;
        console.error("adminDeductBalance debited but audit update failed:", err.message);
    }

    invalidateBalance(telegramId);
    return {
        success: true,
        auditPending,
        newBalance: updatedWallet.balance,
        transaction: { ...tx, status: TxStatus.SUCCESS, balanceAfter: updatedWallet.balance },
    };
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
    const typeIconKey = {
        [TxType.DEPOSIT]: "WALLET_TX_DEPOSIT",
        [TxType.PURCHASE]: "WALLET_TX_PURCHASE",
        [TxType.REFUND]: "WALLET_TX_REFUND",
        [TxType.REFUND_REVERSAL]: "WALLET_TX_REFUND_REVERSAL",
        [TxType.ADMIN_ADD]: "WALLET_TX_ADMIN_ADD",
        [TxType.ADMIN_DEDUCT]: "WALLET_TX_ADMIN_DEDUCT",
        [TxType.GIFTCODE]: "WALLET_TX_GIFTCODE",
    };

    const typeLabel = {
        [TxType.DEPOSIT]: "Nạp tiền",
        [TxType.PURCHASE]: "Mua hàng",
        [TxType.REFUND]: "Hoàn tiền",
        [TxType.REFUND_REVERSAL]: "Thu hồi hoàn tiền",
        [TxType.ADMIN_ADD]: "Admin cộng",
        [TxType.ADMIN_DEDUCT]: "Admin trừ",
        [TxType.GIFTCODE]: "Giftcode",
    };

    const emoji = iconOf(typeIconKey[tx.type] || "WALLET_TX_OTHER");
    const label = typeLabel[tx.type] || tx.type;
    const sign = tx.amount >= 0 ? "+" : "";
    const status = iconOf(
        tx.status === TxStatus.SUCCESS ? "STATUS_SUCCESS"
            : tx.status === TxStatus.PENDING ? "STATUS_PENDING"
                // Hết hạn khác thất bại: giao dịch không bao giờ được xử lý,
                // không phải bị từ chối. Hiển thị riêng để khách không tưởng là lỗi.
                : tx.status === TxStatus.EXPIRED ? "STATUS_WARNING"
                    : "STATUS_ERROR",
    );

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
    creditWallet,
    adminAddBalance,
    adminDeductBalance,
    getTransactionHistory,
    formatTransaction,
    generateDepositContent,
    parseDepositContent,
    findPendingDeposit,
    isWalletPaymentMethod,
    TxType,
    TxStatus,
};
