import { PrismaClient } from "@prisma/client";

// Prisma client singleton with connection retry for Neon.tech
export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

// Handle connection errors
prisma.$connect().catch((err) => {
  console.error("Failed to connect to database:", err);
});

// Graceful shutdown
process.on("beforeExit", async () => {
  await prisma.$disconnect();
});
