import { prisma } from "./db.js";
import fs from "fs/promises";
import path from "path";

/**
 * Export Module
 * Generate Excel/CSV reports for orders and revenue
 */

const EXPORT_DIR = process.env.EXPORT_DIR || "./exports";

/**
 * Export orders to CSV
 */
export async function exportOrdersCSV(startDate = null, endDate = null) {
    await fs.mkdir(EXPORT_DIR, { recursive: true });

    const where = { status: "DELIVERED" };
    if (startDate) {
        where.createdAt = { gte: startDate };
    }
    if (endDate) {
        where.createdAt = { ...where.createdAt, lte: endDate };
    }

    const orders = await prisma.order.findMany({
        where,
        include: { product: true, user: true },
        orderBy: { createdAt: "desc" },
    });

    // CSV Header
    const headers = [
        "Mã đơn",
        "Ngày",
        "Khách hàng",
        "Telegram ID",
        "Sản phẩm",
        "Số lượng",
        "Tổng tiền",
        "Giảm giá",
        "Thành tiền",
        "Thanh toán",
        "Trạng thái",
    ];

    // CSV Rows
    const rows = orders.map((o) => [
        o.id,
        o.createdAt.toLocaleString("vi-VN"),
        o.user?.firstName || "-",
        o.odelegramId,
        o.product.name,
        o.quantity,
        o.amount,
        o.discount,
        o.finalAmount,
        o.paymentMethod || "-",
        o.status,
    ]);

    // Build CSV content
    const csvContent = [
        headers.join(","),
        ...rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")),
    ].join("\n");

    // Add BOM for Excel UTF-8
    const bom = "\uFEFF";
    const filename = `orders_${Date.now()}.csv`;
    const filepath = path.join(EXPORT_DIR, filename);

    await fs.writeFile(filepath, bom + csvContent, "utf-8");

    return { filepath, filename, count: orders.length };
}

/**
 * Export revenue report to CSV
 */
export async function exportRevenueCSV(days = 30) {
    await fs.mkdir(EXPORT_DIR, { recursive: true });

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    // Get daily revenue
    const orders = await prisma.order.findMany({
        where: {
            status: "DELIVERED",
            createdAt: { gte: startDate },
        },
        orderBy: { createdAt: "asc" },
    });

    // Group by date
    const dailyRevenue = {};
    for (const order of orders) {
        const date = order.createdAt.toLocaleDateString("vi-VN");
        if (!dailyRevenue[date]) {
            dailyRevenue[date] = { revenue: 0, orders: 0 };
        }
        dailyRevenue[date].revenue += order.finalAmount;
        dailyRevenue[date].orders++;
    }

    // Headers
    const headers = ["Ngày", "Số đơn", "Doanh thu"];

    // Rows
    const rows = Object.entries(dailyRevenue).map(([date, data]) => [
        date,
        data.orders,
        data.revenue,
    ]);

    // Total row
    const totalRevenue = Object.values(dailyRevenue).reduce((sum, d) => sum + d.revenue, 0);
    const totalOrders = Object.values(dailyRevenue).reduce((sum, d) => sum + d.orders, 0);
    rows.push(["TỔNG", totalOrders, totalRevenue]);

    // Build CSV
    const csvContent = [
        headers.join(","),
        ...rows.map((row) => row.join(",")),
    ].join("\n");

    const bom = "\uFEFF";
    const filename = `revenue_${days}days_${Date.now()}.csv`;
    const filepath = path.join(EXPORT_DIR, filename);

    await fs.writeFile(filepath, bom + csvContent, "utf-8");

    return { filepath, filename, days, totalRevenue, totalOrders };
}

/**
 * Export users to CSV
 */
export async function exportUsersCSV() {
    await fs.mkdir(EXPORT_DIR, { recursive: true });

    const users = await prisma.user.findMany({
        orderBy: { createdAt: "desc" },
    });

    const headers = [
        "ID",
        "Telegram ID",
        "Username",
        "Tên",
        "VIP",
        "Tổng chi tiêu",
        "Số dư",
        "Ngày đăng ký",
        "Blocked",
    ];

    const rows = users.map((u) => [
        u.id,
        u.telegramId,
        u.username || "-",
        u.firstName || "-",
        u.vipLevel,
        u.totalSpent,
        u.balance,
        u.createdAt.toLocaleDateString("vi-VN"),
        u.isBlocked ? "Yes" : "No",
    ]);

    const csvContent = [
        headers.join(","),
        ...rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")),
    ].join("\n");

    const bom = "\uFEFF";
    const filename = `users_${Date.now()}.csv`;
    const filepath = path.join(EXPORT_DIR, filename);

    await fs.writeFile(filepath, bom + csvContent, "utf-8");

    return { filepath, filename, count: users.length };
}

/**
 * Export products with stock to CSV
 */
export async function exportProductsCSV() {
    await fs.mkdir(EXPORT_DIR, { recursive: true });

    const products = await prisma.product.findMany({
        include: {
            _count: {
                select: {
                    stockItems: { where: { isSold: false } },
                },
            },
        },
        orderBy: { createdAt: "desc" },
    });

    const headers = [
        "Code",
        "Tên",
        "Giá",
        "Giá VIP",
        "Mode",
        "Stock còn",
        "Trạng thái",
        "Ngày tạo",
    ];

    const rows = products.map((p) => [
        p.code,
        p.name,
        p.price,
        p.vipPrice || "-",
        p.deliveryMode,
        p._count.stockItems,
        p.isActive ? "Bật" : "Tắt",
        p.createdAt.toLocaleDateString("vi-VN"),
    ]);

    const csvContent = [
        headers.join(","),
        ...rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")),
    ].join("\n");

    const bom = "\uFEFF";
    const filename = `products_${Date.now()}.csv`;
    const filepath = path.join(EXPORT_DIR, filename);

    await fs.writeFile(filepath, bom + csvContent, "utf-8");

    return { filepath, filename, count: products.length };
}

/**
 * Clean old exports
 */
export async function cleanOldExports(maxAgeHours = 24) {
    try {
        const files = await fs.readdir(EXPORT_DIR);
        const now = Date.now();
        const maxAge = maxAgeHours * 60 * 60 * 1000;

        for (const file of files) {
            const filepath = path.join(EXPORT_DIR, file);
            const stats = await fs.stat(filepath);

            if (now - stats.mtime.getTime() > maxAge) {
                await fs.unlink(filepath);
            }
        }
    } catch (error) {
        // Directory might not exist
    }
}

export default {
    exportOrdersCSV,
    exportRevenueCSV,
    exportUsersCSV,
    exportProductsCSV,
    cleanOldExports,
};
