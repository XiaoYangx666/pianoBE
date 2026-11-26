import {
    appendFileSync,
    existsSync,
    mkdirSync,
    renameSync,
    rmSync,
    statSync,
} from "node:fs";
import { dirname } from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFormat = "text" | "json";
export type LogFields = Record<string, unknown>;

export interface LoggerOptions {
    /** 日志文件路径；不传则只输出到控制台 */
    file?: string;
    /** 最低输出级别（默认 info） */
    level?: LogLevel;
    /** 文件格式：text（默认，便于直接看）或 json（一行一条，便于检索） */
    format?: LogFormat;
    /** 单文件上限，超过后轮转为 .1/.2/…（默认 10 MB） */
    maxBytes?: number;
    /** 保留的历史文件数量（默认 7 个） */
    maxFiles?: number;
    /** 是否同时输出到控制台（默认 true，便于 docker logs / 开发时直接看） */
    console?: boolean;
}

export interface Logger {
    /** 实际使用的日志文件；undefined 表示仅控制台 */
    readonly file?: string;
    readonly level: LogLevel;
    debug(message: string, fields?: LogFields): void;
    info(message: string, fields?: LogFields): void;
    warn(message: string, error?: unknown, fields?: LogFields): void;
    error(message: string, error?: unknown, fields?: LogFields): void;
    /** 访问日志：非 /api/ 的成功静态资源不落盘，避免刷屏 */
    http(method: string, path: string, status: number, ms: number, fields?: LogFields): void;
    /** 带固定模块名的子 logger；字段会与父 logger 合并 */
    scope(name: string, fields?: LogFields): Logger;
}

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_FILES = 7;

const LEVEL_ORDER: Record<LogLevel, number> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
};

/** json 输出的保留字段；业务字段同名时不允许覆盖 */
const JSON_RESERVED_KEYS = new Set(["time", "level", "msg", "scope", "err"]);

function pad(value: number, width = 2): string {
    return String(value).padStart(width, "0");
}

/** 文本日志的第一行必须可单独 grep：消息里的换行转成字面量 */
function oneLine(text: string): string {
    return text.replace(/\r\n|\r|\n/g, "\\n");
}

/** 本地时间 `2026-11-25 00:45:12.345`，跨平台且不受 locale 影响 */
export function formatTimestamp(date = new Date()): string {
    return (
        `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
        `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
        `.${pad(date.getMilliseconds(), 3)}`
    );
}

const SECRET_PATTERNS: Array<[RegExp, string]> = [
    [/(\bBearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, "$1***"],
    [/(\bSESSDATA=)[^;\s&]+/gi, "$1***"],
    [/(\b(?:token|access_token|api_key|apikey|secret|password)=)[^&\s]+/gi, "$1***"],
];

const SECRET_KEY_PATTERN = /(?:token|secret|password|passwd|authorization|cookie|sessdata)/i;

/** 把 Bearer / SESSDATA / token=… 这类内容替换掉，避免错误对象把凭据带进日志 */
export function redactSecrets(text: string): string {
    let value = text;
    for (const [pattern, replacement] of SECRET_PATTERNS) {
        value = value.replace(pattern, replacement);
    }
    return value;
}

function redactField(key: string, value: unknown): unknown {
    if (SECRET_KEY_PATTERN.test(key)) return "***";
    if (typeof value === "string") return redactSecrets(value);
    return value;
}

export function formatError(error: unknown, depth = 0): string {
    if (error instanceof Error) {
        const text = redactSecrets(error.stack || `${error.name}: ${error.message}`);
        if (depth < 3 && error.cause !== undefined && !text.includes("Caused by:")) {
            return `${text}\nCaused by: ${formatError(error.cause, depth + 1)}`;
        }
        return text;
    }
    if (typeof error === "string") return redactSecrets(error);
    try {
        const text = JSON.stringify(error);
        return typeof text === "string" ? redactSecrets(text) : String(error);
    } catch {
        return String(error);
    }
}

function errorToJson(error: unknown, depth = 0): unknown {
    if (error instanceof Error) {
        const record: Record<string, unknown> = {
            name: error.name,
            message: redactSecrets(error.message),
            stack: error.stack ? redactSecrets(error.stack) : undefined,
        };
        if (error.cause !== undefined && depth < 3) {
            record.cause = errorToJson(error.cause, depth + 1);
        }
        return record;
    }
    if (typeof error === "string") return redactSecrets(error);
    if (error === undefined || error === null) return error;
    return safeValue(error, depth);
}

function safeValue(value: unknown, depth = 0): unknown {
    if (depth > 3) return "[depth limit]";
    if (typeof value === "bigint") return value.toString();
    if (typeof value === "string") {
        const text = redactSecrets(value);
        return text.length > 500 ? `${text.slice(0, 497)}…` : text;
    }
    if (typeof value !== "object" || value === null) return value;
    if (Array.isArray(value)) return value.slice(0, 20).map((item) => safeValue(item, depth + 1));
    const record: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
        record[key] = redactField(key, safeValue(item, depth + 1));
    }
    return record;
}

function formatFieldValue(value: unknown): string | undefined {
    if (value === undefined || value === null || value === "") return undefined;
    if (typeof value === "string") {
        const text = value.length > 300 ? `${value.slice(0, 297)}…` : value;
        return /[\s|"=]/.test(text) ? JSON.stringify(text) : text;
    }
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    const text = oneLine(formatError(value));
    return text.length > 300 ? `${text.slice(0, 297)}…` : text;
}

function formatFields(fields: LogFields): string {
    const parts: string[] = [];
    for (const [key, raw] of Object.entries(fields)) {
        if (raw === undefined || raw === null || raw === "") continue;
        const value = redactField(key, raw);
        const text = formatFieldValue(value);
        if (text !== undefined) parts.push(`${key}=${text}`);
    }
    return parts.length ? ` | ${parts.join(" ")}` : "";
}

export function parseLogLevel(value: string | undefined): LogLevel {
    const level = value?.trim().toLowerCase();
    return level === "debug" || level === "warn" || level === "error" ? level : "info";
}

export function parseLogFormat(value: string | undefined): LogFormat {
    return value?.trim().toLowerCase() === "json" ? "json" : "text";
}

interface LoggerState {
    file?: string;
    size: number;
    maxBytes: number;
    maxFiles: number;
    mirror: boolean;
    level: LogLevel;
    format: LogFormat;
    /** 只提示一次写盘失败，避免日志本身刷屏 */
    fallbackNoticed: boolean;
}

class ServerLogger implements Logger {
    private readonly state: LoggerState;
    private readonly scopeName?: string;
    private readonly boundFields: LogFields;

    constructor(state: LoggerState, scopeName?: string, boundFields: LogFields = {}) {
        this.state = state;
        this.scopeName = scopeName;
        this.boundFields = boundFields;
    }

    get file(): string | undefined {
        return this.state.file;
    }

    get level(): LogLevel {
        return this.state.level;
    }

    debug(message: string, fields?: LogFields): void {
        this.emit("debug", message, undefined, fields);
    }

    info(message: string, fields?: LogFields): void {
        this.emit("info", message, undefined, fields);
    }

    warn(message: string, error?: unknown, fields?: LogFields): void {
        this.emit("warn", message, error, fields);
    }

    error(message: string, error?: unknown, fields?: LogFields): void {
        this.emit("error", message, error, fields);
    }

    http(method: string, path: string, status: number, ms: number, fields?: LogFields): void {
        if (!path.startsWith("/api/") && status < 400) return;
        // 管理页轮询任务状态：成功请求降到 debug，避免几秒一条把有用信息冲掉
        const polling = method === "GET" && /^\/api\/transcribe\/jobs\/[^/]+$/.test(path);
        const level: LogLevel = status >= 500 ? "error" : status >= 400 ? "warn" : polling ? "debug" : "info";
        this.emit(level, `${method} ${path} ${status} ${ms}ms`, undefined, fields);
    }

    scope(name: string, fields?: LogFields): Logger {
        const scope = this.scopeName ? `${this.scopeName}.${name}` : name;
        return new ServerLogger(this.state, scope, { ...this.boundFields, ...fields });
    }

    private emit(level: LogLevel, message: string, error?: unknown, fields?: LogFields): void {
        if (LEVEL_ORDER[level] < LEVEL_ORDER[this.state.level]) return;

        const merged: LogFields = { ...this.boundFields, ...fields };
        const text =
            this.state.format === "json"
                ? this.toJson(level, message, error, merged)
                : this.toText(level, message, error, merged);

        if (this.state.mirror) {
            const line = text;
            if (level === "error") console.error(line);
            else if (level === "warn") console.warn(line);
            else console.log(line);
        }

        this.append(`${text}\n`);
    }

    private toText(level: LogLevel, message: string, error: unknown, fields: LogFields): string {
        const scope = this.scopeName ? ` [${this.scopeName}]` : "";
        const head = `[${formatTimestamp()}] [${level.toUpperCase()}]${scope} ${oneLine(redactSecrets(message))}`;
        const lines = [`${head}${formatFields(fields)}`];
        if (error !== undefined) lines.push(...formatError(error).split(/\r?\n/));
        return lines.join("\n");
    }

    private toJson(level: LogLevel, message: string, error: unknown, fields: LogFields): string {
        const record: Record<string, unknown> = {
            time: formatTimestamp(),
            level,
            msg: redactSecrets(message),
        };
        if (this.scopeName) record.scope = this.scopeName;
        for (const [key, value] of Object.entries(fields)) {
            if (value === undefined || value === null || value === "") continue;
            // time/level/msg/scope/err 是保留字段：业务字段同名时不能覆盖真实级别
            if (JSON_RESERVED_KEYS.has(key)) continue;
            record[key] = redactField(key, safeValue(value));
        }
        if (error !== undefined) record.err = errorToJson(error);
        try {
            return JSON.stringify(record);
        } catch {
            return JSON.stringify({ time: record.time, level, msg: record.msg, err: "序列化失败" });
        }
    }

    private append(text: string): void {
        const file = this.state.file;
        if (!file) return;
        const bytes = Buffer.byteLength(text);
        try {
            if (this.state.size > 0 && this.state.size + bytes > this.state.maxBytes) {
                this.rotate(file);
            }
            appendFileSync(file, text);
            this.state.size += bytes;
        } catch (error) {
            if (!this.state.fallbackNoticed) {
                this.state.fallbackNoticed = true;
                console.warn(
                    `[日志] 写入 ${file} 失败，后续仅输出到控制台: ${formatError(error)}`
                );
            }
        }
    }

    /** 轮转失败不阻断后续写入，下次超限时再试 */
    private rotate(file: string): void {
        try {
            rmSync(`${file}.${this.state.maxFiles}`, { force: true });
            for (let i = this.state.maxFiles - 1; i >= 1; i--) {
                if (existsSync(`${file}.${i}`)) {
                    renameSync(`${file}.${i}`, `${file}.${i + 1}`);
                }
            }
            if (existsSync(file)) renameSync(file, `${file}.1`);
        } catch {
            // Windows 上文件被占用等情况：继续追加，交给下次轮转
        }
        this.state.size = 0;
    }
}

/** 测试/未配置日志时的空实现，避免写盘 */
class NoopLogger implements Logger {
    readonly file = undefined;
    readonly level: LogLevel = "error";
    debug(): void {}
    info(): void {}
    warn(): void {}
    error(): void {}
    http(): void {}
    scope(): Logger {
        return this;
    }
}

export const NOOP_LOGGER: Logger = new NoopLogger();

export function createLogger(options: LoggerOptions = {}): Logger {
    const state: LoggerState = {
        maxBytes: options.maxBytes ?? DEFAULT_MAX_BYTES,
        maxFiles: Math.max(1, options.maxFiles ?? DEFAULT_MAX_FILES),
        mirror: options.console !== false,
        level: options.level ?? "info",
        format: options.format ?? "text",
        fallbackNoticed: false,
        size: 0,
    };

    const file = options.file?.trim();
    if (file) {
        try {
            mkdirSync(dirname(file), { recursive: true });
            state.size = existsSync(file) ? statSync(file).size : 0;
            state.file = file;
        } catch (error) {
            state.fallbackNoticed = true;
            console.warn(
                `[日志] 无法创建 ${file}，本次仅输出到控制台: ${formatError(error)}`
            );
        }
    }

    return new ServerLogger(state);
}
