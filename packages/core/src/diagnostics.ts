/**
 * 轻量诊断出口：core / vfx 不直接绑定 console，宿主（addon / server / studio）
 * 可以把它们接到统一 logger 上，避免同一份代码在不同环境里输出格式不一致。
 */
export type DiagnosticLevel = "debug" | "info" | "warn" | "error";
export type DiagnosticFields = Record<string, unknown>;

export type DiagnosticSink = (
    level: DiagnosticLevel,
    scope: string,
    message: string,
    error?: unknown,
    fields?: DiagnosticFields
) => void;

let sink: DiagnosticSink | undefined;

/** 由宿主注入统一 logger；传 undefined 恢复默认 console 输出。 */
export function setDiagnosticSink(next: DiagnosticSink | undefined): void {
    sink = next;
}

function formatValue(value: unknown): string {
    if (value === undefined || value === null || value === "") return "";
    if (typeof value === "string") {
        const text = value.replace(/\r\n|\r|\n/g, "\\n");
        return text.length > 200 ? `${text.slice(0, 197)}…` : text;
    }
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    try {
        const text = JSON.stringify(value);
        return text.length > 200 ? `${text.slice(0, 197)}…` : text;
    } catch {
        return String(value);
    }
}

function formatFields(fields?: DiagnosticFields): string {
    if (!fields) return "";
    const parts: string[] = [];
    for (const [key, value] of Object.entries(fields)) {
        const text = formatValue(value);
        if (text) parts.push(`${key}=${text}`);
    }
    return parts.length ? ` | ${parts.join(" ")}` : "";
}

function formatError(error: unknown): string {
    if (error instanceof Error) return error.stack || `${error.name}: ${error.message}`;
    if (typeof error === "string") return error;
    try {
        return JSON.stringify(error);
    } catch {
        return String(error);
    }
}

/** 没有宿主 logger 时的兜底：与 addon 的 `[PBE][scope][LEVEL]` 前缀保持一致。 */
export function reportDiagnostic(
    level: DiagnosticLevel,
    scope: string,
    message: string,
    error?: unknown,
    fields?: DiagnosticFields
): void {
    if (sink) {
        sink(level, scope, message, error, fields);
        return;
    }
    const line = `[PBE][${scope}][${level.toUpperCase()}] ${message}${formatFields(fields)}`;
    const text = error === undefined ? line : `${line}\n${formatError(error)}`;
    if (level === "error") console.error(text);
    else if (level === "warn") console.warn(text);
    else console.log(text);
}
