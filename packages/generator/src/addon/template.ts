import { readAddon, type AddonTemplate, type Manifest } from "@bepack/addon";
import { attachSongPerformance, decodeBase64Url, readSongHeader, type PerformanceCue } from "@piano/core";
import { pbe3ToEntry } from "../music/convert";
import type { SongEntry } from "../types";
import { parseTemplateScores, type ScoreEntry } from "../scores/scores";

export interface TemplateInfo {
    addon: AddonTemplate;
    bpPath: string;
    rpPath: string;
    bpManifest: Manifest;
    rpManifest: Manifest;
    /** 模板内已内嵌的曲目 */
    songs: SongEntry[];
    /** 模板内已内嵌的曲谱（从 scorePack.js 解析，旧模板为空数组） */
    scores: ScoreEntry[];
}

export const LEGACY_MIDI_TREE = "scripts/midis/";
const MIDI_TREE = "scripts/packages/addon/src/midis/";

export function templateMidiTree(addon: AddonTemplate, bpPath: string) {
    return bpPath + (addon.has(bpPath + MIDI_TREE + "index.js") ? MIDI_TREE : LEGACY_MIDI_TREE);
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
    const legacyDir = bpPath + LEGACY_MIDI_TREE;
    // Previously exported packs wrote the user's selection to this path.
    const songs = parseExistingMidis(addon, addon.has(legacyDir + "index.js") ? legacyDir : templateMidiTree(addon, bpPath));
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
 *   index.js: export const midis=[{id,name,duration,noteCount?,bytes?,value:async()=> (await import("./<id>.js")).default},];
 *   <id>.js:  export default "<Base64URL(PBE3)>";
 */
export function parseExistingMidis(
    addon: AddonTemplate,
    midisDir: string
): SongEntry[] {
    const content = addon.readTextSync(`${midisDir}index.js`);
    if (!content) return [];

    const regex =
        /\{id:("(?:[^"\\]|\\.)*"),name:("(?:[^"\\]|\\.)*"),duration:([\d.]+),(?:noteCount:\d+,)?(?:bytes:\d+,)?(?:performances:(\[[^\r\n]*?\]),)?value:async\(\)=>\s*\(await\s*import\("\.\/([^"]+)\.js"\)\)\.default\}/g;

    const items: SongEntry[] = [];
    let match;
    while ((match = regex.exec(content)) !== null) {
        const id = JSON.parse(match[1]);
        const fileId = match[5];

        const jsContent = addon.readTextSync(`${midisDir}${fileId}.js`);
        if (!jsContent) continue;
        const encoded = /export\s+default\s+"([^"]+)"\s*;?/.exec(jsContent)?.[1];
        if (!encoded) continue;
        try {
            const data = decodeBase64Url(encoded);
            const header = readSongHeader(data);
            if (header.id !== id) continue;
            const entry = pbe3ToEntry(data, { isOriginal: true, moduleText: jsContent });
            const performances: (readonly PerformanceCue[])[] = [];
            if (match[4]) {
                try {
                    for (const cues of JSON.parse(match[4])) {
                        if (Array.isArray(cues) && cues.length) {
                            try {
                                const validated = readSongHeader(attachSongPerformance(data, cues)).performance;
                                if (validated) performances.push(validated);
                            } catch { /* Keep the base song if an optional performance is malformed. */ }
                        }
                    }
                } catch { /* Keep the base song. */ }
            }
            if (performances.length) entry.performances = performances;
            items.push(entry);
        } catch (error) {
            console.warn(`[generator] 模板曲目 ${id} 解析失败`, error);
        }
    }
    return items;
}
