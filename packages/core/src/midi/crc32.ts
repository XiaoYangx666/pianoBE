const TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    TABLE[i] = c >>> 0;
}

/** 标准 CRC-32（IEEE 802.3，与 crc 包的 crc32 / crc-32 包的 CRC32.buf 输出一致），返回无符号 32 位整数 */
export function crc32(data: Uint8Array): number {
    let crc = 0xffffffff;
    for (let i = 0; i < data.length; i++) {
        crc = TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

/** crc32 → 16 进制小写字符串（曲目 id 格式） */
export function crc32Hex(data: Uint8Array): string {
    return crc32(data).toString(16);
}