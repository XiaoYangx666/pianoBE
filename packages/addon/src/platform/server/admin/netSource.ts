import { decodeBase64Url, type MidiSongMeta, type PerformanceCue, type PerformanceDescriptor } from "@piano/core";
import { HttpRequestMethod, type HttpRequestMethod as HttpRequestMethodType } from "@platform/server/net/httpMethod";
import { createLogger } from "@runtime/log";

const log = createLogger("net");

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
        const url = this.base("/api/libraries");
        try {
            const res = await this.opts.fetch(url, { headers: this.headers() });
            if (res.status !== 200) {
                log.warn("拉取曲库列表失败", undefined, { url, status: res.status });
                return [];
            }
            const data = (await res.json()) as { items?: RemoteLibraryMeta[]; catalogVersion?: number };
            this.trackCatalogVersion(data.catalogVersion);
            return Array.isArray(data.items) ? data.items : [];
        } catch (error) {
            log.warn("拉取曲库列表失败", error, { url });
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
        log.debug("拉取曲目页", { page, url });
        let res: NetResponse;
        try {
            res = await this.opts.fetch(url, { headers: this.headers() });
        } catch (error) {
            log.warn("拉取曲目页失败", error, { page, url });
            throw error;
        }
        if (res.status !== 200) {
            log.warn("拉取曲目页失败", undefined, { page, url, status: res.status });
            throw new Error(`songs 接口返回 ${res.status}`);
        }
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
        log.debug("曲目页完成", { page, items: items.length, total });
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
        log.debug("曲目元信息拉取完成", { query: q, library: libraryId, count: all.length });
        return all;
    }

    async getPerformance(perfId: string): Promise<readonly PerformanceCue[] | undefined> {
        const url = this.base(`/api/performances/${encodeURIComponent(perfId)}`);
        try {
            const res = await this.opts.fetch(url, { headers: this.headers() });
            if (res.status !== 200) {
                // 404 表示该曲目没有这份演出，播放器会降级为普通演奏，不算故障
                if (res.status === 404) log.debug("演出编排不存在", { perf: perfId });
                else log.warn("拉取演出编排失败", undefined, { perf: perfId, status: res.status });
                return undefined;
            }
            const payload = (await res.json()) as { cues?: PerformanceCue[] };
            return Array.isArray(payload.cues) ? payload.cues : undefined;
        } catch (error) {
            log.warn("拉取演出编排失败", error, { perf: perfId });
            return undefined;
        }
    }

    async get(id: string): Promise<Uint8Array | undefined> {
        const url = this.base(`/api/songs/${encodeURIComponent(id)}`);
        try {
            log.debug("拉取单曲", { song: id, url });
            const res = await this.opts.fetch(url, { headers: this.headers() });
            if (res.status !== 200) {
                log.warn("拉取单曲失败", undefined, { song: id, status: res.status });
                return undefined;
            }
            const payload = (await res.json()) as RemoteSongPayload;
            if (!payload.data) {
                log.warn("单曲响应缺少数据", undefined, { song: id });
                return undefined;
            }
            const bytes = decodeBase64Url(payload.data);
            log.debug("单曲拉取完成", { song: id, name: payload.name, bytes: bytes.length });
            return bytes;
        } catch (error) {
            log.warn("拉取单曲失败", error, { song: id });
            return undefined;
        }
    }

    async reportLoaded(payload: { configHash: string; installedPlugins: readonly string[] }): Promise<boolean> {
        const url = this.base("/api/addon/loaded");
        try {
            const res = await this.opts.fetch(url, {
                method: HttpRequestMethod.Post,
                headers: this.headers({ "Content-Type": "application/json" }),
                body: JSON.stringify(payload),
            });
            if (res.status < 200 || res.status >= 300) {
                log.warn("上报加载状态失败", undefined, { url, status: res.status });
                return false;
            }
            return true;
        } catch (error) {
            log.warn("上报加载状态失败", error, { url });
            return false;
        }
    }
}
