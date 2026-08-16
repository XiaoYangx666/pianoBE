import type { MidiSong, MidiSongMeta } from "../types.js";
import type { SongPort } from "./ports.js";

/** 曲库业务层：在 SongPort 之上提供常用查询与组装逻辑 */
export class SongStore {
    constructor(private readonly port: SongPort) {}

    /** 整首写入（内容寻址，幂等） */
    add(song: MidiSong): void {
        this.port.add(song);
    }

    getMeta(id: string): MidiSongMeta | undefined {
        return this.port.getMeta(id);
    }

    getSong(id: string): MidiSong | undefined {
        return this.port.getSong(id);
    }

    has(id: string): boolean {
        return this.port.has(id);
    }

    /** 全量元信息（排序与调用方约定，默认保持存储插入序） */
    list(): MidiSongMeta[] {
        return this.port.listMetas();
    }

    /** 根据 id 列表取出元信息，自动剔除找不到的（播放列表导入用） */
    fromIds(ids: string[]): MidiSongMeta[] {
        return ids
            .map((id) => this.port.getMeta(id))
            .filter((m): m is MidiSongMeta => m !== undefined);
    }

    remove(id: string): void {
        this.port.remove(id);
    }
}