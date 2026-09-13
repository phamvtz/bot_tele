/**
 * Mock DB cho flash sale — KHÔNG phải một test.
 *
 * Hai file test (`flash-sale-claim.test.js`, `flash-sale-send.test.js`) cần cùng một
 * mock đủ THẬT để bắt được lỗi concurrency. "Đủ thật" nghĩa là:
 *
 *  - `updateOne` phải lọc và sửa như MỘT KHỐI nguyên tử, vì `claimSlot` dựa vào đúng
 *    điều đó để 500 người bấm cùng lúc vào suất cuối chỉ một người qua. Một mock mà
 *    filter và update chạy ở hai bước riêng sẽ cho test xanh trong khi production vượt
 *    trần suất.
 *  - Phải hiểu `$expr` với `$ifNull` / `$lt` / `$gte` / `$or`, vì so sánh HAI FIELD
 *    trên cùng document (`acceptedCount` vs `maxSlots`) là thứ `mapWhere` của adapter
 *    không diễn đạt được và là lý do code xuống raw collection.
 *  - Phải mô phỏng UNIQUE INDEX `(flashSaleId, telegramId)` bằng lỗi `code: 11000`,
 *    vì `acceptOffer` dùng chính lỗi đó làm khoá idempotency.
 *  - Phải có con trỏ `_id` tăng đơn điệu, vì resume của vòng gửi dựa vào `$gt: cursor`.
 *
 * Mọi thứ ở đây là đồng bộ bên trong một `await` — giống Mongo ở chỗ một lệnh
 * `updateOne` không xen giữa hai lệnh khác. Đó là điều kiện để test race có nghĩa.
 */

/** So khớp `_id`: ObjectId thật và chuỗi hex phải so được với nhau. */
const sameId = (a, b) => (a == null || b == null ? a === b : String(a) === String(b));

/** So giá trị thường, hiểu Date và ObjectId. */
const sameValue = (a, b) => {
    if (a instanceof Date || b instanceof Date) {
        const ta = a instanceof Date ? a.getTime() : new Date(a).getTime();
        const tb = b instanceof Date ? b.getTime() : new Date(b).getTime();
        if (Number.isFinite(ta) && Number.isFinite(tb)) return ta === tb;
        // `{field: null}` trong Mongo khớp cả field BỊ THIẾU — adapter dựa vào đó.
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

/**
 * Bộ dịch `$expr` tối thiểu — đúng tập mà flash-sale.js dùng.
 *
 * Cố tình NÉM LỖI khi gặp toán tử lạ thay vì trả false: một mock âm thầm bỏ qua
 * `$someNewOp` sẽ làm filter khớp MỌI document, và test "suất cuối chỉ một người
 * qua" sẽ xanh vì lý do hoàn toàn sai.
 */
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

/**
 * So sánh CÓ PHÂN BIỆT KIỂU — cần cho `$gt`/`$lt`, và đặc biệt cho con trỏ resume.
 *
 * Mongo so ObjectId theo BYTE, mà với chuỗi hex cùng độ dài thì đúng bằng so chuỗi.
 * Bản đầu ép mọi thứ qua `Number()`, nên `$gt: ObjectId("…")` ra `NaN > NaN = false`
 * và vòng gửi không thấy user nào để gửi — test resume sẽ xanh vì lý do hoàn toàn
 * sai (nó không chạy gì cả).
 *
 * Date so theo mốc thời gian; số và chuỗi-số so theo số; còn lại so chuỗi.
 */
function compareValues(a, b) {
    if (a instanceof Date || b instanceof Date) {
        const ta = a instanceof Date ? a.getTime() : new Date(a).getTime();
        const tb = b instanceof Date ? b.getTime() : new Date(b).getTime();
        if (!Number.isFinite(ta) || !Number.isFinite(tb)) return 0;
        return ta < tb ? -1 : ta > tb ? 1 : 0;
    }
    // CHỈ so theo số khi CẢ HAI thật sự là `number`. Ép chuỗi qua `Number()` là sai
    // tai hại với ObjectId: `Number("0000000000000000001000e0")` = 1000 vì JS đọc cái
    // `e0` ở cuối chuỗi hex là SỐ MŨ. Bản đầu làm vậy nên `_id > <cursor>` khớp cả
    // những user NẰM TRƯỚC con trỏ, và vòng gửi quay lại gửi trùng 90 người — test
    // resume bắt được. Mongo thật so ObjectId theo BYTE, tức đúng bằng so chuỗi hex.
    if (typeof a === "number" && typeof b === "number") {
        return a < b ? -1 : a > b ? 1 : 0;
    }
    const sa = String(a ?? "");
    const sb = String(b ?? "");
    return sa < sb ? -1 : sa > sb ? 1 : 0;
}

/** Một điều kiện trên MỘT field: hỗ trợ cả Mongo (`$gt`) lẫn Prisma-style (`{gt:1}`). */
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
                    default:
                        throw new Error(`flash-sale-db mock: toán tử "${k}" chưa hỗ trợ`);
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
            // `_id` và `id` là HAI TÊN của cùng một khoá: raw collection dùng `_id`,
            // adapter Prisma trả `id`. Query có thể nhắm vào tên nào cũng được.
            const docId = doc.id ?? doc._id;
            // PHẢI đi qua matchField khi điều kiện là một object toán tử (`{in: [...]}`,
            // `{$gt: ...}`). Bản đầu so thẳng `sameId(cond, docId)` nên `String({in:…})`
            // thành "[object Object]" và query `{id:{in:[…]}}` KHÔNG BAO GIỜ khớp —
            // đúng query mà `getActiveFlashOffer` dùng để ghép response với sale.
            return matchField(cond, docId, sameId);
        }
        return matchField(cond, doc[key]);
    });
}

/** Áp `$inc` / `$set`. Trả bản SAO — doc trong store được thay bằng object mới. */
function applyUpdate(doc, update) {
    const next = { ...doc };
    if (update.$inc) {
        for (const [k, n] of Object.entries(update.$inc)) {
            next[k] = (Number(next[k]) || 0) + Number(n);
        }
    }
    if (update.$set) Object.assign(next, update.$set);
    const plain = Object.entries(update).filter(([k]) => !k.startsWith("$"));
    for (const [k, v] of plain) next[k] = v;
    return next;
}

/** `ObjectId` giả — chỉ cần `toString()` ra hex để so `_id` khớp `toOid` của code thật. */
class FakeObjectId {
    constructor(hex) { this.hex = String(hex); }
    toString() { return this.hex; }
    static isValid(v) { return /^[a-f\d]{24}$/i.test(String(v ?? "")); }
}

/**
 * Dựng mock. `opts` cho phép bơm lỗi để test nhánh rollback.
 *
 * `failNextCreate` / `failNextClaim` là công tắc để test "ghi response lỗi thì suất
 * phải được nhả ra" — không có nó thì nhánh rollback không bao giờ được chạy trong
 * test, mà đó lại là nhánh dễ sai nhất.
 */
export function makeFlashDb({ sales = [], responses = [], users = [], settings = [] } = {}) {
    const store = {
        sales: sales.map((s) => ({ ...s, _id: s.id ?? s._id, id: s.id ?? s._id })),
        responses: responses.map((r, i) => ({ ...r, _id: r.id ?? `resp-${i}`, id: r.id ?? `resp-${i}` })),
        users: users.map((u, i) => ({ ...u, _id: u._id ?? u.id ?? `user-${i}`, id: u.id ?? u._id ?? `user-${i}` })),
        settings: settings.map((s) => ({ ...s, _id: s.key, id: s.key })),
        orders: [],
    };
    const flags = { failCreate: false, failUpdate: false, failUserUpdate: false };
    const log = [];

    /** Raw collection — chỗ code dùng `$expr` và con trỏ `_id`. */
    const rawCollection = (key, idField = "_id") => ({
        // `find` là ĐỒNG BỘ và trả một cursor — đúng như driver Mongo thật. Code gọi
        // `userColl.find(f).sort(...).limit(...).project(...).toArray()` rồi mới `await`,
        // nên để `async find` là `.sort is not a function` ngay lần đầu chạy vòng gửi.
        find(filter) {
            const rows = store[key].filter((d) => matchFilter(filter, d)).map((d) => ({ ...d }));
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
                async toArray() { return sorted.slice(0, limit).map((d) => ({ ...d })); },
            };
            return chain;
        },
        async updateOne(filter, update) {
            log.push({ op: "updateOne", key, filter });
            const idx = store[key].findIndex((d) => matchFilter(filter, d));
            if (idx === -1) return { matchedCount: 0, modifiedCount: 0 };
            store[key][idx] = applyUpdate(store[key][idx], update);
            return { matchedCount: 1, modifiedCount: 1 };
        },
        async updateMany(filter, update) {
            let n = 0;
            store[key] = store[key].map((d) => (matchFilter(filter, d) ? (n += 1, applyUpdate(d, update)) : d));
            return { matchedCount: n, modifiedCount: n };
        },
        async insertOne(doc) {
            store[key].push({ ...doc });
            return { insertedId: doc[idField] };
        },
        async deleteMany(filter) {
            const before = store[key].length;
            store[key] = store[key].filter((d) => !matchFilter(filter, d));
            return { deletedCount: before - store[key].length };
        },
        async countDocuments(filter) {
            return store[key].filter((d) => matchFilter(filter ?? {}, d)).length;
        },
    });

    /** Adapter kiểu Prisma — `updateMany` trả `{count}`, `findUnique` trả `normalize(doc)`. */
    const normalize = (d) => (d ? { ...d, id: d.id ?? String(d._id) } : null);

    const model = (key, extra = {}) => ({
        async findUnique({ where }) { return normalize(store[key].find((d) => matchFilter(where, d)) || null); },
        async findFirst({ where }) { return normalize(store[key].find((d) => matchFilter(where, d)) || null); },
        async findMany({ where, orderBy, take } = {}) {
            let rows = store[key].filter((d) => matchFilter(where ?? {}, d)).map(normalize);
            if (orderBy) {
                const [field, dir] = Object.entries(orderBy)[0];
                rows = rows.sort((a, b) => compareValues(a[field], b[field]) * (dir === "desc" ? -1 : 1));
            }
            if (take != null) rows = rows.slice(0, Number(take));
            return rows;
        },
        async count({ where } = {}) { return store[key].filter((d) => matchFilter(where ?? {}, d)).length; },
        async create({ data }) {
            if (flags.failCreate) { const e = new Error("mock: create fail"); e.code = "MOCK_FAIL"; throw e; }
            const id = data.id ?? `${key}-new-${store[key].length + 1}`;
            const doc = { ...data, _id: id, id, createdAt: data.createdAt ?? new Date() };
            // UNIQUE INDEX (flashSaleId, telegramId) — khoá idempotency của acceptOffer.
            if (key === "responses") {
                const dup = store[key].some((r) =>
                    sameValue(r.flashSaleId, doc.flashSaleId) && sameValue(r.telegramId, doc.telegramId));
                if (dup) {
                    const e = new Error("E11000 duplicate key error collection: flashSaleResponses index: flashSaleId_1_telegramId_1");
                    e.code = 11000;
                    throw e;
                }
            }
            store[key].push(doc);
            return normalize(doc);
        },
        async upsert({ where, update, create }) {
            const idx = store[key].findIndex((d) => matchFilter(where, d));
            if (idx === -1) {
                const id = create.id ?? create.key ?? `${key}-new-${store[key].length + 1}`;
                const doc = { ...create, _id: id, id };
                store[key].push(doc);
                return normalize(doc);
            }
            store[key][idx] = applyUpdate(store[key][idx], update);
            return normalize(store[key][idx]);
        },
        async update({ where, data }) {
            if (flags.failUpdate) throw new Error("mock: update fail");
            const idx = store[key].findIndex((d) => matchFilter(where, d));
            if (idx === -1) { const e = new Error("Record to update not found."); e.code = "P2025"; throw e; }
            store[key][idx] = applyUpdate(store[key][idx], data);
            return normalize(store[key][idx]);
        },
        async updateMany({ where, data }) {
            if (flags.failUpdate) throw new Error("mock: updateMany fail");
            let n = 0;
            store[key] = store[key].map((d) => (matchFilter(where ?? {}, d) ? (n += 1, applyUpdate(d, data)) : d));
            return { count: n };
        },
        async delete({ where }) {
            const idx = store[key].findIndex((d) => matchFilter(where, d));
            if (idx === -1) { const e = new Error("Record to delete does not exist."); e.code = "P2025"; throw e; }
            const [gone] = store[key].splice(idx, 1);
            return normalize(gone);
        },
        async deleteMany({ where }) {
            const before = store[key].length;
            store[key] = store[key].filter((d) => !matchFilter(where ?? {}, d));
            return { count: before - store[key].length };
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
        _store: store,
        _flags: flags,
        _log: log,
        _FakeObjectId: FakeObjectId,
    };
    store.products = [];
    return prisma;
}

export default { makeFlashDb, FakeObjectId, compareValues };
