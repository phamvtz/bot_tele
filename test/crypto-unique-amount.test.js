import test from "node:test";
import assert from "node:assert/strict";

import { vndToUniqueUsdt, getUsdVndRate } from "../src/payment/crypto.js";
import { getCryptoAmountTolerance } from "../src/payment/amounts.js";

// Rate phải deterministic để test không phụ thuộc mạng: tắt live rate, set tay.
function withRate(rate, fn) {
    const saved = {
        auto: process.env.CRYPTO_USD_VND_RATE_AUTO,
        rate: process.env.CRYPTO_USD_VND_RATE,
    };
    process.env.CRYPTO_USD_VND_RATE_AUTO = "false";
    process.env.CRYPTO_USD_VND_RATE = String(rate);
    try {
        return fn();
    } finally {
        if (saved.auto === undefined) delete process.env.CRYPTO_USD_VND_RATE_AUTO;
        else process.env.CRYPTO_USD_VND_RATE_AUTO = saved.auto;
        if (saved.rate === undefined) delete process.env.CRYPTO_USD_VND_RATE;
        else process.env.CRYPTO_USD_VND_RATE = saved.rate;
    }
}

test("unique amount is deterministic for a given order and rate", () => {
    withRate(26000, () => {
        assert.equal(getUsdVndRate(), 26000);
        const first = vndToUniqueUsdt(265000, "order-abc12345");
        const second = vndToUniqueUsdt(265000, "order-abc12345");
        assert.equal(first, second);
        assert.equal(first, 10.202181);
    });
});

// C1: cùng một order, rate đổi -> số tiền yêu cầu đổi theo. Đây là lý do
// KHÔNG được regenerate checkout cho order đã PENDING (khách đã chuyển tiền
// theo số cũ, số mới lệch xa hơn tolerance nên không bao giờ match).
test("changing the live rate changes the demanded amount for the same order", () => {
    const atLowRate = withRate(26000, () => vndToUniqueUsdt(265000, "order-abc12345"));
    const atHighRate = withRate(27000, () => vndToUniqueUsdt(265000, "order-abc12345"));

    assert.notEqual(atLowRate, atHighRate);
    assert.equal(atLowRate, 10.202181);
    assert.equal(atHighRate, 9.824688);
    assert.ok(
        Math.abs(atLowRate - atHighRate) > getCryptoAmountTolerance(),
        "regenerated amount is outside matching tolerance, so an already-sent transfer can never match",
    );
});

test("the per-order offset stays within the documented 1000..9999 micro-USDT window", () => {
    withRate(26000, () => {
        const base = Math.ceil((265000 / 26000) * 1_000_000) / 1_000_000;
        for (const id of ["a", "order-1", "order-2", "cmxyz0000000000000000", "68f0c1b2d3e4f5a6b7c8d9e0"]) {
            const offsetMicro = Math.round((vndToUniqueUsdt(265000, id) - base) * 1_000_000);
            assert.ok(offsetMicro >= 1000 && offsetMicro <= 9999, `offset out of range for ${id}: ${offsetMicro}`);
        }
    });
});

// C2: offset chỉ có 9000 slot -> hai order khác nhau, cùng số tiền VND, có thể
// đụng cùng một amountToken. Khi đó poller thấy ambiguous và treo cả hai đơn.
// Test này ghim sự thật đó lại; fix C2 (cấp offset theo DB) phải làm nó thành
// "không tồn tại collision" ở tầng cấp phát, không phải ở hashString.
test("distinct order ids can collide on the same unique amount (C2 premise)", () => {
    withRate(26000, () => {
        const seen = new Map();
        let collision = null;
        for (let i = 0; i < 20000 && !collision; i += 1) {
            const id = `order-${i}`;
            const amount = vndToUniqueUsdt(265000, id);
            if (seen.has(amount)) collision = [seen.get(amount), id, amount];
            else seen.set(amount, id);
        }

        assert.ok(collision, "expected a collision within 20000 ids given only 9000 offset slots");
        const [idA, idB, amount] = collision;
        assert.notEqual(idA, idB);
        assert.equal(vndToUniqueUsdt(265000, idA), amount);
        assert.equal(vndToUniqueUsdt(265000, idB), amount);
    });
});

test("different VND totals do not collide even when the offset slot is shared", () => {
    withRate(26000, () => {
        const a = vndToUniqueUsdt(265000, "order-abc12345");
        const b = vndToUniqueUsdt(530000, "order-abc12345");
        assert.ok(Math.abs(a - b) > getCryptoAmountTolerance());
    });
});

// C2 fix: hash chỉ là điểm bắt đầu. Nếu slot đó đang bị đơn PENDING khác giữ,
// bộ cấp phát phải dò sang slot trống thay vì trả về số trùng.
test("allocation skips an amount already held by a pending payment", () => {
    withRate(26000, () => {
        const collided = vndToUniqueUsdt(265000, "order-abc12345");
        const next = vndToUniqueUsdt(265000, "order-abc12345", { taken: [collided] });

        assert.notEqual(next, collided);
        assert.ok(
            Math.abs(next - collided) > getCryptoAmountTolerance(),
            "số mới phải nằm ngoài tolerance của số đang bị giữ",
        );
    });
});

test("two orders that hash to the same slot get two different amounts", () => {
    withRate(26000, () => {
        // Tìm cặp thật sự đụng nhau, rồi cấp phát tuần tự như luồng thật.
        const seen = new Map();
        let pair = null;
        for (let i = 0; i < 20000 && !pair; i += 1) {
            const id = `order-${i}`;
            const amount = vndToUniqueUsdt(265000, id);
            if (seen.has(amount)) pair = [seen.get(amount), id];
            else seen.set(amount, id);
        }
        assert.ok(pair, "cần một cặp collision để kiểm tra");

        const [idA, idB] = pair;
        const taken = new Set();
        const amountA = vndToUniqueUsdt(265000, idA, { taken });
        taken.add(amountA);
        const amountB = vndToUniqueUsdt(265000, idB, { taken });

        assert.notEqual(amountA, amountB, "hai đơn PENDING không được cùng số tiền");
        assert.ok(Math.abs(amountA - amountB) > getCryptoAmountTolerance());
    });
});

test("allocation stays inside the offset window and never loops forever", () => {
    withRate(26000, () => {
        const base = Math.ceil((265000 / 26000) * 1_000_000) / 1_000_000;
        const taken = new Set();
        for (let i = 0; i < 50; i += 1) {
            const amount = vndToUniqueUsdt(265000, `order-${i}`, { taken });
            assert.ok(!taken.has(amount));
            const offsetMicro = Math.round((amount - base) * 1_000_000);
            assert.ok(offsetMicro >= 1000 && offsetMicro <= 9999, `offset out of range: ${offsetMicro}`);
            taken.add(amount);
        }
        assert.equal(taken.size, 50);
    });
});

test("throws instead of returning a duplicate when every slot is taken", () => {
    withRate(26000, () => {
        const base = Math.ceil((265000 / 26000) * 1_000_000) / 1_000_000;
        const taken = new Set();
        for (let slot = 0; slot < 9000; slot += 1) {
            taken.add(Number((base + (slot + 1000) / 1_000_000).toFixed(6)));
        }
        assert.throws(() => vndToUniqueUsdt(265000, "order-abc12345", { taken }), /duy nhất/);
    });
});
