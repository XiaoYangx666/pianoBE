import { decodeBase64Url, type MidiSongMeta, type PerformanceCue, type PerformanceDescriptor } from "@piano/core";
import { HttpRequestMethod, type HttpRequestMethod as HttpRequestMethodType } from "@platform/server/net/httpMethod";

/** 网络响应（适配 server-net HttpResponse / 测试 mock） */
export interface NetResponse {
    status: number;
    json(): Promise<unknown>;
}

export type NetFetch = (
    url: string,
    init: {
        method?: HttpRequestMethodType;
        headers?: Record<string, unknown>;
        body?: string;
    }
) => Promise<NetResponse>;

export interface RemoteSourceOptions {
    baseUrl: string;
    fetch: NetFetch;
    /** 附加请求头构造器（值可为 SecretString，透传不读取） */
    extraHeaders?: () => Record<string, unknown>;
    /** 服务端曲库版本号变化回调（用于动态清理未使用的 SongCache） */
    onCatalogVersionChange?: (version: number) => void;
}

interface RemoteSongPayload {
    id?: string;
    name?: string;
    duration?: number;
    performanceEntries?: PerformanceDescriptor[];
    /** Base64URL(PBE3) */
    data?: string;
}

export interface RemoteLibraryMeta {
    id: string;
    name: string;
    kind?: string;
    songIds?: string[];
}

export class RemoteMidiSource {
    private readonly opts: RemoteSourceOptions;
    private lastCatalogVersion?: number;

    constructor(options: RemoteSourceOptions) {
        this.opts = options;
    }

    private headers(extra?: Record<string, unknown>): Record<string, unknown> {
        return { ...(this.opts.extraHeaders?.() ?? {}), ...(extra ?? {}) };
    }

    private base(path: string): string {
        return `${this.opts.baseUrl.replace(/\/+$/, "")}${path}`;
    }

    private trackCatalogVersion(version: unknown): void {
        if (typeof version !== "number" || !Number.isFinite(version)) return;
        if (this.lastCatalogVersion !== undefined && version !== this.lastCatalogVersion) {
            this.opts.onCatalogVersionChange?.(version);
        }
        this.lastCatalogVersion = version;
    }

    async list(): Promise<MidiSongMeta[]> {
        return [];
    }

    async libraries(): Promise<RemoteLibraryMeta[]> {
        try {
            const res = await this.opts.fetch(this.base("/api/libraries"), { headers: this.headers() });
            if (res.status !== 200) return [];
            const data = (await res.json()) as { items?: RemoteLibraryMeta[]; catalogVersion?: number };
            this.trackCatalogVersion(data.catalogVersion);
            return Array.isArray(data.items) ? data.items : [];
        } catch {
            return [];
        }
    }

    async page(
        page: number,
        pageSize: number,
        q?: string,
        libraryId?: string,
    ): Promise<{ items: MidiSongMeta[]; total: number }> {
        // 手拼 query：游戏脚本运行时没有 URLSearchParams（QuickJS 受限全局）
        const query = [`pageSize=${pageSize}`, `page=${page}`];
        if (q) query.push(`q=${encodeURIComponent(q)}`);
        if (libraryId) query.push(`libraryId=${encodeURIComponent(libraryId)}`);
        const url = this.base(`/api/songs?${query.join("&")}`);
        console.log(`[netSource] 拉取曲目第 ${page} 页: GET ${url}`);
        const res = await this.opts.fetch(url, { headers: this.headers() });
        console.log(`[netSource] 第 ${page} 页响应状态: ${res.status}`);
        if (res.status !== 200) throw new Error(`songs 接口返回 ${res.status}`);
        const data = (await res.json()) as {
            items?: Array<MidiSongMeta & { dataSize?: number }>;
            total?: number;
            catalogVersion?: number;
        };
        this.trackCatalogVersion(data.catalogVersion);
        const items: MidiSongMeta[] = (data.items ?? []).map((item) => {
            const meta: MidiSongMeta = {
                id: item.id,
                name: item.name,
                duration: item.duration,
            };
            if (typeof item.noteCount === "number") meta.noteCount = item.noteCount;
            const bytes = item.bytes ?? item.dataSize;
            if (typeof bytes === "number") meta.bytes = bytes;
            if (Array.isArray(item.libraries) && item.libraries.length) meta.libraries = item.libraries;
            if (Array.isArray(item.performanceEntries) && item.performanceEntries.length) {
                meta.performanceEntries = item.performanceEntries;
            }
            return meta;
        });
        const total = typeof data.total === "number" ? data.total : items.length;
        console.log(`[netSource] 第 ${page} 页 ${items.length} 首（共 ${total} 首）`);
        return { items, total };
    }

    async metaAll(q?: string, libraryId?: string): Promise<MidiSongMeta[]> {
        const pageSize = 100;
        const all: MidiSongMeta[] = [];
        let page = 1;
        for (;;) {
            const { items, total } = await this.page(page, pageSize, q, libraryId);
            all.push(...items);
            if (all.length >= total) break;
            if (items.length < pageSize) break;
            if (page >= 20) break;
            page++;
        }
        console.log(`[netSource] metaAll${q ? `(q=${q})` : ""} 共 ${all.length} 首`);
        return all;
    }

    async getPerformance(perfId: string): Promise<readonly PerformanceCue[] | undefined> {
        try {
            const url = this.base(`/api/performances/${encodeURIComponent(perfId)}`);
            const res = await this.opts.fetch(url, { headers: this.headers() });
            if (res.status !== 200) return undefined;
            const payload = (await res.json()) as { cues?: PerformanceCue[] };
            return Array.isArray(payload.cues) ? payload.cues : undefined;
        } catch {
            return undefined;
        }
    }

    async get(id: string): Promise<Uint8Array | undefined> {
        try {
            const url = this.base(`/api/songs/${encodeURIComponent(id)}`);
            console.log(`[netSource] 拉取单曲: GET ${url}`);
            const res = await this.opts.fetch(url, { headers: this.headers() });
            console.log(`[netSource] 单曲 ${id} 响应状态: ${res.status}`);
            if (res.status !== 200) return undefined;
            const payload = (await res.json()) as RemoteSongPayload;
            if (!payload.data) return undefined;
            const bytes = decodeBase64Url(payload.data);
            console.log(`[netSource] 单曲 ${id} 拉取成功（${payload.name ?? ""}，${bytes.length}B）`);
            return bytes;
        } catch (e) {
            console.warn(`[netSource] 单曲 ${id} 拉取失败: ${(e as Error)?.message ?? e}`);
            return undefined;
        }
    }

    async reportLoaded(payload: { configHash: string; installedPlugins: readonly string[] }): Promise<boolean> {
        try {
            const res = await this.opts.fetch(this.base("/api/addon/loaded"), {
                method: HttpRequestMethod.Post,
                headers: this.headers({ "Content-Type": "application/json" }),
                body: JSON.stringify(payload),
            });
            return res.status >= 200 && res.status < 300;
        } catch {
            return false;
        }
    }
}
