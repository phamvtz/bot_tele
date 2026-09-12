import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { isPaidUpfrontMethod } from "../src/delivery.js";

// Hai lỗ hổng cùng một gốc: "đơn này khách đã trả tiền thật chưa?" bị MỖI NƠI tự trả
// lời bằng một chuỗi so sánh khác nhau.
//
// 1. Nút huỷ đơn của khách (`CONFIRM_CANCEL` trong bot.js) gác hoàn tiền bằng đúng
//    chuỗi `"wallet"`, trong khi cổng atomic của nó nhận cả đơn PAID. Khách trả bằng QR
//    ngân hàng hoặc USDT, đơn đã PAID, bấm huỷ → đơn sang CANCELED, tiền thì đã nằm
//    trong tài khoản shop (chuyển khoản ngân hàng và on-chain đều KHÔNG đảo ngược
//    được), không một khoản hoàn, và log admin chỉ ghi "ĐƠN HÀNG BỊ HUỶ" — không một
//    dấu hiệu nào để ai đó hoàn tay. Khách mất tiền thật, im lặng.
//
// 2. `ADMIN:CONFIRM_PAY` là MỘT nút bấm ăn ngay, nằm trong danh sách tới 5 nút "Xác
//    nhận XXXXXXXX" trông y hệt nhau. Một cú chạm nhầm phát một API key THẬT mà không
//    có đồng nào vào; `paymentRef` thì giữ nguyên NỘI DUNG CHUYỂN KHOẢN MONG ĐỢI nên
//    sau đó không phân biệt được đơn ngân hàng xác nhận với đơn admin bấm tay.
//
// Cả hai đều đã sửa; test này khoá lại.

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

/**
 * Bỏ các dòng là COMMENT NGUYÊN DÒNG trước khi chạy assertion "không được có X".
 * Chính mấy file này chứa comment trích nguyên cú pháp cũ (`=== "wallet"`,
 * `paymentMethod: "bank"`) để giải thích bug đã sửa; không lọc thì assertion cấm cú
 * pháp cũ khớp trúng phần văn bản giải thích.
 */
const codeOf = (src) => src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

// ─── 1. Một danh sách phương thức duy nhất ─────────────────────────────────────────

test("isPaidUpfrontMethod phủ đúng ba đường thu tiền trước, không thừa không thiếu", () => {
    for (const m of ["wallet", "vietqr", "crypto_trc20", "crypto_bep20", "crypto_binance_pay"]) {
        assert.equal(isPaidUpfrontMethod(m), true, `${m} là phương thức khách đã trả tiền trước`);
    }
});

test("phương thức KHÔNG thu tiền trước thì không được hoàn — kể cả giá trị rác", () => {
    // Gác bằng "khác rỗng" thì sai theo hướng ngược lại: đơn admin cấp tay, đơn khuyến
    // mãi 0đ, hoặc đơn mang phương thức lạ đều bị hoàn tiền khống.
    for (const m of ["", null, undefined, "free", "manual", "admin", "cod", "bank", "CRYPTO_TRC20_X", 0, {}]) {
        assert.equal(isPaidUpfrontMethod(m), false, `${JSON.stringify(m)} không phải phương thức đã thu tiền`);
    }
});

test("isPaidUpfrontMethod không phân biệt hoa thường — paymentMethod từng được lower ở mỗi nơi một kiểu", () => {
    // bot.js cũ viết `String(order.paymentMethod).toLowerCase() === "wallet"`, delivery.js
    // cũ viết `.has(String(order.paymentMethod || ""))` KHÔNG lower. Hai luật trên cùng
    // một field là một nhánh hoàn tiền chạy và nhánh kia thì không.
    assert.equal(isPaidUpfrontMethod("WALLET"), true);
    assert.equal(isPaidUpfrontMethod("VietQR"), true);
    assert.equal(isPaidUpfrontMethod("CRYPTO_TRC20"), true);
});

test("không còn chỗ nào trong src/ tự so paymentMethod với chuỗi \"wallet\"", () => {
    // Đây chính là hình dạng của bug #1: một nhánh quyết định tiền nòi được viết bằng
    // đúng một chuỗi. Quét toàn bộ src để bản sao không mọc lại ở handler khác.
    //
    // Hai chỗ từng so như vậy KHÔNG phải nhánh hoàn tiền mà là nhánh "ví đã trừ nhưng
    // đơn chưa promote" (bot.js) và nhánh promote trong lưới huỷ (server.js) — cả hai
    // cũng đã chuyển sang `isWalletPaymentMethod`, nên luật ở đây là tuyệt đối: không
    // chuỗi "wallet" nào được đem ra so với paymentMethod nữa.
    const offenders = [];
    const SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");
    for (const f of readdirSync(SRC_DIR, { recursive: true })) {
        if (!String(f).endsWith(".js")) continue;
        const code = codeOf(readFileSync(path.join(SRC_DIR, String(f)), "utf8"));
        for (const m of code.matchAll(/paymentMethod[^;\n]{0,60}?[!=]==?\s*"wallet"|"wallet"\s*[!=]==?[^;\n]{0,40}paymentMethod/g)) {
            offenders.push(`${f}: ${m[0].trim().slice(0, 90)}`);
        }
    }
    assert.deepEqual(offenders, [], `vẫn còn nơi tự so paymentMethod với "wallet":\n  ${offenders.join("\n  ")}`);
});

test("isWalletPaymentMethod là hàm duy nhất trả lời 'đơn này trả bằng ví'", async () => {
    const { isWalletPaymentMethod } = await import("../src/wallet.js");
    assert.equal(isWalletPaymentMethod("wallet"), true);
    assert.equal(isWalletPaymentMethod("WALLET"), true, "không phân biệt hoa thường");
    for (const m of ["", null, undefined, "vietqr", "crypto_trc20", "bank", "walletx", " Wallet ", 0, {}]) {
        assert.equal(isWalletPaymentMethod(m), false, `${JSON.stringify(m)} không phải ví`);
    }
});

test("delivery.js chỉ hỏi isPaidUpfrontMethod, không chạm thẳng PAID_UPFRONT_METHODS bên ngoài định nghĩa", () => {
    const code = codeOf(read("../src/delivery.js"));
    const uses = (code.match(/PAID_UPFRONT_METHODS/g) || []).length;
    // Đúng HAI lần: khai báo Set và một lần đọc nó bên trong isPaidUpfrontMethod.
    // Lần thứ ba nghĩa là có một nhánh hoàn tiền mới vừa đi tắt qua hàm dùng chung.
    assert.equal(uses, 2, `PAID_UPFRONT_METHODS phải chỉ được đọc trong isPaidUpfrontMethod, thực tế ${uses} lần`);
});

// ─── 2. Nút huỷ đơn của khách ──────────────────────────────────────────────────────

test("CONFIRM_CANCEL hoàn tiền theo isPaidUpfrontMethod, không theo chuỗi \"wallet\"", () => {
    const src = read("../src/bot.js");
    const start = src.indexOf("bot.action(/^CONFIRM_CANCEL:(.+)$/");
    assert.ok(start > 0, "không tìm thấy handler CONFIRM_CANCEL");
    const end = src.indexOf("// === WALLET SECTION ===", start);
    assert.ok(end > start, "không khoanh được hết handler CONFIRM_CANCEL");
    const code = codeOf(src.slice(start, end));

    assert.ok(
        code.includes("isPaidUpfrontMethod(order.paymentMethod)"),
        "nhánh hoàn tiền phải hỏi isPaidUpfrontMethod",
    );
    assert.ok(
        !/===\s*"wallet"/.test(code),
        "không được gác hoàn tiền bằng đúng chuỗi \"wallet\" nữa",
    );
    assert.ok(code.includes("walletRefund("), "phải thực sự gọi hoàn tiền");
});

test("màn hỏi huỷ cũng hứa hoàn tiền cho đơn QR/USDT, không chỉ đơn ví", () => {
    // Khách phải thấy TRƯỚC khi bấm rằng tiền sẽ về ví. Hứa một đằng làm một nẻo
    // (hoặc không hứa mà vẫn hoàn) đều là một kiểu mất tin cậy.
    const src = read("../src/bot.js");
    const code = codeOf(src);
    assert.ok(
        /order\.status === "PAID" && isPaidUpfrontMethod\(order\.paymentMethod\)\s*\?\s*`\$\{uiText\.refundToWallet\}/.test(code),
        "dòng refundToWallet phải hiện cho mọi đơn PAID đã thu tiền trước",
    );
});

test("hoàn tiền thất bại thì KHÔNG được huỷ đơn, và phải trả đơn về ĐÚNG trạng thái cũ", () => {
    // Tiền đã vào shop mà đơn CANCELED là khách mất trắng. Trước đây chỗ này rollback
    // hardcode về "PAID" bằng `update` trần — một đơn VÍ còn PENDING (đã trừ ví nhưng
    // promote chưa kịp) bị âm thầm đẩy lên PAID chỉ vì lượt huỷ thất bại.
    const src = read("../src/bot.js");
    const start = src.indexOf("bot.action(/^CONFIRM_CANCEL:(.+)$/");
    const end = src.indexOf("// === WALLET SECTION ===", start);
    const code = codeOf(src.slice(start, end));

    assert.ok(
        /where:\s*\{\s*id:\s*orderId,\s*status:\s*"CANCELING"\s*\}/.test(code),
        "rollback phải có gate status CANCELING — chỉ rollback đúng lượt claim của mình",
    );
    assert.ok(
        code.includes('order.status === "PAID" ? "PAID" : "PENDING"'),
        "rollback phải trả về trạng thái trước khi claim, không hardcode PAID",
    );
    // Hoàn không được thì phải dừng, không rơi xuống chỗ ghi CANCELED.
    const rollbackAt = code.indexOf('status: "CANCELING"');
    const canceledAt = code.indexOf('data: { status: "CANCELED"');
    assert.ok(rollbackAt > 0 && canceledAt > rollbackAt, "nhánh rollback phải nằm trước chỗ chốt CANCELED");
    assert.ok(
        /return ctx\.reply\(/.test(code.slice(rollbackAt, canceledAt)),
        "sau rollback phải return, không được đi tiếp tới bước chốt CANCELED",
    );
});

test("hoàn tiền thất bại phải BÁO ADMIN — ca tiền đã thu mà máy không tự hoàn được", () => {
    const src = read("../src/bot.js");
    const start = src.indexOf("bot.action(/^CONFIRM_CANCEL:(.+)$/");
    const end = src.indexOf("// === WALLET SECTION ===", start);
    const code = codeOf(src.slice(start, end));

    assert.ok(
        /sendLog\(\s*"ERROR"/.test(code),
        "phải đẩy log ERROR khi hoàn tiền thất bại, không thì không ai biết để hoàn tay",
    );
    assert.ok(code.includes("CẦN HOÀN TIỀN TAY"), "log phải nói rõ việc admin cần làm");
    // Log phải mang đủ dữ liệu để hoàn tay: ai, đơn nào, bằng gì, bao nhiêu.
    for (const field of ["order.odelegramId", "order.paymentMethod", "order.finalAmount"]) {
        assert.ok(code.includes(field), `log phải kèm ${field}`);
    }
});

// ─── 3. Xác nhận thu tiền bằng tay của admin ───────────────────────────────────────

test("màn đơn chờ xác nhận lọc vietqr, không phải \"bank\" — giá trị không nơi nào ghi ra", () => {
    // `"bank"` xuất hiện đúng MỘT lần trong cả repo, ở chính query này. Không nơi nào
    // tạo đơn với paymentMethod "bank", nên màn "Đơn chờ xác nhận" luôn rỗng và tính
    // năng xác nhận tay chết từ khi viết: admin không có đường nào cứu một đơn QR mà
    // bank-poller/IPN bỏ lỡ.
    const src = read("../src/admin.js");
    assert.ok(
        src.includes('where: { status: "PENDING", paymentMethod: "vietqr" }'),
        "phải liệt kê đơn vietqr đang chờ",
    );
    assert.ok(
        !/paymentMethod:\s*"bank"/.test(codeOf(src)),
        "không được lọc theo paymentMethod \"bank\" — giá trị đó không tồn tại",
    );
});

test("ADMIN:CONFIRM_PAY là màn HỎI LẠI, hành động thật nằm ở ADMIN:CONFIRM_PAY_DO", () => {
    // Một nút bấm ăn ngay, đặt giữa 5 nút trông y hệt nhau, phát hàng thật. Idiom của
    // chính file này là hai bước (ADMIN:DELETE → ADMIN:CONFIRM_DELETE).
    const src = read("../src/admin.js");

    const ask = src.indexOf("bot.action(/^ADMIN:CONFIRM_PAY:(.+)$/");
    const act = src.indexOf("bot.action(/^ADMIN:CONFIRM_PAY_DO:(.+)$/");
    assert.ok(ask > 0, "thiếu handler màn hỏi lại ADMIN:CONFIRM_PAY");
    assert.ok(act > 0, "thiếu handler hành động ADMIN:CONFIRM_PAY_DO");

    // Hai pattern phải rời nhau: `^ADMIN:CONFIRM_PAY:` có dấu hai chấm ngay sau PAY nên
    // không nuốt được `ADMIN:CONFIRM_PAY_DO:`. Nếu ai đó "gọn hoá" thành một handler
    // dùng prefix thì màn hỏi lại biến mất.
    const askBody = src.slice(ask, act);
    assert.ok(
        !askBody.includes("deliverOrder"),
        "màn hỏi lại KHÔNG được giao hàng — nó chỉ hỏi",
    );
    assert.ok(
        !/status:\s*"PAID"/.test(codeOf(askBody)),
        "màn hỏi lại KHÔNG được đổi trạng thái đơn",
    );
    assert.ok(
        askBody.includes("`ADMIN:CONFIRM_PAY_DO:${orderId}`"),
        "màn hỏi lại phải dẫn tới nút hành động",
    );
});

test("màn hỏi lại hiện đủ dữ liệu để admin đối chiếu sao kê ngân hàng", () => {
    // Đó mới là lý do tồn tại của nút này. Hiện mỗi mã đơn thì admin vẫn phải đi tìm
    // số tiền ở chỗ khác, và thế là bấm bừa.
    const src = read("../src/admin.js");
    const ask = src.indexOf("bot.action(/^ADMIN:CONFIRM_PAY:(.+)$/");
    const act = src.indexOf("bot.action(/^ADMIN:CONFIRM_PAY_DO:(.+)$/");
    const body = src.slice(ask, act);

    for (const field of ["order.finalAmount", "order.paymentMethod", "order.paymentRef", "order.product?.name"]) {
        assert.ok(body.includes(field), `màn hỏi lại phải hiện ${field}`);
    }
});

test("xác nhận tay GHI ĐÈ paymentRef bằng MANUAL:<adminId>, không giữ nội dung chuyển khoản", () => {
    // Với đơn PENDING, `paymentRef` chứa NỘI DUNG MONG ĐỢI (`SHOPxxxxxxxx`), không phải
    // bằng chứng đã thu. Giữ nó lại thì đơn admin bấm tay không khác gì đơn ngân hàng
    // xác nhận — mất dấu vết đúng chỗ cần dấu vết nhất.
    const src = read("../src/admin.js");
    const act = src.indexOf("bot.action(/^ADMIN:CONFIRM_PAY_DO:(.+)$/");
    assert.ok(act > 0);
    const body = codeOf(src.slice(act, act + 6000));

    assert.ok(
        body.includes("paymentRef: `MANUAL:${ctx.from.id}`"),
        "paymentRef phải nói rõ ai đã thả đơn này",
    );
    assert.ok(
        !/paymentRef:\s*order\.paymentRef/.test(body),
        "không được kế thừa paymentRef cũ — nó là nội dung mong đợi, không phải bằng chứng",
    );
    // Vẫn phải là claim atomic: bank-poller có thể xác nhận cùng đơn đúng lúc đó.
    assert.ok(
        /where:\s*\{\s*id:\s*orderId,\s*status:\s*"PENDING"\s*\}/.test(body),
        "phải claim bằng updateMany có điều kiện status PENDING",
    );
});

test("xác nhận tay phải ghi AUDIT LOG và log trước khi giao hàng", () => {
    // CLAUDE.md: "Admin actions phải được log qua audit.js". Đây là hành động admin
    // nhạy cảm nhất panel — phát hàng thật mà không có dòng tiền nào.
    const src = read("../src/admin.js");
    const act = src.indexOf("bot.action(/^ADMIN:CONFIRM_PAY_DO:(.+)$/");
    const body = codeOf(src.slice(act, act + 6000));

    assert.ok(body.includes("logAction(ctx.from.id, Actions.CONFIRM_ORDER"), "phải ghi audit log");
    assert.ok(body.includes('sendLog("ORDER"'), "phải đẩy lên kênh log để admin khác thấy ngay");
    assert.ok(body.includes("manual: true"), "audit phải đánh dấu đây là xác nhận tay");

    const auditAt = body.indexOf("logAction(ctx.from.id");
    const deliverAt = body.indexOf("await deliverOrder(");
    assert.ok(auditAt > 0 && deliverAt > auditAt, "ghi log TRƯỚC khi giao: giao crash thì vẫn còn dấu vết ai đã thả đơn");
});

test("delivery bị skip thì KHÔNG được báo 'đã giao hàng'", () => {
    // Đơn đã claim sang PAID; nếu deliverOrder trả {skipped} mà admin vẫn đọc "Đã xác
    // nhận và giao hàng" thì admin bỏ đi và đơn treo tới lúc delivery-recovery nhặt.
    const src = read("../src/admin.js");
    const act = src.indexOf("bot.action(/^ADMIN:CONFIRM_PAY_DO:(.+)$/");
    const body = codeOf(src.slice(act, act + 6000));

    assert.ok(body.includes("result?.skipped"), "phải xét kết quả của deliverOrder");
    const skipAt = body.indexOf("if (result?.skipped)");
    const okAt = body.indexOf("Đã xác nhận và giao hàng");
    assert.ok(skipAt > 0 && okAt > skipAt, "nhánh skip phải chắn trước lời báo thành công");
    assert.ok(
        /return ctx\.editMessageText\(/.test(body.slice(skipAt, okAt)),
        "nhánh skip phải return, không rơi xuống lời báo thành công",
    );
});

test("số nút trên màn chờ xác nhận bị chặn và có khai báo", () => {
    // Danh sách từng `findMany` không giới hạn rồi `.slice(0, 5)`: tồn đọng 500 đơn là
    // kéo 500 dòng về chỉ để hiện 5 nút. Và nếu hiện nhiều đơn hơn số nút thì admin
    // đọc tên một đơn mà không có nút nào để bấm.
    const src = read("../src/admin.js");
    assert.ok(
        /const PENDING_CONFIRM_LIST_MAX = \d+;/.test(src),
        "trần danh sách phải là hằng đặt tên, không phải số trần trong query",
    );
    assert.ok(src.includes("take: PENDING_CONFIRM_LIST_MAX + 1"), "query phải lấy thừa một dòng để biết còn đơn nữa không");
    assert.ok(
        src.includes("orders.slice(0, PENDING_CONFIRM_LIST_MAX)"),
        "số dòng hiển thị và số nút phải cùng một trần",
    );
    assert.ok(
        src.includes('orderBy: { createdAt: "asc" }'),
        "phải xếp CŨ NHẤT TRƯỚC — đơn cũ nhất là đơn khách chờ lâu nhất",
    );
});
