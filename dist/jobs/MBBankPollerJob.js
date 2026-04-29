import { createLogger } from '../infrastructure/logger.js';
import { PaymentService } from '../modules/payment/PaymentService.js';
const log = createLogger('MBBankPoller');
/**
 * Danh sách tranId đã xử lý để tránh double-process
 * Dùng Set in-memory (reset khi restart — OK vì PaymentService có idempotency check)
 */
const processedTranIds = new Set();
// ── Hàm fetch giao dịch từ thueapibank.vn ─────────────────────────────────────
async function fetchMBBankTransactions() {
    const token = process.env.MBBANK_API_TOKEN;
    const account = process.env.MBBANK_ACCOUNT_NUMBER;
    const pass = process.env.MBBANK_ACCOUNT_PASSWORD;
    if (!token) {
        log.warn('MBBANK_API_TOKEN is not configured.');
        return [];
    }
    let url;
    // Dùng V3 nếu có đủ thông tin đăng nhập
    if (account && pass) {
        url = `https://thueapibank.vn/historyapimbv3/${encodeURIComponent(pass)}/${account}/${token}`;
    }
    else {
        // V2: chỉ cần token
        url = `https://thueapibank.vn/historyapimbv2/${token}`;
    }
    const response = await fetch(url, {
        headers: { 'Accept': 'application/json' }
    });
    if (!response.ok) {
        throw new Error(`MBBank API responded with status ${response.status}`);
    }
    const data = await response.json();
    if (data.status !== 'success') {
        throw new Error(`MBBank API error: ${data.message}`);
    }
    return data.transactions ?? [];
}
// ── Xử lý từng giao dịch mới ─────────────────────────────────────────────────
async function processMBBankTransaction(tx) {
    // Chỉ xử lý giao dịch tiền vào (IN)
    if (tx.type !== 'IN')
        return;
    // Idempotency: bỏ qua nếu đã xử lý
    if (processedTranIds.has(tx.transactionID))
        return;
    processedTranIds.add(tx.transactionID);
    log.info({ transactionID: tx.transactionID, amount: tx.amount }, 'New MBBank transaction detected');
    try {
        const result = await PaymentService.processBankCallback('MBBANK', String(tx.transactionID), tx.amount, tx.description, // Nội dung CK — để khớp với transferContent
        JSON.stringify(tx));
        log.info({ transactionID: tx.transactionID, status: result.status }, 'MBBank transaction processed');
    }
    catch (err) {
        log.error({ err, tx }, 'Failed to process MBBank transaction');
    }
}
// ── Job Runner ────────────────────────────────────────────────────────────────
let _pollInterval = null;
export function startMBBankPollerJob() {
    const token = process.env.MBBANK_API_TOKEN;
    if (!token) {
        log.warn('MBBANK_API_TOKEN not set — MBBank poller will not start.');
        return;
    }
    const intervalMs = parseInt(process.env.MBBANK_POLL_INTERVAL_MS ?? '30000', 10);
    log.info({ intervalMs, url: `https://thueapibank.vn/historyapimbv2/${token.slice(0, 8)}...` }, 'Starting MBBank poller job ✅');
    _pollInterval = setInterval(async () => {
        try {
            const transactions = await fetchMBBankTransactions();
            for (const tx of transactions) {
                await processMBBankTransaction(tx);
            }
        }
        catch (err) {
            log.error({ err }, 'MBBank polling error');
        }
    }, intervalMs);
    // Chạy lần đầu ngay khi startup
    fetchMBBankTransactions()
        .then((txs) => txs.forEach(t => processMBBankTransaction(t)))
        .catch((err) => log.error({ err }, 'MBBank initial poll error'));
}
export function stopMBBankPollerJob() {
    if (_pollInterval) {
        clearInterval(_pollInterval);
        _pollInterval = null;
        log.info('MBBank poller job stopped');
    }
}
