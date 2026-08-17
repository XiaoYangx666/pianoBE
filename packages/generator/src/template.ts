import JSZip from "jszip";
import type { SongEntry } from "./types";

export interface TemplateInfo {
    zip: JSZip;
    bpPath: string;
    rpPath: string;
    bpManifest: Record<string, any>;
    rpManifest: Record<string, any>;
    /** 模板内已内嵌的曲目（从 scripts/midis 解析） */
    songs: SongEntry[];
}

/**
 * 加载并解析 addon 模板（.mcaddon 即 zip）。
 * 与历史行为一致：按 manifest.json 路径识别 bp/rp，解析内嵌曲目。
 */
export async function loadTemplate(fileOrBlob: Blob): Promise<TemplateInfo> {
    const zip = await JSZip.loadAsync(fileOrBlob);
    const files = Object.keys(zip.files);
    const bpM = files.find(
        (f) => f.endsWith("manifest.json") && (f.includes("bp") || f.includes("behavior"))
    );
    const rpM = files.find(
        (f) => f.endsWith("manifest.json") && (f.includes("rp") || f.includes("resource"))
    );
    if (!bpM || !rpM) throw new Error("模板不完整：未找到 bp/rp manifest");

    const bpPath = bpM.replace("manifest.json", "");
    const rpPath = rpM.replace("manifest.json", "");
    const bpManifest = JSON.parse(await zip.file(bpM)!.async("string"));
    const rpManifest = JSON.parse(await zip.file(rpM)!.async("string"));

    const songs = await parseExistingMidis(zip, `${bpPath}scripts/midis/`);

    return { zip, bpPath, rpPath, bpManifest, rpManifest, songs };
}

/**
 * 解析模板内嵌曲目。
 * 文件格式由 @piano/core 的 metasToAddonIndex / songToAddonModule 生成：
 *   index.js: export const midis=[{id,name,duration,value:async()=> (await import("./<id>.js")).default},];
 *   <id>.js:  export default {id,name,duration,tracks:[{instrument,notes:new Uint16Array([...])}]};
 */
export async function parseExistingMidis(
    zip: JSZip,
    midisDir: string
): Promise<SongEntry[]> {
    const indexFile = zip.file(midisDir + "index.js");
    if (!indexFile) return [];

    const content = await indexFile.async("string");
    const regex =
        /\{id:("(?:[^"\\]|\\.)*"),name:("(?:[^"\\]|\\.)*"),duration:([\d.]+),value:async\(\)=>\s*\(await\s*import\("\.\/([^"]+)\.js"\)\)\.default\}/g;

    const items: SongEntry[] = [];
    let match;
    while ((match = regex.exec(content)) !== null) {
        const id = JSON.parse(match[1]);
        const name = JSON.parse(match[2]);
        const duration = parseFloat(match[3]);
        const fileId = match[4];

        const jsFile = zip.file(`${midisDir}${fileId}.js`);
        if (!jsFile) continue;
        const jsContent = await jsFile.async("string");
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