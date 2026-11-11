import { readAddon, type AddonTemplate, type Manifest } from "@bepack/addon";
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
 * songToAddonModule 生成：
 *   index.js: export const midis=[{id,name,duration,value:async()=> (await import("./<id>.js")).default},];
 *   <id>.js:  export default {id,name,duration,tracks:[{instrument,notes:new Uint16Array([...])}]};
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
        const name = JSON.parse(match[2]);
        const duration = parseFloat(match[3]);
        const fileId = match[4];

        const jsContent = addon.readTextSync(`${midisDir}${fileId}.js`);
        if (!jsContent) continue;
        const tracksMatch = jsContent.match(/tracks:(\[.*\])\};/);
        if (!tracksMatch) continue;

        // 估算音符数：统计 Uint16Array/Float32Array 内数字个数 ÷ 4
        const noteMatches = jsContent.match(/(Float32Array|Uint16Array)\(\[(.*?)\]\)/g);
        let noteCount = 0;
        if (noteMatches) {
            for (const m of noteMatches) {
                const nums = m.match(/[\d.]+/g);
                if (nums) noteCount += nums.length / 4;
            }
        }

        items.push({
            id,
            name,
            duration,
            noteCount: Math.floor(noteCount),
            isOriginal: true,
            moduleText: jsContent,
        });
    }
    return items;
}
