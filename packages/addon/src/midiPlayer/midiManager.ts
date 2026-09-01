import type { MidiSong, MidiSongMeta, MidiSource } from "@piano/core";

/**
 * 曲库管理器：元信息注册表（同步可查）+ 内容懒加载。
 * 元信息在构造时从来源同步填充（内嵌源）；远程源可在之后异步 refresh。
 */
export class MidiManager {
    private metas: MidiSongMeta[] = [];
    private readonly metaMap = new Map<string, MidiSongMeta>();

    constructor(private source: MidiSource) {
        this.refreshSync();
    }

    /** 切换曲库来源（如内嵌 → 远程），并异步刷新元信息；失败保持现有列表 */
    setSource(source: MidiSource): void {
        this.source = source;
        void this.refresh();
    }

    /** 同步填充（内嵌源直接返回；远程源在 refresh 前为空列表） */
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
        this.metas = metas;
        this.metaMap.clear();
        for (const m of metas) {
            this.metaMap.set(m.id, m);
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
     * 按需解析单曲元信息：内存已登记直接返回；未命中时经 source 拉取
     * （远程源会请求单曲接口）并登记，供播放列表按 id 显示歌名等场景。
     */
    async infoOf(id: string): Promise<MidiSongMeta | undefined> {
        const known = this.getInfo(id);
        if (known) return known;
        const song = await this.source.get(id).catch(() => undefined);
        if (!song) return undefined;
        const meta: MidiSongMeta = {
            id: song.id,
            name: song.name,
            duration: song.duration,
        };
        this.register(meta);
        return meta;
    }

    /** 登记单条元信息（已存在则跳过） */
    private register(meta: MidiSongMeta): void {
        if (!this.metaMap.has(meta.id)) {
            this.metas.push(meta);
            this.metaMap.set(meta.id, meta);
        }
    }

    /** 加载曲目内容（懒加载；未找到返回 undefined） */
    async load(meta: MidiSongMeta): Promise<MidiSong | undefined> {
        return this.source.get(meta.id);
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