import {
    assembleAddonBlob,
    type AssemblyOptions,
    type TemplateInfo,
} from "@piano/assembly";
import type { PbePluginArchive } from "@piano/vfx/package";
import type { SongEntry } from "../types";
import { TIMBRES_SCRIPT_PATH, type LoadedTimbrePack, type TimbreIndexEntry } from "./timbres";
import type { ScoreEntry } from "../scores/scores";

export { TIMBRES_SCRIPT_PATH };

export interface ExportOptions {
    name: string;
    desc: string;
    randomUuid: boolean;
    /** 音色选择；不传则保持模板原样（兼容旧调用） */
    timbres?: TimbreExportSelection;
    /** 曲谱列表；不传或为空则保持模板原样（只更新资源包 UUID） */
    scores?: ScoreEntry[];
    /** VFX 插件包；传 [] 表示零插件模式，不传则保持模板原样 */
    plugins?: readonly PbePluginArchive[];
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
 * 生成最终 .mcaddon（zip Blob），底层逻辑由 @piano/assembly 统一提供。
 */
export async function generateAddonZip(
    info: TemplateInfo,
    songs: SongEntry[],
    opts: ExportOptions,
): Promise<Blob> {
    const assemblyOpts: AssemblyOptions = {
        name: opts.name,
        desc: opts.desc,
        randomUuid: opts.randomUuid,
        timbres: opts.timbres,
        scores: opts.scores,
        plugins: opts.plugins,
        embedSongs: true,
    };
    return assembleAddonBlob(info, songs, assemblyOpts);
}
