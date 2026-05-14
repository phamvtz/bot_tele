import "dotenv/config";
import dns from "node:dns";
import { MongoClient, ObjectId } from "mongodb";

dns.setServers((process.env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1").split(","));

const MODEL_COLLECTIONS = {
    user: "users",
    category: "categories",
    product: "products",
    stockItem: "stockItems",
    order: "orders",
    coupon: "coupons",
    referral: "referrals",
    setting: "settings",
    backupLog: "backupLogs",
    auditLog: "auditLogs",
    vipLevel: "vipLevels",
    broadcast: "broadcasts",
    wallet: "wallets",
    walletTransaction: "walletTransactions",
};

const DEFAULTS = {
    user: { language: "vi", balance: 0, isBlocked: false, vipLevel: 0, totalSpent: 0 },
    category: { isActive: true, order: 0 },
    product: { currency: "VND", isActive: true, stockAlertAt: 5, autoDisableAt: 0 },
    stockItem: { isSold: false },
    order: { discount: 0, currency: "VND", status: "PENDING" },
    coupon: { discountType: "PERCENT", usedCount: 0, vipOnly: 0, isActive: true },
    referral: { commission: 0, status: "PENDING" },
    wallet: { balance: 0 },
    walletTransaction: { status: "PENDING" },
    broadcast: { sentCount: 0, failCount: 0, status: "PENDING" },
};

const UPDATED_AT_MODELS = new Set(["user", "product", "order", "setting", "wallet"]);
const REF_ID_FIELDS = new Set(["categoryId", "productId", "orderId", "couponId", "userId", "walletId", "referrerId", "refereeId"]);
const client = new MongoClient(process.env.MONGODB_URI || "");
let connectionPromise;

function getDatabaseName() {
    if (process.env.MONGODB_DB) return process.env.MONGODB_DB;
    if (!process.env.MONGODB_URI) return "shopbottele";
    return new URL(process.env.MONGODB_URI).pathname.replace("/", "") || "shopbottele";
}

async function connect() {
    if (!process.env.MONGODB_URI) {
        throw new Error("Missing MONGODB_URI in .env");
    }
    if (!connectionPromise) {
        connectionPromise = client.connect().catch((err) => {
            connectionPromise = null; // reset so next call retries
            throw err;
        });
    }
    try {
        await connectionPromise;
    } catch (err) {
        connectionPromise = null;
        throw err;
    }
    return client.db(getDatabaseName());
}

function isObjectIdLike(value) {
    return typeof value === "string" && ObjectId.isValid(value) && String(new ObjectId(value)) === value;
}

function toDocId(value) {
    return isObjectIdLike(value) ? new ObjectId(value) : value;
}

function maybeIdQuery(field, value) {
    if (field === "id") return { _id: toDocId(value) };
    if (REF_ID_FIELDS.has(field) && isObjectIdLike(value)) return { [field]: { $in: [value, new ObjectId(value)] } };
    return { [field]: value };
}

function mapWhere(where = {}) {
    if (!where || !Object.keys(where).length) return {};

    const query = {};
    for (const [key, value] of Object.entries(where)) {
        if (key === "OR" && Array.isArray(value)) {
            query.$or = value.map(mapWhere);
            continue;
        }

        const field = key === "id" ? "_id" : key;
        if (value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date) && !(value instanceof ObjectId)) {
            const condition = {};
            if ("in" in value) {
                condition.$in = value.in.flatMap((item) => REF_ID_FIELDS.has(field) && isObjectIdLike(item)
                    ? [item, new ObjectId(item)]
                    : [field === "_id" ? toDocId(item) : item]);
            }
            if ("gt" in value) condition.$gt = value.gt;
            if ("gte" in value) condition.$gte = value.gte;
            if ("lt" in value) condition.$lt = value.lt;
            if ("lte" in value) condition.$lte = value.lte;
            if ("not" in value) condition.$ne = value.not;
            if ("endsWith" in value) condition.$regex = new RegExp(`${escapeRegExp(value.endsWith)}$`);
            query[field] = condition;
        } else {
            Object.assign(query, maybeIdQuery(key, value));
        }
    }

    return query;
}

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mapOrderBy(orderBy) {
    if (!orderBy) return undefined;
    const entries = Array.isArray(orderBy) ? orderBy : [orderBy];
    return Object.fromEntries(entries.flatMap((item) => Object.entries(item).map(([key, direction]) => {
        if (typeof direction === "object" && direction) {
            const [[nestedKey, nestedDirection]] = Object.entries(direction);
            return [`${key}.${nestedKey}`, nestedDirection === "desc" ? -1 : 1];
        }
        return [key === "id" ? "_id" : key, direction === "desc" ? -1 : 1];
    })));
}

function applyDefaults(model, data) {
    const now = new Date();
    return {
        ...(DEFAULTS[model] || {}),
        ...data,
        createdAt: data.createdAt || now,
        ...(UPDATED_AT_MODELS.has(model) ? { updatedAt: data.updatedAt || now } : {}),
    };
}

function mapUpdateData(data = {}, model) {
    const $set = {};
    const $inc = {};

    for (const [key, value] of Object.entries(data)) {
        if (value && typeof value === "object" && !Array.isArray(value) && "increment" in value) {
            $inc[key] = value.increment;
        } else {
            $set[key] = value;
        }
    }

    if (UPDATED_AT_MODELS.has(model)) {
        $set.updatedAt = new Date();
    }

    return {
        ...(Object.keys($set).length ? { $set } : {}),
        ...(Object.keys($inc).length ? { $inc } : {}),
    };
}

function normalize(doc) {
    if (!doc) return doc;
    const out = { ...doc, id: String(doc._id) };
    delete out._id;
    for (const [key, value] of Object.entries(out)) {
        if (value instanceof ObjectId) out[key] = String(value);
    }
    return out;
}

function applySelect(doc, select) {
    if (!doc || !select) return doc;
    const selected = {};
    for (const [key, enabled] of Object.entries(select)) {
        if (enabled === true && key in doc) selected[key] = doc[key];
    }
    if (doc.id && !("id" in selected)) selected.id = doc.id;
    return selected;
}

function getPathValue(value, path) {
    return path.split(".").reduce((current, part) => current?.[part], value);
}

async function countProductsForCategory(db, categoryId, select) {
    const where = select?.products?.where || {};
    return db.collection("products").countDocuments({ ...mapWhere(where), ...mapWhere({ categoryId }) });
}

async function countStockForProduct(db, productId, select) {
    const where = select?.stockItems?.where || {};
    return db.collection("stockItems").countDocuments({ ...mapWhere(where), productId });
}

async function includeRelations(db, model, doc, include) {
    if (!doc || !include) return doc;
    const result = { ...doc };

    if (model === "category" && include.products) {
        const options = typeof include.products === "object" ? include.products : {};
        const products = await findRaw(db, "product", { ...options, where: { ...(options.where || {}), categoryId: doc.id } });
        result.products = products;
    }

    if (model === "category" && include._count?.select?.products) {
        result._count = {
            ...(result._count || {}),
            products: await countProductsForCategory(db, doc.id, include._count.select),
        };
    }

    if (model === "product" && include.category) {
        result.category = doc.categoryId ? await prisma.category.findUnique({ where: { id: doc.categoryId } }) : null;
    }

    if (model === "product" && include._count?.select?.stockItems) {
        result._count = {
            ...(result._count || {}),
            stockItems: await countStockForProduct(db, doc.id, include._count.select),
        };
    }

    if (model === "order") {
        if (include.product) {
            const product = doc.productId ? await prisma.product.findUnique({ where: { id: doc.productId }, include: include.product.include }) : null;
            result.product = product;
        }
        if (include.user) {
            result.user = doc.userId ? await prisma.user.findUnique({ where: { id: doc.userId } }) : null;
        }
        if (include.coupon) {
            result.coupon = doc.couponId ? await prisma.coupon.findUnique({ where: { id: doc.couponId } }) : null;
        }
    }

    if (model === "walletTransaction" && include.wallet) {
        result.wallet = doc.walletId ? await prisma.wallet.findUnique({ where: { id: doc.walletId } }) : null;
    }

    return result;
}

async function findRaw(db, model, args = {}) {
    const collection = db.collection(MODEL_COLLECTIONS[model]);
    let cursor = collection.find(mapWhere(args.where));
    const sort = mapOrderBy(args.orderBy);
    if (sort) cursor = cursor.sort(sort);
    if (args.take) cursor = cursor.limit(args.take);
    let docs = (await cursor.toArray()).map(normalize);
    if (args.distinct?.length) {
        const seen = new Set();
        docs = docs.filter((doc) => {
            const key = JSON.stringify(args.distinct.map((field) => doc[field]));
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }
    const withIncludes = await Promise.all(docs.map((doc) => includeRelations(db, model, doc, args.include)));
    return args.select ? withIncludes.map((doc) => applySelect(doc, args.select)) : withIncludes;
}

class ModelDelegate {
    constructor(model) {
        this.model = model;
        this.collectionName = MODEL_COLLECTIONS[model];
    }

    async collection() {
        const db = await connect();
        return db.collection(this.collectionName);
    }

    async findMany(args = {}) {
        const db = await connect();
        return findRaw(db, this.model, args);
    }

    async findUnique(args = {}) {
        const db = await connect();
        const doc = normalize(await db.collection(this.collectionName).findOne(mapWhere(args.where)));
        const withIncludes = await includeRelations(db, this.model, doc, args.include);
        return applySelect(withIncludes, args.select);
    }

    async findFirst(args = {}) {
        const docs = await this.findMany({ ...args, take: 1 });
        return docs[0] || null;
    }

    async count(args = {}) {
        const collection = await this.collection();
        return collection.countDocuments(mapWhere(args.where));
    }

    async create(args = {}) {
        const collection = await this.collection();
        const data = applyDefaults(this.model, args.data || {});
        const result = await collection.insertOne(data);
        return normalize({ ...data, _id: result.insertedId });
    }

    async createMany(args = {}) {
        const collection = await this.collection();
        const data = (args.data || []).map((item) => applyDefaults(this.model, item));
        if (!data.length) return { count: 0 };
        const result = await collection.insertMany(data, { ordered: false });
        return { count: result.insertedCount };
    }

    async update(args = {}) {
        const collection = await this.collection();
        const result = await collection.findOneAndUpdate(
            mapWhere(args.where),
            mapUpdateData(args.data, this.model),
            { returnDocument: "after" },
        );
        return normalize(result);
    }

    async updateMany(args = {}) {
        const collection = await this.collection();
        const result = await collection.updateMany(mapWhere(args.where), mapUpdateData(args.data, this.model));
        return { count: result.modifiedCount };
    }

    async delete(args = {}) {
        const collection = await this.collection();
        const doc = await collection.findOneAndDelete(mapWhere(args.where));
        return normalize(doc);
    }

    async deleteMany(args = {}) {
        const collection = await this.collection();
        const result = await collection.deleteMany(mapWhere(args.where));
        return { count: result.deletedCount };
    }

    async upsert(args = {}) {
        const collection = await this.collection();
        const now = new Date();
        const setData = { ...(args.update || {}), ...(UPDATED_AT_MODELS.has(this.model) ? { updatedAt: now } : {}) };
        const insertData = applyDefaults(this.model, args.create || {});
        for (const key of Object.keys(setData)) {
            delete insertData[key];
        }
        const result = await collection.findOneAndUpdate(
            mapWhere(args.where),
            {
                $set: setData,
                $setOnInsert: insertData,
            },
            { upsert: true, returnDocument: "after" },
        );
        return normalize(result);
    }

    async aggregate(args = {}) {
        const docs = await this.findMany({ where: args.where });
        const response = {};
        if (args._sum) {
            response._sum = {};
            for (const key of Object.keys(args._sum)) {
                response._sum[key] = docs.reduce((sum, doc) => sum + (Number(doc[key]) || 0), 0);
            }
        }
        return response;
    }

    async groupBy(args = {}) {
        const by = args.by || [];
        const docs = await this.findMany({ where: args.where });
        const groups = new Map();

        for (const doc of docs) {
            const key = JSON.stringify(by.map((field) => doc[field]));
            if (!groups.has(key)) {
                groups.set(key, { docs: [], values: Object.fromEntries(by.map((field) => [field, doc[field]])) });
            }
            groups.get(key).docs.push(doc);
        }

        let result = [...groups.values()].map((group) => ({
            ...group.values,
            ...(args._count === true ? { _count: group.docs.length } : {}),
            ...(args._count && args._count !== true ? { _count: { _all: group.docs.length } } : {}),
            ...(args._sum ? {
                _sum: Object.fromEntries(Object.keys(args._sum).map((field) => [
                    field,
                    group.docs.reduce((sum, doc) => sum + (Number(doc[field]) || 0), 0),
                ])),
            } : {}),
        }));

        const sort = mapOrderBy(args.orderBy);
        if (sort) {
            result.sort((a, b) => {
                for (const [field, dir] of Object.entries(sort)) {
                    const av = getPathValue(a, field);
                    const bv = getPathValue(b, field);
                    if (av === bv) continue;
                    return av > bv ? dir : -dir;
                }
                return 0;
            });
        }
        if (args.take) result = result.slice(0, args.take);
        return result;
    }
}

const prisma = Object.fromEntries(
    Object.keys(MODEL_COLLECTIONS).map((model) => [model, new ModelDelegate(model)]),
);

prisma.$connect = async () => {
    await connect();
};

prisma.$disconnect = async () => {
    if (connectionPromise) {
        await client.close();
        connectionPromise = null;
    }
};

prisma.$queryRaw = async () => [{ ok: 1 }];

prisma.$transaction = async (operations) => {
    if (typeof operations === "function") {
        return operations(prisma);
    }
    return Promise.all(operations);
};

export function getPrisma() {
    return prisma;
}

export { prisma };
export default prisma;
