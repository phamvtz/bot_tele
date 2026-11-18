FROM node:20-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Build Mini App & React Admin frontend bundles
RUN if [ -f "miniapp/package.json" ]; then cd miniapp && npm ci && npm run build && cd ..; fi
RUN if [ -f "admin-react/package.json" ]; then cd admin-react && npm ci && npm run build && cd ..; fi

# Prisma generate
RUN npx prisma generate

FROM node:20-slim

# Install OpenSSL & CA certs
RUN apt-get update && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app ./

# Make start script executable
RUN chmod +x start.sh

EXPOSE 3001
ENV PORT=3001

# Start server
CMD ["./start.sh"]
