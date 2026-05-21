import dotenv from 'dotenv';
dotenv.config({ override: true });

// Tự động ánh xạ MONGODB_URI sang DATABASE_URL cho Prisma
// nếu DATABASE_URL bị trống hoặc bị ghi đè bởi biến hệ thống Postgres
if (process.env.MONGODB_URI) {
  if (!process.env.DATABASE_URL || !process.env.DATABASE_URL.startsWith('mongo')) {
    process.env.DATABASE_URL = process.env.MONGODB_URI;
  }
}
