import type { MidiSong, MidiSongMeta } from "./types.js";

/**
 * 曲目来源端口：addon 内嵌曲库与 server-net 远程曲库共用。
 * - list()：同步或异步返回全量元信息；远程源头实现失败时应返回空数组而非抛错。
 * - get(id)：异步获取完整曲目，未找到返回 undefined。
 */
export interface MidiSource {
    /** 全量元信息（小数据，可整份缓存） */
    list(): MidiSongMeta[] | Promise<MidiSongMeta[]>;
    /** 按 id 获取完整曲目（异步；未找到返回 undefined） */
    get(id: string): Promise<MidiSong | undefined>;
}