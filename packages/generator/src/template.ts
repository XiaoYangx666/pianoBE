import { readAddon, type AddonTemplate, type Manifest } from "@bepack/addon";
import { decodeBase64Url, readPbe2Header } from "@piano/core";
import { pbe2ToEntry } from "./convert";
import type { SongEntry } from "./types";
import { parseTemplateScores, type ScoreEntry } from "./scores";

export interface TemplateInfo {
    addon: AddonTemplate;
    bpPath: string;
    rpPath: string;
    bpManifest: Manifest;
    rpManifest: Manifest;
    /** 模板内已内嵌的曲目（从 scripts/midis 解析） */
    songs: SongEntry[];
    /** 模板内已内嵌的曲谱（从 scorePack.js 解析，旧模板为空数组） */
    scores: ScoreEntry[];
}

/**
 * 加载并解析 addon 模板（.mcaddon 即 zip）。
 * pack 识别、manifest 解析、路径校验都由 @bepack/addon 负责。
 */
export async function loadTemplate(fileOrBlob: Blob | Uint8Array): Promise<TemplateInfo> {
    const addon = await readAddon(fileOrBlob);
    const bp = addon.packs.bp;
    const rp = addon.packs.rp;
    if (!bp || !rp) throw new Error("模板不完整：未找到 bp/rp manifest");

    const bpPath = bp.root;
    const rpPath = rp.root;
    const songs = parseExistingMidis(addon, `${bpPath}scripts/midis/`);
    const scores = parseTemplateScores(addon, bpPath);

    return {
        addon,
        bpPath,
        rpPath,
        bpManifest: bp.manifest,
        rpManifest: rp.manifest,
        songs,
        scores,
    };
}

/**
 * 解析模板内嵌曲目。文件格式由 @piano/core 的 metasToAddonIndex /
 * pbe2ToAddonModule 生成：
 *   index.js: export const midis=[{id,name,duration,value:async()=> (await import("./<id>.js")).default},];
 *   <id>.js:  export default "<Base64URL(PBE2)>";
 */
export function parseExistingMidis(
    addon: AddonTemplate,
    midisDir: string
): SongEntry[] {
    const content = addon.readTextSync(`${midisDir}index.js`);
    if (!content) return [];

    const regex =
        /\{id:("(?:[^"\\]|\\.)*"),name:("(?:[^"\\]|\\.)*"),duration:([\d.]+),value:async\(\)=>\s*\(await\s*import\("\.\/([^"]+)\.js"\)\)\.default\}/g;

    const items: SongEntry[] = [];
    let match;
    while ((match = regex.exec(content)) !== null) {
        const id = JSON.parse(match[1]);
        const fileId = match[4];

        const jsContent = addon.readTextSync(`${midisDir}${fileId}.js`);
        if (!jsContent) continue;
        const encoded = /export\s+default\s+"([^"]+)"\s*;?/.exec(jsContent)?.[1];
        if (!encoded) continue;
        try {
            const data = decodeBase64Url(encoded);
            const header = readPbe2Header(data);
            if (header.id !== id) continue;
            items.push(
                pbe2ToEntry(data, {
                    isOriginal: true,
                    moduleText: jsContent,
                })
            );
        } catch (error) {
            console.warn(`[generator] 模板曲目 ${id} 解析失败`, error);
        }
    }
    return items;
}
