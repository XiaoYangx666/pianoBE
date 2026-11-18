export function formatDuration(seconds: number | null | undefined): string {
    if (seconds == null || !Number.isFinite(seconds)) return "—";
    const total = Math.max(0, Math.round(seconds));
    const minutes = Math.floor(total / 60);
    return `${minutes}:${String(total % 60).padStart(2, "0")}`;
}

export function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatElapsed(ms: number | null): string {
    if (ms == null) return "—";
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    const total = Math.round(ms / 1000);
    return `${Math.floor(total / 60)}m ${total % 60}s`;
}

export function baseName(name: string): string {
    return name.replace(/\.[^.]+$/, "").slice(0, 80) || "音频转录";
}
