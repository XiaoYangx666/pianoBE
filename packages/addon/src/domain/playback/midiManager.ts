import type { MidiSongMeta } from "@piano/core";
import { SongCache, type SongHandle } from "@piano/core";

/**
 * 曲库管理器：
 * - 元信息注册表（同步可查，列表/搜索不加载单曲模块）；
 * - 主来源（内嵌 / 远程）+ 附加来源（本地导入）统一路由；
 * - 所有来源的 PBE2 数据进入同一个 SongCache（引用计数 + LRU + 内存预算）。
 */
export class MidiManager {
    private metas: MidiSongMeta[] = [];
    private readonly metaMap = new Map<string, MidiSongMeta>();
    private readonly extraSources: MidiSourceLike[] = [];
    private readonly cache: SongCache;

    constructor(private source: MidiSourceLike, maxCacheBytes?: number) {
        this.cache = new SongCache((id) => this.load(id), { maxBytes: maxCacheBytes });
        this.refreshSync();
    }

    /** 切换主曲库来源（如内嵌 → 远程），释放无引用的旧缓存并异步刷新元信息 */
    setSource(source: MidiSourceLike): void {
        this.source = source;
        this.cache.clearUnused();
        void this.refresh();
    }

    /** 注册附加来源（本地导入曲库）；元信息并入查找表，但不混入主曲库列表 */
    addSource(source: MidiSourceLike): void {
        if (!this.extraSources.includes(source)) this.extraSources.push(source);
        const list = source.list();
        if (Array.isArray(list)) this.registerAll(list, false);
        else list.then((items) => this.registerAll(items, false)).catch(() => {});
    }

    /** 获取曲目引用（播放器按 id 获取，持有期间不会被 LRU 淘汰） */
    acquire(id: string): Promise<SongHandle | undefined> {
        return this.cache.acquire(id);
    }

    cacheStats() {
        return this.cache.stats();
    }

    private refreshSync() {
        const list = this.source.list();
        this.reset(Array.isArray(list) ? list : []);
    }

    /** 异步刷新元信息（远程来源用；失败时保持现有列表） */
    async refresh(): Promise<void> {
        try {
            const list = await this.source.list();
            if (list) this.reset(list);
        } catch (e) {
            console.error("刷新曲库元信息失败", e);
        }
    }

    private reset(metas: MidiSongMeta[]) {
        this.metas = [];
        this.metaMap.clear();
        this.registerAll(metas, true);
        for (const source of this.extraSources) {
            const list = source.list();
            if (Array.isArray(list)) this.registerAll(list, false);
        }
    }

    /** 曲目元信息列表（同步） */
    list(): MidiSongMeta[] {
        return this.metas;
    }

    /** 根据 midiId 获取元信息 */
    getInfo(id: string): MidiSongMeta | undefined {
        return this.metaMap.get(id);
    }

    /**
     * 按需解析单曲元信息：内存已登记直接返回；未命中时经来源加载 PBE2
     * 并读取文件头，供播放列表按 id 显示歌名等场景。
     */
    async infoOf(id: string): Promise<MidiSongMeta | undefined> {
        const known = this.getInfo(id);
        if (known) return known;
        const handle = await this.cache.acquire(id);
        if (!handle) return undefined;
        const meta: MidiSongMeta = {
            id: handle.song.id,
            name: handle.song.name,
            duration: handle.song.duration,
        };
        handle.release();
        this.register(meta, false);
        return meta;
    }

    /** 登记单条元信息（已存在则更新名称/时长；includeInList 控制是否进入主列表） */
    private register(meta: MidiSongMeta, includeInList = false): void {
        const current = this.metaMap.get(meta.id);
        if (current) {
            current.name = meta.name;
            current.duration = meta.duration;
            return;
        }
        this.metaMap.set(meta.id, meta);
        if (includeInList) this.metas.push(meta);
    }

    private registerAll(metas: MidiSongMeta[], includeInList = false): void {
        for (const meta of metas) this.register(meta, includeInList);
    }

    /** 加载 PBE2 数据：主来源优先，附加来源兜底（未找到返回 undefined） */
    private async load(id: string): Promise<Uint8Array | undefined> {
        try {
            const primary = await this.source.get(id);
            if (primary) return primary;
        } catch {
            // 主来源网络失败时继续尝试本地导入来源
        }
        for (const source of this.extraSources) {
            try {
                const data = await source.get(id);
                if (data) return data;
            } catch {
                // 继续下一个来源
            }
        }
        return undefined;
    }

    /** 根据 midiId 列表获取元信息列表，去除无法找到的 */
    fromIds(ids: string[]): MidiSongMeta[] {
        return ids
            .map((id) => this.metaMap.get(id))
            .filter((m): m is MidiSongMeta => m !== undefined);
    }

    /**
     * 分页查询（远程源走服务端分页 + q 服务端搜索；内嵌源回退本地快照过滤）。
     * 返回该页 items 与匹配总数，供列表 UI 按需取页。
     */
    async page(
        page: number,
        pageSize: number,
        q?: string
    ): Promise<{ items: MidiSongMeta[]; total: number }> {
        if (this.source.page) {
            return this.source.page(page, pageSize, q);
        }
        const list = this.list();
        const filtered = q
            ? list.filter((m) => m.name.toLowerCase().includes(q.toLowerCase()))
            : list;
        const start = (page - 1) * pageSize;
        return {
            items: filtered.slice(start, start + pageSize),
            total: filtered.length,
        };
    }

    /** 批量取全部（远程源后端过滤；内嵌源本地过滤），"一键添加"等批量操作用 */
    async metaAll(q?: string): Promise<MidiSongMeta[]> {
        if (this.source.metaAll) {
            return this.source.metaAll(q);
        }
        const list = this.list();
        return q
            ? list.filter((m) => m.name.toLowerCase().includes(q.toLowerCase()))
            : list;
    }
}

/** MidiSource 的最小结构（domain 层不依赖具体实现） */
export interface MidiSourceLike {
    list(): MidiSongMeta[] | Promise<MidiSongMeta[]>;
    get(id: string): Promise<Uint8Array | undefined>;
    page?(
        page: number,
        pageSize: number,
        q?: string
    ): Promise<{ items: MidiSongMeta[]; total: number }>;
    metaAll?(q?: string): Promise<MidiSongMeta[]>;
}
