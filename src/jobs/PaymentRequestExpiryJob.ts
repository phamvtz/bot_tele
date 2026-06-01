import cron from 'node-cron';
import prisma from '../infrastructure/db.js';
import { createLogger } from '../infrastructure/logger.js';

const log = createLogger('PaymentRequestExpiryJob');

export function startPaymentRequestExpiryJob() {
  cron.schedule('* * * * *', async () => {
    try {
      const result = await prisma.paymentRequest.updateMany({
        where: {
          status: 'PENDING',
          expiresAt: { lt: new Date() },
        },
        data: { status: 'EXPIRED' },
      });

      if (result.count > 0) {
        log.info({ count: result.count }, 'Expired stale payment requests');
      }
    } catch (err) {
      log.error({ err }, 'PaymentRequestExpiryJob: fatal error');
    }
  });

  log.info('Payment Request Expiry Job started (every 1 minute)');
}
