import pino from 'pino';
/**
 * Centralized logger powered by pino.
 * LOG_LEVEL env controls verbosity (trace | debug | info | warn | error).
 */
const logger = pino({
    level: process.env.LOG_LEVEL ?? 'info',
    transport: process.env.NODE_ENV !== 'production'
        ? {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' },
        }
        : undefined,
});
export default logger;
/**
 * Create a child logger with a fixed module context.
 * Usage: const log = createLogger('OrderService');
 */
export function createLogger(module) {
    return logger.child({ module });
}
