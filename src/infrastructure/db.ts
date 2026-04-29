import { PrismaClient } from '@prisma/client';
import { createLogger } from './logger.js';

const log = createLogger('Prisma');

// ─── Global Singleton ──────────────────────────────────────────────────────────
// Prevents multiple PrismaClient instances in dev (hot-reload causes connection leaks)
declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

function buildPrismaClient(): PrismaClient {
  const client = new PrismaClient({
    log: [
      { level: 'warn',  emit: 'event' },
      { level: 'error', emit: 'event' },
    ],
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (client as any).$on('warn',  (e: { message: string }) => log.warn(e.message));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (client as any).$on('error', (e: { message: string }) => log.error(e.message));

  return client;
}

const prisma: PrismaClient =
  process.env.NODE_ENV === 'production'
    ? buildPrismaClient()
    : (globalThis.__prisma ??= buildPrismaClient());

export default prisma;

// ─── DB Heartbeat ─────────────────────────────────────────────────────────────
// Giữ connection luôn alive, tránh cold start khi bot ít traffic

let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

export function startDbHeartbeat(intervalMs = 30_000) {
  if (heartbeatInterval) return;
  heartbeatInterval = setInterval(async () => {
    try {
      await prisma.$runCommandRaw({ ping: 1 });
    } catch (err) {
      log.warn('DB heartbeat failed — connection may be cold');
    }
  }, intervalMs);
  log.info(`DB heartbeat started (every ${intervalMs / 1000}s)`);
}
