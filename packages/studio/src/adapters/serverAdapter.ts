import type { LibraryRecord, PerformanceCue } from "@piano/core";
import type { TimbreIndexEntry } from "@piano/assembly";
import type { VfxPluginIcon } from "@piano/vfx";
import type {
    PerformanceDescriptor,
    PluginContentCounts,
    ServerScoreMeta,
    StudioDeploymentStatus,
    StudioPlugin,
    StudioSong,
    StudioTokenInfo,
} from "./types";

const STUDIO_TOKEN_KEY = "pianobe_studio_token";
const LEGACY_WEB_TOKEN_KEY = "piano_token";

export function getServerToken(): string | null {
    return localStorage.getItem(STUDIO_TOKEN_KEY) ?? localStorage.getItem(LEGACY_WEB_TOKEN_KEY);
}

export function setServerToken(token: string | null): void {
    if (token) {
        localStorage.setItem(STUDIO_TOKEN_KEY, token);
    } else {
        localStorage.removeItem(STUDIO_TOKEN_KEY);
        localStorage.removeItem(LEGACY_WEB_TOKEN_KEY);
    }
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = getServerToken();
    const headers = new Headers(init.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    const res = await fetch(path, { ...init, headers });
    if (!res.ok) {
        const text = await res.text();
        let message = `${res.status} ${res.statusText}`;
        try {
            const j = JSON.parse(text);
            if (j?.error) message = String(j.error);
        } catch {
            if (text) message = text;
        }
        const err = new Error(message) as Error & { status?: number };
        err.status = res.status;
        throw err;
    }
    if (res.status === 204) return undefined as T;
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) return (await res.json()) as T;
    return (await res.arrayBuffer()) as unknown as T;
}

export const serverApi = {
    async checkAvailable(): Promise<{ ok: boolean; authRequired: boolean; authenticated: boolean }> {
        try {
            const res = await fetch("/api/health");
            if (!res.ok) return { ok: false, authRequired: false, authenticated: false };
            const health = (await res.json().catch(() => null)) as { ok?: boolean } | null;
            if (!health?.ok) return { ok: false, authRequired: false, authenticated: false };
            const songRes = await fetch("/api/songs?pageSize=1", {
                headers: getServerToken() ? { Authorization: `Bearer ${getServerToken()}` } : {},
            });
            if (songRes.status === 401 || songRes.status === 403) {
                return { ok: true, authRequired: true, authenticated: false };
            }
            return { ok: true, authRequired: Boolean(getServerToken()), authenticated: songRes.ok };
        } catch {
            return { ok: false, authRequired: false, authenticated: false };
        }
    },

    listSongs(params?: { q?: string; page?: number; pageSize?: number; libraryId?: string }) {
        const sp = new URLSearchParams();
        if (params?.q) sp.set("q", params.q);
        if (params?.page) sp.set("page", String(params.page));
        if (params?.pageSize) sp.set("pageSize", String(params.pageSize));
        if (params?.libraryId) sp.set("libraryId", params.libraryId);
        return req<{
            items: StudioSong[];
            total: number;
            page: number;
            pageSize: number;
            catalogVersion?: number;
        }>(`/api/songs?${sp.toString()}`);
    },

    getSongDetail(id: string) {
        return req<{
            id: string;
            name: string;
            duration: number;
            performanceEntries?: PerformanceDescriptor[];
            data: string;
        }>(`/api/songs/${encodeURIComponent(id)}`);
    },

    getImportCode(id: string) {
        return req<{ name: string; chunks: string[]; bytes: number }>(
            `/api/songs/${encodeURIComponent(id)}/code`,
        );
    },

    async downloadSongRaw(id: string): Promise<Uint8Array> {
        const token = getServerToken();
        const res = await fetch(`/api/songs/${encodeURIComponent(id)}/raw`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error(`下载失败 (${res.status})`);
        return new Uint8Array(await res.arrayBuffer());
    },

    uploadSong(fileName: string, bytes: Uint8Array, libraryId?: string) {
        const headers: Record<string, string> = {
            "X-File-Name": encodeURIComponent(fileName),
            "Content-Type": "application/octet-stream",
        };
        if (libraryId) headers["X-Library-Id"] = encodeURIComponent(libraryId);
        return req<StudioSong>("/api/songs", {
            method: "POST",
            headers,
            body: bytes.slice().buffer,
        });
    },

    renameSong(id: string, name: string) {
        return req<StudioSong>(`/api/songs/${encodeURIComponent(id)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name }),
        });
    },

    deleteSong(id: string) {
        return req<void>(`/api/songs/${encodeURIComponent(id)}`, { method: "DELETE" });
    },

    listPerformances(songId: string) {
        return req<{ items: PerformanceDescriptor[] }>(
            `/api/songs/${encodeURIComponent(songId)}/performances`,
        );
    },

    addSongPerformance(
        songId: string,
        body: { id?: string; name: string; author?: string; description?: string; cues: readonly PerformanceCue[] },
    ) {
        return req<PerformanceDescriptor>(`/api/songs/${encodeURIComponent(songId)}/performances`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
    },

    deletePerformance(perfId: string) {
        return req<void>(`/api/performances/${encodeURIComponent(perfId)}`, { method: "DELETE" });
    },

    listLibraries() {
        return req<{ items: LibraryRecord[]; catalogVersion: number }>("/api/libraries");
    },

    createLibrary(name: string, description?: string, songIds?: string[]) {
        return req<LibraryRecord>("/api/libraries", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, description, songIds }),
        });
    },

    updateLibrary(id: string, patch: { name?: string; description?: string }) {
        return req<LibraryRecord>(`/api/libraries/${encodeURIComponent(id)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(patch),
        });
    },

    deleteLibrary(id: string) {
        return req<void>(`/api/libraries/${encodeURIComponent(id)}`, { method: "DELETE" });
    },

    addSongsToLibrary(libraryId: string, songIds: string[]) {
        return req<LibraryRecord>(`/api/libraries/${encodeURIComponent(libraryId)}/songs`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ songIds }),
        });
    },

    removeSongFromLibrary(libraryId: string, songId: string) {
        return req<void>(
            `/api/libraries/${encodeURIComponent(libraryId)}/songs/${encodeURIComponent(songId)}`,
            { method: "DELETE" },
        );
    },

    clearLibrary(libraryId: string) {
        return req<void>(`/api/libraries/${encodeURIComponent(libraryId)}/songs`, {
            method: "DELETE",
        });
    },

    async exportLibraryPlugin(libraryId: string): Promise<Blob> {
        const token = getServerToken();
        const res = await fetch(`/api/libraries/${encodeURIComponent(libraryId)}/export-plugin`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error(`导出插件失败 (${res.status})`);
        return res.blob();
    },

    listPlugins() {
        return req<{ items: ServerPluginRaw[]; deployment: ServerAddonStatusRaw }>("/api/plugins");
    },

    async fetchPluginArchive(id: string): Promise<Uint8Array> {
        const token = getServerToken();
        const res = await fetch(`/api/plugins/${encodeURIComponent(id)}/archive`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error(`获取扩展包失败 (${res.status})`);
        return new Uint8Array(await res.arrayBuffer());
    },

    installBuiltinPlugin(builtinId: string) {
        return req<ServerPluginRaw>("/api/plugins", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ builtinId }),
        });
    },

    uploadPlugin(bytes: Uint8Array) {
        return req<ServerPluginRaw>("/api/plugins", {
            method: "POST",
            headers: { "Content-Type": "application/octet-stream" },
            body: bytes.slice().buffer,
        });
    },

    trustPlugin(id: string) {
        return req<ServerPluginRaw>(`/api/plugins/${encodeURIComponent(id)}/trust`, { method: "POST" });
    },

    setPluginEnabled(id: string, enabled: boolean) {
        return req<ServerPluginRaw>(`/api/plugins/${encodeURIComponent(id)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enabled }),
        });
    },

    uninstallPlugin(id: string) {
        return req<void>(`/api/plugins/${encodeURIComponent(id)}`, { method: "DELETE" });
    },

    getAddonStatus() {
        return req<ServerAddonStatusRaw>("/api/addon/status");
    },

    updateAddonConfig(config: {
        bdsDir?: string;
        bdsWorld?: string;
        bdsBpName?: string;
        bdsRpName?: string;
        enabledTimbres?: string[];
    }) {
        return req<{ bdsConfig: StudioDeploymentStatus["bdsConfig"]; status: ServerAddonStatusRaw }>(
            "/api/addon/config",
            {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(config),
            },
        );
    },

    listServerScores() {
        return req<{ items: ServerScoreMeta[] }>("/api/addon/scores");
    },

    addServerScore(input: {
        id: string;
        title: string;
        pages: string[];
        pageCount?: number;
        assets: Record<string, string>;
    }) {
        return req<{ items: ServerScoreMeta[]; status: ServerAddonStatusRaw }>("/api/addon/scores", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
        });
    },

    deleteServerScore(id: string) {
        return req<{ items: ServerScoreMeta[]; status: ServerAddonStatusRaw }>(
            `/api/addon/scores/${encodeURIComponent(id)}`,
            { method: "DELETE" },
        );
    },

    uploadServerTemplate(bytes: Uint8Array) {
        return req<ServerAddonStatusRaw>("/api/addon/template", {
            method: "POST",
            headers: { "Content-Type": "application/octet-stream" },
            body: bytes.slice().buffer,
        });
    },

    deployToBds() {
        return req<ServerAddonStatusRaw>("/api/addon/deploy", { method: "POST" });
    },

    async downloadServerAddon(): Promise<Blob> {
        const token = getServerToken();
        const res = await fetch("/api/addon/download", {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error(`生成服务端附加包失败 (${res.status})`);
        return res.blob();
    },

    listTokens() {
        return req<{ items: StudioTokenInfo[] }>("/api/tokens");
    },

    createToken(label: string, role: string) {
        return req<{ id: string; label: string; role: string; token: string }>("/api/tokens", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ label, role }),
        });
    },

    revokeToken(id: string) {
        return req<void>(`/api/tokens/${encodeURIComponent(id)}`, { method: "DELETE" });
    },

    getTranscribeStatus() {
        return req<{
            available: boolean;
            bilibili?: { available: boolean; reason?: string };
        }>("/api/transcribe/status");
    },

    searchBilibili(q: string, page = 1) {
        return req<{
            items: Array<{
                bvid: string;
                title: string;
                author: string;
                duration: number;
                play: number;
                pic?: string;
            }>;
        }>(`/api/transcribe/bilibili/search?q=${encodeURIComponent(q)}&page=${page}`);
    },

    startTranscribeUpload(file: File, name: string, duration?: number) {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("name", name);
        if (duration !== undefined) fd.append("duration", String(duration));
        return req<{ jobId: string }>("/api/transcribe/jobs", { method: "POST", body: fd });
    },

    startTranscribeBilibili(bvid: string, name: string) {
        return req<{ jobId: string }>("/api/transcribe/jobs/bilibili", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ bvid, name }),
        });
    },

    getTranscribeJob(jobId: string) {
        return req<{
            id: string;
            name: string;
            stage: "queued" | "downloading" | "analyzing" | "transcribing" | "finalizing" | "done" | "error";
            progress: number;
            error?: string;
            result?: {
                noteCount: number;
                duration: number;
            };
        }>(`/api/transcribe/jobs/${encodeURIComponent(jobId)}`);
    },

    saveTranscribeJob(jobId: string, name?: string) {
        return req<StudioSong>(`/api/transcribe/jobs/${encodeURIComponent(jobId)}/save`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name }),
        });
    },

    async downloadTranscribeMidi(jobId: string): Promise<Uint8Array> {
        const token = getServerToken();
        const res = await fetch(`/api/transcribe/jobs/${encodeURIComponent(jobId)}/midi`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error(`获取转录 MIDI 失败 (${res.status})`);
        return new Uint8Array(await res.arrayBuffer());
    },
};

export interface ServerPluginRaw {
    id: string;
    name: string;
    version: string;
    manifest: {
        id: string;
        name: string;
        version: string;
        author: string;
        license?: string;
        visibility?: "public" | "internal";
        dependencies?: string[];
        provides?: Record<string, string[] | undefined>;
        icon?: VfxPluginIcon;
        preview?: { thumbnail?: string; description?: string };
    };
    size: number;
    source: "builtin" | "upload";
    installed: boolean;
    enabled: boolean;
    trusted: boolean;
    compatible: boolean;
    compatibilityReason?: string;
    hasExecutableCode: boolean;
    requiresPackDeploy: boolean;
    status: "active" | "pending_deploy" | "pending_restart" | "unavailable";
    missingDependencies?: string[];
    previewDataUrl?: string;
    contents?: PluginContentCounts;
}

export interface ServerAddonStatusRaw {
    templateReady: boolean;
    targetConfigHash: string;
    deployedConfigHash?: string;
    loadedConfigHash?: string;
    deployedAt?: number;
    loadedAt?: number;
    enabledPlugins: string[];
    deployedPlugins: string[];
    loadedPlugins: string[];
    enabledTimbres?: string[];
    availableTimbres?: TimbreIndexEntry[];
    scores?: ServerScoreMeta[];
    issues?: string[];
    status: "active" | "pending_deploy" | "pending_restart" | "unavailable";
    bdsConfig: {
        bdsDir?: string;
        bdsWorld?: string;
        bdsBpName: string;
        bdsRpName: string;
    };
}

export function normalizeServerPlugin(raw: ServerPluginRaw): StudioPlugin {
    const manifest = raw.manifest;
    const provides = manifest?.provides ?? {};
    const contents: PluginContentCounts = raw.contents ?? {
        songs: provides.songs?.length ?? 0,
        performances: provides.performances?.length ?? 0,
        libraries: provides.libraries?.length ?? 0,
        timbres: provides.timbres?.length ?? 0,
        effects: provides.effects?.length ?? 0,
        themes: provides.themes?.length ?? 0,
        keyStyles: provides.keyStyles?.length ?? 0,
        particles: provides.particles?.length ?? 0,
        stageProps: 0,
    };

    return {
        id: raw.id,
        name: raw.name || manifest?.name || raw.id,
        version: raw.version || manifest?.version || "1.0.0",
        author: manifest?.author ?? "PianoBE",
        description: manifest?.preview?.description ?? "",
        license: manifest?.license,
        source: raw.source,
        visibility: manifest?.visibility ?? "public",
        installed: raw.installed,
        enabled: raw.enabled,
        trusted: raw.trusted,
        hasExecutableCode: raw.hasExecutableCode,
        requiresPackDeploy: raw.requiresPackDeploy,
        compatible: raw.compatible,
        compatibilityNote: raw.compatibilityReason,
        sizeBytes: raw.size ?? 0,
        ...(manifest?.icon !== undefined ? { icon: manifest.icon } : {}),
        ...(raw.previewDataUrl ? { previewDataUrl: raw.previewDataUrl } : {}),
        dependencies: (manifest?.dependencies ?? []).map((id) => ({ id })),
        missingDependencies: raw.missingDependencies ?? [],
        provides,
        contents,
        status: raw.status,
    };
}

export function normalizeServerDeployment(raw: ServerAddonStatusRaw): StudioDeploymentStatus {
    return {
        supported: true,
        status: raw.status,
        templateReady: raw.templateReady,
        targetConfigHash: raw.targetConfigHash,
        deployedConfigHash: raw.deployedConfigHash,
        loadedConfigHash: raw.loadedConfigHash,
        deployedAt: raw.deployedAt,
        loadedAt: raw.loadedAt,
        enabledPlugins: raw.enabledPlugins ?? [],
        deployedPlugins: raw.deployedPlugins ?? [],
        loadedPlugins: raw.loadedPlugins ?? [],
        enabledTimbres: raw.enabledTimbres ?? ["piano"],
        availableTimbres: raw.availableTimbres ?? [],
        scores: raw.scores ?? [],
        issues: raw.issues ?? [],
        bdsConfig: {
            bdsDir: raw.bdsConfig?.bdsDir ?? "",
            bdsWorld: raw.bdsConfig?.bdsWorld ?? "",
            bdsBpName: raw.bdsConfig?.bdsBpName ?? "pianoServerBP",
            bdsRpName: raw.bdsConfig?.bdsRpName ?? "pianoServerRP",
        },
    };
}
