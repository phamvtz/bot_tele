import { deliverOrder } from "./delivery.js";

const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_BATCH_SIZE = 10;
const MAX_RETRY_DELAY_MS = 30 * 60_000;

function retryDelayMs(attempt) {
    return Math.min(MAX_RETRY_DELAY_MS, DEFAULT_INTERVAL_MS * (2 ** Math.max(0, attempt - 1)));
}

export function isPermanentDeliveryError(error) {
    const message = String(error?.description || error?.message || error || "").toLowerCase();
    return /chat not found|bot was blocked by the user|user is deactivated|bot can't initiate conversation|peer_id_invalid|chat_id is empty/.test(message);
}

export async function recoverPaidOrdersOnce({
    prisma,
    telegram,
    deliver = deliverOrder,
    retryState = new Map(),
    now = Date.now(),
    batchSize = DEFAULT_BATCH_SIZE,
} = {}) {
    const orders = await prisma.order.findMany({
        where: { status: "PAID", deliveryRetryBlockedAt: null },
        orderBy: { createdAt: "asc" },
        take: Math.max(1, Number(batchSize) || DEFAULT_BATCH_SIZE),
    });
    const result = { found: orders.length, delivered: 0, skipped: 0, failed: 0, blocked: 0 };

    for (const order of orders) {
        const previous = retryState.get(order.id);
        if (previous?.nextAttemptAt > now) {
            result.skipped += 1;
            continue;
        }

        try {
            const delivery = await deliver({ prisma, telegram, order });
            retryState.delete(order.id);
            if (delivery?.skipped) result.skipped += 1;
            else result.delivered += 1;
        } catch (error) {
            if (isPermanentDeliveryError(error)) {
                retryState.delete(order.id);
                await prisma.order.update({
                    where: { id: order.id },
                    data: {
                        deliveryRetryBlockedAt: new Date(now),
                        deliveryError: String(error?.description || error?.message || error).slice(0, 500),
                    },
                });
                result.blocked += 1;
                console.error(
                    `[delivery:recovery] order ${order.id} blocked from automatic retry: ${error.message}`,
                );
                continue;
            }

            const attempt = (previous?.attempt || 0) + 1;
            const delayMs = retryDelayMs(attempt);
            retryState.set(order.id, { attempt, nextAttemptAt: now + delayMs });
            result.failed += 1;
            console.warn(
                `[delivery:recovery] order ${order.id} failed (${attempt}), retry in ${Math.round(delayMs / 1000)}s: ${error.message}`,
            );
        }
    }

    return result;
}

export function startPaidDeliveryRecovery({ prisma, telegram } = {}) {
    if (String(process.env.DELIVERY_RECOVERY_ENABLED || "true").toLowerCase() === "false") {
        console.log("Delivery recovery disabled");
        return { stop() {} };
    }

    const intervalMs = Math.max(15_000, Number(process.env.DELIVERY_RECOVERY_INTERVAL_MS || DEFAULT_INTERVAL_MS));
    const batchSize = Math.max(1, Number(process.env.DELIVERY_RECOVERY_BATCH_SIZE || DEFAULT_BATCH_SIZE));
    const retryState = new Map();
    let running = false;

    const tick = async () => {
        if (running) return;
        running = true;
        try {
            await recoverPaidOrdersOnce({ prisma, telegram, retryState, batchSize });
        } catch (error) {
            console.error("[delivery:recovery] scan failed:", error.message);
        } finally {
            running = false;
        }
    };

    const timer = setInterval(tick, intervalMs);
    tick().catch(() => {});
    console.log(`Delivery recovery started (${intervalMs}ms, batch ${batchSize})`);

    return { stop() { clearInterval(timer); } };
}
