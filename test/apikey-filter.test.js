import test from "node:test";
import assert from "node:assert/strict";
import {
    decorateKeys, arrangeKeys, normalizeKeyFilter, KEY_FILTERS,
    classifyKeyStatus, keyLifecycle,
} from "../src/apikey-renew.js";
import { myKeysMessage } from "../src/bot-ui/apikey-messages.js";
import { buildMyKeysKeyboard } from "../src/bot-ui/keyboards.js";

/**
 * Bộ lọc danh sách key. Hợp đồng quan trọng nhất: tin nhắn và bàn phím phải xếp
 * GIỐNG HỆT nhau — nút "Gia hạn #3" trỏ sang key khác dòng số 3 là khách nạp
 * tiền vào nhầm key.
 */
const NOW = Date.UTC(2026, 8, 6, 12, 0, 0);
const DAY = 86_400_000;
const at = (d) => new Date(NOW + d * DAY).toISOString();

// 5 key phủ hết các trạng thái.
const KEYS = [
    { id: "healthy", key: "sk-healthy", externalId: "healthy", quotaTokens: 100e6, rpm: 100, createdAt: new Date(NOW) },
    { id: "low", key: "sk-low", externalId: "low", quotaTokens: 100e6, rpm: 100, createdAt: new Date(NOW) },
    { id: "noquota", key: "sk-noquota", externalId: "noquota", quotaTokens: 50e6, rpm: 300, createdAt: new Date(NOW) },
    { id: "expired", key: "sk-expired", externalId: "expired", quotaTokens: 50e6, rpm: 300, createdAt: new Date(NOW), expiresAt: at(-5) },
    { id: "forever", key: "sk-forever", externalId: "forever", quotaTokens: 0, rpm: 600, createdAt: new Date(NOW) },
];

const STATUS = new Map(Object.entries({
    healthy: { quotaLimit: 1000, quotaUsed: 10, expiresAt: at(30), enabled: true },
    low: { quotaLimit: 1000, quotaUsed: 850, expiresAt: at(30), enabled: true },
    noquota: { quotaLimit: 1000, quotaUsed: 1000, expiresAt: at(30), enabled: true },
    expired: { quotaLimit: 1000, quotaUsed: 10, expiresAt: at(-5), enabled: true },
    forever: { quotaLimit: 0, quotaUsed: 9e9, expiresAt: null, enabled: true },
}));

const view = (filter) => arrangeKeys(decorateKeys(KEYS, { statusById: STATUS, now: NOW }), filter);
const ids = (v) => v.shown.map((d) => d.key.id);

test("mỗi bộ lọc lấy đúng nhóm key của nó", () => {
    assert.deepEqual(ids(view("all")).sort(), ["expired", "forever", "healthy", "low", "noquota"]);
    assert.deepEqual(ids(view("active")).sort(), ["forever", "healthy", "low"], "còn dùng = chưa chết");
    assert.deepEqual(ids(view("low")), ["low"], "sắp hết KHÔNG gồm key đã chết");
    assert.deepEqual(ids(view("exhausted")), ["noquota"]);
    assert.deepEqual(ids(view("expired")), ["expired"]);
});

test("key vô hạn quota không bị coi là hết quota", () => {
    // quota_limit = 0 là VÔ HẠN bên xpiki. Đọc nhầm là key vĩnh viễn của khách
    // rơi hết vào tab "hết quota".
    assert.ok(ids(view("active")).includes("forever"));
    assert.ok(!ids(view("exhausted")).includes("forever"));
});

test("key sống luôn đứng trước key chết", () => {
    const shown = ids(view("all"));
    const lastAlive = Math.max(shown.indexOf("healthy"), shown.indexOf("low"), shown.indexOf("forever"));
    const firstDead = Math.min(shown.indexOf("noquota"), shown.indexOf("expired"));
    assert.ok(lastAlive < firstDead, "key đã hết phải dồn xuống cuối");
});

test("counts đếm cho MỌI bộ lọc, không phải chỉ cái đang bật", () => {
    const v = view("active");
    assert.deepEqual(v.counts, { all: 5, active: 3, low: 1, exhausted: 1, expired: 1 });
});

test("bộ lọc lạ / rỗng rơi về 'tất cả' chứ không làm trống danh sách", () => {
    assert.equal(normalizeKeyFilter("hack"), "all");
    assert.equal(normalizeKeyFilter(undefined), "all");
    assert.equal(ids(view("hack")).length, 5);
});

test("không đọc được số liệu provider vẫn lọc được theo NGÀY hết hạn", () => {
    // Provider hắt hơi thì khách vẫn phải xem và lọc được key của mình.
    const v = arrangeKeys(decorateKeys(KEYS, { statusById: new Map(), now: NOW }), "expired");
    assert.deepEqual(ids(v), ["expired"]);
    assert.equal(arrangeKeys(decorateKeys(KEYS, { statusById: new Map(), now: NOW }), "active").shown.length, 4);
});

// === Tin nhắn ==============================================================

test("tin nhắn nói rõ 'bộ lọc đang ẩn', không phải 'chưa có key nào'", () => {
    const text = myKeysMessage(KEYS, { lang: "vi", now: NOW, statusById: STATUS, filter: "active" });
    assert.match(text, /\(3\/5\)/, "tiêu đề phải cho biết đang xem 3 trên 5");
    assert.match(text, /2 key đang bị bộ lọc ẩn/);
});

test("lọc ra danh sách rỗng KHÔNG được nói 'bạn chưa có API key nào'", () => {
    // Khách có 5 key mà đọc "chưa có key nào" thì tưởng mất sạch key.
    const noneMatch = myKeysMessage(
        [KEYS[0]], { lang: "vi", now: NOW, statusById: STATUS, filter: "expired" },
    );
    assert.match(noneMatch, /Không có key nào khớp bộ lọc/);
    assert.doesNotMatch(noneMatch, /chưa có API key nào/);
});

test("khách chưa có key nào thì vẫn là 'chưa có API key nào'", () => {
    assert.match(myKeysMessage([], { lang: "vi" }), /chưa có API key nào/);
});

test("key đã hết vẫn bị gạch ngang khi xem 'tất cả'", () => {
    const text = myKeysMessage(KEYS, { lang: "vi", now: NOW, statusById: STATUS, filter: "all" });
    assert.match(text, /<s>[^<]*<\/s> — <b>đã hết<\/b>/);
    assert.doesNotMatch(text, /bị bộ lọc ẩn/, "xem tất cả thì không ẩn gì");
});

// === Bàn phím ==============================================================

const kbButtons = (kb) => kb.reply_markup.inline_keyboard.flat();

test("nút lọc đánh dấu cái đang bật và kèm số lượng", () => {
    const v = view("low");
    const btns = kbButtons(buildMyKeysKeyboard({ lang: "vi", filter: v.filter, counts: v.counts }));
    const low = btns.find((b) => b.callback_data === "APIKEY_FLT:low");
    assert.ok(low, "thiếu nút lọc");
    assert.match(low.text, /^• /, "lựa chọn đang bật phải được đánh dấu");
    assert.match(low.text, /\(1\)/, "phải cho biết trong đó có mấy key");
});

test("bộ lọc rỗng thì KHÔNG hiện nút — bấm vào chỗ trống là hụt hẫng", () => {
    const only = [KEYS[0]];
    const v = arrangeKeys(decorateKeys(only, { statusById: STATUS, now: NOW }), "all");
    const btns = kbButtons(buildMyKeysKeyboard({ lang: "vi", filter: v.filter, counts: v.counts }));
    assert.ok(!btns.some((b) => b.callback_data === "APIKEY_FLT:expired"));
    assert.ok(!btns.some((b) => b.callback_data === "APIKEY_FLT:exhausted"));
});

test("chỉ có một loại key → không hiện hàng nút lọc nào cả", () => {
    const only = [KEYS[0]];
    const v = arrangeKeys(decorateKeys(only, { statusById: STATUS, now: NOW }), "all");
    const btns = kbButtons(buildMyKeysKeyboard({ lang: "vi", filter: v.filter, counts: v.counts }));
    assert.ok(!btns.some((b) => String(b.callback_data).startsWith("APIKEY_FLT:")),
        "một khách chỉ có key khoẻ thì bộ lọc chỉ là rác màn hình");
});

test("nút lọc đang bật vẫn hiện dù nhóm đó rỗng — không thì khách kẹt", () => {
    // Lọc "hết hạn" rồi gia hạn nốt key cuối: nhóm về 0. Nếu nút biến mất thì
    // khách nhìn màn trống mà không biết đang bật bộ lọc nào để tắt.
    const v = arrangeKeys(decorateKeys([KEYS[0]], { statusById: STATUS, now: NOW }), "expired");
    const btns = kbButtons(buildMyKeysKeyboard({ lang: "vi", filter: v.filter, counts: v.counts }));
    assert.ok(btns.some((b) => b.callback_data === "APIKEY_FLT:expired"));
    assert.ok(btns.some((b) => b.callback_data === "APIKEY_FLT:all"), "luôn phải có đường về 'Tất cả'");
});

test("số thứ tự nút 'Gia hạn #N' khớp đúng dòng trong tin nhắn", () => {
    // Đây là lỗi tốn tiền thật: bấm #2 mà nạp vào key ở dòng 4.
    for (const f of KEY_FILTERS) {
        const v = view(f);
        const text = myKeysMessage(KEYS, { lang: "vi", now: NOW, statusById: STATUS, arranged: v });
        v.shown.forEach((d, i) => {
            const n = i + 1;
            // Dòng số n trong tin phải chứa đúng chuỗi key đó.
            const line = text.split("\n\n").find((b) => new RegExp(`(^|\\n)${n}\\. `).test(b));
            assert.ok(line, `[${f}] thiếu dòng ${n}`);
            assert.ok(line.includes(d.key.key), `[${f}] dòng ${n} không phải key mà nút #${n} trỏ tới`);
        });
    }
});

test("bộ lọc có bản dịch en / zh", () => {
    const v = view("all");
    for (const [lang, re] of [["en", /Running low/], ["zh", /即将用完/]]) {
        const btns = kbButtons(buildMyKeysKeyboard({ lang, filter: v.filter, counts: v.counts }));
        assert.ok(btns.some((b) => re.test(b.text)), `thiếu bản dịch ${lang}`);
    }
});

// === Nhãn trạng thái cho bảng admin =======================================
// Admin xử lý mỗi nhóm một kiểu, nên gộp hết thành "đã chết" là mất thông tin:
// hết quota → mời nạp token, hết hạn → mời gia hạn ngày, không thấy → cấp lại.
const life = (st) => keyLifecycle(st, NOW);

test("nhãn trạng thái phân biệt hết quota với hết hạn", () => {
    assert.equal(classifyKeyStatus(life({ quotaLimit: 1000, quotaUsed: 10, expiresAt: at(30) })), "active");
    assert.equal(classifyKeyStatus(life({ quotaLimit: 1000, quotaUsed: 850, expiresAt: at(30) })), "low");
    assert.equal(classifyKeyStatus(life({ quotaLimit: 1000, quotaUsed: 1000, expiresAt: at(30) })), "exhausted");
    assert.equal(classifyKeyStatus(life({ quotaLimit: 1000, quotaUsed: 10, expiresAt: at(-1) })), "expired");
});

test("còn ít ngày cũng là 'sắp hết', không chỉ mỗi trục quota", () => {
    assert.equal(classifyKeyStatus(life({ quotaLimit: 1000, quotaUsed: 10, expiresAt: at(2) })), "low");
});

test("key bị tắt và key đã bị xoá bên provider là hai nhãn KHÁC nhau", () => {
    // Tắt thì bật lại được; bị xoá thì phải cấp key mới. Gộp là chỉ admin sai việc.
    assert.equal(classifyKeyStatus(life({ quotaLimit: 1000, quotaUsed: 10, expiresAt: at(30) }), { enabled: false }), "disabled");
    assert.equal(classifyKeyStatus(life({ quotaLimit: 1000, quotaUsed: 10, expiresAt: at(30) }), { missing: true }), "missing");
});

test("vừa cạn quota vừa quá hạn → báo 'hết quota' (cái khách chạm trước)", () => {
    assert.equal(classifyKeyStatus(life({ quotaLimit: 1000, quotaUsed: 1000, expiresAt: at(-1) })), "exhausted");
});

test("key vô hạn quota, không hết hạn → 'còn dùng', không phải 'hết quota'", () => {
    assert.equal(classifyKeyStatus(life({ quotaLimit: 0, quotaUsed: 9e9, expiresAt: null })), "active");
});
