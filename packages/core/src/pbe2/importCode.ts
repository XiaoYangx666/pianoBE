import { crc32, crc32Hex } from "../midi/crc32.js";
import { decodeBase64Url, encodeBase64Url } from "./base64url.js";
import { readPbe2Header } from "./codec.js";

/** 导入码前缀（版本化，避免与普通文本混淆） */
export const IMPORT_CODE_PREFIX = "PBE2I1";
/** 单段完整文本建议上限（DDUI 实测单次输入 5000 字符） */
export const IMPORT_CHUNK_MAX_CHARS = 4800;
/** 分段头部预留字符数（id/序号/总数/校验和） */
const CHUNK_OVERHEAD = 64;

export interface ImportChunk {
    /** 曲目 id（PBE2 头部） */
    songId: string;
    /** 1 基序号 */
    index: number;
    total: number;
    /** 完整 PBE2 负载的 CRC32（16 进制） */
    checksum: string;
    /** 本段数据的 CRC32（16 进制） */
    chunkChecksum: string;
    /** 本段原始字节 */
    data: Uint8Array;
}

export interface ImportProgress {
    status: "accepted" | "duplicate" | "complete" | "ignored" | "error";
    /** 当前任务标识（songId/checksum） */
    taskId?: string;
    songId?: string;
    received: number;
    total: number;
    /** 还缺的分段序号（1 基） */
    missing: number[];
    /** 仅 complete 时提供完整 PBE2 */
    payload?: Uint8Array;
    error?: string;
}

/**
 * 把 PBE2 切成可粘贴的分段。
 * 每段 = 协议头 + 校验和 + Base64URL 数据，总长度不超过 maxChars。
 */
export function planImportChunks(
    pbe2: Uint8Array,
    maxChars = IMPORT_CHUNK_MAX_CHARS
): string[] {
    const header = readPbe2Header(pbe2);
    const checksum = crc32Hex(pbe2);
    const budget = Math.max(64, maxChars - CHUNK_OVERHEAD);
    const chunkBytes = Math.max(48, Math.floor((budget * 3) / 4) - 3);
    const total = Math.max(1, Math.ceil(pbe2.length / chunkBytes));
    const lines: string[] = [];
    for (let index = 1; index <= total; index++) {
        const start = (index - 1) * chunkBytes;
        const data = pbe2.subarray(start, Math.min(pbe2.length, start + chunkBytes));
        lines.push(
            `${IMPORT_CODE_PREFIX}.${header.id}.${index}/${total}.${checksum}.${crc32Hex(data)}.${encodeBase64Url(data)}`
        );
    }
    return lines;
}

/** 解析一段导入码；非本协议文本返回 undefined */
export function parseImportChunk(text: string): ImportChunk | undefined {
    const line = text.trim();
    if (!line.startsWith(`${IMPORT_CODE_PREFIX}.`)) return undefined;
    const parts = line.split(".");
    if (parts.length !== 6) return undefined;
    const [, songId, range, checksum, chunkChecksum, encoded] = parts;
    if (!songId || songId.length > 64 || !/^[0-9a-f]{1,8}$/i.test(checksum)) {
        return undefined;
    }
    if (!/^[0-9a-f]{1,8}$/i.test(chunkChecksum)) return undefined;
    const rangeMatch = /^(\d+)\/(\d+)$/.exec(range);
    if (!rangeMatch) return undefined;
    const index = Number(rangeMatch[1]);
    const total = Number(rangeMatch[2]);
    if (!Number.isInteger(index) || !Number.isInteger(total) || index < 1 || total < 1 || index > total) {
        return undefined;
    }
    let data: Uint8Array;
    try {
        data = decodeBase64Url(encoded);
    } catch {
        return undefined;
    }
    if (crc32Hex(data) !== chunkChecksum.toLowerCase()) return undefined;
    return {
        songId,
        index,
        total,
        checksum: checksum.toLowerCase(),
        chunkChecksum: chunkChecksum.toLowerCase(),
        data,
    };
}

interface ImportSession {
    key: string;
    songId: string;
    checksum: string;
    total: number;
    parts: Map<number, Uint8Array>;
    receivedBytes: number;
    lastAccess: number;
}

/**
 * 导入分段装配器：
 * - 按 songId + 完整校验和自动识别任务；
 * - 支持乱序、重复、中断后继续；
 * - 完成后校验总 CRC32 与 PBE2 头部。
 */
export class ImportAssembler {
    private readonly sessions = new Map<string, ImportSession>();
    private lastKey?: string;
    private readonly maxSessions: number;
    private readonly maxBytes: number;

    constructor(options: { maxSessions?: number; maxBytes?: number } = {}) {
        this.maxSessions = options.maxSessions ?? 8;
        this.maxBytes = options.maxBytes ?? 8 * 1024 * 1024;
    }

    add(text: string): ImportProgress {
        const chunk = parseImportChunk(text);
        if (!chunk) return this.progressFor(undefined, "ignored");
        const key = `${chunk.songId}:${chunk.checksum}`;
        let session = this.sessions.get(key);
        if (!session) {
            session = {
                key,
                songId: chunk.songId,
                checksum: chunk.checksum,
                total: chunk.total,
                parts: new Map(),
                receivedBytes: 0,
                lastAccess: Date.now(),
            };
            this.sessions.set(key, session);
            this.prune();
        } else if (session.total !== chunk.total) {
            return this.progressFor(session, "error", "分段总数不一致");
        }

        this.lastKey = key;
        session.lastAccess = Date.now();
        if (session.parts.has(chunk.index)) return this.progressFor(session, "duplicate");
        session.parts.set(chunk.index, chunk.data);
        session.receivedBytes += chunk.data.length;
        if (session.receivedBytes > this.maxBytes) {
            this.sessions.delete(key);
            return this.progressFor(undefined, "error", "导入数据超过大小限制");
        }
        if (session.parts.size < session.total) return this.progressFor(session, "accepted");

        const payload = this.join(session);
        if (!payload || crc32Hex(payload) !== session.checksum) {
            this.sessions.delete(key);
            return this.progressFor(session, "error", "完整数据校验失败，请重新导入");
        }
        try {
            const header = readPbe2Header(payload);
            if (header.id !== session.songId) {
                this.sessions.delete(key);
                return this.progressFor(session, "error", "曲目 id 与数据不一致");
            }
        } catch (error) {
            this.sessions.delete(key);
            return this.progressFor(session, "error", `PBE2 校验失败：${(error as Error).message}`);
        }
        this.sessions.delete(key);
        return {
            status: "complete",
            taskId: key,
            songId: session.songId,
            received: session.total,
            total: session.total,
            missing: [],
            payload,
        };
    }

    /** 当前/最近任务进度 */
    progress(): ImportProgress {
        return this.progressFor(this.lastKey ? this.sessions.get(this.lastKey) : undefined, "accepted");
    }

    /** 清空所有装配中的任务 */
    reset(): void {
        this.sessions.clear();
        this.lastKey = undefined;
    }

    private join(session: ImportSession): Uint8Array | undefined {
        let size = 0;
        for (const part of session.parts.values()) size += part.length;
        const out = new Uint8Array(size);
        let offset = 0;
        for (let index = 1; index <= session.total; index++) {
            const part = session.parts.get(index);
            if (!part) return undefined;
            out.set(part, offset);
            offset += part.length;
        }
        return out;
    }

    private progressFor(
        session: ImportSession | undefined,
        status: ImportProgress["status"],
        error?: string
    ): ImportProgress {
        if (!session) {
            return { status, received: 0, total: 0, missing: [], error };
        }
        const missing: number[] = [];
        for (let index = 1; index <= session.total; index++) {
            if (!session.parts.has(index)) missing.push(index);
        }
        return {
            status,
            taskId: session.key,
            songId: session.songId,
            received: session.parts.size,
            total: session.total,
            missing,
            error,
        };
    }

    private prune() {
        if (this.sessions.size <= this.maxSessions) return;
        const oldest = [...this.sessions.values()].sort((a, b) => a.lastAccess - b.lastAccess)[0];
        if (oldest) this.sessions.delete(oldest.key);
    }
}
