/**
 * 无依赖 Base64URL 编解码。
 * QuickJS / 浏览器 / Node 都能直接运行，不依赖 Buffer / btoa。
 */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const LOOKUP = new Int16Array(128).fill(-1);
for (let i = 0; i < ALPHABET.length; i++) LOOKUP[ALPHABET.charCodeAt(i)] = i;
// 兼容带 padding 的标准 Base64 输入
LOOKUP[0x2b] = 62; // '+'
LOOKUP[0x2f] = 63; // '/'

/** 字节数组 → Base64URL（无 padding） */
export function encodeBase64Url(bytes: Uint8Array): string {
    let out = "";
    const len = bytes.length;
    const full = len - (len % 3);
    for (let i = 0; i < full; i += 3) {
        const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
        out += ALPHABET[(n >>> 18) & 63];
        out += ALPHABET[(n >>> 12) & 63];
        out += ALPHABET[(n >>> 6) & 63];
        out += ALPHABET[n & 63];
    }
    const remain = len - full;
    if (remain === 1) {
        const n = bytes[full] << 16;
        out += ALPHABET[(n >>> 18) & 63];
        out += ALPHABET[(n >>> 12) & 63];
    } else if (remain === 2) {
        const n = (bytes[full] << 16) | (bytes[full + 1] << 8);
        out += ALPHABET[(n >>> 18) & 63];
        out += ALPHABET[(n >>> 12) & 63];
        out += ALPHABET[(n >>> 6) & 63];
    }
    return out;
}

/** Base64URL → 字节数组；非法字符抛错 */
export function decodeBase64Url(text: string): Uint8Array {
    const clean = text.replace(/[=\s]/g, "");
    const len = clean.length;
    if (len % 4 === 1) throw new Error("[pbe2] Base64URL 长度非法");
    const out = new Uint8Array(Math.floor((len * 3) / 4));
    let pos = 0;
    let buffer = 0;
    let bits = 0;
    for (let i = 0; i < len; i++) {
        const code = clean.charCodeAt(i);
        const value = code < 128 ? LOOKUP[code] : -1;
        if (value < 0) throw new Error(`[pbe2] Base64URL 字符非法 @${i}`);
        buffer = (buffer << 6) | value;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out[pos++] = (buffer >>> bits) & 0xff;
        }
    }
    return pos === out.length ? out : out.subarray(0, pos);
}
