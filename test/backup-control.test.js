import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { scheduleBackups, createBackup } from "../src/backup.js";

function withEnv(values, fn) {
    const saved = {};
    for (const [key, value] of Object.entries(values)) {
        saved[key] = process.env[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = String(value);
    }
    try {
        return fn();
    } finally {
        for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    }
}

test("scheduleBackups is disabled by default when AUTO_BACKUP_ENABLED is not set", () => {
    withEnv({ AUTO_BACKUP_ENABLED: undefined }, () => {
        const timer = scheduleBackups(null, 24);
        assert.equal(timer, null);
    });
});

test("scheduleBackups is disabled when AUTO_BACKUP_ENABLED=false", () => {
    withEnv({ AUTO_BACKUP_ENABLED: "false" }, () => {
        const timer = scheduleBackups(null, 24);
        assert.equal(timer, null);
    });
});

test("createBackup aborts immediately when BACKUP_ENABLED=false", async () => {
    await withEnv({ BACKUP_ENABLED: "false" }, async () => {
        const result = await createBackup(null);
        assert.equal(result.success, false);
        assert.match(result.error, /disabled/i);
    });
});

test("server.js startup does not call scheduleBackups unconditionally", () => {
    const src = readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
    assert.doesNotMatch(src, /^\s*scheduleBackups\(bot,\s*\d+\);/m, "scheduleBackups không được gọi trần");
    assert.match(src, /AUTO_BACKUP_ENABLED === "true"/, "phải kiểm tra AUTO_BACKUP_ENABLED");
});
