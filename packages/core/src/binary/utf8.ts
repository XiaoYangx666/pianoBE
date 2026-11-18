/**
 * 纯 JS UTF-8 编解码。
 * BDS/QuickJS 不提供 TextEncoder / TextDecoder，格式层不能依赖宿主全局。
 */

/** 字符串 → UTF-8 字节（孤立代理项替换为 U+FFFD） */
export function encodeUtf8(value: string): Uint8Array {
    const input = value ?? "";
    const bytes: number[] = [];
    for (let i = 0; i < input.length; i++) {
        let code = input.charCodeAt(i);
        if (code >= 0xd800 && code <= 0xdbff) {
            const next = i + 1 < input.length ? input.charCodeAt(i + 1) : 0;
            if (next >= 0xdc00 && next <= 0xdfff) {
                code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
                i++;
            } else {
                code = 0xfffd;
            }
        } else if (code >= 0xdc00 && code <= 0xdfff) {
            code = 0xfffd;
        }

        if (code < 0x80) {
            bytes.push(code);
        } else if (code < 0x800) {
            bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
        } else if (code < 0x10000) {
            bytes.push(
                0xe0 | (code >> 12),
                0x80 | ((code >> 6) & 0x3f),
                0x80 | (code & 0x3f)
            );
        } else {
            bytes.push(
                0xf0 | (code >> 18),
                0x80 | ((code >> 12) & 0x3f),
                0x80 | ((code >> 6) & 0x3f),
                0x80 | (code & 0x3f)
            );
        }
    }
    return Uint8Array.from(bytes);
}

/** UTF-8 字节 → 字符串（非法序列替换为 U+FFFD） */
export function decodeUtf8(bytes: Uint8Array): string {
    let out = "";
    for (let i = 0; i < bytes.length; ) {
        const first = bytes[i++];
        let code: number;
        if (first < 0x80) {
            code = first;
        } else if (first >= 0xc2 && first <= 0xdf) {
            const b1 = bytes[i++];
            code = ((first & 0x1f) << 6) | (b1 & 0x3f);
            if ((b1 & 0xc0) !== 0x80) code = 0xfffd;
        } else if (first >= 0xe0 && first <= 0xef) {
            const b1 = bytes[i++];
            const b2 = bytes[i++];
            code = ((first & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f);
            if ((b1 & 0xc0) !== 0x80 || (b2 & 0xc0) !== 0x80) code = 0xfffd;
            if (code >= 0xd800 && code <= 0xdfff) code = 0xfffd;
        } else if (first >= 0xf0 && first <= 0xf4) {
            const b1 = bytes[i++];
            const b2 = bytes[i++];
            const b3 = bytes[i++];
            code =
                ((first & 0x07) << 18) |
                ((b1 & 0x3f) << 12) |
                ((b2 & 0x3f) << 6) |
                (b3 & 0x3f);
            if ((b1 & 0xc0) !== 0x80 || (b2 & 0xc0) !== 0x80 || (b3 & 0xc0) !== 0x80) {
                code = 0xfffd;
            }
            if (code < 0x10000 || code > 0x10ffff) code = 0xfffd;
        } else {
            code = 0xfffd;
        }

        if (code <= 0xffff) {
            out += String.fromCharCode(code);
        } else {
            const value = code - 0x10000;
            out += String.fromCharCode(0xd800 + (value >> 10), 0xdc00 + (value & 0x3ff));
        }
    }
    return out;
}
