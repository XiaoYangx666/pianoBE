import type {
    ContentOrigin,
    LibraryRecord,
    PerformanceDescriptor,
    ResourceDeployStatus,
} from "@piano/core";
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
    isOriginal?: boolean;
    fromLibrary?: boolean;
    addedAt?: number;
    playCount?: number;
    createdAt?: number;
    data?: Uint8Array;
    moduleText?: string;
}

export interface OfficialCollection {
    id: string;
    name: string;
    description: string;
    songIds: string[];
}

export interface OfficialCatalog {
    version: number;
    totalSongs: number;
    collections: OfficialCollection[];
    performances: Record<string, PerformanceDescriptor[]>;
    songs: Array<{
        id: string;
        name: string;
        duration: number;
        noteCount: number;
        bytes: number;
    }>;
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
    enabled: boolean;
    trusted: boolean;
    hasExecutableCode: boolean;
    compatible: boolean;
    compatibilityNote?: string;
    sizeBytes: number;
    previewDataUrl?: string;
    dependencies: Array<{ id: string; range?: string }>;
    provides: Record<string, string[] | undefined>;
    status: ResourceDeployStatus;
    songSourceName?: string;
    archive?: PbePluginArchive;
}

export interface StudioDeploymentStatus {
    supported: boolean;
    status: ResourceDeployStatus | "unconfigured";
    templateReady: boolean;
    configHash: string;
    deployedHash: string | null;
    loadedHash: string | null;
    lastDeployedAt: number | null;
    lastLoadedAt: number | null;
    pendingPlugins: string[];
    deployedPlugins: string[];
    loadedPlugins: string[];
    bdsConfig: {
        bdsDir: string;
        bdsWorld: string;
        bdsBpName: string;
        bdsRpName: string;
    };
}

export interface StudioTokenInfo {
    id: string;
    label: string;
    role: string;
    createdAt: number;
    lastUsedAt: number | null;
}

export interface ImportSummary {
    added: number;
    merged: number;
    conflicts: string[];
    songs: StudioSong[];
}
