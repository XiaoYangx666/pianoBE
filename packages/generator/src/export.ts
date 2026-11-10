import type { AddonTemplate } from "@bepack/addon";
import { metasToAddonIndex, songToAddonModule } from "@piano/core";
import type { SongEntry } from "./types";
import type { TemplateInfo } from "./template";
import type { LoadedTimbrePack, TimbreIndexEntry } from "./timbres";
import { TIMBRES_SCRIPT_PATH } from "./timbres";

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
    /** 实际启用的音色 id，会写进 scripts/packages/addon/src/domain/piano/timbres.js */
    enabledIds: string[];
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
    const { addon, bpPath, rpPath } = info;

    const { identity } = addon.updateIdentity(
        {
            name: opts.name,
            description: opts.desc,
            resourceName: `${opts.name} (RP)`,
            randomizeUuids: opts.randomUuid,
        },
        { indent: 4 }
    );
    const scorePackModule = `${bpPath}scripts/packages/addon/src/data/scorePack.js`;
    if (identity.resourcePack && addon.has(scorePackModule)) {
        addon.writeText(scorePackModule,
            `export const SCORE_RESOURCE_PACK_ID = ${JSON.stringify(identity.resourcePack.headerUuid)};\n`);
    }

    // ---- 重写 scripts/midis ----
    const midisDir = `${bpPath}scripts/midis/`.replace(/\/+/g, "/");
    addon.removeTree(midisDir);

    for (const entry of songs) {
        const content = entry.song
            ? songToAddonModule(entry.song)
            : (entry.moduleText ?? "");
        addon.writeText(`${midisDir}${entry.id}.js`, content);
    }
    addon.writeText(
        `${midisDir}index.js`,
        metasToAddonIndex(songs.map((s) => ({ id: s.id, name: s.name, duration: s.duration })))
    );

    if (opts.timbres) applyTimbres(addon, bpPath, rpPath, opts.timbres);

    return addon.toBlob();
}

/**
 * 把模板裁剪成“只包含选中音色”的状态：
 * - 先移除所有已知可选音色目录和 sound_definitions 条目（兼容旧的完整模板）
 * - 再合并已按需加载的音色包
 * - 最后覆写 scripts/packages/addon/src/domain/piano/timbres.js，让游戏内设置只显示实际存在的音色
 */
function applyTimbres(
    addon: AddonTemplate,
    bpPath: string,
    rpPath: string,
    selection: TimbreExportSelection
) {
    const soundRoot = `${rpPath}sounds/`;
    const definitionsPath = `${soundRoot}sound_definitions.json`;
    const definitionsText = addon.readTextSync(definitionsPath);
    const definitions = definitionsText
        ? JSON.parse(definitionsText)
        : { format_version: "1.26.0", sound_definitions: {} };
    definitions.sound_definitions ??= {};

    const optionalDirs = new Set<string>();
    for (const timbre of selection.all) {
        if (timbre.id === "piano") continue;
        for (const dir of Object.values(timbre.dirs)) {
            optionalDirs.add(dir);
            addon.removeTree(`${soundRoot}${dir}/`);
        }
    }
    for (const key of Object.keys(definitions.sound_definitions)) {
        if (optionalDirs.has(key.split(".")[0])) delete definitions.sound_definitions[key];
    }

    for (const pack of selection.selected) {
        for (const [path, data] of pack.files) {
            if (path.startsWith("sounds/")) addon.write(`${rpPath}${path}`, data);
        }
        Object.assign(definitions.sound_definitions, pack.soundDefinitions);
    }

    addon.writeText(definitionsPath, `${JSON.stringify(definitions, null, 4)}\n`);
    const enabled = [...new Set(["piano", ...selection.enabledIds])];
    const timbresModule = `${bpPath}${TIMBRES_SCRIPT_PATH}`;
    if (!addon.has(timbresModule)) {
        console.warn(`[generator] 模板缺少 ${timbresModule}，音色勾选可能无法在游戏内生效`);
    }
    addon.writeText(
        timbresModule,
        `export const ENABLED_PIANO_TIMBRES = ${JSON.stringify(enabled)};\n`
    );
}
