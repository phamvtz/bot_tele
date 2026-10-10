/**
 * Mock DB cho flash sale — KHÔNG phải một test.
 *
 * Mock này cố tình mô phỏng hai lớp khác nhau của Mongo:
 *  - thao tác thường đọc/ghi committed store;
 *  - `$withMongoTransaction` chạy trên snapshot riêng, chỉ commit sau khi callback
 *    thành công. Vì vậy test bắt được callback/commit lỗi và không thể vô tình xanh nhờ
 *    rollback thủ công ngoài transaction.
 */

/** So khớp `_id`: ObjectId thật và chuỗi hex phải so được với nhau. */
const sameId = (a, b) => (a == null || b == null ? a === b : String(a) === String(b));

/** So giá trị thường, hiểu Date và ObjectId. */
const sameValue = (a, b) => {
    if (a instanceof Date || b instanceof Date) {
        const ta = a instanceof Date ? a.getTime() : new Date(a).getTime();
        const tb = b instanceof Date ? b.getTime() : new Date(b).getTime();
        if (Number.isFinite(ta) && Number.isFinite(tb)) return ta === tb;
        // `{field: null}` trong Mongo khớp cả field BỊ THIẾU.
        if (a === null || a === undefined) return b === null || b === undefined;
        return false;
    }
    if (a === null || a === undefined) return b === null || b === undefined;
    return String(a) === String(b) || a === b;
};

/** Đọc một toán hạng của `$expr`: `"$field"`, `{ $ifNull: [...] }`, hoặc hằng số. */
function evalOperand(op, doc) {
    if (typeof op === "string" && op.startsWith("$") && !op.startsWith("$$")) {
        const v = doc[op.slice(1)];
        return v === undefined ? null : v;
    }
    if (op && typeof op === "object") return evalExpr(op, doc);
    return op;
}

/** Bộ dịch `$expr` tối thiểu mà flash-sale dùng. */
function evalExpr(expr, doc) {
    if (expr === null || typeof expr !== "object") return expr;
    const [op] = Object.keys(expr);
    const args = expr[op];
    switch (op) {
        case "$or": return args.some((e) => evalExpr(e, doc));
        case "$and": return args.every((e) => evalExpr(e, doc));
        case "$eq": return sameValue(evalOperand(args[0], doc), evalOperand(args[1], doc));
        case "$ne": return !sameValue(evalOperand(args[0], doc), evalOperand(args[1], doc));
        case "$lt": return Number(evalOperand(args[0], doc)) < Number(evalOperand(args[1], doc));
        case "$lte": return Number(evalOperand(args[0], doc)) <= Number(evalOperand(args[1], doc));
        case "$gt": return Number(evalOperand(args[0], doc)) > Number(evalOperand(args[1], doc));
        case "$gte": return Number(evalOperand(args[0], doc)) >= Number(evalOperand(args[1], doc));
        case "$ifNull": {
            const v = evalOperand(args[0], doc);
            return v === null || v === undefined ? evalOperand(args[1], doc) : v;
        }
        default:
            throw new Error(`flash-sale-db mock: $expr chưa hỗ trợ toán tử "${op}" — thêm vào evalExpr, đừng để nó âm thầm khớp hết`);
    }
}

/** So sánh Date, số, chuỗi và ObjectId giả theo cách đủ gần Mongo cho test. */
function compareValues(a, b) {
    if (a instanceof Date || b instanceof Date) {
        const ta = a instanceof Date ? a.getTime() : new Date(a).getTime();
        const tb = b instanceof Date ? b.getTime() : new Date(b).getTime();
        if (!Number.isFinite(ta) || !Number.isFinite(tb)) return 0;
        return ta < tb ? -1 : ta > tb ? 1 : 0;
    }
    if (typeof a === "number" && typeof b === "number") return a < b ? -1 : a > b ? 1 : 0;
    const sa = String(a ?? "");
    const sb = String(b ?? "");
    return sa < sb ? -1 : sa > sb ? 1 : 0;
}

/** Một điều kiện trên một field: hỗ trợ Mongo và Prisma-style operator. */
function matchField(condition, value, eq = sameValue) {
    if (condition && typeof condition === "object" && !(condition instanceof Date)) {
        const keys = Object.keys(condition);
        const isOpObject = keys.length > 0 && keys.every((k) =>
            k.startsWith("$") || ["gt", "gte", "lt", "lte", "ne", "in", "not", "notIn"].includes(k));
        if (isOpObject) {
            return keys.every((k) => {
                const want = condition[k];
                switch (k) {
                    case "$gt": case "gt": return compareValues(value, want) > 0;
                    case "$gte": case "gte": return compareValues(value, want) >= 0;
                    case "$lt": case "lt": return compareValues(value, want) < 0;
                    case "$lte": case "lte": return compareValues(value, want) <= 0;
                    case "$ne": case "ne": return !eq(value, want);
                    case "not": return !eq(value, want);
                    case "$in": case "in": return want.some((w) => eq(value, w));
                    case "$nin": case "notIn": return !want.some((w) => eq(value, w));
                    default: throw new Error(`flash-sale-db mock: toán tử "${k}" chưa hỗ trợ`);
                }
            });
        }
    }
    return eq(value, condition);
}

function matchFilter(filter, doc) {
    if (!filter) return true;
    return Object.entries(filter).every(([key, cond]) => {
        if (key === "$expr") return evalExpr(cond, doc);
        if (key === "$or") return cond.some((sub) => matchFilter(sub, doc));
        if (key === "$and") return cond.every((sub) => matchFilter(sub, doc));
        if (key === "_id" || key === "id") {
            const docId = doc.id ?? doc._id;
            return matchField(cond, docId, sameId);
        }
        return matchField(cond, doc[key]);
    });
}

function cloneValue(value) {
    if (value instanceof Date) return new Date(value.getTime());
    if (Array.isArray(value)) return value.map(cloneValue);
    if (value && typeof value === "object") {
        if (value.constructor && value.constructor !== Object) return value;
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, cloneValue(v)]));
    }
    return value;
}

function cloneStore(source) {
    return Object.fromEntries(Object.entries(source).map(([key, rows]) => [key, rows.map(cloneValue)]));
}

/** Fake Mongo session: mỗi transaction có snapshot riêng và được serialize. */
class FakeSession {
    constructor(id, state) {
        this.id = id;
        this.state = state;
        this.ended = false;
    }

    async endSession() {
        this.ended = true;
        this.state = null;
    }
}

function applyUpdate(doc, update) {
    const next = { ...doc };
    if (update.$inc) {
        for (const [k, n] of Object.entries(update.$inc)) next[k] = (Number(next[k]) || 0) + Number(n);
    }
    if (update.$set) Object.assign(next, update.$set);
    if (update.$setOnInsert && !doc) Object.assign(next, update.$setOnInsert);
    const plain = Object.entries(update).filter(([k]) => !k.startsWith("$"));
    for (const [k, v] of plain) next[k] = v;
    return next;
}

/** `ObjectId` giả — chỉ cần `toString()` ra hex để so `_id` khớp `toOid`. */
class FakeObjectId {
    constructor(hex) { this.hex = String(hex); }
    toString() { return this.hex; }
    static isValid(v) { return /^[a-f\d]{24}$/i.test(String(v ?? "")); }
}

const rawName = (key) => ({
    flashSales: "sales",
    flashSaleResponses: "responses",
    users: "users",
    settings: "settings",
    orders: "orders",
    products: "products",
}[key] || key);

export function makeFlashDb({ sales = [], responses = [], users = [], settings = [] } = {}) {
    const committed = {
        sales: sales.map((s) => ({ ...s, _id: s.id ?? s._id, id: s.id ?? s._id })),
        responses: responses.map((r, i) => ({ ...r, _id: r.id ?? `resp-${i}`, id: r.id ?? `resp-${i}` })),
        users: users.map((u, i) => ({ ...u, _id: u._id ?? u.id ?? `user-${i}`, id: u.id ?? u._id ?? `user-${i}` })),
        settings: settings.map((s) => ({ ...s, _id: s.key, id: s.key })),
        orders: [],
        products: [],
    };
    const flags = {
        failCreate: false,
        failUpdate: false,
        failUserUpdate: false,
        failResponseWrite: false,
        failTransactionCallback: false,
        failCallback: false,
        failTransactionCommit: false,
        failCommit: false,
    };
    const log = [];
    const sessions = [];
    let sessionSeq = 0;
    let transactionTail = Promise.resolve();

    const stateFor = (session) => session?.state || committed;
    const failIf = (condition, message, code = "MOCK_FAIL") => {
        if (!condition) return;
        const error = new Error(message);
        error.code = code;
        throw error;
    };

    const rawCollection = (name, boundSession = null) => {
        const key = rawName(name);
        const sessionOf = (options) => options?.session || boundSession || null;
        const getRows = (options) => stateFor(sessionOf(options))[key];
        const entry = (op, options = {}) => log.push({ op, key, sessionId: sessionOf(options)?.id ?? null });
        const duplicateResponse = (rows, doc) => rows.some((r) =>
            sameValue(r.flashSaleId, doc.flashSaleId) && sameValue(r.telegramId, doc.telegramId));

        return {
            find(filter, options = {}) {
                const rows = getRows(options).filter((d) => matchFilter(filter, d)).map(cloneValue);
                let sorted = rows;
                let limit = Infinity;
                const chain = {
                    sort(spec) {
                        const [field, dir] = Object.entries(spec)[0];
                        sorted = [...rows].sort((a, b) => compareValues(a[field], b[field]) * (dir < 0 ? -1 : 1));
                        return chain;
                    },
                    limit(n) { limit = Number(n); return chain; },
                    project() { return chain; },
                    async toArray() { return sorted.slice(0, limit).map(cloneValue); },
                };
                return chain;
            },
            async findOne(filter, options = {}) {
                entry("findOne", options);
                return cloneValue(getRows(options).find((d) => matchFilter(filter, d)) || null);
            },
            async updateOne(filter, update, options = {}) {
                entry("updateOne", options);
                failIf(flags.failUpdate, "mock: update fail");
                failIf(key === "responses" && flags.failResponseWrite, "mock: response update fail");
                const rows = getRows(options);
                const idx = rows.findIndex((d) => matchFilter(filter, d));
                if (idx === -1) return { matchedCount: 0, modifiedCount: 0 };
                rows[idx] = applyUpdate(rows[idx], update);
                return { matchedCount: 1, modifiedCount: 1 };
            },
            async updateMany(filter, update, options = {}) {
                entry("updateMany", options);
                failIf(flags.failUpdate, "mock: updateMany fail");
                failIf(key === "responses" && flags.failResponseWrite, "mock: response updateMany fail");
                const rows = getRows(options);
                let n = 0;
                for (let i = 0; i < rows.length; i += 1) {
                    if (matchFilter(filter, rows[i])) { rows[i] = applyUpdate(rows[i], update); n += 1; }
                }
                return { matchedCount: n, modifiedCount: n };
            },
            async insertOne(doc, options = {}) {
                entry("insertOne", options);
                const rows = getRows(options);
                failIf(key === "responses" && (flags.failResponseWrite || flags.failCreate), "mock: response insert fail");
                if (key === "responses" && duplicateResponse(rows, doc)) {
                    const error = new Error("E11000 duplicate key error collection: flashSaleResponses index: flashSaleId_1_telegramId_1");
                    error.code = 11000;
                    throw error;
                }
                rows.push(cloneValue(doc));
                return { insertedId: doc._id ?? doc.id };
            },
            async deleteMany(filter, options = {}) {
                entry("deleteMany", options);
                const rows = getRows(options);
                const before = rows.length;
                const kept = rows.filter((d) => !matchFilter(filter, d));
                const target = stateFor(sessionOf(options));
                target[key] = kept;
                return { deletedCount: before - kept.length };
            },
            async countDocuments(filter = {}, options = {}) {
                entry("countDocuments", options);
                return getRows(options).filter((d) => matchFilter(filter, d)).length;
            },
        };
    };

    const normalize = (d) => (d ? { ...cloneValue(d), id: d.id ?? String(d._id) } : null);
    const model = (key, extra = {}) => ({
        async findUnique({ where }) { return normalize(committed[key].find((d) => matchFilter(where, d)) || null); },
        async findFirst({ where }) { return normalize(committed[key].find((d) => matchFilter(where, d)) || null); },
        async findMany({ where, orderBy, take } = {}) {
            let rows = committed[key].filter((d) => matchFilter(where ?? {}, d)).map(normalize);
            if (orderBy) {
                const [field, dir] = Object.entries(orderBy)[0];
                rows = rows.sort((a, b) => compareValues(a[field], b[field]) * (dir === "desc" ? -1 : 1));
            }
            if (take != null) rows = rows.slice(0, Number(take));
            return rows;
        },
        async count({ where } = {}) { return committed[key].filter((d) => matchFilter(where ?? {}, d)).length; },
        async create({ data }) {
            failIf(flags.failCreate, "mock: create fail");
            if (key === "responses") failIf(flags.failResponseWrite, "mock: response create fail");
            const id = data.id ?? `${key}-new-${committed[key].length + 1}`;
            const doc = { ...data, _id: id, id, createdAt: data.createdAt ?? new Date() };
            if (key === "responses" && committed[key].some((r) => sameValue(r.flashSaleId, doc.flashSaleId) && sameValue(r.telegramId, doc.telegramId))) {
                const e = new Error("E11000 duplicate key error collection: flashSaleResponses index: flashSaleId_1_telegramId_1");
                e.code = 11000;
                throw e;
            }
            committed[key].push(doc);
            return normalize(doc);
        },
        async upsert({ where, update, create }) {
            const idx = committed[key].findIndex((d) => matchFilter(where, d));
            if (idx === -1) {
                const id = create.id ?? create.key ?? `${key}-new-${committed[key].length + 1}`;
                const doc = { ...create, _id: id, id };
                committed[key].push(doc);
                return normalize(doc);
            }
            committed[key][idx] = applyUpdate(committed[key][idx], update);
            return normalize(committed[key][idx]);
        },
        async update({ where, data }) {
            failIf(flags.failUpdate, "mock: update fail");
            const idx = committed[key].findIndex((d) => matchFilter(where, d));
            if (idx === -1) { const e = new Error("Record to update not found."); e.code = "P2025"; throw e; }
            committed[key][idx] = applyUpdate(committed[key][idx], data);
            return normalize(committed[key][idx]);
        },
        async updateMany({ where, data }) {
            failIf(flags.failUpdate, "mock: updateMany fail");
            let n = 0;
            committed[key] = committed[key].map((d) => (matchFilter(where ?? {}, d) ? (n += 1, applyUpdate(d, data)) : d));
            return { count: n };
        },
        async delete({ where }) {
            const idx = committed[key].findIndex((d) => matchFilter(where, d));
            if (idx === -1) { const e = new Error("Record to delete does not exist."); e.code = "P2025"; throw e; }
            const [gone] = committed[key].splice(idx, 1);
            return normalize(gone);
        },
        async deleteMany({ where }) {
            const before = committed[key].length;
            committed[key] = committed[key].filter((d) => !matchFilter(where ?? {}, d));
            return { count: before - committed[key].length };
        },
        async aggregate() { return { _sum: {} }; },
        collection: () => rawCollection(key),
        ...extra,
    });

    const prisma = {
        flashSale: model("sales"),
        flashSaleResponse: model("responses"),
        user: model("users"),
        setting: model("settings"),
        order: model("orders"),
        product: model("products"),
        _store: committed,
        _flags: flags,
        _log: log,
        _sessions: sessions,
        _FakeObjectId: FakeObjectId,
        $withMongoTransaction: async (callback) => {
            if (typeof callback !== "function") throw new TypeError("mock transaction cần callback");
            const previous = transactionTail;
            let release;
            transactionTail = new Promise((resolve) => { release = resolve; });
            await previous;
                const session = new FakeSession(++sessionSeq, cloneStore(committed));
                sessions.push(session);
                const transactionDb = { collection: (name) => rawCollection(name, session) };
                try {
                    const result = await callback({
                        db: transactionDb,
                        session,
                        collection: (name) => rawCollection(name, session),
                    });
                failIf(flags.failTransactionCallback || flags.failCallback, "mock: transaction callback fail");
                failIf(flags.failTransactionCommit || flags.failCommit, "mock: transaction commit fail", "MOCK_COMMIT_FAIL");
                for (const [key, rows] of Object.entries(session.state)) committed[key] = rows.map(cloneValue);
                return result;
            } finally {
                release();
                await session.endSession();
            }
        },
    };
    return prisma;
}

export default { makeFlashDb, FakeSession, FakeObjectId, compareValues };
