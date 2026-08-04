// Liệt kê toàn bộ Product + providerId trong payload, để tìm sản phẩm mồ côi
// (đã xóa provider API nhưng sản phẩm vẫn còn active trong bot).
//   node scripts/check-orphan-products.mjs
import "dotenv/config";
import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;
if (!uri) { console.error("Thiếu MONGODB_URI trong .env"); process.exit(1); }

const client = new MongoClient(uri);
await client.connect();
const db = client.db(process.env.MONGODB_DB || undefined);

const setting = await db.collection("Setting").findOne({ key: "api_providers" });
let providers = [];
try { providers = JSON.parse(setting?.value || "[]"); } catch {}
const liveIds = new Set(providers.map((p) => String(p.id)));
console.log(`Provider còn sống: ${liveIds.size ? [...liveIds].join(", ") : "(không có)"}\n`);

const prods = await db.collection("Product").find({}).toArray();
console.log(`Tổng sản phẩm: ${prods.length}\n`);
for (const p of prods) {
    let pid = null;
    try { pid = JSON.parse(p.payload || "{}").providerId ?? null; } catch { pid = "(payload không phải JSON)"; }
    const orphan = pid && !liveIds.has(String(pid)) ? "  <== MỒ CÔI" : "";
    console.log(
        `${String(p._id)} | active=${p.isActive} | unlisted=${p.unlisted} | ` +
        `mode=${p.deliveryMode} | providerId=${pid} | ${p.name}${orphan}`
    );
}

await client.close();
