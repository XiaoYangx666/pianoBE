import { crc32Hex } from "../midi/crc32.js";
import { encodeBase64Url } from "../pbe2/base64url.js";
import { readAllPbe2Notes, readPbe2Events, readPbe2Header } from "../pbe2/codec.js";
import type { Pbe2Header } from "../pbe2/format.js";
import {
    DEFAULT_MUSIC_LIMITS,
    MUSIC_ENTRY_ID_PATTERN,
    type MusicStorageLimits,
} from "./limits.js";

export { MUSIC_ENTRY_ID_PATTERN } from "./limits.js";

/** 可直接展示给玩家的校验错误。 */
export class MusicValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "MusicValidationError";
    }
}

export interface ValidatedMusic {
    header: Pbe2Header;
    /** 整份 PBE2 的 CRC32（16 进制） */
    checksum: string;
    /** Base64URL 编码后的长度（写盘计费用） */
    encoded: string;
}

export function isValidMusicId(id: unknown): id is string {
    return typeof id === "string" && MUSIC_ENTRY_ID_PATTERN.test(id);
}

/**
 * 写入前的完整校验：结构、CRC、解压安全、音符数量。
 * 任何一项失败都抛 MusicValidationError（中文提示可直接展示），不写半成品。
 */
export function validateMusic(
    pbe2: Uint8Array,
    limits: MusicStorageLimits = DEFAULT_MUSIC_LIMITS
): ValidatedMusic {
    if (!pbe2 || pbe2.length === 0) throw new MusicValidationError("曲目数据为空");
    if (pbe2.length > limits.maxSongBytes) {
        throw new MusicValidationError(
            `曲目超过单曲上限 ${(limits.maxSongBytes / 1024 / 1024).toFixed(0)}MB`
        );
    }
    let header: Pbe2Header;
    try {
        header = readPbe2Header(pbe2);
    } catch {
        throw new MusicValidationError("不是有效的 PBE2 曲目数据");
    }
    if (!isValidMusicId(header.id)) throw new MusicValidationError("曲目 id 非法");
    if (header.noteCount <= 0) throw new MusicValidationError("曲目没有音符");
    if (header.noteCount > limits.maxNotes) throw new MusicValidationError("音符数量超过上限");
    if (header.duration < 0 || header.duration > limits.maxDurationTicks) {
        throw new MusicValidationError("曲目时长超出允许范围");
    }
    if (header.uncompressedLength > limits.maxEventBytes) {
        throw new MusicValidationError("曲目解压长度超出允许范围");
    }
    let events: Uint8Array;
    try {
        events = readPbe2Events(pbe2).events;
    } catch {
        throw new MusicValidationError("曲目数据损坏（事件流无法解压）");
    }
    if (readAllPbe2Notes(events, header.hasVelocity).length !== header.noteCount) {
        throw new MusicValidationError("曲目音符数量校验失败");
    }
    return { header, checksum: crc32Hex(pbe2), encoded: encodeBase64Url(pbe2) };
}
