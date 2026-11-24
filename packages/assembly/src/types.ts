import type { AddonTemplate, Manifest } from "@bepack/addon";
import type { MidiSongMeta } from "@piano/core";
import type { PbePluginArchive } from "@piano/vfx/package";

export interface AssemblySongEntry extends MidiSongMeta {
    noteCount: number;
    isOriginal?: boolean;
    fromLibrary?: boolean;
    moduleText?: string;
    data?: Uint8Array;
    voicePeak?: number;
}

export type AssemblyScoreSource = "template" | "custom";

export interface AssemblyScoreEntry {
    id: string;
    title: string;
    pages: string[];
    source: AssemblyScoreSource;
    pageCount?: number;
    assets?: Map<string, Uint8Array>;
}

export interface TimbreIndexEntry {
    id: string;
    value: number;
    label: string;
    description: string;
    required: boolean;
    bundled: boolean;
    dirs: Record<string, string>;
    notes: string[];
    layers: string[];
    size: number;
    file: string | null;
}

export interface LoadedTimbrePack {
    meta: TimbreIndexEntry;
    files: Map<string, Uint8Array>;
    soundDefinitions: Record<string, unknown>;
}

export interface TimbreExportSelection {
    all: TimbreIndexEntry[];
    selected: LoadedTimbrePack[];
    enabledIds: string[];
}

export interface TemplateInfo {
    addon: AddonTemplate;
    bpPath: string;
    rpPath: string;
    bpManifest: Manifest;
    rpManifest: Manifest;
    songs: AssemblySongEntry[];
    scores: AssemblyScoreEntry[];
}

export interface AssemblyOptions {
    name?: string;
    desc?: string;
    randomUuid?: boolean;
    /** 音色选择；不传则保持模板原样 */
    timbres?: TimbreExportSelection;
    /** 曲谱列表；不传或为空则保持模板原样 */
    scores?: AssemblyScoreEntry[];
    /** 插件包；传 [] 表示零插件模式，不传则保持模板原样 */
    plugins?: readonly PbePluginArchive[];
    /** 是否内嵌曲目到脚本（本地客户端默认 true；服务端 BDS 部署传 false） */
    embedSongs?: boolean;
}

export interface AssemblyResult {
    addon: AddonTemplate;
    bpPath: string;
    rpPath: string;
    installedPlugins: string[];
    configHash: string;
    resourcePackId?: string;
}
