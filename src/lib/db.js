import prisma from "./prisma.js";

/**
 * DB ready check with retry — đợi DB sẵn sàng lúc khởi động.
 * Dùng setting collection (đã có sẵn) để verify connection thật.
 */
async function waitForDB(retry = 10) {
    for (let i = 0; i < retry; i++) {
        try {
            await prisma.setting.count();
            console.log("✅ DB ready");
            return true;
        } catch (e) {
            console.log(`⏳ DB not ready, retrying... (${i + 1}/${retry}): ${e.message}`);
            await new Promise((r) => setTimeout(r, 3000));
        }
    }
    console.error("❌ DB unreachable after retries");
    return false;
}

/**
 * Safe query wrapper — auto reconnect khi connection bị reset bởi network glitch.
 */
async function safeQuery(fn) {
    try {
        return await fn();
    } catch (e) {
        const msg = e?.message || "";
        const code = e?.code || "";
        const isConnectionError =
            msg.includes("Closed") ||
            msg.includes("topology was destroyed") ||
            msg.includes("not connected") ||
            msg.includes("connection") ||
            code === "P1017" ||
            code === "ECONNRESET";

        if (isConnectionError) {
            console.log("🔄 Reconnecting DB...");
            try {
                await prisma.$disconnect();
                await prisma.$connect();
                return await fn();
            } catch (retryError) {
                console.error("❌ Reconnect failed:", retryError.message);
                throw retryError;
            }
        }
        throw e;
    }
}

/**
 * Keep-alive ping mỗi 5 phút — giữ connection ấm,
 * tránh Atlas đóng idle connection.
 */
function startKeepAlive() {
    const timer = setInterval(async () => {
        try {
            await prisma.setting.count();
        } catch (e) {
            console.log("⚠️ Keep-alive failed:", e.message);
        }
    }, 5 * 60 * 1000); // 5 minutes
    timer.unref?.();
}

export { waitForDB, safeQuery, startKeepAlive };
