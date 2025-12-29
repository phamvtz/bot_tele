FROM node:20-alpine

# Install OpenSSL for Prisma
RUN apk add --no-cache openssl libssl3

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

RUN npx prisma generate

EXPOSE 3000

CMD ["npm", "start"]
