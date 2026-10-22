import test from "node:test";
import assert from "node:assert/strict";
import {
    BANK_BINS,
    crc16Ccitt,
    buildVietQrString,
    extractImageFromResponse,
    fetchVietQrImageBuffer,
} from "../src/payment/vietqr.js";

test("BANK_BINS contains popular Vietnamese banks", () => {
    assert.equal(BANK_BINS.MB, "970422");
    assert.equal(BANK_BINS.VCB, "970436");
    assert.equal(BANK_BINS.TCB, "970407");
    assert.equal(BANK_BINS.ACB, "970416");
    assert.equal(BANK_BINS.BIDV, "970418");
});

test("crc16Ccitt calculates correct CRC16 for VietQR", () => {
    const raw = "00020101021238500010A0000007270120000697042201063213360208QRIBFTTA53037045405294515802VN62160812SHOP812865AE6304";
    const crc = crc16Ccitt(raw);
    assert.equal(crc, "C0F5");
});

test("buildVietQrString builds matching Napas EMVCo string", () => {
    const qrStr = buildVietQrString({
        bankBin: "970422",
        accountNumber: "321336",
        amount: 29451,
        content: "SHOP812865AE",
    });
    assert.equal(
        qrStr,
        "00020101021238500010A0000007270120000697042201063213360208QRIBFTTA53037045405294515802VN62160812SHOP812865AE6304C0F5"
    );
});

test("extractImageFromResponse extracts base64 PNG from SVG text", () => {
    // 1x1 transparent PNG base64
    const fakeBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
    const svgText = `<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/png;base64,${fakeBase64}"/></svg>`;
    const buf = extractImageFromResponse(svgText);
    assert.ok(buf);
    assert.equal(buf[0], 0x89);
    assert.equal(buf[1], 0x50);
    assert.equal(buf[2], 0x4e);
    assert.equal(buf[3], 0x47);
});

test("extractImageFromResponse extracts base64 PNG from SVG Buffer", () => {
    const fakeBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
    const svgBuffer = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/png;base64,${fakeBase64}"/></svg>`, "utf8");
    const buf = extractImageFromResponse(svgBuffer);
    assert.ok(buf);
    assert.equal(buf[0], 0x89);
});

test("extractImageFromResponse preserves pure PNG buffer", () => {
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const buf = extractImageFromResponse(pngHeader);
    assert.equal(buf, pngHeader);
});

test("fetchVietQrImageBuffer falls back to local generation when offline/invalid url", async () => {
    const buf = await fetchVietQrImageBuffer("http://invalid-url-that-does-not-exist.local/qr.png", {
        bankCode: "MB",
        accountNumber: "321336",
        amount: 50000,
        content: "SHOPTEST123",
    });
    assert.ok(buf);
    assert.ok(Buffer.isBuffer(buf));
    // Must be valid PNG buffer
    assert.equal(buf[0], 0x89);
    assert.equal(buf[1], 0x50);
    assert.equal(buf[2], 0x4e);
    assert.equal(buf[3], 0x47);
});

test("fetchVietQrImageBuffer parses params from vietqr URL on fallback", async () => {
    const url = "https://invalid-host-for-test.xyz/image/MB-321336-compact2.png?amount=100000&addInfo=SHOPTEST99";
    const buf = await fetchVietQrImageBuffer(url);
    assert.ok(buf);
    assert.ok(Buffer.isBuffer(buf));
    assert.equal(buf[0], 0x89);
    assert.equal(buf[1], 0x50);
});
