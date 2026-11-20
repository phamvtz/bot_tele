import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
    .join("\n");

test("server.js hỗ trợ bind theo HOST (VD 127.0.0.1) cho cả HTTP và HTTPS", () => {
    assert.match(CODE, /const HOST\s*=\s*String\(process\.env\.HOST\s*\|\|\s*""\)\.trim\(\)\s*\|\|\s*undefined;/);
    assert.match(CODE, /const buildListenArgs\s*=\s*\(port,\s*onListening\)\s*=>\s*\(HOST\s*\?\s*\[port,\s*HOST,\s*onListening\]\s*:\s*\[port,\s*onListening\]\);/);
    assert.match(CODE, /app\.listen\(\.\.\.buildListenArgs\(PORT,/);
    assert.match(CODE, /httpsServer\.listen\(\.\.\.buildListenArgs\(httpsPort,/);
});
