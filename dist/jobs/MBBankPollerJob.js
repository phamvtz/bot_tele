import { createLogger } from '../infrastructure/logger.js';
import { PaymentService } from '../modules/payment/PaymentService.js';
const log = createLogger('MBBankPoller');
/**
 * Danh sách tranId đã xử lý để tránh double-process
 * Dùng Set in-memory (reset khi restart — OK vì PaymentService có idempotency check)
 */
const processedTranIds = new Set();
// ── Hàm fetch giao dịch từ thueapibank.vn ────────────────────────────────────
async function fetchMBBankTransactions() {
    const token = process.env.MBBANK_API_TOKEN;
    const account = process.env.MBBANK_ACCOUNT_NUMBER;
    const pass = process.env.MBBANK_ACCOUNT_PASSWORD;
    if (!token) {
        log.warn('MBBANK_API_TOKEN is not configured.');
        return [];
    }
    let url;
    // V3 nếu có đủ account + password
    if (account && pass) {
        url = `https://thueapibank.vn/historyapimbv3/${encodeURIComponent(pass)}/${account}/${token}`;
    }
    else {
        // V2: CHỈ dùng token — KHÔNG thêm account (gây lỗi "Token không hợp lệ")
        url = `https://thueapibank.vn/historyapimbv2/${token}`;
    }
    log.info({ url: url.replace(token, token.slice(0, 8) + '...') }, 'Fetching MBBank transactions');
    const response = await fetch(url, {
        headers: { 'Accept': 'application/json' }
    });
    if (!response.ok) {
        throw new Error(`MBBank API HTTP error: ${response.status} ${response.statusText}`);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await response.json();
    // Log response để debug
    const list = data.TranList ?? data.transactions ?? data.data ?? [];
    const tranCount = Array.isArray(list) ? list.length : 'N/A';
    log.info({ status: data.status, tranCount, raw: JSON.stringify(data).slice(0, 300) }, 'MBBank API response');
    // Hỗ trợ nhiều format response khác nhau của thueapibank.vn
    if (data.status && data.status.toLowerCase() !== 'success') {
        throw new Error(`MBBank API error: ${data.message ?? data.msg ?? data.status}`);
    }
    // TranList hoặc transactions hoặc data
    return Array.isArray(list) ? list : [];
}
// ── Xử lý từng giao dịch mới ─────────────────────────────────────────────────
async function processMBBankTransaction(tx) {
    // Hỗ trợ cả format mới (transactionID/amount/type) và cũ (refNo/creditAmount)
    const isIn = tx.type === 'IN' || (tx.creditAmount && parseFloat(tx.creditAmount) > 0);
    if (!isIn)
        return;
    // Số tiền: ưu tiên field 'amount', fallback 'creditAmount'
    const amountStr = tx.amount ?? tx.creditAmount ?? '0';
    const credit = parseInt(amountStr.replace(/[^0-9]/g, ''), 10);
    if (!credit || credit <= 0)
        return;
    // Unique key: ưu tiên transactionID, fallback refNo/tranId
    const uniqueKey = tx.transactionID ?? tx.refNo ?? tx.tranId;
    if (!uniqueKey)
        return;
    // Idempotency: bỏ qua nếu đã xử lý
    if (processedTranIds.has(uniqueKey))
        return;
    processedTranIds.add(uniqueKey);
    log.info({ txId: uniqueKey, amount: credit, desc: tx.description }, 'New MBBank transaction detected');
    try {
        const result = await PaymentService.processBankCallback('MBBANK', uniqueKey, credit, tx.description, JSON.stringify(tx));
        log.info({ txId: uniqueKey, status: result.status }, 'MBBank transaction processed');
    }
    catch (err) {
        log.error({ err, txId: uniqueKey }, 'Failed to process MBBank transaction');
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
    log.info({ intervalMs }, 'Starting MBBank poller job ✅');
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
    // Chạy lần đầu ngay khi startup — sequential để tránh MongoDB deadlock
    (async () => {
        try {
            const txs = await fetchMBBankTransactions();
            for (const t of txs) {
                await processMBBankTransaction(t);
            }
        }
        catch (err) {
            log.error({ err }, 'MBBank initial poll error');
        }
    })();
}
export function stopMBBankPollerJob() {
    if (_pollInterval) {
        clearInterval(_pollInterval);
        _pollInterval = null;
        log.info('MBBank poller job stopped');
    }
}
