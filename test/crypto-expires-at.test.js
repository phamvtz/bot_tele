import test from "node:test";
import assert from "node:assert/strict";

import { cryptoExpiresAt, isCryptoOrderExpired } from "../src/payment/crypto.js";

// M1: hạn thanh toán phải là mốc đã ghi lúc tạo checkout. Nếu tính lại từ config
// lúc đọc, đổi CRYPTO_EXPIRE_MINUTES sẽ hồi sinh đơn đã hết hạn hoặc giết đơn
// đang chờ — cả hai đều là mất tiền của khách hoặc của shop.
function withExpireMinutes(minutes, fn) {
    const saved = process.env.CRYPTO_EXPIRE_MINUTES;
    process.env.CRYPTO_EXPIRE_MINUTES = String(minutes);
    try {
        return fn();
    } finally {
        if (saved === undefined) delete process.env.CRYPTO_EXPIRE_MINUTES;
        else process.env.CRYPTO_EXPIRE_MINUTES = saved;
    }
}

const NOW = Date.now();
const minutesAgo = (n) => new Date(NOW - n * 60_000);
const minutesAhead = (n) => new Date(NOW + n * 60_000);

test("a stored expiresAt wins over the configured window", () => {
    const order = { createdAt: minutesAgo(60), expiresAt: minutesAhead(5) };
    // Theo createdAt + 10 phút thì đơn này đã hết hạn từ lâu; expiresAt nói chưa.
    withExpireMinutes(10, () => {
        assert.equal(isCryptoOrderExpired(order), false);
        assert.equal(cryptoExpiresAt(order).getTime(), order.expiresAt.getTime());
    });
});

test("changing CRYPTO_EXPIRE_MINUTES does not move the deadline of a stored order", () => {
    const order = { createdAt: minutesAgo(30), expiresAt: minutesAgo(5) };
    // Nới config lên 24h cũng không được hồi sinh đơn đã hết hạn.
    assert.equal(withExpireMinutes(10, () => isCryptoOrderExpired(order)), true);
    assert.equal(withExpireMinutes(1440, () => isCryptoOrderExpired(order)), true);
});

test("legacy records without expiresAt fall back to createdAt + configured minutes", () => {
    const fresh = { createdAt: minutesAgo(5) };
    const stale = { createdAt: minutesAgo(30) };
    withExpireMinutes(10, () => {
        assert.equal(isCryptoOrderExpired(fresh), false);
        assert.equal(isCryptoOrderExpired(stale), true);
        assert.equal(cryptoExpiresAt(fresh).getTime(), new Date(fresh.createdAt).getTime() + 10 * 60_000);
    });
    // Bản ghi cũ vẫn theo config — đó là tất cả thông tin ta có về chúng.
    withExpireMinutes(60, () => assert.equal(isCryptoOrderExpired(stale), false));
});

// Có chỗ trong code cũ truyền thẳng createdAt; không được im lặng coi là "chưa hết hạn".
test("accepts a bare createdAt date as well as a record", () => {
    withExpireMinutes(10, () => {
        assert.equal(isCryptoOrderExpired(minutesAgo(30)), true);
        assert.equal(isCryptoOrderExpired(minutesAgo(1)), false);
    });
});
