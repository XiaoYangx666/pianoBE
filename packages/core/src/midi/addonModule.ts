import type { MidiSongMeta } from "../types.js";
import { encodeBase64Url } from "../pbe2/base64url.js";

/**
 * 单曲 PBE2 → addon 内嵌模块文本。
 * 模块只保存压缩后的 PBE2 数据（Base64URL），不再内联完整音符数组。
 */
export function pbe2ToAddonModule(pbe2: Uint8Array): string {
    return `export default ${JSON.stringify(encodeBase64Url(pbe2))};`;
}

/** 曲目元列表 → addon 内嵌 index.js 文本（value() 返回模块内的 Base64URL 数据） */
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
