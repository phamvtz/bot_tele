/* eslint-disable */
require("dotenv/config");
const dns = require("node:dns");
const { MongoClient } = require("mongodb");

dns.setServers((process.env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1").split(","));

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || "shopbottele";

async function bench() {
    const c = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
    const t0 = Date.now();
    await c.connect();
    console.log(`Connect: ${Date.now() - t0}ms`);

    const db = c.db(dbName);

    // Ping
    {
        const start = Date.now();
        await db.command({ ping: 1 });
        console.log(`Ping: ${Date.now() - start}ms`);
    }

    // findOne
    for (let i = 0; i < 5; i++) {
        const start = Date.now();
        await db.collection("settings").findOne({});
        console.log(`findOne settings #${i + 1}: ${Date.now() - start}ms`);
    }

    // count
    for (let i = 0; i < 3; i++) {
        const start = Date.now();
        await db.collection("products").countDocuments({});
        console.log(`count products #${i + 1}: ${Date.now() - start}ms`);
    }

    // findMany 50
    {
        const start = Date.now();
        await db.collection("products").find({}).limit(50).toArray();
        console.log(`findMany products limit 50: ${Date.now() - start}ms`);
    }

    await c.close();
}

bench().catch((e) => {
    console.error("FAIL:", e.message);
    process.exit(1);
});
