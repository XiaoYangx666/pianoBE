import type { LibraryRecord } from "@piano/core";
import type { TemplateInfo, TimbreIndexEntry } from "@piano/assembly";
import type { PbePluginArchive } from "@piano/vfx/package";
import type {
    StudioDeploymentStatus,
    StudioMode,
    StudioPlugin,
    StudioSong,
} from "../adapters/types";
import type { ScoreEntry } from "../scores/scores";
import type { LatestTracker, MutationQueue } from "./concurrency";

export interface LocalAddonPlan {
    selectedLibraryIds: string[];
    extraSongIds: string[];
    excludedSongIds: string[];
    selectedTimbreIds: string[];
    addonName: string;
    addonDesc: string;
    randomUuid: boolean;
}

export interface StoreRuntime {
    queue: MutationQueue;
    refreshTracker: LatestTracker;
}

export interface AudioSlice {
    previewTimbreId: string;
    normalizeLoudness: boolean;
    setPreviewTimbre: (id: string) => Promise<void>;
    previewTimbreDemo: (id: string) => Promise<void>;
    auditionTimbreSample: (id: string) => Promise<void>;
    setNormalizeLoudness: (enabled: boolean) => void;
}

export interface LibrarySlice {
    songs: StudioSong[];
    libraries: LibraryRecord[];
    importFiles: (files: File[], targetLibraryId?: string) => Promise<void>;
    saveConvertedMidi: (name: string, midiBytes: Uint8Array, libraryId?: string) => Promise<void>;
    renameSong: (songId: string, name: string) => Promise<void>;
    deleteSong: (songId: string) => Promise<void>;
    importPerformanceFile: (songId: string, file: File) => Promise<void>;
    deletePerformance: (songId: string, perfId: string) => Promise<void>;
    getSongBytes: (songId: string) => Promise<Uint8Array>;
    getImportCode: (songId: string) => Promise<{ name: string; chunks: string[]; bytes: number }>;
    createLibrary: (name: string, description?: string) => Promise<LibraryRecord>;
    renameLibrary: (id: string, name: string) => Promise<void>;
    deleteLibrary: (id: string) => Promise<void>;
    clearLibrary: (libraryId: string) => Promise<void>;
    addSongsToLibrary: (libraryId: string, songIds: string[]) => Promise<void>;
    removeSongFromLibrary: (libraryId: string, songId: string) => Promise<void>;
    exportLibraryPlugin: (libraryId: string) => Promise<void>;
}

export interface PluginsSlice {
    plugins: StudioPlugin[];
    pendingTrustPlugins: Array<{
        plugin: StudioPlugin;
        bytes: Uint8Array;
    }>;
    loadPluginArchive: (plugin: StudioPlugin) => Promise<PbePluginArchive>;
    importSingleSongFromPlugin: (
        archive: PbePluginArchive,
        songId: string,
        opts: { includePerformances: boolean; targetLibraryId?: string },
    ) => Promise<void>;
    installBuiltinPlugin: (id: string, onProgress?: (loaded: number) => void) => Promise<void>;
    scanServerPlugins: () => Promise<void>;
    trustPlugin: (id: string) => Promise<void>;
    confirmPendingTrust: (approvedIds: string[]) => Promise<void>;
    cancelPendingTrust: () => void;
    togglePlugin: (id: string, enabled: boolean) => Promise<void>;
    uninstallPlugin: (id: string) => Promise<void>;
    autoMatchLocalPlugins: () => Promise<void>;
    zeroLocalPlugins: () => Promise<void>;
}

export interface AddonSlice {
    deploymentStatus: StudioDeploymentStatus | null;
    template: TemplateInfo | null;
    templateVersion: string;
    addonName: string;
    addonDesc: string;
    randomUuid: boolean;
    timbreIndex: TimbreIndexEntry[];
    installedTimbreIds: string[];
    selectedTimbreIds: string[];
    scores: ScoreEntry[];
    addonSelectedLibraryIds: string[];
    addonExtraSongIds: string[];
    addonExcludedSongIds: string[];
    selectedSongIds: string[];
    selectedPluginIds: string[];
    toggleLibraryInAddon: (libraryId: string) => void;
    toggleSongInAddon: (songId: string) => void;
    includeAllSongsInAddon: () => void;
    clearAddonSongs: () => void;
    setAddonName: (value: string) => void;
    setAddonDesc: (value: string) => void;
    setRandomUuid: (value: boolean) => void;
    toggleTimbre: (id: string) => Promise<void>;
    addScores: (entries: ScoreEntry[]) => Promise<void>;
    removeScore: (id: string) => Promise<void>;
    applyTemplateFile: (file: File) => Promise<void>;
    exportLocalMcaddon: () => Promise<void>;
    updateBdsConfig: (patch: {
        bdsDir?: string;
        bdsWorld?: string;
        bdsBpName?: string;
        bdsRpName?: string;
        bdsPackMode?: "development" | "release";
        packName?: string;
        packDescription?: string;
    }) => Promise<void>;
    deployServerToBds: () => Promise<void>;
    downloadServerAddon: () => Promise<void>;
}

export interface StudioState extends AudioSlice, LibrarySlice, PluginsSlice, AddonSlice {
    initialized: boolean;
    loading: boolean;
    busy: boolean;
    mode: StudioMode;
    serverAvailable: boolean;
    authRequired: boolean;
    authenticated: boolean;
    init: () => Promise<void>;
    loadTemplate: () => Promise<void>;
    switchMode: (mode: StudioMode) => Promise<void>;
    loginServer: (token: string) => Promise<void>;
    logoutServer: () => Promise<void>;
    refresh: () => Promise<void>;
}

export type StudioSet = (
    partial:
        | StudioState
        | Partial<StudioState>
        | ((state: StudioState) => StudioState | Partial<StudioState>),
) => void;

export type StudioGet = () => StudioState;
