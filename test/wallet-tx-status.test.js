import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { TxStatus } from "../src/wallet.js";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

// H6: "EXPIRED" từng là chuỗi literal rời, không có trong TxStatus. Mọi chỗ lọc
// hoặc thống kê theo enum sẽ bỏ sót các bản ghi đó — sai số liệu mà không lỗi.
test("EXPIRED is part of the wallet transaction status enum", () => {
    assert.equal(TxStatus.EXPIRED, "EXPIRED");
    assert.deepEqual(
        Object.keys(TxStatus).sort(),
        ["EXPIRED", "FAILED", "PENDING", "SUCCESS"],
    );
});

test("no source file writes a bare EXPIRED wallet status literal", async () => {
    for (const path of ["../src/wallet.js", "../src/crypto-poller.js"]) {
        const src = await read(path);
        assert.ok(
            !/status:\s*"EXPIRED"/.test(src),
            `${path} must use TxStatus.EXPIRED, not the literal`,
        );
        assert.ok(src.includes("TxStatus.EXPIRED"), `${path} must reference TxStatus.EXPIRED`);
    }
});

test("schema documents EXPIRED as a valid wallet transaction status", async () => {
    const schema = await read("../prisma/schema.prisma");
    // Nhiều model có field status @default("PENDING") — phải lấy đúng block
    // WalletTransaction, không phải Order.
    const block = schema.match(/model WalletTransaction \{[\s\S]*?\n\}/);
    assert.ok(block, "expected a WalletTransaction model");
    const line = block[0].split("\n").find((l) => /^\s*status\s+String/.test(l));
    assert.ok(line, "expected the WalletTransaction status field");
    assert.match(line, /EXPIRED/);
});
