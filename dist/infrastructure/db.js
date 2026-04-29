import { PrismaClient } from '@prisma/client';
import { createLogger } from './logger.js';
const log = createLogger('Prisma');
import pkg from 'pg';
const { Pool } = pkg;
import { PrismaPg } from '@prisma/adapter-pg';
function buildPrismaClient() {
    const connectionString = process.env.DATABASE_URL;
    const pool = new Pool({ connectionString });
    const adapter = new PrismaPg(pool);
    const client = new PrismaClient({
        adapter,
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
