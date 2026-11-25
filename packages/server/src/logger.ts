import {
    appendFileSync,
    existsSync,
    mkdirSync,
    renameSync,
    rmSync,
    statSync,
} from "node:fs";
import { dirname } from "node:path";

export interface LoggerOptions {
    /** 日志文件路径；不传则只输出到控制台 */
    file?: string;
    /** 单文件上限，超过后轮转为 .1/.2/…（默认 5 MB） */
    maxBytes?: number;
    /** 保留的历史文件数量（默认 3 个） */
    maxFiles?: number;
    /** 是否同时输出到控制台（默认 true，便于 docker logs / 开发时直接看） */
    console?: boolean;
}

export interface Logger {
    /** 实际使用的日志文件；undefined 表示仅控制台 */
    readonly file?: string;
    info(message: string): void;
    warn(message: string, error?: unknown): void;
    error(message: string, error?: unknown): void;
    /** 访问日志：非 /api/ 的成功静态资源不落盘，避免刷屏 */
    http(method: string, path: string, status: number, ms: number): void;
}

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_FILES = 3;

function pad(value: number, width = 2): string {
    return String(value).padStart(width, "0");
}

/** 本地时间 `2026-11-25 00:45:12.345`，跨平台且不受 locale 影响 */
export function formatTimestamp(date = new Date()): string {
    return (
        `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
        `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
        `.${pad(date.getMilliseconds(), 3)}`
    );
}

export function formatError(error: unknown): string {
    if (error instanceof Error) {
        return error.stack || `${error.name}: ${error.message}`;
    }
    if (typeof error === "string") return error;
    try {
        const text = JSON.stringify(error);
        return typeof text === "string" ? text : String(error);
    } catch {
        return String(error);
    }
}

class ServerLogger implements Logger {
    readonly file?: string;
    private size = 0;
    private readonly maxBytes: number;
    private readonly maxFiles: number;
    private readonly mirror: boolean;
    /** 只提示一次写盘失败，避免日志本身刷屏 */
    private fallbackNoticed = false;

    constructor(options: LoggerOptions = {}) {
        this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
        this.maxFiles = Math.max(1, options.maxFiles ?? DEFAULT_MAX_FILES);
        this.mirror = options.console !== false;

        const file = options.file?.trim();
        if (file) {
            try {
                mkdirSync(dirname(file), { recursive: true });
                this.size = existsSync(file) ? statSync(file).size : 0;
                this.file = file;
            } catch (error) {
                this.fallbackNoticed = true;
                console.warn(
                    `[日志] 无法创建 ${file}，本次仅输出到控制台: ${formatError(error)}`
                );
            }
        }
    }

    info(message: string): void {
        this.emit("INFO", message);
    }

    warn(message: string, error?: unknown): void {
        this.emit("WARN", message, error);
    }

    error(message: string, error?: unknown): void {
        this.emit("ERROR", message, error);
    }

    http(method: string, path: string, status: number, ms: number): void {
        if (!path.startsWith("/api/") && status < 400) return;
        this.emit("HTTP", `${method} ${path} ${status} ${ms}ms`);
    }

    private emit(tag: string, message: string, error?: unknown): void {
        const lines = [`[${formatTimestamp()}] [${tag}] ${message}`];
        if (error !== undefined) {
            lines.push(...formatError(error).split(/\r?\n/));
        }
        const text = lines.join("\n");

        if (this.mirror) {
            const line = text;
            if (tag === "ERROR") console.error(line);
            else if (tag === "WARN") console.warn(line);
            else console.log(line);
        }

        this.append(`${text}\n`);
    }

    private append(text: string): void {
        if (!this.file) return;
        const bytes = Buffer.byteLength(text);
        try {
            if (this.size > 0 && this.size + bytes > this.maxBytes) {
                this.rotate();
            }
            appendFileSync(this.file, text);
            this.size += bytes;
        } catch (error) {
            if (!this.fallbackNoticed) {
                this.fallbackNoticed = true;
                console.warn(
                    `[日志] 写入 ${this.file} 失败，后续仅输出到控制台: ${formatError(error)}`
                );
            }
        }
    }

    /** 轮转失败不阻断后续写入，下次超限时再试 */
    private rotate(): void {
        const file = this.file;
        if (!file) return;
        try {
            rmSync(`${file}.${this.maxFiles}`, { force: true });
            for (let i = this.maxFiles - 1; i >= 1; i--) {
                if (existsSync(`${file}.${i}`)) {
                    renameSync(`${file}.${i}`, `${file}.${i + 1}`);
                }
            }
            if (existsSync(file)) renameSync(file, `${file}.1`);
        } catch {
            // Windows 上文件被占用等情况：继续追加，交给下次轮转
        }
        this.size = 0;
    }
}

/** 测试/未配置日志时的空实现，避免写盘 */
export const NOOP_LOGGER: Logger = {
    file: undefined,
    info() {},
    warn() {},
    error() {},
    http() {},
};

export function createLogger(options: LoggerOptions = {}): Logger {
    return new ServerLogger(options);
}
