import type { MidiSongMeta } from "../types.js";
import { encodeBase64Url } from "../binary/base64url.js";

/**
 * 单曲 PBE3 → addon 内嵌模块文本。
 * 模块只保存压缩后的 PBE3 数据（Base64URL），不再内联完整音符数组。
 */
export function pbe3ToAddonModule(pbe3: Uint8Array): string {
    return `export default ${JSON.stringify(encodeBase64Url(pbe3))};`;
}

export interface AddonLibraryMeta {
    id: string;
    name: string;
}

/** 曲目元列表 → addon 内嵌 index.js 文本（value() 返回模块内的 Base64URL 数据） */
export function metasToAddonIndex(
    metas: MidiSongMeta[],
    libraries?: readonly AddonLibraryMeta[]
): string {
    let content = "export const midis=[";
    for (const item of metas) {
        const compactEntries = item.performanceEntries?.map((entry) => ({
            id: entry.id,
            name: entry.name,
            ...(entry.author ? { author: entry.author } : {}),
            ...(entry.cues ? { cues: entry.cues } : {}),
            ...(entry.requiredEffects?.length ? { requiredEffects: entry.requiredEffects } : {}),
        }));
        content +=
            `{` +
            `id:${JSON.stringify(item.id)},` +
            `name:${JSON.stringify(item.name)},` +
            `duration:${item.duration},` +
            (item.noteCount !== undefined ? `noteCount:${item.noteCount},` : "") +
            (item.bytes !== undefined ? `bytes:${item.bytes},` : "") +
            (item.libraries?.length ? `libraries:${JSON.stringify(item.libraries)},` : "") +
            (compactEntries?.length ? `performanceEntries:${JSON.stringify(compactEntries)},` : "") +
            (item.performances?.length ? `performances:${JSON.stringify(item.performances)},` : "") +
            `value:async()=> (await import("./${item.id}.js")).default` +
            `},`;
    }
    content += "];";
    if (libraries && libraries.length > 0) {
        content += `export const libraries=${JSON.stringify(libraries.map((l) => ({ id: l.id, name: l.name })))};`;
    }
    return content;
}
