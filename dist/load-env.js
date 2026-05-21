import dotenv from 'dotenv';
dotenv.config({ override: true });
// Tự động ánh xạ MONGODB_URI sang DATABASE_URL cho Prisma
// nếu DATABASE_URL bị trống hoặc bị ghi đè bởi biến hệ thống Postgres
if (process.env.MONGODB_URI) {
    if (!process.env.DATABASE_URL || !process.env.DATABASE_URL.startsWith('mongo')) {
        process.env.DATABASE_URL = process.env.MONGODB_URI;
    }
}
// Bổ sung DB name vào DATABASE_URL nếu bị thiếu (Atlas proxy yêu cầu db name, không cho phép rỗng)
if (process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith('mongo')) {
    try {
        const url = new URL(process.env.DATABASE_URL);
        // url.pathname là '/' hoặc rỗng hoặc '/something'
        const dbName = url.pathname.replace(/^\//, '');
        if (!dbName) {
            const fallbackDb = process.env.MONGODB_DB || 'shopbottele';
            url.pathname = '/' + fallbackDb;
            process.env.DATABASE_URL = url.toString();
        }
    }
    catch (err) {
        // Bỏ qua nếu URL không hợp lệ, để Prisma tự báo lỗi
    }
}
