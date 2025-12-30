import { PrismaClient } from "@prisma/client";

// Prisma client singleton - KHÔNG tạo lại bừa bãi
let prisma;

function getPrisma() {
    if (!prisma) {
        prisma = new PrismaClient({
            log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
        });
    }
    return prisma;
}

export { getPrisma };
export default getPrisma();



