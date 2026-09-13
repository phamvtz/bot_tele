// Rà tĩnh: mọi `import { X } from "./y.js"` trong src/ phải khớp một export có thật.
// Dùng để phát hiện file bị ghi đè/cắt cụt mà `node --check` không thấy (nó chỉ bắt
// lỗi cú pháp, không bắt một export bị mất).
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

const dirs = ["src", "src/lib", "src/bot-ui", "src/payment", "src/i18n"];
const files = [];
for (const d of dirs) {
    for (const f of readdirSync(d)) {
        if (f.endsWith(".js")) files.push(join(d, f).split("\\").join("/"));
    }
}

const exportsOf = new Map();
for (const f of files) {
    const s = readFileSync(f, "utf8");
    const names = new Set();
    for (const m of s.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z0-9_$]+)/gm)) names.add(m[1]);
    for (const m of s.matchAll(/^export\s*\{([^}]+)\}/gm)) {
        for (const p of m[1].split(",")) {
            const n = p.trim().split(/\s+as\s+/).pop().trim();
            if (n) names.add(n);
        }
    }
    if (/^export\s+default/m.test(s)) names.add("default");
    exportsOf.set(f, names);
}

let bad = 0;
for (const f of files) {
    const s = readFileSync(f, "utf8");
    for (const m of s.matchAll(/import\s*\{([^}]+)\}\s*from\s*["'](\.[^"']+)["']/g)) {
        const target = resolve(dirname(f), m[2]).split("\\").join("/");
        const rel = target.replace(process.cwd().split("\\").join("/") + "/", "");
        const set = exportsOf.get(rel);
        if (!set) continue;
        for (const p of m[1].split(",")) {
            const n = p.trim().split(/\s+as\s+/)[0].trim();
            if (!n) continue;
            if (!set.has(n)) { console.log(`MISSING  ${f}  ->  "${n}"  (từ ${m[2]})`); bad += 1; }
        }
    }
}
console.log(bad ? `\n${bad} named import KHÔNG resolve được` : `OK — mọi named import trong ${files.length} file src/ đều resolve được`);
process.exit(bad ? 1 : 0);
