import type { MidiSongMeta } from "./types.js";

/**
 * 曲目来源端口：内嵌 / 导入 / 远程曲库统一返回 PBE2 二进制。
 * - list()：同步或异步返回全量元信息；远程源头实现失败时应返回空数组而非抛错。
 * - get(id)：异步获取 PBE2 数据，未找到返回 undefined。
 * 所有来源最终进入同一个 SongCache，不再各自维护完整 MidiSong 缓存。
 */
export interface MidiSource {
    /** 全量元信息（小数据，可整份缓存） */
    list(): MidiSongMeta[] | Promise<MidiSongMeta[]>;
    /** 按 id 获取 PBE2 数据（异步；未找到返回 undefined） */
    get(id: string): Promise<Uint8Array | undefined>;
    /** 服务端分页查询（远程源实现；返回该页 items + 总数；q 为服务端名称搜索） */
    page?(
        page: number,
        pageSize: number,
        q?: string
    ): Promise<{ items: MidiSongMeta[]; total: number }>;
    /** 按 q 取全部元信息（批量操作专用，如"一键添加"；未实现时调用方回退本地过滤） */
    metaAll?(q?: string): Promise<MidiSongMeta[]>;
}