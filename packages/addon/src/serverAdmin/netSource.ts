import type { MidiSong, MidiSongMeta, MidiSource } from "@piano/core";

/** 网络响应（适配 server-net HttpResponse / 测试 mock） */
export interface NetResponse {
    status: number;
    json(): Promise<unknown>;
}

/**
 * 网络请求。headers 值可为普通字符串或 server-admin 的 SecretString
 * （脚本环境不可读，由底层 HttpHeader 在请求执行时解析）。
 */
export type NetFetch = (
    url: string,
    init: { method?: string; headers?: Record<string, unknown> }
) => Promise<NetResponse>;

/** 缓存存储（适配 DPDataBase / 测试 mock） */
export interface CacheStorage {
    getJSON(key: string): unknown;
    setJSON(key: string, value: unknown): void | Promise<void>;
}

export interface RemoteSourceOptions {
    baseUrl: string;
    fetch: NetFetch;
    storage: CacheStorage;
    /** meta 列表内存缓存有效期（ms），默认 5 分钟 */
    metaTtlMs?: number;
    /** 附加请求头构造器（值可为 SecretString，透传不读取） */
    extraHeaders?: () => Record<string, unknown>;
}

const META_KEY = "meta";
const SONG_PREFIX = "song:";
const DEFAULT_TTL = 5 * 60 * 1000;

/**
 * 远程曲库来源：通过 server-net 从后端 API 拉取曲目。
 * - meta 列表：内存缓存（TTL）+ 持久缓存兜底（断网可读上次结果）
 * - 单曲：内存 → 持久缓存 → 网络，按需拉取并写入缓存
 * - 所有网络错误静默降级（返回缓存 / undefined），由内嵌曲库兜底
 */
export class CachedRemoteSource implements MidiSource {
    private metaCache: MidiSongMeta[] | null = null;
    private metaLoadedAt = 0;
    private readonly songCache = new Map<string, MidiSong>();
    private readonly opts: RemoteSourceOptions;

    constructor(options: RemoteSourceOptions) {
        this.opts = { metaTtlMs: DEFAULT_TTL, ...options };
    }

    private headers(): Record<string, unknown> {
        return this.opts.extraHeaders?.() ?? {};
    }

    private base(path: string): string {
        return `${this.opts.baseUrl.replace(/\/+$/, "")}${path}`;
    }

    async list(): Promise<MidiSongMeta[]> {
        if (
            this.metaCache &&
            Date.now() - this.metaLoadedAt < (this.opts.metaTtlMs ?? DEFAULT_TTL)
        ) {
            return this.metaCache;
        }

        try {
            const res = await this.opts.fetch(this.base("/api/songs?pageSize=100"), {
                headers: this.headers(),
            });
            if (res.status !== 200) throw new Error(`songs 接口返回 ${res.status}`);
            const data = (await res.json()) as { items?: MidiSongMeta[] };
            const items = data.items ?? [];
            this.metaCache = items;
            this.metaLoadedAt = Date.now();
            await this.opts.storage.setJSON(META_KEY, items);
            return items;
        } catch {
            // 网络失败 → 持久缓存兜底
            return this.readMetaFromStorage();
        }
    }

    async get(id: string): Promise<MidiSong | undefined> {
        const mem = this.songCache.get(id);
        if (mem) return mem;

        const stored = this.opts.storage.getJSON(SONG_PREFIX + id) as
            | MidiSong
            | undefined;
        if (stored) {
            this.songCache.set(id, stored);
            return stored;
        }

        try {
            const res = await this.opts.fetch(
                this.base(`/api/songs/${encodeURIComponent(id)}`),
                { headers: this.headers() }
            );
            if (res.status !== 200) return undefined;
            const song = (await res.json()) as MidiSong;
            this.songCache.set(id, song);
            await this.opts.storage.setJSON(SONG_PREFIX + id, song);
            return song;
        } catch {
            return undefined;
        }
    }

    private readMetaFromStorage(): MidiSongMeta[] {
        const data = this.opts.storage.getJSON(META_KEY);
        return Array.isArray(data) ? (data as MidiSongMeta[]) : [];
    }
}