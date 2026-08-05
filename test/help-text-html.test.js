import test from "node:test";
import assert from "node:assert/strict";

// Bug that hit production: helpBuyingText was authored in Markdown and contained
// `/order <mã>`. The HELP:* handlers pass no parse_mode, and safeEditOrReply
// defaults to parse_mode "HTML" — so Telegram read `<mã>` as an unknown start tag
// and 400'd. Worse, "can't parse entities" is not in EDIT_FALLBACK_ERRORS, so the
// fallback re-sent the same bad payload and rethrew: the help screen just never
// appeared. These strings must be valid HTML because that is what actually gets sent.

const KEYS = ["helpBuyingText", "helpPaymentText", "helpReferralText", "helpWalletText"];
const LANGS = ["vi", "en", "zh"];
const TAGS = ["b", "i", "u", "s", "code", "pre"];

const dicts = {};
for (const lang of LANGS) {
    const mod = await import(`../src/i18n/${lang}.js`);
    dicts[lang] = mod.default || mod;
}

function eachHelpString(fn) {
    for (const lang of LANGS) {
        for (const key of KEYS) {
            fn(dicts[lang][key], `${lang}.${key}`);
        }
    }
}

test("moi chuoi help deu ton tai", () => {
    eachHelpString((text, where) => {
        assert.equal(typeof text, "string", `${where} phai la string`);
        assert.ok(text.length > 0, `${where} khong duoc rong`);
    });
});

test("khong con cu phap Markdown sot lai (se hien tho ra cho khach)", () => {
    eachHelpString((text, where) => {
        assert.ok(!text.includes("*"), `${where} con dau * cua Markdown`);
        assert.ok(!/(^|[^\w])_|_([^\w]|$)/.test(text), `${where} con dau _ cua Markdown`);
    });
});

test("khong con < hoac > chua escape — day la nguyen nhan loi 400 tren production", () => {
    const validTag = new RegExp(`</?(${TAGS.join("|")})>`, "g");
    eachHelpString((text, where) => {
        const stripped = text.replace(validTag, "");
        assert.ok(!/[<>]/.test(stripped), `${where} con < hoac > chua escape thanh &lt; / &gt;`);
    });
});

test("the HTML dong mo can bang", () => {
    eachHelpString((text, where) => {
        for (const tag of TAGS) {
            const open = (text.match(new RegExp(`<${tag}>`, "g")) || []).length;
            const close = (text.match(new RegExp(`</${tag}>`, "g")) || []).length;
            assert.equal(open, close, `${where} the <${tag}> lech: ${open} mo / ${close} dong`);
        }
    });
});

test("khong lot ky tu hong U+FFFD (tung co mot emoji vo trong vi.helpPaymentText)", () => {
    eachHelpString((text, where) => {
        assert.ok(!text.includes("�"), `${where} chua ky tu thay the U+FFFD`);
    });
});
