FROM node:20-slim

# Install OpenSSL
RUN apt-get update && apt-get install -y openssl libssl-dev ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Prisma generate (db push sẽ chạy khi deploy, không phải khi start)
RUN npx prisma generate

EXPOSE 10000

# Start app - NO db push at runtime!
CMD ["npm", "start"]
