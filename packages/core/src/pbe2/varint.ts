/** 无符号 LEB128（VarInt）读写。事件流的时间差、音符数、时长均使用此编码。 */

export interface VarintResult {
    value: number;
    next: number;
}

/** 写一个无符号 VarInt，返回写入后的偏移 */
export function writeVarUint(out: Uint8Array, offset: number, value: number): number {
    let v = value >>> 0;
    while (v >= 0x80) {
        out[offset++] = (v & 0x7f) | 0x80;
        v >>>= 7;
    }
    out[offset++] = v;
    return offset;
}

/** 计算无符号 VarInt 的字节数 */
export function varUintSize(value: number): number {
    let v = value >>> 0;
    let size = 1;
    while (v >= 0x80) {
        v >>>= 7;
        size++;
    }
    return size;
}

/**
 * 读取无符号 VarInt。
 * 调用方可复用 `out` 对象，避免高频解码时产生大量临时对象。
 * 数据被截断或超过 5 字节（32 位）时抛错。
 */
export function readVarUint(
    data: Uint8Array,
    offset: number,
    out: VarintResult,
    end = data.length
): VarintResult {
    let value = 0;
    let shift = 0;
    let pos = offset;
    while (pos < end) {
        const byte = data[pos++];
        value |= (byte & 0x7f) << shift;
        if ((byte & 0x80) === 0) {
            out.value = value >>> 0;
            out.next = pos;
            return out;
        }
        shift += 7;
        if (shift > 28) break;
    }
    throw new Error(`[pbe2] VarInt 数据损坏 @${offset}`);
}

/** 读取并返回新对象（低频场景用） */
export function readVarUintAt(data: Uint8Array, offset: number, end = data.length): VarintResult {
    return readVarUint(data, offset, { value: 0, next: 0 }, end);
}
