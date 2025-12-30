FROM node:20-slim

# Install OpenSSL
RUN apt-get update && apt-get install -y openssl libssl-dev ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Prisma generate
RUN npx prisma generate

# Make start script executable
RUN chmod +x start.sh

EXPOSE 10000

# Start with script (includes db push with timeout)
CMD ["./start.sh"]
