import { createLogger } from '../../infrastructure/logger.js';
const log = createLogger('ErrorBoundary');
/**
 * Global error boundary middleware.
 *
 * - Bắt tất cả exceptions phát sinh từ handlers phía sau
 * - Tự động `answerCbQuery` nếu context là callback (tránh spinner xoay mãi)
 * - Trả về message thân thiện người dùng bằng tiếng Việt
 * - Log đầy đủ để debug
 */
export const errorMiddleware = async (ctx, next) => {
    try {
        await next();
    }
    catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        const userId = ctx.from?.id;
        log.error({ err, userId, updateType: ctx.updateType }, 'Unhandled error in bot handler');
        // Bao giờ cũng answer callback query để Telegram không hiển thị spinner
        if (ctx.callbackQuery) {
            try {
                await ctx.answerCbQuery('❌ Có lỗi xảy ra. Vui lòng thử lại!', { show_alert: false });
            }
            catch {
                // Ignore double-answer errors
            }
        }
        // Gửi message lỗi thân thiện
        const userMessage = getUserFriendlyError(errorMessage);
        try {
            await ctx.reply(userMessage, { parse_mode: 'Markdown' });
        }
        catch {
            // Có thể fail nếu bot bị block
        }
    }
};
function getUserFriendlyError(message) {
    // Match các lỗi business logic đã định nghĩa → trả về text đẹp
    if (message.includes('Insufficient balance'))
        return '❌ Số dư ví không đủ để thực hiện giao dịch này.';
    if (message.includes('Not enough stock'))
        return '❌ Sản phẩm đã hết hàng hoặc không đủ số lượng yêu cầu.';
    if (message.includes('Order is not in pending'))
        return '❌ Đơn hàng này không thể thanh toán (sai trạng thái).';
    if (message.includes('Đơn hàng đã hết hạn'))
        return '❌ Đơn hàng đã hết hạn thanh toán. Vui lòng tạo đơn mới.';
    if (message.includes('Product not found') || message.includes('Product is not active'))
        return '❌ Sản phẩm không tồn tại hoặc đã ngừng bán.';
    // Generic fallback
    return '❌ Có lỗi xảy ra. Vui lòng thử lại sau hoặc liên hệ hỗ trợ.';
}
