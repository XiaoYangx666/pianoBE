export interface MidiSongMeta {
    id: string;
    name: string;
    duration: number;
    noteCount?: number;
    dataSize?: number;
}

export interface TokenInfo {
    id: number;
    label: string;
    role: string;
    created_at: number;
    revoked: number;
}

export interface TranscribeStatus {
    available: boolean;
    cli?: string;
    model?: string;
    decoder: "native" | "ffmpeg";
    threads: number;
    eco: boolean;
    bilibili?: boolean;
    maxAudioBytes?: number;
    message?: string;
}

export interface BiliSearchItem {
    bvid: string;
    title: string;
    author: string;
    duration: string;
    play: number;
}

export type TranscribeJobStage =
    | "queued"
    | "downloading"
    | "analyzing"
    | "transcribing"
    | "finalizing"
    | "done"
    | "error";

export type TranscribeJobSource =
    | { kind: "upload"; fileName?: string }
    | {
          kind: "bilibili";
          bvid: string;
          cid: number;
          title: string;
          page: number;
          pageCount: number;
          quality: string;
          codecs: string;
          bandwidth: number;
      };

export interface TranscribeJob {
    id: string;
    stage: TranscribeJobStage;
    message: string;
    /** 0-100；-1 表示无法估算（显示不确定进度） */
    percent: number;
    audioTime?: number;
    durationSec?: number;
    noteCount: number;
    /** 转录结果时长（已按 TIME_SCALE 缩放） */
    midiDuration?: number;
    /** 转录结果 .mid 字节数 */
    dataSize?: number;
    elapsedMs: number;
    name: string;
    source: TranscribeJobSource;
    createdAt: number;
    updatedAt: number;
    audioReady: boolean;
    midiReady: boolean;
    error?: string;
    savedSong?: MidiSongMeta;
}

export interface ImportCode {
    name: string;
    chunks: string[];
    bytes: number;
}

const TOKEN_KEY = "piano_token";

export function getToken(): string | null {
    return localStorage.getItem(TOKEN_KEY);
}
export function setToken(t: string | null) {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
    constructor(
        public status: number,
        message: string
    ) {
        super(message);
    }
}

async function handle<T>(res: Response): Promise<T> {
    if (res.status === 401) {
        setToken(null);
        throw new ApiError(401, "令牌无效或已过期，请重新登录");
    }
    if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new ApiError(res.status, body?.error ?? `请求失败 (${res.status})`);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
}

function authHeaders(extra: Record<string, string> = {}): Headers {
    const headers = new Headers(extra);
    const token = getToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return headers;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = init.headers ? new Headers(init.headers) : authHeaders();
    return handle<T>(await fetch(path, { ...init, headers }));
}

/** 带鉴权的二进制请求（音频/MIDI 试听） */
async function requestBinary(path: string): Promise<Response> {
    const res = await fetch(path, { headers: authHeaders() });
    if (res.status === 401) {
        setToken(null);
        throw new ApiError(401, "令牌无效或已过期，请重新登录");
    }
    if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new ApiError(res.status, body?.error ?? `请求失败 (${res.status})`);
    }
    return res;
}

export const api = {
    health: () => request<{ ok: boolean }>("/api/health"),

    listSongs: (q = "", page = 1) =>
        request<{ items: MidiSongMeta[]; total: number }>(
            `/api/songs?q=${encodeURIComponent(q)}&page=${page}&pageSize=50`
        ),

    /** 原始 .mid 字节（前端直接解析播放，无需 server 转 JSON） */
    getSongRaw: async (id: string): Promise<ArrayBuffer> => {
        const res = await fetch(`/api/songs/${encodeURIComponent(id)}/raw`, {
            headers: authHeaders(),
        });
        if (res.status === 401) {
            setToken(null);
            throw new ApiError(401, "令牌无效或已过期，请重新登录");
        }
        if (!res.ok) {
            throw new ApiError(res.status, `拉取曲目失败 (${res.status})`);
        }
        return res.arrayBuffer();
    },

    /** 游戏内导入码（曲目库中的曲目） */
    getSongCode: (id: string) =>
        request<ImportCode>(`/api/songs/${encodeURIComponent(id)}/code`, {
            headers: authHeaders(),
        }),

    uploadSong: async (file: File) =>
        handle<MidiSongMeta>(
            await fetch("/api/songs", {
                method: "POST",
                headers: authHeaders({
                    "X-File-Name": encodeURIComponent(file.name),
                }),
                body: file,
            })
        ),

    renameSong: (id: string, name: string) =>
        request<MidiSongMeta>(`/api/songs/${encodeURIComponent(id)}`, {
            method: "PATCH",
            headers: authHeaders({ "content-type": "application/json" }),
            body: JSON.stringify({ name }),
        }),

    deleteSong: (id: string) =>
        request<void>(`/api/songs/${id}`, {
            method: "DELETE",
            headers: authHeaders(),
        }),

    listTokens: () =>
        request<{ items: TokenInfo[] }>("/api/tokens", { headers: authHeaders() }),

    createToken: (label: string, role: string) =>
        request<{ id: number; label: string; role: string; token: string }>(
            "/api/tokens",
            {
                method: "POST",
                headers: authHeaders({ "content-type": "application/json" }),
                body: JSON.stringify({ label, role }),
            }
        ),

    revokeToken: (id: number) =>
        request<void>(`/api/tokens/${id}`, {
            method: "DELETE",
            headers: authHeaders(),
        }),

    transcribeStatus: () =>
        request<TranscribeStatus>("/api/transcribe/status", { headers: authHeaders() }),

    searchBilibili: (q: string) =>
        request<{ items: BiliSearchItem[] }>(
            `/api/transcribe/bilibili/search?q=${encodeURIComponent(q)}&limit=10`,
            { headers: authHeaders() }
        ),

    /** 上传音频创建转录任务（XHR 以获得上传进度；结果不会自动进曲目库） */
    createTranscribeJob: (
        file: File,
        options: {
            name?: string;
            durationSec?: number;
            onUploadProgress?: (ratio: number) => void;
        } = {}
    ): Promise<TranscribeJob> =>
        new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open("POST", "/api/transcribe/jobs");
            const token = getToken();
            if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
            xhr.setRequestHeader(
                "X-File-Name",
                encodeURIComponent(options.name?.trim() || file.name)
            );
            if (options.durationSec && options.durationSec > 0) {
                xhr.setRequestHeader("X-Audio-Duration", String(options.durationSec));
            }
            xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
            xhr.upload.onprogress = (event) => {
                if (event.lengthComputable && event.total > 0) {
                    options.onUploadProgress?.(event.loaded / event.total);
                }
            };
            xhr.onload = () => {
                if (xhr.status === 401) {
                    setToken(null);
                    reject(new ApiError(401, "令牌无效或已过期，请重新登录"));
                    return;
                }
                let body: unknown = null;
                try {
                    body = JSON.parse(xhr.responseText);
                } catch {
                    // 非 JSON 响应
                }
                if (xhr.status >= 200 && xhr.status < 300 && body) {
                    resolve(body as TranscribeJob);
                } else {
                    const message =
                        (body as { error?: string } | null)?.error ?? `上传失败 (${xhr.status})`;
                    reject(new ApiError(xhr.status, message));
                }
            };
            xhr.onerror = () => reject(new ApiError(0, "上传失败：网络错误"));
            xhr.onabort = () => reject(new ApiError(0, "已取消上传"));
            xhr.send(file);
        }),

    createBilibiliJob: (input: string, page = 1, name?: string) =>
        request<TranscribeJob>("/api/transcribe/jobs/bilibili", {
            method: "POST",
            headers: authHeaders({ "content-type": "application/json" }),
            body: JSON.stringify({ input, page, name }),
        }),

    getTranscribeJob: (id: string) =>
        request<TranscribeJob>(`/api/transcribe/jobs/${id}`, { headers: authHeaders() }),

    /** 订阅任务进度（fetch 流解析 SSE，可携带 Authorization 头） */
    subscribeTranscribeJob: (
        id: string,
        handlers: {
            onUpdate: (job: TranscribeJob) => void;
            onError?: (error: Error) => void;
            onClose?: () => void;
        }
    ): (() => void) => {
        const controller = new AbortController();
        void (async () => {
            const res = await fetch(`/api/transcribe/jobs/${id}/events`, {
                headers: authHeaders(),
                signal: controller.signal,
            });
            if (res.status === 401) {
                setToken(null);
                throw new ApiError(401, "令牌无效或已过期，请重新登录");
            }
            if (!res.ok || !res.body) {
                throw new ApiError(res.status, `订阅进度失败 (${res.status})`);
            }
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffered = "";
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                buffered += decoder.decode(value, { stream: true });
                let boundary = buffered.indexOf("\n\n");
                while (boundary >= 0) {
                    const block = buffered.slice(0, boundary);
                    buffered = buffered.slice(boundary + 2);
                    boundary = buffered.indexOf("\n\n");
                    let event = "message";
                    let data = "";
                    for (const line of block.split("\n")) {
                        if (line.startsWith("event:")) event = line.slice(6).trim();
                        else if (line.startsWith("data:")) data += line.slice(5).trim();
                    }
                    if (event === "progress" && data) {
                        handlers.onUpdate(JSON.parse(data) as TranscribeJob);
                    }
                }
            }
            handlers.onClose?.();
        })().catch((error: unknown) => {
            if (controller.signal.aborted) return;
            handlers.onError?.(error instanceof Error ? error : new Error(String(error)));
        });
        return () => controller.abort();
    },

    renameTranscribeJob: (id: string, name: string) =>
        request<TranscribeJob>(`/api/transcribe/jobs/${id}`, {
            method: "PATCH",
            headers: authHeaders({ "content-type": "application/json" }),
            body: JSON.stringify({ name }),
        }),

    saveTranscribeJob: (id: string, name?: string) =>
        request<TranscribeJob>(`/api/transcribe/jobs/${id}/save`, {
            method: "POST",
            headers: authHeaders({ "content-type": "application/json" }),
            body: JSON.stringify({ name }),
        }),

    getTranscribeCode: (id: string) =>
        request<ImportCode>(`/api/transcribe/jobs/${id}/code`, { headers: authHeaders() }),

    getTranscribeAudio: async (id: string): Promise<Blob> =>
        (await requestBinary(`/api/transcribe/jobs/${id}/audio`)).blob(),

    getTranscribeMidi: async (id: string): Promise<ArrayBuffer> =>
        (await requestBinary(`/api/transcribe/jobs/${id}/midi`)).arrayBuffer(),

    deleteTranscribeJob: (id: string) =>
        request<void>(`/api/transcribe/jobs/${id}`, {
            method: "DELETE",
            headers: authHeaders(),
        }),
};

/** 时长显示：缩放值 → 分:秒 */
export function formatDuration(scaled: number): string {
    const s = Math.floor(scaled / 40);
    const m = Math.floor(s / 60);
    return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}
