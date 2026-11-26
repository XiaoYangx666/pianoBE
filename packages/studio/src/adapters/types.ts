import type {
    ContentOrigin,
    PerformanceCue,
    PerformanceDescriptor,
    ResourceDeployStatus,
} from "@piano/core";
import type { TimbreIndexEntry } from "@piano/assembly";
import type { VfxPluginIcon } from "@piano/vfx";
import type { PbePluginArchive } from "@piano/vfx/package";

export type { PerformanceDescriptor } from "@piano/core";

export type StudioMode = "local" | "server";

export interface StudioSong {
    id: string;
    name: string;
    duration: number;
    noteCount: number;
    bytes: number;
    musicFingerprint?: string;
    aliases?: string[];
    libraries?: string[];
    origin?: ContentOrigin;
    origins?: ContentOrigin[];
    performanceEntries: PerformanceDescriptor[];
    addedAt?: number;
    data?: Uint8Array;
}

export interface UserPerformanceRecord {
    id: string;
    songId: string;
    musicFingerprint?: string;
    name: string;
    author?: string;
    description?: string;
    cues: PerformanceCue[];
    requiredEffects: string[];
    createdAt: number;
}

export interface PluginContentCounts {
    songs: number;
    performances: number;
    libraries: number;
    timbres: number;
    effects: number;
    themes: number;
    keyStyles: number;
    particles: number;
    stageProps: number;
}

export interface PluginTimbreMeta {
    id: string;
    value?: number;
    label: string;
    description?: string;
    dirs: Record<string, string>;
    notes: readonly string[];
    layers: readonly string[];
}

export interface StudioPlugin {
    id: string;
    name: string;
    version: string;
    author: string;
    description: string;
    license?: string;
    source: "builtin" | "local" | "upload" | "song";
    visibility: "public" | "internal";
    installed: boolean;
    enabled: boolean;
    trusted: boolean;
    hasExecutableCode: boolean;
    requiresPackDeploy: boolean;
    compatible: boolean;
    compatibilityNote?: string;
    sizeBytes: number;
    file?: string;
    icon?: VfxPluginIcon;
    previewDataUrl?: string;
    dependencies: Array<{ id: string; range?: string }>;
    missingDependencies: string[];
    provides: Record<string, string[] | undefined>;
    contents: PluginContentCounts;
    timbreEntries?: PluginTimbreMeta[];
    status: ResourceDeployStatus;
    songSourceName?: string;
    archive?: PbePluginArchive;
}

export interface ServerScoreMeta {
    id: string;
    title: string;
    pages: string[];
    pageCount?: number;
}

export interface StudioDeploymentStatus {
    supported: boolean;
    status: ResourceDeployStatus;
    templateReady: boolean;
    targetConfigHash: string;
    deployedConfigHash?: string;
    loadedConfigHash?: string;
    deployedAt?: number;
    loadedAt?: number;
    enabledPlugins: string[];
    deployedPlugins: string[];
    loadedPlugins: string[];
    enabledTimbres: string[];
    availableTimbres: TimbreIndexEntry[];
    scores: ServerScoreMeta[];
    issues: string[];
    warnings: string[];
    bdsConfig: {
        bdsDir: string;
        bdsWorld: string;
        bdsBpName: string;
        bdsRpName: string;
        bdsPackMode: "development" | "release";
        packName: string;
        packDescription: string;
    };
}

export interface StudioTokenInfo {
    id: string;
    label: string;
    role: string;
    createdAt: number;
    lastUsedAt: number | null;
}
