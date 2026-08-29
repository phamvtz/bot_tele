import "dotenv/config";
// Tat tinh nang ban key Claude (aiplus) theo yeu cau cua user.
// Dung co che thiet ke: Setting AIPLUS_ENABLED = "false" (DB ghi de ENV).
import prisma from "../src/lib/prisma.js";
await prisma.setting.updateMany({ where: { key: "AIPLUS_ENABLED" }, data: { value: "false" } });
const rows = await prisma.setting.findMany({ where: { key: "AIPLUS_ENABLED" } });
console.log("AIPLUS_ENABLED sau khi tat:", JSON.stringify(rows.map((r) => r.value)));
process.exit(0);
