import { prisma } from "./db.js";
import fs from "fs/promises";
import path from "path";

/**
 * Export Module
 * Generate Excel/CSV reports for orders and revenue
 */

const EXPORT_DIR = process.env.EXPORT_DIR || "./exports";

/** Parse ngày từ query string ("2026-08-01") → Date. Bỏ qua nếu không hợp lệ. */
function parseDate(value, endOfDay = false) {
    if (!value) return null;
    if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
    const raw = String(value).trim();
    if (!raw) return null;
    // Chỉ có ngày (không có giờ) + là mốc kết thúc → lấy hết cuối ngày.
    const s = endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T23:59:59.999` : raw;
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
}

const VN_TZ_FMT = new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
});

/**
 * Export orders to CSV.
 *
 * Nhận:
 *   exportOrdersCSV()                          → toàn bộ đơn (mọi trạng thái)
 *   exportOrdersCSV(start, end)                → dạng cũ, vẫn dùng được
 *   exportOrdersCSV({ status, search, start, end })
 *
 * Trước đây where bị hardcode status: "DELIVERED" và so sánh createdAt với
 * STRING (không new Date()) nên lọc theo ngày trả về 0 dòng.
 */
export async function exportOrdersCSV(optionsOrStart = null, endDate = null) {
    await fs.mkdir(EXPORT_DIR, { recursive: true });

    const isOpts = optionsOrStart && typeof optionsOrStart === "object" && !(optionsOrStart instanceof Date);
    const opts = isOpts ? optionsOrStart : { start: optionsOrStart, end: endDate };

    const status = opts.status ? String(opts.status).trim().toUpperCase() : null;
    const search = opts.search ? String(opts.search).trim() : "";
    const start = parseDate(opts.start);
    const end = parseDate(opts.end, true);

    const where = {};
    if (status) where.status = status;
    if (start || end) {
        where.createdAt = {};
        if (start) where.createdAt.gte = start;
        if (end) where.createdAt.lte = end;
    }
    if (search) {
        // Cùng logic với GET /orders: khớp telegramId, tên/username khách, tên SP.
        const [matchedUsers, matchedProducts] = await Promise.all([
            prisma.user.findMany({
                where: { OR: [
                    { firstName: { contains: search, mode: "insensitive" } },
                    { username: { contains: search, mode: "insensitive" } },
                ] },
                select: { telegramId: true }, take: 100,
            }),
            prisma.product.findMany({
                where: { name: { contains: search, mode: "insensitive" } },
                select: { id: true }, take: 50,
            }),
        ]);
        const orClauses = [{ odelegramId: { contains: search } }];
        const tids = matchedUsers.map((u) => u.telegramId);
        const pids = matchedProducts.map((p) => p.id);
        if (tids.length) orClauses.push({ odelegramId: { in: tids } });
        if (pids.length) orClauses.push({ productId: { in: pids } });
        where.OR = orClauses;
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
        o.oderId || o.id,
        o.createdAt ? VN_TZ_FMT.format(new Date(o.createdAt)) : "-",
        o.user?.firstName || "-",
        o.odelegramId,
        o.product?.name || "(sản phẩm đã xoá)",
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
