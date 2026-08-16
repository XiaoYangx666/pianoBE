import type { MidiSong, MidiSongMeta } from "../types.js";

/**
 * 单曲 → addon 内嵌模块文本（与历史 tools/convert.js 产物逐字节一致）。
 * 注意：instrument 可能出现 undefined 的轨道，JSON.stringify 会渲染为
 * "undefined" 字面量，与历史行为保持一致。
 */
export function songToAddonModule(song: MidiSong): string {
    const tracksCode = song.tracks
        .map(
            (t) =>
                `{instrument:${JSON.stringify(t.instrument)},notes:new Uint16Array([${t.notes.join(",")}])}`
        )
        .join(",");

    return (
        `export default {` +
        `id:${JSON.stringify(song.id)},` +
        `name:${JSON.stringify(song.name)},` +
        `duration:${song.duration},` +
        `tracks:[${tracksCode}]` +
        `};`
    );
}

/** 曲目元列表 → addon 内嵌 index.js 文本（与历史产物逐字节一致） */
export function metasToAddonIndex(metas: MidiSongMeta[]): string {
    let content = "export const midis=[";
    for (const item of metas) {
        content +=
            `{` +
            `id:${JSON.stringify(item.id)},` +
            `name:${JSON.stringify(item.name)},` +
            `duration:${item.duration},` +
            `value:async()=> (await import("./${item.id}.js")).default` +
            `},`;
    }
    return content + "];";
}