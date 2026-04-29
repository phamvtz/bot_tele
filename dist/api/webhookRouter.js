import { Router } from 'express';
import { PaymentService } from '../modules/payment/PaymentService.js';
import { createLogger } from '../infrastructure/logger.js';
import crypto from 'crypto';
const router = Router();
const log = createLogger('WebhookRouter');
/**
 * SePay IPN Webhook Endpoint
 * POST /webhook/sepay
 *
 * SePay gửi callback khi nhận được giao dịch.
 * Signature verification sử dụng HMAC-SHA256.
 *
 * Docs: https://my.sepay.vn/userapi/transactions/docs
 */
router.post('/sepay', async (req, res) => {
    try {
        // 1. Verify signature (nếu có IPN_SECRET_TOKEN)
        const secretToken = process.env.IPN_SECRET_TOKEN;
        if (secretToken) {
            const signature = req.headers['x-sepay-signature'];
            if (!signature) {
                log.warn('SePay webhook: missing signature header');
                return res.status(401).json({ success: false, error: 'Missing signature' });
            }
            const rawBody = JSON.stringify(req.body);
            const expected = crypto
                .createHmac('sha256', secretToken)
                .update(rawBody)
                .digest('hex');
            if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
                log.warn('SePay webhook: invalid signature');
                return res.status(401).json({ success: false, error: 'Invalid signature' });
            }
        }
        // 2. Parse payload
        const payload = req.body;
        log.info({ payload }, 'SePay callback received');
        const { referenceNumber: transactionRef, transferAmount: amount, content: transferContent, gateway: provider, } = payload;
        if (!transactionRef || !amount || !transferContent) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }
        // 3. Process
        const result = await PaymentService.processBankCallback(provider ?? 'SEPAY', String(transactionRef), Number(amount), String(transferContent), JSON.stringify(payload));
        log.info({ status: result.status }, 'SePay callback processed');
        // SePay expects 200 with success flag
        return res.json({ success: true, status: result.status });
    }
    catch (err) {
        log.error({ err }, 'SePay webhook processing error');
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});
export default router;
