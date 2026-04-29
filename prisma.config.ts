import "dotenv/config";
import { defineConfig } from "prisma/config";

/**
 * Prisma Config — chỉ khai báo đường dẫn schema.
 * DATABASE_URL được đọc từ .env và khai báo trong schema.prisma
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
});
