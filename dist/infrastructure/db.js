import { PrismaClient } from '@prisma/client';
import { createLogger } from './logger.js';
const log = createLogger('Prisma');
function buildPrismaClient() {
    const client = new PrismaClient({
        log: [
            { level: 'warn', emit: 'event' },
            { level: 'error', emit: 'event' },
        ],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client.$on('warn', (e) => log.warn(e.message));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client.$on('error', (e) => log.error(e.message));
    return client;
}
const prisma = process.env.NODE_ENV === 'production'
    ? buildPrismaClient()
    : (globalThis.__prisma ??= buildPrismaClient());
export default prisma;
// ─── DB Heartbeat ─────────────────────────────────────────────────────────────
// Giữ connection luôn alive, tránh cold start khi bot ít traffic
let heartbeatInterval = null;
export function startDbHeartbeat(intervalMs = 30_000) {
    if (heartbeatInterval)
        return;
    heartbeatInterval = setInterval(async () => {
        try {
            await prisma.$runCommandRaw({ ping: 1 });
        }
        catch (err) {
            log.warn('DB heartbeat failed — connection may be cold');
        }
    }, intervalMs);
    log.info(`DB heartbeat started (every ${intervalMs / 1000}s)`);
}
