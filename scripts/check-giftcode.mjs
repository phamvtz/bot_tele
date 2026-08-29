// Kiểm tra nhanh module giftcode: import được, helper thuần hoạt động đúng.
// Không kết nối DB, không tạo mã thật.
import { normalizeGiftCode, generateGiftCode, GiftCodeError } from "../src/giftcode.js";

let failed = 0;
function check(label, actual, expected) {
    const ok = actual === expected;
    if (!ok) failed++;
    console.log(`${ok ? "✅" : "❌"} ${label}: ${JSON.stringify(actual)}${ok ? "" : ` (mong đợi ${JSON.stringify(expected)})`}`);
}

check("normalize trim+upper", normalizeGiftCode("  tet2026 "), "TET2026");
check("normalize bỏ space giữa", normalizeGiftCode("gift abc 123"), "GIFTABC123");
check("normalize null", normalizeGiftCode(null), "");

const gen = generateGiftCode("TET", 8);
check("generate độ dài", gen.length, 11);
check("generate prefix", gen.startsWith("TET"), true);
check("generate không có ký tự dễ nhầm", /[IO01]/.test(gen.slice(3)), false);

const codes = new Set();
for (let i = 0; i < 500; i++) codes.add(generateGiftCode("G", 8));
check("generate hiếm trùng trong 500 lần", codes.size > 495, true);

check("enum có ALREADY_USED", GiftCodeError.ALREADY_USED, "ALREADY_USED");

console.log(failed ? `\n${failed} kiểm tra thất bại` : "\nTất cả kiểm tra đạt");
process.exit(failed ? 1 : 0);
