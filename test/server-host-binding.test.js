import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SERVER_PATH = fileURLToPath(new URL("../src/server.js", import.meta.url));
const SRC = readFileSync(SERVER_PATH, "utf8");
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
    .join("\n");

test("src/server.js không có lỗi cú pháp (node --check)", () => {
    execFileSync(process.execPath, ["--check", SERVER_PATH]);
});

test("server.js hỗ trợ bind theo HOST (VD 127.0.0.1) cho cả HTTP và HTTPS", () => {
    assert.match(CODE, /const HOST\s*=\s*String\(process\.env\.HOST\s*\|\|\s*""\)\.trim\(\)\s*\|\|\s*undefined;/);
    assert.match(CODE, /const buildListenArgs\s*=\s*\(port,\s*onListening\)\s*=>\s*\(HOST\s*\?\s*\[port,\s*HOST,\s*onListening\]\s*:\s*\[port,\s*onListening\]\);/);
    assert.match(CODE, /app\.listen\(\.\.\.buildListenArgs\(PORT,/);
    assert.match(CODE, /httpsServer\.listen\(\.\.\.buildListenArgs\(httpsPort,/);
});
