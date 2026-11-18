import type { MidiSong, MidiSongMeta } from "../types.js";

/**
 * 曲库存储端口。
 * 实现方要求：add/getMeta/getSong/remove 均为单记录（单键/单行）原子操作；
 * add 按内容寻址，同 id 重复写入幂等。
 */
export interface SongPort {
    /** 幂等写入整首曲目（含音符数据） */
    add(song: MidiSong): void;
    getMeta(id: string): MidiSongMeta | undefined;
    /** 完整曲目（含音符数据）；不存在或数据缺失返回 undefined */
    getSong(id: string): MidiSong | undefined;
    has(id: string): boolean;
    /** 全量曲目元信息（派生列表/搜索用） */
    listMetas(): MidiSongMeta[];
    remove(id: string): void;
}
