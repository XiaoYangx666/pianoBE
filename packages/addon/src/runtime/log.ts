/**
 * addon 运行时统一日志出口。
 *
 * 目标：
 * - 所有模块共用 `[PBE][scope][LEVEL] message | k=v` 格式，BDS 控制台里可按 scope 过滤；
 * - 默认只输出 info/warn/error，逐请求、逐曲目的细节走 debug，避免刷屏；
 * - 同一个 warn/error 在短时间内重复出现时只保留一条，并带上 `repeated=N`；
 * - 错误统一展开 name/message/stack，不再出现 `[object Object]` 或只剩 message。
 */

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

const LEVEL_ORDER: Record<LogLevel, number> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
};

/** 重复 warn/error 的合并窗口 */
const REPEAT_WINDOW_MS = 10_000;
/** 单条错误堆栈最多保留的行数，避免一次异常刷满控制台 */
const MAX_STACK_LINES = 8;
/** 参与去重身份判断的字段：同一对象重复报错合并，不同曲目/钢琴分别保留 */
const IDENTITY_FIELDS = ["song", "piano", "player", "job", "perf", "plugin", "effect", "boundary"];

let minLevel: LogLevel = "info";

const lastEmitAt = new Map<string, number>();
const suppressed = new Map<string, number>();

export function setLogLevel(level: LogLevel): void {
    minLevel = level;
}

export function getLogLevel(): LogLevel {
    return minLevel;
}

const SECRET_KEY_PATTERN = /(?:token|secret|password|passwd|authorization|cookie|sessdata)/i;

const SECRET_PATTERNS: Array<[RegExp, string]> = [
    [/(\bBearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, "$1***"],
    [/(\bSESSDATA=)[^;\s&]+/gi, "$1***"],
    [/(\b(?:token|access_token|api_key|apikey|secret|password)=)[^&\s]+/gi, "$1***"],
];

function redact(text: string): string {
    let value = text;
    for (const [pattern, replacement] of SECRET_PATTERNS) value = value.replace(pattern, replacement);
    return value;
}

function formatValue(value: unknown): string | undefined {
    if (value === undefined || value === null || value === "") return undefined;
    if (typeof value === "string") {
        const text = redact(value.length > 200 ? `${value.slice(0, 197)}…` : value);
        return /[\s|"=]/.test(text) ? JSON.stringify(text) : text;
    }
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    try {
        const text = redact(JSON.stringify(value));
        return text.length > 200 ? `${text.slice(0, 197)}…` : text;
    } catch {
        return String(value);
    }
}

function formatFields(fields?: LogFields): string {
    if (!fields) return "";
    const parts: string[] = [];
    for (const [key, value] of Object.entries(fields)) {
        if (value === undefined || value === null || value === "") continue;
        const text = SECRET_KEY_PATTERN.test(key) ? "***" : formatValue(value);
        if (text !== undefined) parts.push(`${key}=${text}`);
    }
    return parts.length ? ` | ${parts.join(" ")}` : "";
}

function formatError(error: unknown): string {
    if (error instanceof Error) {
        const text = error.stack || `${error.name}: ${error.message}`;
        const lines = text.split(/\r?\n/).slice(0, MAX_STACK_LINES);
        if (text.split(/\r?\n/).length > MAX_STACK_LINES) lines.push("  ...");
        return redact(lines.join("\n"));
    }
    if (typeof error === "string") return redact(error);
    try {
        return redact(JSON.stringify(error));
    } catch {
        return String(error);
    }
}

function emit(
    level: LogLevel,
    scope: string,
    message: string,
    error?: unknown,
    fields?: LogFields
): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;

    let merged = fields;
    if (level === "warn" || level === "error") {
        const identity = fields
            ? IDENTITY_FIELDS.map((name) => fields[name])
                  .filter((value) => value !== undefined && value !== null && value !== "")
                  .join("|")
            : "";
        const key = `${scope}|${level}|${message}|${identity}`;
        const now = Date.now();
        // 长时间运行时清理过期键，避免曲目/玩家 ID 持续增长导致 Map 无界
        if (lastEmitAt.size > 512) {
            const cutoff = now - REPEAT_WINDOW_MS * 6;
            for (const [stale, at] of lastEmitAt) {
                if (at < cutoff) {
                    lastEmitAt.delete(stale);
                    suppressed.delete(stale);
                }
            }
        }
        const last = lastEmitAt.get(key) ?? 0;
        if (now - last < REPEAT_WINDOW_MS) {
            suppressed.set(key, (suppressed.get(key) ?? 0) + 1);
            return;
        }
        lastEmitAt.set(key, now);
        const skipped = suppressed.get(key);
        if (skipped) {
            suppressed.delete(key);
            merged = { ...fields, repeated: skipped + 1 };
        }
    }

    const head =
        `[PBE][${scope}][${level.toUpperCase()}] ` +
        redact(message).replace(/\r\n|\r|\n/g, "\\n") +
        formatFields(merged);
    const text = error === undefined ? head : `${head}\n${formatError(error)}`;
    if (level === "error") console.error(text);
    else if (level === "warn") console.warn(text);
    else console.log(text);
}

export interface PianoLogger {
    readonly scope: string;
    readonly level: LogLevel;
    debug(message: string, fields?: LogFields): void;
    info(message: string, fields?: LogFields): void;
    warn(message: string, error?: unknown, fields?: LogFields): void;
    error(message: string, error?: unknown, fields?: LogFields): void;
    child(name: string, fields?: LogFields): PianoLogger;
}

class ScopedLogger implements PianoLogger {
    constructor(
        readonly scope: string,
        private readonly fields: LogFields = {}
    ) {}

    get level(): LogLevel {
        return minLevel;
    }

    debug(message: string, fields?: LogFields): void {
        emit("debug", this.scope, message, undefined, { ...this.fields, ...fields });
    }

    info(message: string, fields?: LogFields): void {
        emit("info", this.scope, message, undefined, { ...this.fields, ...fields });
    }

    warn(message: string, error?: unknown, fields?: LogFields): void {
        emit("warn", this.scope, message, error, { ...this.fields, ...fields });
    }

    error(message: string, error?: unknown, fields?: LogFields): void {
        emit("error", this.scope, message, error, { ...this.fields, ...fields });
    }

    child(name: string, fields?: LogFields): PianoLogger {
        return new ScopedLogger(`${this.scope}.${name}`, { ...this.fields, ...fields });
    }
}

export function createLogger(scope: string, fields?: LogFields): PianoLogger {
    return new ScopedLogger(scope, fields);
}

/** 接住 core / vfx 通过 `setDiagnosticSink` 上报的诊断。 */
export function routeDiagnostic(
    level: LogLevel,
    scope: string,
    message: string,
    error?: unknown,
    fields?: LogFields
): void {
    emit(level, scope, message, error, fields);
}
