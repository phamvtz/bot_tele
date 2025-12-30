#!/bin/sh

echo "🚀 Starting Telegram Shop Bot..."

# Run prisma db push with timeout (30 seconds max)
# If it fails, continue anyway - app has retry logic
echo "📦 Running prisma db push..."
timeout 30 npx prisma db push --accept-data-loss 2>/dev/null || echo "⚠️ DB push skipped/failed, continuing..."

# Start the Node app
echo "🤖 Starting app..."
exec node src/server.js
