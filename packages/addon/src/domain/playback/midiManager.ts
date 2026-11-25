import type { MidiSongMeta, PerformanceCue, PerformanceDescriptor } from "@piano/core";
import { SongCache, worldRawId, type SongHandle } from "@piano/core";

/**
 * 曲库管理器：
 * - 元信息注册表（同步可查，列表/搜索不加载单曲模块）；
 * - 主来源（内嵌 / 远程）+ 公共附加来源（世界全局曲库）统一路由；
 * - 所有来源的 PBE3 数据进入同一个 SongCache（引用计数 + LRU + 内存预算）。
 */
export class MidiManager {
    /** 主来源元信息（不包含公共附加来源，供 reset 重建索引）。 */
    private metas: MidiSongMeta[] = [];
    private readonly metaMap = new Map<string, MidiSongMeta>();
    private readonly publicSources: MidiSourceLike[] = [];
    private cachedLibraries: readonly { id: string; name: string }[] = [];
    private readonly cache: SongCache;

    constructor(private source: MidiSourceLike, maxCacheBytes?: number) {
        this.cache = new SongCache((id) => this.load(id), {
            maxBytes: maxCacheBytes,
            verify: (id, header) => header.id === (worldRawId(id) ?? id),
        });
        this.refreshSync();
    }

    /** 切换主曲库来源（如内嵌 → 远程），释放无引用的旧缓存并异步刷新元信息 */
    setSource(source: MidiSourceLike): void {
        this.source = source;
        this.cache.clearUnused();
        void this.refresh();
    }

    /**
     * 注册公共附加来源（世界全局曲库）。
     * 元信息进入查找表，并参与公共曲库搜索/分页；不占用主来源列表。
     */
    addPublicSource(source: MidiSourceLike): void {
        if (!this.publicSources.includes(source)) this.publicSources.push(source);
        const list = source.list();
        if (Array.isArray(list)) this.registerAll(list, false);
        else list.then((items) => this.registerAll(items, false)).catch(() => {});
    }

    /** 公共附加来源内容变化后重建元信息索引（不重新请求远程主来源）。 */
    refreshPublicIndex(): void {
        this.reset(this.metas.slice());
        // 删除/替换后不要继续从旧缓存加载；活跃播放引用由 SongCache 保护。
        this.cache.clearUnused();
    }

    /** 清理未被引用的缓存曲目（服务端目录变更后即时生效）。 */
    invalidateCache(): void {
        this.cache.clearUnused();
    }

    /** 获取曲目引用（播放器按 id 获取，持有期间不会被 LRU 淘汰） */
    acquire(id: string): Promise<SongHandle | undefined> {
        return this.cache.acquire(id);
    }

    /** 读取原始 PBE3（不进入共享缓存；跨存储复制/导出用）。 */
    read(id: string): Promise<Uint8Array | undefined> {
        return this.load(id);
    }

    cacheStats() {
        return this.cache.stats();
    }

    private refreshSync() {
        const list = this.source.list();
        this.reset(Array.isArray(list) ? list : []);
        const libs = this.source.libraries?.();
        if (Array.isArray(libs)) {
            this.cachedLibraries = libs;
        }
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
        for (const source of this.publicSources) {
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

    performances(id: string) {
        if (worldRawId(id) === undefined) return this.getInfo(id)?.performances ?? [];
        for (const source of this.publicSources) {
            const performances = source.performances?.(id);
            if (performances) return performances;
        }
        return [];
    }

    performanceEntries(id: string): readonly PerformanceDescriptor[] {
        if (worldRawId(id) === undefined) {
            const info = this.getInfo(id);
            if (info?.performanceEntries?.length) return info.performanceEntries;
            return (info?.performances ?? []).map((cues, index) => ({
                id: `${id}:perf:${index + 1}`,
                name: `附加演出 ${index + 1}`,
                songId: id,
                cues,
            }));
        }
        for (const source of this.publicSources) {
            const entries = source.performanceEntries?.(id);
            if (entries?.length) return entries;
            const perfs = source.performances?.(id);
            if (perfs?.length) {
                return perfs.map((cues, index) => ({
                    id: `${id}:perf:${index + 1}`,
                    name: `附加演出 ${index + 1}`,
                    songId: id,
                    cues,
                }));
            }
        }
        return [];
    }

    async resolvePerformanceCues(id: string, performanceId: string): Promise<readonly PerformanceCue[] | undefined> {
        const local = this.performanceEntries(id).find((entry) => entry.id === performanceId);
        if (local?.cues) return local.cues;
        if (worldRawId(id) === undefined && this.source.getPerformance) {
            const fetched = await this.source.getPerformance(performanceId);
            if (fetched) return fetched;
        }
        for (const source of this.publicSources) {
            if (!source.getPerformance) continue;
            const fetched = await source.getPerformance(performanceId);
            if (fetched) return fetched;
        }
        return undefined;
    }

    listLibrariesSync(): readonly { id: string; name: string }[] {
        return this.cachedLibraries;
    }

    async listLibraries(): Promise<readonly { id: string; name: string }[]> {
        const libs: { id: string; name: string }[] = [];
        const seen = new Set<string>();
        const collect = (list: readonly { id: string; name: string }[]) => {
            for (const item of list) {
                if (seen.has(item.id)) continue;
                seen.add(item.id);
                libs.push(item);
            }
        };
        if (this.source.libraries) {
            try {
                collect(await this.source.libraries());
            } catch { /* ignore */ }
        }
        for (const source of this.publicSources) {
            if (!source.libraries) continue;
            try {
                collect(await source.libraries());
            } catch { /* ignore */ }
        }
        this.cachedLibraries = libs;
        return libs;
    }

    /**
     * 按需解析单曲元信息：内存已登记直接返回；未命中时经来源加载 PBE3
     * 并读取文件头，供播放列表按 id 显示歌名等场景。
     */
    async infoOf(id: string): Promise<MidiSongMeta | undefined> {
        const known = this.getInfo(id);
        if (known) return known;
        const handle = await this.cache.acquire(id);
        if (!handle) return undefined;
        const meta: MidiSongMeta = {
            id,
            name: handle.song.name,
            duration: handle.song.duration,
            noteCount: handle.song.noteCount,
        };
        handle.release();
        this.register(meta, false);
        return meta;
    }

    /** 登记单条元信息（已存在则合并更新；includeInList 控制是否进入主列表） */
    private register(meta: MidiSongMeta, includeInList = false): void {
        const current = this.metaMap.get(meta.id);
        if (current) {
            current.name = meta.name;
            current.duration = meta.duration;
            if (meta.noteCount !== undefined) current.noteCount = meta.noteCount;
            if (meta.bytes !== undefined) current.bytes = meta.bytes;
            // 远程分页拿到的演出摘要只在这里出现一次；不合并会导致详情页
            // 只剩 PBE3 内嵌的默认演出。
            if (meta.performanceEntries !== undefined) current.performanceEntries = meta.performanceEntries;
            if (meta.performances !== undefined) current.performances = meta.performances;
            if (meta.libraries !== undefined) current.libraries = meta.libraries;
            return;
        }
        this.metaMap.set(meta.id, meta);
        if (includeInList) this.metas.push(meta);
    }

    private registerAll(metas: MidiSongMeta[], includeInList = false): void {
        for (const meta of metas) this.register(meta, includeInList);
    }

    /** 加载 PBE3 数据：主来源优先，公共附加来源兜底（未找到返回 undefined） */
    private async load(id: string): Promise<Uint8Array | undefined> {
        // 命名空间歌曲只能读世界公共来源，不能被同 ID 的主曲库截获。
        if (worldRawId(id) !== undefined) {
            for (const source of this.publicSources) {
                try {
                    const bytes = await source.get(id);
                    if (bytes) return bytes;
                } catch { /* 尝试下一个来源 */ }
            }
            return undefined;
        }
        try {
            const primary = await this.source.get(id);
            if (primary) return primary;
        } catch {
            // 主来源网络失败时继续尝试公共附加来源
        }
        for (const source of this.publicSources) {
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
     * 分页查询：主来源与公共附加来源各自取窗口后合并。
     *
     * 远程主来源仍走服务端分页 + 服务端搜索；世界全局曲库只查内存索引。
     * 合并顺序为主来源在前、公共附加来源在后，保持现有曲库排序行为。
     */
    async page(
        page: number,
        pageSize: number,
        q?: string,
        libraryId?: string,
    ): Promise<{ items: MidiSongMeta[]; total: number }> {
        const current = Math.max(1, Math.floor(page));
        const size = Math.max(1, Math.floor(pageSize));
        const sources = [this.source, ...this.publicSources];
        const items: MidiSongMeta[] = [];
        let cursor = (current - 1) * size;
        let remaining = size;
        let total = 0;

        for (const source of sources) {
            const slice = await this.sourceSlice(source, cursor, remaining, q, libraryId);
            total += slice.total;
            if (remaining <= 0) continue;
            if (cursor >= slice.total) {
                cursor -= slice.total;
                continue;
            }
            items.push(...slice.items);
            remaining -= slice.items.length;
            cursor = 0;
        }
        const pageItems = items.slice(0, size);
        // 远程来源没有全量 list，分页结果必须登记，详情页才能读到演出摘要。
        this.registerAll(pageItems, false);
        return { items: pageItems, total };
    }

    /** 批量取全部（远程源后端过滤；本地源内存过滤），"一键添加"等批量操作用 */
    async metaAll(q?: string, libraryId?: string): Promise<MidiSongMeta[]> {
        const all: MidiSongMeta[] = [];
        for (const source of [this.source, ...this.publicSources]) {
            if (source.metaAll) {
                all.push(...await source.metaAll(q, libraryId));
                continue;
            }
            all.push(...this.filter(await source.list(), q, libraryId));
        }
        this.registerAll(all, false);
        return all;
    }

    /**
     * 从来源取 [start, start+count) 范围的条目。
     *
     * 远程来源直接请求包含 start 的服务端页，只读取需要的块，避免为了
     * 合并分页而从第 1 页全量拉取。总条数取自同一次响应。
     */
    private async sourceSlice(
        source: MidiSourceLike,
        start: number,
        count: number,
        q?: string,
        libraryId?: string,
    ): Promise<{ items: MidiSongMeta[]; total: number }> {
        if (!source.page) {
            const all = this.filter(await source.list(), q, libraryId);
            const from = Math.max(0, start);
            return { items: all.slice(from, from + Math.max(0, count)), total: all.length };
        }

        // 远程接口单页上限 100；本地来源也按块读取，避免一次取过多。
        const chunk = 100;
        const firstPage = Math.floor(Math.max(0, start) / chunk) + 1;
        let page = firstPage;
        let local = Math.max(0, start) % chunk;
        let need = Math.max(0, count);
        if (need === 0) {
            // 仍需要总数用于合并分页的总量统计。
            const head = await source.page(1, 1, q, libraryId);
            return { items: [], total: head.total };
        }

        const items: MidiSongMeta[] = [];
        let total = 0;
        while (need > 0) {
            const result = await source.page(page, chunk, q, libraryId);
            if (page === firstPage) total = result.total;
            const available = result.items.slice(local);
            const take = available.slice(0, need);
            items.push(...take);
            need -= take.length;
            local = 0;
            page++;
            if (take.length === 0 || page > 100_000) break;
        }
        return { items, total };
    }

    private filter(list: MidiSongMeta[], q?: string, libraryId?: string): MidiSongMeta[] {
        const keyword = q?.trim().toLowerCase();
        return list.filter((meta) => {
            if (libraryId && !meta.libraries?.includes(libraryId)) return false;
            if (keyword && !meta.name.toLowerCase().includes(keyword)) return false;
            return true;
        });
    }
}

/** MidiSource 的最小结构（domain 层不依赖具体实现） */
export interface MidiSourceLike {
    list(): MidiSongMeta[] | Promise<MidiSongMeta[]>;
    get(id: string): Promise<Uint8Array | undefined>;
    libraries?(): Promise<readonly { id: string; name: string }[]> | readonly { id: string; name: string }[];
    page?(
        page: number,
        pageSize: number,
        q?: string,
        libraryId?: string,
    ): Promise<{ items: MidiSongMeta[]; total: number }>;
    metaAll?(q?: string, libraryId?: string): Promise<MidiSongMeta[]>;
    performances?(id: string): MidiSongMeta["performances"];
    performanceEntries?(id: string): readonly PerformanceDescriptor[] | undefined;
    getPerformance?(perfId: string): Promise<readonly PerformanceCue[] | undefined>;
}
