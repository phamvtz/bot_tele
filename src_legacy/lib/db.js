import prisma from "./prisma.js";

// DB ready check with retry - CỐT LÕI FIX NGỦ
async function waitForDB(retry = 10) {
    for (let i = 0; i < retry; i++) {
        try {
            await prisma.$queryRaw`SELECT 1`;
            console.log("✅ DB ready");
            return true;
        } catch (e) {
            console.log(`⏳ DB not ready, retrying... (${i + 1}/${retry})`);
            await new Promise((r) => setTimeout(r, 3000));
        }
    }
    console.error("❌ DB unreachable after retries");
    return false;
}

// Safe query wrapper - auto reconnect on closed connection
async function safeQuery(fn) {
    try {
        return await fn();
    } catch (e) {
        if (e.message?.includes("Closed") || e.code === "P1017") {
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

// Keep-alive ping every 5 minutes - prevent DB sleep
function startKeepAlive() {
    setInterval(async () => {
        try {
            await prisma.$queryRaw`SELECT 1`;
            console.log("💓 DB keep-alive");
        } catch (e) {
            console.log("⚠️ Keep-alive failed, will retry on next ping");
        }
    }, 5 * 60 * 1000); // 5 minutes
}

export { waitForDB, safeQuery, startKeepAlive };
