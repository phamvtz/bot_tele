import test from "node:test";
import assert from "node:assert/strict";
import {
    ORDER_NOTIFY_DISABLED_UNTIL,
    getOrderNotificationMode,
    getOrderNotificationMutedUntil,
    isOrderNotificationMuted,
} from "../src/order-notifications.js";

const NOW = 1_700_000_000_000;

test("resolves enabled, 24-hour mute, and admin-disabled notification modes", () => {
    assert.equal(getOrderNotificationMode(null, NOW), "enabled");
    assert.equal(getOrderNotificationMode(NOW - 1, NOW), "enabled");
    assert.equal(getOrderNotificationMode(NOW + 60_000, NOW), "muted_24h");
    assert.equal(getOrderNotificationMode(ORDER_NOTIFY_DISABLED_UNTIL, NOW), "disabled");
});

test("creates compatible notifyMutedUntil values for every admin mode", () => {
    assert.equal(getOrderNotificationMutedUntil("enabled", NOW), null);
    assert.equal(getOrderNotificationMutedUntil("muted_24h", NOW), NOW + 86_400_000);
    assert.equal(getOrderNotificationMutedUntil("disabled", NOW), ORDER_NOTIFY_DISABLED_UNTIL);
    assert.equal(isOrderNotificationMuted(NOW + 1, NOW), true);
    assert.equal(isOrderNotificationMuted(null, NOW), false);
    assert.throws(() => getOrderNotificationMutedUntil("unknown", NOW), /không hợp lệ/);
});
