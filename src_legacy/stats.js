import { prisma } from "./db.js";

/**
 * Statistics Module
 * Provides advanced statistics and reporting
 */

/**
 * Get stats for a time period
 */
export async function getStats(period = "today") {
    const now = new Date();
    let startDate;

    switch (period) {
        case "today":
            startDate = new Date(now.setHours(0, 0, 0, 0));
            break;
        case "week":
            startDate = new Date(now.setDate(now.getDate() - 7));
            break;
        case "month":
            startDate = new Date(now.setMonth(now.getMonth() - 1));
            break;
        default:
            startDate = null;
    }

    const where = startDate
        ? { status: "DELIVERED", createdAt: { gte: startDate } }
        : { status: "DELIVERED" };

    const orders = await prisma.order.findMany({ where });

    const revenue = orders.reduce((sum, o) => sum + o.finalAmount, 0);
    const orderCount = orders.length;

    const totalProducts = await prisma.product.count();
    const activeProducts = await prisma.product.count({ where: { isActive: true } });

    const totalUsers = await prisma.user.count();
    const newUsers = startDate
        ? await prisma.user.count({ where: { createdAt: { gte: startDate } } })
        : totalUsers;

    const totalStock = await prisma.stockItem.count({ where: { isSold: false } });

    return {
        period,
        revenue,
        orderCount,
        avgOrderValue: orderCount ? Math.round(revenue / orderCount) : 0,
        totalProducts,
        activeProducts,
        totalUsers,
        newUsers,
        totalStock,
    };
}

/**
 * Get top selling products
 */
export async function getTopProducts(limit = 5, period = null) {
    let startDate = null;
    if (period === "week") {
        startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    } else if (period === "month") {
        startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    }

    const where = {
        status: "DELIVERED",
        ...(startDate && { createdAt: { gte: startDate } }),
    };

    const orders = await prisma.order.findMany({
        where,
        include: { product: true },
    });

    // Group by product
    const productStats = {};
    for (const order of orders) {
        const pid = order.productId;
        if (!productStats[pid]) {
            productStats[pid] = {
                product: order.product,
                quantity: 0,
                revenue: 0,
            };
        }
        productStats[pid].quantity += order.quantity;
        productStats[pid].revenue += order.finalAmount;
    }

    // Sort by quantity
    return Object.values(productStats)
        .sort((a, b) => b.quantity - a.quantity)
        .slice(0, limit);
}

/**
 * Get revenue by day for chart
 */
export async function getRevenueByDay(days = 7) {
    const result = [];
    const now = new Date();

    for (let i = days - 1; i >= 0; i--) {
        const date = new Date(now);
        date.setDate(date.getDate() - i);
        date.setHours(0, 0, 0, 0);

        const nextDate = new Date(date);
        nextDate.setDate(nextDate.getDate() + 1);

        const orders = await prisma.order.findMany({
            where: {
                status: "DELIVERED",
                createdAt: { gte: date, lt: nextDate },
            },
        });

        const revenue = orders.reduce((sum, o) => sum + o.finalAmount, 0);
        const count = orders.length;

        result.push({
            date: date.toLocaleDateString("vi-VN", { weekday: "short", day: "numeric" }),
            revenue,
            count,
        });
    }

    return result;
}

/**
 * Generate text-based chart for Telegram
 */
export function generateTextChart(data, maxWidth = 20) {
    if (!data.length) return "Không có dữ liệu";

    const maxValue = Math.max(...data.map((d) => d.revenue));
    if (maxValue === 0) return "Không có doanh thu";

    const lines = data.map((d) => {
        const barLength = Math.round((d.revenue / maxValue) * maxWidth);
        const bar = "█".repeat(barLength) + "░".repeat(maxWidth - barLength);
        const value = formatCurrency(d.revenue);
        return `${d.date.padEnd(8)} ${bar} ${value}`;
    });

    return "```\n" + lines.join("\n") + "\n```";
}

/**
 * Format currency
 */
function formatCurrency(amount) {
    return new Intl.NumberFormat("vi-VN").format(amount) + "đ";
}

/**
 * Get full stats message
 */
export async function getStatsMessage(period = "today") {
    const stats = await getStats(period);
    const topProducts = await getTopProducts(3, period === "all" ? null : period);

    const periodLabels = {
        today: "📅 Hôm nay",
        week: "📆 7 ngày qua",
        month: "🗓️ 30 ngày qua",
        all: "📈 Tất cả",
    };

    let msg = `📊 *Thống kê - ${periodLabels[period]}*\n\n`;
    msg += `💰 Doanh thu: ${formatCurrency(stats.revenue)}\n`;
    msg += `📦 Đơn hàng: ${stats.orderCount}\n`;
    msg += `💵 TB/đơn: ${formatCurrency(stats.avgOrderValue)}\n\n`;
    msg += `🛍️ Sản phẩm: ${stats.activeProducts}/${stats.totalProducts}\n`;
    msg += `👥 Người dùng: ${stats.totalUsers} (+${stats.newUsers} mới)\n`;
    msg += `📊 Stock còn: ${stats.totalStock}\n`;

    if (topProducts.length > 0) {
        msg += "\n🏆 *Top sản phẩm:*\n";
        topProducts.forEach((p, i) => {
            msg += `${i + 1}. ${p.product.name}: ${p.quantity} bán\n`;
        });
    }

    return msg;
}

export default {
    getStats,
    getTopProducts,
    getRevenueByDay,
    generateTextChart,
    getStatsMessage,
};
