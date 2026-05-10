import "dotenv/config";
import dns from "node:dns";
import { MongoClient } from "mongodb";

dns.setServers((process.env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1").split(","));

const categories = [
  { name: "Mail Reg Phone New", icon: "📧", order: 1 },
  { name: "Chat GPT", icon: "🤖", order: 2 },
  { name: "CapCut Pro", icon: "✂️", order: 3 },
  { name: "Youtube Pre", icon: "▶️", order: 4 },
  { name: "Src Code Bot", icon: "💻", order: 5 },
  { name: "Tool Quản Lý Chrome", icon: "🌐", order: 6 },
  { name: "Tool Veo 3 Tạo AI", icon: "🎬", order: 7 },
];

const products = [
  { category: "Mail Reg Phone New", code: "MAIL001", name: "Mail Reg Phone New 24H", price: 15000 },
  { category: "Mail Reg Phone New", code: "MAIL002", name: "Mail Reg Dính Phone Ẩn", price: 50000 },
  { category: "Mail Reg Phone New", code: "MAIL003", name: "Mail Trial YTB", price: 0 },
  { category: "Mail Reg Phone New", code: "MAIL004", name: "Mail GG One", price: 0 },
  { category: "Chat GPT", code: "GPT001", name: "Chat GPT Chính Chủ", price: 0 },
  { category: "Chat GPT", code: "GPT002", name: "Chat GPT 1 Tháng BH Full Fam Business", price: 50000 },
  { category: "Chat GPT", code: "GPT003", name: "Chat GPT Cấp 1 Tháng BH Full", price: 0 },
  { category: "CapCut Pro", code: "CAP001", name: "CapCut Pro 7D", price: 2000 },
  { category: "CapCut Pro", code: "CAP002", name: "CapCut Pro Chính Chủ", price: 0 },
  { category: "Youtube Pre", code: "YTB001", name: "Acc Fam Add 5 Người", price: 35000 },
  { category: "Src Code Bot", code: "BOT001", name: "Src Code Bot Này", price: 200000 },
  { category: "Src Code Bot", code: "BOT002", name: "Src Code Bot Làm Riêng", price: 0, payload: "Liên hệ: 200k-500k - @vanggohh" },
  { category: "Tool Quản Lý Chrome", code: "TOOL001", name: "GpmLogin Crack VV", price: 400000 },
  { category: "Tool Quản Lý Chrome", code: "TOOL002", name: "GenLogin Crack VV", price: 400000 },
  { category: "Tool Veo 3 Tạo AI", code: "VEO001", name: "Tool Veo 3 Tạo AI", price: 0, payload: "Liên hệ Admin @vanggohh (Tất cả liên hệ chuyển qua Admin)" },
];

const vipLevels = [
  { level: 0, name: "Thường", minSpent: 0, discountPercent: 0, referralBonus: 5 },
  { level: 1, name: "Bạc", minSpent: 500000, discountPercent: 5, referralBonus: 7 },
  { level: 2, name: "Vàng", minSpent: 2000000, discountPercent: 10, referralBonus: 10 },
  { level: 3, name: "Kim Cương", minSpent: 5000000, discountPercent: 15, referralBonus: 15 },
];

const coupons = [
  {
    code: "WELCOME10",
    discount: 10,
    discountType: "PERCENT",
    maxUses: 100,
    usedCount: 0,
    minOrder: 10000,
    maxDiscount: 50000,
    vipOnly: 0,
    expiresAt: null,
    isActive: true,
  },
  {
    code: "VIP20",
    discount: 20,
    discountType: "PERCENT",
    maxUses: 50,
    usedCount: 0,
    minOrder: 50000,
    maxDiscount: 100000,
    vipOnly: 1,
    expiresAt: null,
    isActive: true,
  },
];

const collectionNames = [
  "users",
  "categories",
  "products",
  "stockItems",
  "orders",
  "coupons",
  "referrals",
  "settings",
  "backupLogs",
  "auditLogs",
  "vipLevels",
  "broadcasts",
  "wallets",
  "walletTransactions",
];

function getDatabaseName(uri) {
  return process.env.MONGODB_DB || new URL(uri).pathname.replace("/", "") || "shopbottele";
}

async function createCollectionIfMissing(db, name) {
  const exists = await db.listCollections({ name }).hasNext();
  if (!exists) {
    await db.createCollection(name);
  }
}

async function ensureIndexes(db) {
  await Promise.all([
    db.collection("users").createIndex({ telegramId: 1 }, { unique: true }),
    db.collection("users").createIndex({ referralCode: 1 }, { unique: true }),
    db.collection("categories").createIndex({ name: 1 }, { unique: true }),
    db.collection("categories").createIndex({ order: 1 }),
    db.collection("products").createIndex({ code: 1 }, { unique: true }),
    db.collection("products").createIndex({ categoryId: 1 }),
    db.collection("stockItems").createIndex({ productId: 1, isSold: 1 }),
    db.collection("orders").createIndex({ odelegramId: 1 }),
    db.collection("orders").createIndex({ status: 1 }),
    db.collection("coupons").createIndex({ code: 1 }, { unique: true }),
    db.collection("vipLevels").createIndex({ level: 1 }, { unique: true }),
    db.collection("wallets").createIndex({ odelegramId: 1 }, { unique: true }),
    db.collection("walletTransactions").createIndex({ walletId: 1 }),
  ]);
}

async function seed() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("Missing MONGODB_URI in .env");
  }

  const client = new MongoClient(uri);
  await client.connect();

  const db = client.db(getDatabaseName(uri));
  const now = new Date();

  try {
    for (const name of collectionNames) {
      await createCollectionIfMissing(db, name);
    }
    await ensureIndexes(db);

    for (const category of categories) {
      await db.collection("categories").updateOne(
        { name: category.name },
        {
          $set: { ...category, isActive: true },
          $setOnInsert: { createdAt: now },
        },
        { upsert: true },
      );
    }

    const categoryDocs = await db.collection("categories").find({}).toArray();
    const categoryByName = new Map(categoryDocs.map((category) => [category.name, category]));

    for (const product of products) {
      const category = categoryByName.get(product.category);
      if (!category) {
        throw new Error(`Missing category: ${product.category}`);
      }

      await db.collection("products").updateOne(
        { code: product.code },
        {
          $set: {
            code: product.code,
            name: product.name,
            description: product.description || null,
            price: product.price,
            vipPrice: product.vipPrice || null,
            currency: "VND",
            deliveryMode: "TEXT",
            payload: product.payload || "Liên hệ Admin @vanggohh",
            isActive: true,
            stockAlertAt: 5,
            autoDisableAt: 0,
            categoryId: category._id,
            updatedAt: now,
          },
          $setOnInsert: { createdAt: now },
        },
        { upsert: true },
      );
    }

    for (const level of vipLevels) {
      await db.collection("vipLevels").updateOne(
        { level: level.level },
        { $set: level },
        { upsert: true },
      );
    }

    for (const coupon of coupons) {
      await db.collection("coupons").updateOne(
        { code: coupon.code },
        { $set: coupon, $setOnInsert: { createdAt: now } },
        { upsert: true },
      );
    }

    const settings = {
      bankCode: process.env.BANK_CODE || "",
      bankName: process.env.BANK_NAME || process.env.DEFAULT_BANK_NAME || "",
      bankAccount: process.env.BANK_ACCOUNT || process.env.DEFAULT_BANK_ACCOUNT || "",
      bankAccountName: process.env.BANK_ACCOUNT_NAME || process.env.DEFAULT_BANK_OWNER || "",
      referralCommission: process.env.REFERRAL_COMMISSION || "5",
      adminTelegram: process.env.ADMIN_TELEGRAM || "",
    };

    for (const [key, value] of Object.entries(settings)) {
      await db.collection("settings").updateOne(
        { key },
        { $set: { key, value: String(value), updatedAt: now } },
        { upsert: true },
      );
    }

    const adminIds = (process.env.ADMIN_IDS || "").split(",").map((id) => id.trim()).filter(Boolean);
    for (const telegramId of adminIds) {
      const user = await db.collection("users").findOneAndUpdate(
        { telegramId },
        {
          $set: {
            telegramId,
            username: process.env.ADMIN_TELEGRAM || null,
            firstName: "Admin",
            language: "vi",
            isBlocked: false,
            vipLevel: 3,
            vipExpiresAt: null,
            updatedAt: now,
          },
          $setOnInsert: {
            referralCode: `ADMIN${telegramId.slice(-6)}`,
            referredBy: null,
            balance: 0,
            totalSpent: 0,
            createdAt: now,
          },
        },
        { upsert: true, returnDocument: "after" },
      );

      await db.collection("wallets").updateOne(
        { odelegramId: telegramId },
        {
          $set: { odelegramId: telegramId, updatedAt: now },
          $setOnInsert: { userId: user._id, balance: 0, createdAt: now },
        },
        { upsert: true },
      );
    }

    const stats = await Promise.all([
      db.collection("categories").countDocuments(),
      db.collection("products").countDocuments(),
      db.collection("coupons").countDocuments(),
      db.collection("vipLevels").countDocuments(),
      db.collection("users").countDocuments(),
      db.collection("wallets").countDocuments(),
    ]);

    console.log(`MongoDB seeded: ${db.databaseName}`);
    console.log(`Categories: ${stats[0]}`);
    console.log(`Products: ${stats[1]}`);
    console.log(`Coupons: ${stats[2]}`);
    console.log(`VIP levels: ${stats[3]}`);
    console.log(`Users: ${stats[4]}`);
    console.log(`Wallets: ${stats[5]}`);
  } finally {
    await client.close();
  }
}

seed().catch((error) => {
  console.error(error);
  process.exit(1);
});
