import fs from "fs/promises";
import path from "path";
import { prisma } from "./db.js";

/**
 * Backup Module
 * Handles automatic database backup
 */

const BACKUP_DIR = process.env.BACKUP_DIR || "./backups";
const MAX_BACKUPS = parseInt(process.env.MAX_BACKUPS || "10");
const ADMIN_IDS = (process.env.ADMIN_IDS || "").split(",").map(id => id.trim()).filter(Boolean);

function isTransientTelegramError(error) {
    const msg = String(error?.message || error?.code || "").toLowerCase();
    return /socket hang up|econnreset|etimedout|timeout|network|fetch failed|eai_again|enotfound|bad gateway|gateway time/.test(msg);
}

async function sendBackupWithRetry(bot, adminId, document, options, attempts = 4) {
    let lastError;
    for (let i = 0; i < attempts; i++) {
        try {
            return await bot.telegram.sendDocument(adminId, document, options);
        } catch (error) {
            lastError = error;
            if (i === attempts - 1 || !isTransientTelegramError(error)) throw error;
            const waitMs = Math.min(15000, 1000 * Math.pow(2, i));
            console.warn(`[backup] sendDocument lỗi tạm (${error.message}), thử lại sau ${waitMs}ms (${i + 1}/${attempts})`);
            await new Promise((resolve) => setTimeout(resolve, waitMs));
        }
    }
    throw lastError;
}

/**
 * Create a backup of the database
 */
export async function createBackup(bot) {
    try {
        // Ensure backup directory exists
        await fs.mkdir(BACKUP_DIR, { recursive: true });

        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const filename = `backup-${timestamp}.json`;
        const filepath = path.join(BACKUP_DIR, filename);

        // Export all data
        const data = {
            timestamp: new Date().toISOString(),
            users: await prisma.user.findMany(),
            products: await prisma.product.findMany(),
            stockItems: await prisma.stockItem.findMany(),
            orders: await prisma.order.findMany(),
            coupons: await prisma.coupon.findMany(),
            referrals: await prisma.referral.findMany(),
            settings: await prisma.setting.findMany(),
        };

        const content = JSON.stringify(data, null, 2);
        await fs.writeFile(filepath, content, "utf-8");

        const stats = await fs.stat(filepath);

        // Log backup
        await prisma.backupLog.create({
            data: {
                filename,
                size: stats.size,
            },
        });

        // Clean old backups
        await cleanOldBackups();

        // Notify admins
        if (bot) {
            for (const adminId of ADMIN_IDS) {
                try {
                    await sendBackupWithRetry(
                        bot,
                        adminId,
                        { source: filepath, filename },
                        { caption: `💾 Backup thành công!\n📦 Size: ${formatSize(stats.size)}` }
                    );
                } catch (e) {
                    console.error("Failed to send backup to admin:", e);
                }
            }
        }

        return { success: true, filename, size: stats.size };
    } catch (error) {
        console.error("Backup failed:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Clean old backups
 */
async function cleanOldBackups() {
    try {
        const files = await fs.readdir(BACKUP_DIR);
        const backupFiles = files
            .filter((f) => f.startsWith("backup-") && f.endsWith(".json"))
            .sort()
            .reverse();

        // Keep only MAX_BACKUPS files
        const toDelete = backupFiles.slice(MAX_BACKUPS);
        for (const file of toDelete) {
            await fs.unlink(path.join(BACKUP_DIR, file));
        }
    } catch (error) {
        console.error("Failed to clean old backups:", error);
    }
}

/**
 * List backups
 */
export async function listBackups() {
    try {
        await fs.mkdir(BACKUP_DIR, { recursive: true });
        const files = await fs.readdir(BACKUP_DIR);
        const backups = [];

        for (const file of files) {
            if (file.startsWith("backup-") && file.endsWith(".json")) {
                const stats = await fs.stat(path.join(BACKUP_DIR, file));
                backups.push({
                    filename: file,
                    size: stats.size,
                    createdAt: stats.mtime,
                });
            }
        }

        return backups.sort((a, b) => b.createdAt - a.createdAt);
    } catch (error) {
        console.error("Failed to list backups:", error);
        return [];
    }
}

/**
 * Format file size
 */
function formatSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

/**
 * Schedule automatic backups
 */
export function scheduleBackups(bot, intervalHours = 24) {
    const interval = intervalHours * 60 * 60 * 1000;

    setInterval(async () => {
        console.log("Running scheduled backup...");
        await createBackup(bot);
    }, interval);

    console.log(`📅 Backup scheduled every ${intervalHours} hours`);
}

export default {
    createBackup,
    listBackups,
    scheduleBackups,
};
