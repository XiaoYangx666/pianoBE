import JSZip from "jszip";
import { metasToAddonIndex, songToAddonModule } from "@piano/core";
import type { SongEntry } from "./types";
import type { TemplateInfo } from "./template";

export interface ExportOptions {
    name: string;
    desc: string;
    randomUuid: boolean;
}

function generateUUID(): string {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
        const r = (Math.random() * 16) | 0;
        return (ch === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
}

/**
 * 生成最终 .mcaddon（zip Blob）。
 * - 曲目模块：模板已有曲目原样保留（字节保真），新曲目由 core 生成；
 *   index.js 统一用 core 的 metasToAddonIndex 重新生成（格式与历史一致）
 * - manifest：应用名称/描述，可选随机化 UUID（含 bp/rp 交叉依赖与模块 UUID）
 */
export async function generateAddonZip(
    info: TemplateInfo,
    songs: SongEntry[],
    opts: ExportOptions
): Promise<Blob> {
    const { zip, bpPath, rpPath, bpManifest, rpManifest } = info;

    // ---- manifest 应用名称/描述 ----
    const bp = JSON.parse(JSON.stringify(bpManifest));
    const rp = JSON.parse(JSON.stringify(rpManifest));
    bp.header.name = opts.name;
    bp.header.description = opts.desc;
    rp.header.name = `${opts.name} (RP)`;
    rp.header.description = opts.desc;

    if (opts.randomUuid) {
        const oldB = bp.header.uuid;
        const oldR = rp.header.uuid;
        const newB = generateUUID();
        const newR = generateUUID();
        bp.header.uuid = newB;
        rp.header.uuid = newR;
        bp.dependencies?.forEach((d: Record<string, any>) => {
            if (d.uuid === oldR) {
                d.uuid = newR;
                d.version = rp.header.version;
            }
        });
        rp.dependencies?.forEach((d: Record<string, any>) => {
            if (d.uuid === oldB) {
                d.uuid = newB;
                d.version = bp.header.version;
            }
        });
        bp.modules?.forEach((m: Record<string, any>) => (m.uuid = generateUUID()));
        rp.modules?.forEach((m: Record<string, any>) => (m.uuid = generateUUID()));
    }

    zip.file(`${bpPath}manifest.json`, JSON.stringify(bp, null, 4));
    zip.file(`${rpPath}manifest.json`, JSON.stringify(rp, null, 4));

    // ---- 重写 scripts/midis ----
    const midisDir = `${bpPath}scripts/midis/`.replace(/\/+/g, "/");
    for (const f of Object.keys(zip.files)) {
        if (f.startsWith(midisDir)) zip.remove(f);
    }

    for (const entry of songs) {
        const content = entry.song
            ? songToAddonModule(entry.song)
            : (entry.moduleText ?? "");
        zip.file(`${midisDir}${entry.id}.js`, content);
    }
    zip.file(
        `${midisDir}index.js`,
        metasToAddonIndex(songs.map((s) => ({ id: s.id, name: s.name, duration: s.duration })))
    );

    return zip.generateAsync({ type: "blob" });
}