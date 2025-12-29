FROM node:20-slim

# Install OpenSSL
RUN apt-get update && apt-get install -y openssl libssl-dev ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

# Generate Prisma client and run migrations
RUN npx prisma generate
RUN npx prisma migrate deploy || npx prisma db push --accept-data-loss

EXPOSE 3000

CMD ["npm", "start"]
