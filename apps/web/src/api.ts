export interface MidiSongMeta {
    id: string;
    name: string;
    duration: number;
}

export interface PlaylistMeta {
    id: number;
    owner: string;
    name: string;
    public: boolean;
    playCount: number;
    createdAt: number;
    updatedAt: number;
}

export interface TokenInfo {
    id: number;
    label: string;
    role: string;
    created_at: number;
    revoked: number;
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
    return handle<T>(await fetch(path, init));
}

export const api = {
    health: () => request<{ ok: boolean }>("/api/health"),

    listSongs: (q = "", page = 1) =>
        request<{ items: MidiSongMeta[]; total: number }>(
            `/api/songs?q=${encodeURIComponent(q)}&page=${page}&pageSize=50`
        ),

    uploadSong: (file: File) =>
        handle<MidiSongMeta>(
            fetch("/api/songs", {
                method: "POST",
                headers: authHeaders({
                    "X-File-Name": encodeURIComponent(file.name),
                }),
                body: file,
            })
        ),

    deleteSong: (id: string) =>
        request<void>(`/api/songs/${id}`, {
            method: "DELETE",
            headers: authHeaders(),
        }),

    listPlaylists: (query = "") =>
        request<{ items: PlaylistMeta[]; total: number }>(
            `/api/playlists${query}`,
            { headers: authHeaders() }
        ),

    getPlaylist: (id: number) =>
        request<PlaylistMeta & { items: string[] }>(`/api/playlists/${id}`, {
            headers: authHeaders(),
        }),

    createPlaylist: (name: string) =>
        request<PlaylistMeta>("/api/playlists", {
            method: "POST",
            headers: authHeaders({ "content-type": "application/json" }),
            body: JSON.stringify({ name }),
        }),

    updatePlaylist: (id: number, patch: { name?: string; public?: boolean }) =>
        request<PlaylistMeta>(`/api/playlists/${id}`, {
            method: "PATCH",
            headers: authHeaders({ "content-type": "application/json" }),
            body: JSON.stringify(patch),
        }),

    setPlaylistItems: (id: number, items: string[]) =>
        request<{ items: string[] }>(`/api/playlists/${id}/items`, {
            method: "PUT",
            headers: authHeaders({ "content-type": "application/json" }),
            body: JSON.stringify({ items }),
        }),

    playPlaylist: (id: number) =>
        request<{ playCount: number }>(`/api/playlists/${id}/play`, {
            method: "POST",
            headers: authHeaders(),
        }),

    deletePlaylist: (id: number) =>
        request<void>(`/api/playlists/${id}`, {
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
};

/** 时长显示：缩放值 → 分:秒 */
export function formatDuration(scaled: number): string {
    const s = Math.floor(scaled / 40);
    const m = Math.floor(s / 60);
    return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}