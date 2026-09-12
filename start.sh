#!/bin/sh
set -eu

echo "🚀 Starting Telegram Shop Bot..."
# Bot dùng MongoDB qua src/lib/prisma.js. Không chạy prisma db push ở runtime:
# schema.prisma chỉ là tài liệu và --accept-data-loss có thể phá DATABASE_URL khác.
exec node src/server.js