import test from "node:test";
import assert from "node:assert/strict";
import { formatOrderCode } from "../src/order-code.js";

test("formats one canonical eight-character order code", () => {
    assert.equal(formatOrderCode("9d34133d6a5f6"), "33D6A5F6");
    assert.equal(formatOrderCode("66a0189554c29d34133d6a60e"), "33D6A60E");
});

test("keeps short legacy IDs usable", () => {
    assert.equal(formatOrderCode("order-1"), "ORDER-1");
    assert.equal(formatOrderCode(null), "");
});
