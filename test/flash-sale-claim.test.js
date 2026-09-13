import test, { mock } from "node:test";
import assert from "node:assert/strict";

import { makeFlashDb } from "./helpers/flash-sale-db.js";

const url = (p) => new URL(p, import.meta.url).href;

/**
 * Test tầng I/O của flash sale: claim suất, idempotency, rollback, đóng/xoá.
 *
 * Đích ngắm là các ca CONCURRENCY. `acceptOffer` được viết theo một thứ tự ngược với
 * trực giác (ghi dòng response TRƯỚC, chiếm suất SAU) và toàn bộ lý do tồn tại của
 * thứ tự đó là để hai cú bấm song song không đốt hai suất. Test tuần tự sẽ không bao
 * giờ bắt được lỗi ở đây — phải `Promise.all` thật.
 */

const NOW = Date.UTC(2026, 8, 13, 12, 0, 0);

function saleRow(over = {}) {
    return {
        id: "sale-1",
        productId: "prod-1",
        productName: "Khoá học",
        productCurrency: "VND",
        productPrice: 250000,
        totalDiscount: false,
        discountPct: 30,
        validityMinutes: 60,
        maxSlots: 0,
        status: "OPEN",
        recipientTotal: 0,
        sentCount: 0,
        blockedCount: 0,
        errorCount: 0,
        acceptedCount: 0,
        skippedCount: 0,
        purchasedCount: 0,
        discountGivenTotal: 0,
        progressCursor: null,
        sendLeaseAt: null,
        sendLeaseOwner: null,
        sendStartedAt: new Date(NOW - 60000),
        sendFinishedAt: null,
        opensAt: new Date(NOW - 30000),
        createdAt: new Date(NOW - 60000),
        closedAt: null,
        ...over,
    };
}

/**
 * `mock.module` chỉ được gọi MỘT lần cho mỗi module trong cả file — gọi lại ném
 * `ERR_INVALID_STATE`. Vì mỗi test cần một DB khác nhau, ta mock một Proxy cố định
 * và tráo `CURRENT` bên dưới nó: property được đọc LÚC GỌI (`prisma.flashSale.…`),
 * nên proxy luôn trả về store của test đang chạy.
 */
let CURRENT = null;
const prismaProxy = new Proxy({}, {
    get: (_t, prop) => (CURRENT ? CURRENT[prop] : undefined),
    has: (_t, prop) => Boolean(CURRENT && prop in CURRENT),
});
mock.module(url("../src/db.js"), { namedExports: { prisma: prismaProxy }, defaultExport: prismaProxy });
mock.module(url("../src/lib/logger.js"), {
    namedExports: { sendLog: () => Promise.resolve(), warnOnce: () => {} },
});
const mod = await import("../src/flash-sale.js");

/**
 * `flash-sale.js` giữ cache ưu đãi ở module scope (TTL 5s). Vì mọi test dùng chung MỘT
 * module instance, mỗi test phải tự xoá cache — không thì test sau đọc ưu đãi mà test
 * trước đã cache và cho kết quả xanh giả.
 */
const fresh = async (over = {}, dbOver = {}) => {
    CURRENT = makeFlashDb({ sales: [saleRow(over)], ...dbOver });
    mod.invalidateFlashOfferCache();
    return { db: CURRENT, mod };
};

// ─── Claim suất ────────────────────────────────────────────────────────────────────

test("nhận ưu đãi khi đợt đang mở → ghi ACCEPT, chiếm đúng một suất, hạn đúng validityMinutes", async () => {
    const { db, mod } = await fresh({ maxSlots: 5, validityMinutes: 30 });
    const out = await mod.acceptOffer("user-1", "sale-1", { now: NOW });

    assert.equal(out.ok, true);
    assert.equal(out.reason, "accepted");
    assert.equal(out.consumedSlot, true);
    assert.equal(out.expiresAt, new Date(NOW + 30 * 60000).toISOString());
    assert.equal(db._store.sales[0].acceptedCount, 1);
    assert.equal(db._store.responses.length, 1);
    assert.equal(db._store.responses[0].kind, "ACCEPT");
    assert.equal(db._store.responses[0].telegramId, "user-1");
});

test("không giới hạn suất (maxSlots = 0) thì nhận bao nhiêu cũng được, không bao giờ FULL", async () => {
    const { db, mod } = await fresh({ maxSlots: 0 });
    for (let i = 0; i < 12; i += 1) {
        const out = await mod.acceptOffer(`user-${i}`, "sale-1", { now: NOW });
        assert.equal(out.ok, true, `user-${i} phải nhận được`);
    }
    assert.equal(db._store.sales[0].acceptedCount, 12);
    assert.equal(db._store.sales[0].status, "OPEN", "maxSlots=0 nghĩa là KHÔNG giới hạn (§1)");
});

test("suất cuối: 50 người bấm CÙNG LÚC thì đúng maxSlots người qua", async () => {
    // Đây là test quan trọng nhất của cả tính năng. `claimSlot` so acceptedCount với
    // maxSlots bằng `$expr` trên CÙNG một updateOne — nếu filter và modify không phải
    // một khối nguyên tử thì con số vượt trần và shop bán nhiều suất hơn đã hứa.
    const { db, mod } = await fresh({ maxSlots: 3 });
    const results = await Promise.all(
        Array.from({ length: 50 }, (_, i) => mod.acceptOffer(`user-${i}`, "sale-1", { now: NOW })),
    );

    const ok = results.filter((r) => r.ok && r.reason === "accepted");
    const rejected = results.filter((r) => !r.ok);
    assert.equal(ok.length, 3, `đúng 3 người được nhận, thực tế ${ok.length}`);
    assert.equal(db._store.sales[0].acceptedCount, 3, "acceptedCount không được vượt maxSlots");
    assert.equal(db._store.sales[0].status, "FULL", "hết suất phải chuyển FULL");
    assert.ok(rejected.every((r) => r.reason === "full" || r.reason === "already"),
        `mọi ca trượt phải là 'full', thấy: ${[...new Set(rejected.map((r) => r.reason))]}`);
    // Số dòng ACCEPT phải ĐÚNG BẰNG số suất đã chiếm — không được có ưu đãi mồ côi.
    assert.equal(db._store.responses.filter((r) => r.kind === "ACCEPT").length, 3);
});

test("HAI CÚ BẤM của CÙNG một khách chỉ đốt MỘT suất (§2)", async () => {
    // Đây là lý do acceptOffer ghi dòng response TRƯỚC khi chiếm suất. Đảo thứ tự thì
    // cả hai request đều đọc existing=null, đều claim → 2 suất cho 1 người.
    const { db, mod } = await fresh({ maxSlots: 5 });
    const [a, b] = await Promise.all([
        mod.acceptOffer("user-1", "sale-1", { now: NOW }),
        mod.acceptOffer("user-1", "sale-1", { now: NOW }),
    ]);

    assert.equal(db._store.sales[0].acceptedCount, 1, "một người = một suất");
    assert.equal(db._store.responses.length, 1, "unique index (sale, user) chỉ cho một dòng");
    assert.ok([a.reason, b.reason].includes("already"), "một trong hai phải là 'already'");
    assert.equal(a.ok, true);
    assert.equal(b.ok, true, "khách bấm lại vì lo lắng — không được báo lỗi");
    // Cả hai phải trả CÙNG một hạn, không phải hai hạn khác nhau.
    assert.equal(new Date(a.expiresAt).getTime(), new Date(b.expiresAt).getTime());
});

test("bấm lại SAU khi đã nhận → nhắc lại hạn cũ, không ăn thêm suất", async () => {
    const { db, mod } = await fresh({ maxSlots: 5 });
    const first = await mod.acceptOffer("user-1", "sale-1", { now: NOW });
    const second = await mod.acceptOffer("user-1", "sale-1", { now: NOW + 60000 });

    assert.equal(second.ok, true);
    assert.equal(second.reason, "already");
    assert.equal(second.consumedSlot, false);
    assert.equal(db._store.sales[0].acceptedCount, 1);
    assert.equal(new Date(second.expiresAt).getTime(), new Date(first.expiresAt).getTime(),
        "phải nhắc lại đúng hạn cũ — cấp hạn mới là gia hạn ưu đãi ngoài ý muốn");
});

test("đã BỎ QUA rồi vẫn nhận được, và lượt đó chiếm suất (§2)", async () => {
    const { db, mod } = await fresh({ maxSlots: 5 });
    const skipped = await mod.skipOffer("user-1", "sale-1", { now: NOW });
    assert.equal(skipped.ok, true);
    assert.equal(db._store.sales[0].acceptedCount, 0);
    assert.equal(db._store.responses.length, 1);

    const accepted = await mod.acceptOffer("user-1", "sale-1", { now: NOW + 60000 });
    assert.equal(accepted.ok, true);
    assert.equal(accepted.reason, "accepted");
    assert.equal(db._store.sales[0].acceptedCount, 1, "lượt bỏ qua không giữ suất nên lượt nhận phải chiếm");
    assert.equal(db._store.responses.length, 1, "vẫn một dòng — SKIP được đổi thành ACCEPT, không tạo dòng mới");
    assert.equal(db._store.responses[0].kind, "ACCEPT");
});

test("hết suất → 'full', và KHÔNG ghi dòng response nào", async () => {
    const { db, mod } = await fresh({ maxSlots: 1, acceptedCount: 1, status: "FULL" });
    const out = await mod.acceptOffer("user-9", "sale-1", { now: NOW });
    assert.equal(out.ok, false);
    assert.equal(out.reason, "full");
    assert.equal(db._store.responses.length, 0, "từ chối thì không được để lại dấu vết");
    assert.equal(db._store.sales[0].acceptedCount, 1);
});

test("§5: khách đã nhận TRƯỚC khi hết suất vẫn dùng được ưu đãi", async () => {
    const { db, mod } = await fresh({ maxSlots: 1 });
    const early = await mod.acceptOffer("user-1", "sale-1", { now: NOW });
    assert.equal(early.ok, true);
    assert.equal(db._store.sales[0].status, "FULL");

    // Người đến sau bị chặn.
    const late = await mod.acceptOffer("user-2", "sale-1", { now: NOW + 1000 });
    assert.equal(late.ok, false);
    assert.equal(late.reason, "full");

    // Nhưng người đã nhận vẫn thấy ưu đãi của mình còn sống.
    const again = await mod.acceptOffer("user-1", "sale-1", { now: NOW + 1000 });
    assert.equal(again.ok, true);
    assert.equal(again.reason, "already");
    assert.equal(db._store.sales[0].acceptedCount, 1);
});

test("đang gửi mà bấm Nhận → 'not_open' kèm thanh tiến độ THẬT (§3, §8)", async () => {
    const { mod } = await fresh({
        status: "SENDING", recipientTotal: 2500, sentCount: 1200, blockedCount: 30, errorCount: 5,
        sendStartedAt: new Date(NOW - 60000), opensAt: new Date(NOW + 90000),
    });
    const out = await mod.acceptOffer("user-1", "sale-1", { now: NOW });

    assert.equal(out.ok, false);
    assert.equal(out.reason, "not_open");
    assert.ok(out.view, "phải kèm view tiến độ để handler hiện thanh");
    // processed = sent + blocked + error = 1235 / 2500 = 49%
    assert.equal(out.view.pct, 49);
    assert.equal(out.view.bar, "▓▓▓▓▓▓░░░░░░");
    // ETA không được sớm hơn giờ đã in trên tin.
    assert.ok(out.view.etaMs >= 90000, `ETA ${out.view.etaMs} phải ≥ 90000 (giờ đã in)`);
    // §2: view đi tới khách nên tuyệt đối không mang tổng số người nhận.
    assert.ok(!("total" in out.view));
    assert.ok(!JSON.stringify(out.view).includes("2500"));
});

test("đợt đã đóng → 'closed'", async () => {
    const { mod } = await fresh({ status: "CLOSED" });
    const out = await mod.acceptOffer("user-1", "sale-1", { now: NOW });
    assert.equal(out.ok, false);
    assert.equal(out.reason, "closed");
});

test("ưu đãi hết hạn → 'expired', không tự gia hạn", async () => {
    const { db, mod } = await fresh({ maxSlots: 5 }, {
        responses: [{
            id: "r1", flashSaleId: "sale-1", telegramId: "user-1",
            kind: "ACCEPT", expiresAt: new Date(NOW - 1000), respondedAt: new Date(NOW - 3600000),
        }],
    });
    const out = await mod.acceptOffer("user-1", "sale-1", { now: NOW });
    assert.equal(out.ok, false);
    assert.equal(out.reason, "expired");
    assert.equal(db._store.sales[0].acceptedCount, 0, "hết hạn thì không chiếm suất mới");
});

test("không tìm thấy đợt → 'not_found'", async () => {
    const { mod } = await fresh();
    const out = await mod.acceptOffer("user-1", "sale-không-tồn-tại", { now: NOW });
    assert.equal(out.ok, false);
    assert.equal(out.reason, "not_found");
});

test("telegramId rỗng → 'bad_user', không chạm DB", async () => {
    const { db, mod } = await fresh();
    for (const bad of ["", "   ", null, undefined]) {
        const out = await mod.acceptOffer(bad, "sale-1", { now: NOW });
        assert.equal(out.ok, false);
        assert.equal(out.reason, "bad_user", String(bad));
    }
    assert.equal(db._store.responses.length, 0);
    assert.equal(db._store.sales[0].acceptedCount, 0);
});

// ─── Rollback khi chiếm suất thất bại ──────────────────────────────────────────────

test("đọc thấy còn suất nhưng tới lúc claim thì đã hết → rollback, không để ưu đãi mồ côi", async () => {
    // Mô phỏng race: `evaluateClaim` đọc status=OPEN và chấp nhận, nhưng `$expr` trong
    // claimSlot thấy acceptedCount đã bằng maxSlots (một request khác vừa chiếm xong).
    // Không rollback thì có một dòng ACCEPT mà không giữ suất — khách tưởng mình có
    // ưu đãi, tới lúc thanh toán thì trả giá gốc.
    const { db, mod } = await fresh({ maxSlots: 2, acceptedCount: 2, status: "OPEN" });
    const out = await mod.acceptOffer("user-1", "sale-1", { now: NOW });

    assert.equal(out.ok, false, "claim thất bại thì phải báo thất bại");
    assert.equal(out.reason, "full");
    assert.equal(db._store.responses.length, 0, "dòng ACCEPT phải bị xoá (rollback)");
    assert.equal(db._store.sales[0].acceptedCount, 2, "không được nhả suất của người khác");
});

test("rollback phải TRẢ LẠI trạng thái SKIP cũ nếu khách từng bỏ qua", async () => {
    // Cùng race trên, nhưng khách này đã có dòng SKIP. Xoá trắng dòng đó là xoá mất
    // một con số thống kê; phải trả về SKIP.
    const { db, mod } = await fresh({ maxSlots: 2, acceptedCount: 2, status: "OPEN" }, {
        responses: [{
            id: "r1", flashSaleId: "sale-1", telegramId: "user-1",
            kind: "SKIP", expiresAt: null, respondedAt: new Date(NOW - 5000),
        }],
    });
    const out = await mod.acceptOffer("user-1", "sale-1", { now: NOW });

    assert.equal(out.ok, false);
    assert.equal(db._store.responses.length, 1, "dòng SKIP phải còn đó");
    assert.equal(db._store.responses[0].kind, "SKIP", "phải trả về SKIP, không phải ACCEPT");
    assert.equal(db._store.responses[0].expiresAt, null, "SKIP không có hạn");
});

// ─── Bỏ qua ────────────────────────────────────────────────────────────────────────

test("bỏ qua → ghi SKIP, tăng skippedCount, KHÔNG đụng acceptedCount", async () => {
    const { db, mod } = await fresh({ maxSlots: 5 });
    const out = await mod.skipOffer("user-1", "sale-1", { now: NOW });
    assert.equal(out.ok, true);
    assert.equal(out.reason, "skipped");
    assert.equal(db._store.sales[0].skippedCount, 1);
    assert.equal(db._store.sales[0].acceptedCount, 0, "bỏ qua không được chiếm suất");
    assert.equal(db._store.responses[0].kind, "SKIP");
});

test("đã nhận rồi bấm bỏ qua → từ chối, ưu đãi đang sống không bị tước", async () => {
    const { db, mod } = await fresh({ maxSlots: 5 });
    await mod.acceptOffer("user-1", "sale-1", { now: NOW });
    const out = await mod.skipOffer("user-1", "sale-1", { now: NOW + 1000 });
    assert.equal(out.ok, false);
    assert.equal(out.reason, "already_accepted");
    assert.equal(db._store.responses[0].kind, "ACCEPT", "dòng ACCEPT phải nguyên vẹn");
    assert.ok(db._store.responses[0].expiresAt, "hạn phải còn");
});

test("ghi thống kê bỏ qua thất bại thì VẪN báo ok — số liệu không được chặn khách", async () => {
    const { db, mod } = await fresh({ maxSlots: 5 });
    db._flags.failUpdate = true;
    const out = await mod.skipOffer("user-1", "sale-1", { now: NOW });
    assert.equal(out.ok, true, "bỏ qua là thống kê, không phải quyền lợi — lỗi ghi không được làm khách kẹt");
    db._flags.failUpdate = false;
});

// ─── releaseSlot ───────────────────────────────────────────────────────────────────

test("nhả suất phải trả đợt từ FULL về OPEN — một lỗi ghi không được đóng cả đợt", async () => {
    const { db, mod } = await fresh({ maxSlots: 2, acceptedCount: 2, status: "FULL" });
    const ok = await mod.releaseSlot("sale-1");
    assert.equal(ok, true);
    assert.equal(db._store.sales[0].acceptedCount, 1);
    assert.equal(db._store.sales[0].status, "OPEN", "còn suất thì phải mở lại cho khách khác");
});

test("nhả suất khi acceptedCount = 0 thì không âm", async () => {
    const { db, mod } = await fresh({ maxSlots: 2, acceptedCount: 0 });
    const ok = await mod.releaseSlot("sale-1");
    assert.equal(ok, false);
    assert.equal(db._store.sales[0].acceptedCount, 0);
});

// ─── Đóng / xoá ────────────────────────────────────────────────────────────────────

test("closeFlashSale là atomic: đóng hai lần chỉ lần đầu trả true", async () => {
    const { db, mod } = await fresh({ status: "OPEN" });
    assert.equal(await mod.closeFlashSale("sale-1", { now: NOW }), true);
    assert.equal(db._store.sales[0].status, "CLOSED");
    assert.equal(db._store.sales[0].closedAt.getTime(), NOW);
    assert.equal(await mod.closeFlashSale("sale-1", { now: NOW + 1000 }), false, "đã đóng rồi thì không đổi nữa");
    assert.equal(db._store.sales[0].closedAt.getTime(), NOW, "closedAt phải giữ mốc đóng ĐẦU TIÊN");
});

test("closeFlashSale chỉ đóng đợt đang sống, không đụng đợt đã CLOSED", async () => {
    const { db, mod } = await fresh({ status: "CLOSED", closedAt: new Date(NOW - 5000) });
    assert.equal(await mod.closeFlashSale("sale-1", { now: NOW }), false);
    assert.equal(db._store.sales[0].closedAt.getTime(), NOW - 5000);
});

test("closeFlashSale ghi lý do để log phân biệt được 'ngừng nhận' với 'dừng gửi'", async () => {
    const { db, mod } = await fresh({ status: "SENDING" });
    await mod.closeFlashSale("sale-1", { reason: "admin_stop_sending", now: NOW });
    assert.equal(db._store.sales[0].closeReason, "admin_stop_sending");
});

test("xoá đợt thì xoá CẢ claim của khách (§8)", async () => {
    const { db, mod } = await fresh({ maxSlots: 5 }, {
        responses: [
            { id: "r1", flashSaleId: "sale-1", telegramId: "u1", kind: "ACCEPT" },
            { id: "r2", flashSaleId: "sale-1", telegramId: "u2", kind: "SKIP" },
            { id: "r3", flashSaleId: "sale-KHÁC", telegramId: "u3", kind: "ACCEPT" },
        ],
    });
    const removed = await mod.deleteFlashSale("sale-1");
    assert.equal(removed.sale, 1);
    assert.equal(removed.responses, 2);
    assert.equal(db._store.sales.length, 0);
    // Response của đợt KHÁC phải nguyên vẹn — xoá nhầm là tước ưu đãi của khách đợt đó.
    assert.equal(db._store.responses.length, 1);
    assert.equal(db._store.responses[0].flashSaleId, "sale-KHÁC");
});

// ─── Đọc ưu đãi đang sống ──────────────────────────────────────────────────────────

test("getActiveFlashOffer trả ưu đãi còn hạn, và null khi đã hết hạn", async () => {
    const { mod } = await fresh({ maxSlots: 5 });
    await mod.acceptOffer("user-1", "sale-1", { now: NOW });

    const live = await mod.getActiveFlashOffer("user-1", "prod-1", { now: NOW + 60000 });
    assert.ok(live, "phải đọc ra ưu đãi");
    assert.equal(live.discountPct, 30);
    assert.equal(live.productId, "prod-1");

    const dead = await mod.getActiveFlashOffer("user-1", "prod-1", { now: NOW + 61 * 60000 });
    assert.equal(dead, null, "quá hạn 60 phút thì phải hết ưu đãi — hết hạn tự động (§2)");
});

test("admin LUÔN thấy giá gốc (§4)", async () => {
    const { mod } = await fresh({ maxSlots: 5 });
    await mod.acceptOffer("admin-1", "sale-1", { now: NOW });
    const offer = await mod.getActiveFlashOffer("admin-1", "prod-1", { now: NOW + 1000, isAdmin: true });
    assert.equal(offer, null, "admin mà thấy giá giảm thì không đối chiếu được giá niêm yết");
});

test("khách KHÔNG nhận thì không thấy gì bất thường (§2)", async () => {
    const { mod } = await fresh({ maxSlots: 5 });
    await mod.acceptOffer("user-1", "sale-1", { now: NOW });
    const offer = await mod.getActiveFlashOffer("user-khác", "prod-1", { now: NOW + 1000 });
    assert.equal(offer, null);
});

test("ưu đãi không rò sang sản phẩm khác", async () => {
    const { mod } = await fresh({ maxSlots: 5 });
    await mod.acceptOffer("user-1", "sale-1", { now: NOW });
    assert.equal(await mod.getActiveFlashOffer("user-1", "prod-KHÁC", { now: NOW + 1000 }), null);
});

// ─── applyOfferToProduct ───────────────────────────────────────────────────────────

test("applyOfferToProduct IDEMPOTENT — áp hai lần không nhân đôi giảm giá", async () => {
    // Đây là bug mất tiền: nếu giảm 30% bị áp hai lần thì thành 51%, và khách bị thu
    // THẤP HƠN giá bot đã hứa. Áp ở tầng fetch rồi lại áp trong createPendingOrder
    // chính là đường dẫn tới lỗi đó.
    const { mod } = await fresh();
    const product = { id: "prod-1", name: "Khoá học", price: 100000, currency: "VND" };
    const offer = { saleId: "sale-1", productId: "prod-1", discountPct: 30, expiresAt: new Date(NOW + 60000) };

    const once = mod.applyOfferToProduct(product, offer);
    assert.equal(once.price, 70000);
    assert.equal(once.priceBeforeFlash, 100000);
    assert.equal(once.flashPct, 30);
    assert.equal(once.flashMode, "unit");

    const twice = mod.applyOfferToProduct(once, offer);
    assert.equal(twice.price, 70000, "áp lần hai phải ra đúng số cũ, không phải 49000");
    assert.equal(twice.priceBeforeFlash, 100000, "giá gốc phải giữ nguyên để còn gạch ngang");

    const thrice = mod.applyOfferToProduct(twice, offer);
    assert.equal(thrice.price, 70000);
});

test("applyOfferToProduct KHÔNG mutate object gốc", async () => {
    // Product được cache 30 phút trong category.js và dùng CHUNG cho mọi khách.
    // Mutate tại chỗ là khách A có ưu đãi sẽ làm khách B cũng thấy giá giảm (§2).
    const { mod } = await fresh();
    const product = { id: "prod-1", name: "Khoá học", price: 100000, currency: "VND" };
    const offer = { saleId: "sale-1", productId: "prod-1", discountPct: 30, expiresAt: new Date(NOW + 60000) };

    const out = mod.applyOfferToProduct(product, offer);
    assert.notEqual(out, product, "phải trả bản copy");
    assert.equal(product.price, 100000, "object gốc không được đổi");
    assert.equal(product.flashOffer, undefined);
});

test("applyOfferToProduct với hàng API key → mode 'total', giá đơn vị giữ nguyên", async () => {
    const { mod } = await fresh({ totalDiscount: true });
    const product = { id: "__API_KEY__", code: "__API_KEY__", deliveryMode: "API_KEY", price: 0, currency: "USD" };
    const offer = { saleId: "sale-1", productId: "__API_KEY__", discountPct: 30, expiresAt: new Date(NOW + 60000) };
    const out = mod.applyOfferToProduct(product, offer);
    assert.equal(out.flashMode, "total");
    assert.equal(out.price, 0, "giá đơn vị KHÔNG giảm — giảm phải áp lên tổng đơn ở tầng báo giá");
    assert.equal(out.flashPct, 30);
});

test("applyOfferToProduct với offer rác thì trả nguyên product", async () => {
    const { mod } = await fresh();
    const product = { id: "prod-1", price: 100000 };
    assert.equal(mod.applyOfferToProduct(product, null), product);
    assert.equal(mod.applyOfferToProduct(product, { discountPct: 0 }), product);
    assert.equal(mod.applyOfferToProduct(product, { discountPct: 91 }), product);
    assert.equal(mod.applyOfferToProduct(null, { discountPct: 30 }), null);
});

// ─── Thống kê (§6) ─────────────────────────────────────────────────────────────────

test("flashSaleStats đếm đúng từng loại, và 'live' = đã nhận trừ đã hết hạn", async () => {
    const { mod } = await fresh({}, {
        responses: [
            { id: "r1", flashSaleId: "sale-1", telegramId: "u1", kind: "ACCEPT", expiresAt: new Date(NOW + 600000), purchased: true },
            { id: "r2", flashSaleId: "sale-1", telegramId: "u2", kind: "ACCEPT", expiresAt: new Date(NOW - 60000) },
            { id: "r3", flashSaleId: "sale-1", telegramId: "u3", kind: "SKIP" },
            { id: "r4", flashSaleId: "sale-1", telegramId: "u4", kind: "ACCEPT", expiresAt: new Date(NOW + 600000) },
        ],
    });
    const s = await mod.flashSaleStats("sale-1", { now: NOW });
    assert.equal(s.accepted, 3);
    assert.equal(s.skipped, 1);
    assert.equal(s.purchased, 1);
    assert.equal(s.expired, 1);
    assert.equal(s.live, 2);
    assert.equal(s.responded, 4);
});

test("flashSaleReport: 'không phản hồi' = đã gửi − đã trả lời, không bao giờ âm", async () => {
    const { mod } = await fresh({ sentCount: 100, blockedCount: 5, errorCount: 2, recipientTotal: 200 }, {
        responses: [{ id: "r1", flashSaleId: "sale-1", telegramId: "u1", kind: "ACCEPT", expiresAt: new Date(NOW + 60000) }],
    });
    const rep = await mod.flashSaleReport(await mod.getFlashSale("sale-1"), { now: NOW });
    assert.equal(rep.noResponse, 99);
    assert.equal(rep.blockedCount, 5, "chặn bot là một mục riêng, KHÔNG phải lỗi (§8)");
    assert.equal(rep.errorCount, 2);

    // sentCount nhỏ hơn số đã trả lời (dữ liệu lệch) thì phải ra 0, không phải -3.
    const odd = await fresh({ sentCount: 1 }, {
        responses: [
            { id: "a", flashSaleId: "sale-1", telegramId: "u1", kind: "ACCEPT", expiresAt: new Date(NOW + 60000) },
            { id: "b", flashSaleId: "sale-1", telegramId: "u2", kind: "ACCEPT", expiresAt: new Date(NOW + 60000) },
            { id: "c", flashSaleId: "sale-1", telegramId: "u3", kind: "ACCEPT", expiresAt: new Date(NOW + 60000) },
            { id: "d", flashSaleId: "sale-1", telegramId: "u4", kind: "ACCEPT", expiresAt: new Date(NOW + 60000) },
        ],
    });
    const rep2 = await odd.mod.flashSaleReport(await odd.mod.getFlashSale("sale-1"), { now: NOW });
    assert.equal(rep2.noResponse, 0);
});

test("flashSaleReport nêu đúng tiền tệ của 'tổng tiền đã giảm'", async () => {
    // Đơn API key lưu amount bằng VND trong khi sản phẩm __API_KEY__ khai currency USD.
    // Gắn nhãn USD cho một con số VND là in ra "$70" cho 70 nghìn đồng.
    const a = await fresh({ totalDiscount: true, productCurrency: "USD" });
    const repA = await a.mod.flashSaleReport(await a.mod.getFlashSale("sale-1"), { now: NOW });
    assert.equal(repA.moneyCurrency, "VND");

    const b = await fresh({ totalDiscount: false, productCurrency: "USD" });
    const repB = await b.mod.flashSaleReport(await b.mod.getFlashSale("sale-1"), { now: NOW });
    assert.equal(repB.moneyCurrency, "USD");

    const c = await fresh({ totalDiscount: false, productCurrency: null });
    const repC = await c.mod.flashSaleReport(await c.mod.getFlashSale("sale-1"), { now: NOW });
    assert.equal(repC.moneyCurrency, "VND");
});

test("flashSaleReport chỉ kèm tiến độ khi đang SENDING", async () => {
    const sending = await fresh({ status: "SENDING", recipientTotal: 100, sentCount: 40 });
    const repS = await sending.mod.flashSaleReport(await sending.mod.getFlashSale("sale-1"), { now: NOW });
    assert.ok(repS.progress, "đang gửi thì admin phải thấy thanh tiến độ (§3)");
    assert.equal(repS.progress.pct, 40);

    const open = await fresh({ status: "OPEN", recipientTotal: 100, sentCount: 100 });
    const repO = await open.mod.flashSaleReport(await open.mod.getFlashSale("sale-1"), { now: NOW });
    assert.equal(repO.progress, null);
});

// ─── recordFlashSalePurchase (§6) ──────────────────────────────────────────────────

const flashOrder = (over = {}) => ({
    id: "order-1", flashSaleId: "sale-1", flashDiscountPct: 30,
    flashListAmount: 250000, flashDiscountAmount: 75000, flashCountedAt: null, ...over,
});

test("đơn đã giao có flash → đếm purchasedCount và cộng đúng số tiền đã giảm", async () => {
    const { db, mod } = await fresh();
    db._store.orders.push(flashOrder());
    const out = await mod.recordFlashSalePurchase({ prisma: db, order: flashOrder() });
    assert.notEqual(out.skipped, true);
    assert.equal(db._store.sales[0].purchasedCount, 1);
    assert.equal(db._store.sales[0].discountGivenTotal, 75000, "ghi SỐ THẬT lúc mua, không ước lượng (§6)");
});

test("recordFlashSalePurchase IDEMPOTENT theo đơn — recovery chạy lại 7 ngày không được đếm thêm", async () => {
    const { db, mod } = await fresh();
    const order = flashOrder();
    db._store.orders.push(order);

    await mod.recordFlashSalePurchase({ prisma: db, order });
    // Mô phỏng lượt retry: đọc lại đơn từ DB (đã có flashCountedAt).
    const after = db._store.orders[0];
    const second = await mod.recordFlashSalePurchase({ prisma: db, order: after });
    assert.equal(second.skipped, true);
    assert.equal(db._store.sales[0].purchasedCount, 1, "không được cộng hai lần");
    assert.equal(db._store.sales[0].discountGivenTotal, 75000);
});

test("hai lượt đếm song song CÙNG một đơn thì chỉ một lượt thắng", async () => {
    const { db, mod } = await fresh();
    const order = flashOrder();
    db._store.orders.push(order);
    await Promise.all([
        mod.recordFlashSalePurchase({ prisma: db, order }),
        mod.recordFlashSalePurchase({ prisma: db, order }),
    ]);
    assert.equal(db._store.sales[0].purchasedCount, 1);
    assert.equal(db._store.sales[0].discountGivenTotal, 75000);
});

test("đơn không có flash sale thì bỏ qua, không đếm oan", async () => {
    const { db, mod } = await fresh();
    const order = { id: "order-2", flashSaleId: null, flashDiscountPct: 0, flashDiscountAmount: 0, flashCountedAt: null };
    db._store.orders.push(order);
    const out = await mod.recordFlashSalePurchase({ prisma: db, order });
    assert.equal(out.skipped, true);
    assert.equal(db._store.sales[0].purchasedCount, 0);
    assert.equal(db._store.sales[0].discountGivenTotal, 0);
});

test("flashDiscountAmount âm (dữ liệu lệch) thì kẹp về 0, không trừ ngược thống kê", async () => {
    const { db, mod } = await fresh();
    const order = flashOrder({ flashDiscountAmount: -500 });
    db._store.orders.push(order);
    await mod.recordFlashSalePurchase({ prisma: db, order });
    assert.equal(db._store.sales[0].discountGivenTotal, 0);
    assert.equal(db._store.sales[0].purchasedCount, 1, "vẫn là một lượt mua thật");
});
