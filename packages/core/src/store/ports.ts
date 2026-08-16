import type { MidiSong, MidiSongMeta, PlaylistMeta } from "../types.js";

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

/**
 * 播放列表存储端口。
 * 设计约束：单记录 = 单键/单行原子读写；不维护任何跨记录索引，
 * owner/public 等派生视图由业务层通过 listAllMetas() 扫描获得。
 */
export interface PlaylistPort {
    /** 分配下一个自增 id；须保证顺序调用不碰撞，且崩溃后可从现有记录恢复（如 max(id)+1） */
    nextId(): number;
    getMeta(id: number): PlaylistMeta | undefined;
    /** 全量扫描主记录（用于派生视图/启动对账，驱动必须返回最新主数据） */
    listAllMetas(): PlaylistMeta[];
    setMeta(meta: PlaylistMeta): void;
    deleteMeta(id: number): void;
    /** 读取列表内容（song id 数组，保持顺序） */
    getContent(id: number): string[];
    /** 整体替换列表内容（原子，单键/单行） */
    setContent(id: number, items: string[]): void;
    deleteContent(id: number): void;
    /** 删除一条列表的全部记录（meta + content 分别原子删除，容忍中途崩溃的残留） */
    deletePlaylist(id: number): void;
}