import JSZip from "jszip";
import { metasToAddonIndex, songToAddonModule } from "@piano/core";
import type { SongEntry } from "./types";
import type { TemplateInfo } from "./template";
import type { LoadedTimbrePack, TimbreIndexEntry } from "./timbres";

export interface ExportOptions {
    name: string;
    desc: string;
    randomUuid: boolean;
    /** 音色选择；不传则保持模板原样（兼容旧调用） */
    timbres?: TimbreExportSelection;
}

export interface TimbreExportSelection {
    /** 所有已知音色（用于从旧模板中剥离未选中的可选音色） */
    all: TimbreIndexEntry[];
    /** 已按需加载、需要写入导出包的可选音色 */
    selected: LoadedTimbrePack[];
    /** 实际启用的音色 id，会写进 scripts/piano/timbres.js */
    enabledIds: string[];
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

    if (opts.timbres) await applyTimbres(zip, bpPath, rpPath, opts.timbres);

    return zip.generateAsync({ type: "blob" });
}

/**
 * 把模板裁剪成“只包含选中音色”的状态：
 * - 先移除所有已知可选音色目录和 sound_definitions 条目（兼容旧的完整模板）
 * - 再合并已按需加载的音色包
 * - 最后覆写 scripts/piano/timbres.js，让游戏内设置只显示实际存在的音色
 */
async function applyTimbres(
    zip: JSZip,
    bpPath: string,
    rpPath: string,
    selection: TimbreExportSelection
) {
    const soundRoot = `${rpPath}sounds/`;
    const definitionsPath = `${soundRoot}sound_definitions.json`;
    const definitionsFile = zip.file(definitionsPath);
    const definitions = definitionsFile
        ? JSON.parse(await definitionsFile.async("string"))
        : { format_version: "1.26.0", sound_definitions: {} };
    definitions.sound_definitions ??= {};

    const optionalDirs = new Set<string>();
    for (const timbre of selection.all) {
        if (timbre.id === "piano") continue;
        for (const dir of Object.values(timbre.dirs)) {
            optionalDirs.add(dir);
            const prefix = `${soundRoot}${dir}/`;
            for (const file of Object.keys(zip.files)) {
                if (file.startsWith(prefix)) zip.remove(file);
            }
        }
    }
    for (const key of Object.keys(definitions.sound_definitions)) {
        if (optionalDirs.has(key.split(".")[0])) delete definitions.sound_definitions[key];
    }

    for (const pack of selection.selected) {
        for (const [path, data] of pack.files) {
            if (path.startsWith("sounds/")) zip.file(`${rpPath}${path}`, data);
        }
        Object.assign(definitions.sound_definitions, pack.soundDefinitions);
    }

    zip.file(definitionsPath, `${JSON.stringify(definitions, null, 4)}\n`);
    const enabled = [...new Set(["piano", ...selection.enabledIds])];
    const timbresModule = `${bpPath}scripts/piano/timbres.js`;
    if (!zip.file(timbresModule)) {
        console.warn(`[generator] 模板缺少 ${timbresModule}，音色勾选可能无法在游戏内生效`);
    }
    zip.file(
        timbresModule,
        `export const ENABLED_PIANO_TIMBRES = ${JSON.stringify(enabled)};\n`
    );
}