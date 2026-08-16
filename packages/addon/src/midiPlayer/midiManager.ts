import type { MidiSong, MidiSongMeta, MidiSource } from "@piano/core";

/**
 * 曲库管理器：元信息注册表（同步可查）+ 内容懒加载。
 * 元信息在构造时从来源同步填充（内嵌源）；远程源可在之后异步 refresh。
 */
export class MidiManager {
    private metas: MidiSongMeta[] = [];
    private readonly metaMap = new Map<string, MidiSongMeta>();

    constructor(private readonly source: MidiSource) {
        this.refreshSync();
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

    /** 根据 id 获取元信息 */
    getInfo(id: string): MidiSongMeta | undefined {
        return this.metaMap.get(id);
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
}