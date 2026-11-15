import { create } from "zustand";
import {
    PIANO_SAMPLE_KEYS,
    PIANO_SOUND_LAYERS,
    PIANO_TIMBRES,
    pianoSoundId,
    planImportChunks,
} from "@piano/core";
import { notifications } from "@piano/ui";
import { loadTemplate, type TemplateInfo } from "../template";
import { generateAddonZip } from "../export";
import { midiFileToEntry } from "../convert";
import {
    libraryMetaToEntry,
    loadLibraryIndex,
    loadLibrarySong,
    recordLibraryAdd,
    recordLibraryPlay,
    type LibraryMeta,
} from "../library";
import { previewPlayer } from "../player";
import { loadTimbreIndex, loadTimbrePack, type LoadedTimbrePack, type TimbreIndexEntry } from "../timbres";
import { importScorePack, MAX_TITLE_CHARS, type ScoreEntry } from "../scores";
import { importScorePages } from "../importPages";
import type { SongEntry } from "../types";

export type LibrarySort = "adds" | "plays" | "name" | "default";

export const TIME_SCALE = 40;

function notifyError(title: string, error: unknown, fallback = "请稍后重试") {
    console.error(`[generator] ${title}`, error);
    notifications.show({
        title,
        message: error instanceof Error ? error.message : fallback,
        color: "red",
    });
}

/** 音色清单加载失败时的兜底：只有默认音色可直接使用，但仍知道可选目录以便裁剪旧模板。 */
function fallbackTimbreIndex(): TimbreIndexEntry[] {
    return PIANO_TIMBRES.map((timbre) => ({
        id: timbre.id,
        value: timbre.value,
        label: timbre.label,
        description: timbre.description,
        required: timbre.id === "piano",
        bundled: timbre.id === "piano",
        dirs: Object.fromEntries(
            PIANO_SOUND_LAYERS.map((layer) => [layer, pianoSoundId(timbre.value, layer)])
        ),
        notes: [...PIANO_SAMPLE_KEYS],
        layers: [...PIANO_SOUND_LAYERS],
        size: 0,
        file: null,
    }));
}

function bytesToMB(bytes: number) {
    return `${(bytes / 1048576).toFixed(2)} MB`;
}

export { bytesToMB };

interface GeneratorState {
    ready: boolean;
    loadingText: string | null;
    template: TemplateInfo | null;
    songs: SongEntry[];
    scores: ScoreEntry[];
    library: LibraryMeta[] | null;
    libSort: LibrarySort;
    timbres: TimbreIndexEntry[];
    selectedTimbres: string[];
    previewTimbreId: string;
    pendingPreviewId: string | null;
    pendingAddId: string | null;
    addonName: string;
    addonDesc: string;
    randomUuid: boolean;
    exporting: boolean;
    templateVersion: string;

    init: () => Promise<void>;
    setLoading: (text: string | null) => void;
    applyTemplate: (file: Blob) => Promise<void>;
    setAddonName: (value: string) => void;
    setAddonDesc: (value: string) => void;
    setRandomUuid: (value: boolean) => void;

    addMidiFiles: (files: File[]) => Promise<void>;
    addLibrarySong: (id: string) => Promise<void>;
    togglePreview: (entry: SongEntry) => Promise<void>;
    previewLibrarySong: (meta: LibraryMeta) => Promise<void>;
    removeSong: (id: string) => void;
    clearSongs: () => void;

    setLibSort: (sort: LibrarySort) => void;

    toggleTimbre: (id: string, checked: boolean) => void;
    setPreviewTimbre: (id: string) => Promise<void>;
    selectedTimbreSize: () => number;

    setScores: (scores: ScoreEntry[]) => void;
    importScorePackFiles: (files: File[]) => Promise<void>;
    importScorePageFiles: (
        files: File[],
        requestTitle: (defaultTitle: string, hint: string) => Promise<string | null>
    ) => Promise<void>;
    removeScore: (index: number) => void;

    exportAddon: () => Promise<void>;

    scoreChunks: (entry: SongEntry) => string[];
    loadLibraryEntry: (meta: LibraryMeta) => Promise<SongEntry>;
}

const loadedTimbres = new Map<string, LoadedTimbrePack>();

function attachTimbrePack(template: TemplateInfo | null, pack: LoadedTimbrePack) {
    if (!template) return;
    for (const [path, data] of pack.files) {
        if (path.startsWith("sounds/")) {
            template.addon.write(`${template.rpPath}${path}`, data);
        }
    }
}

async function ensureTimbrePack(meta: TimbreIndexEntry): Promise<LoadedTimbrePack> {
    let pack = loadedTimbres.get(meta.id);
    if (!pack) {
        pack = await loadTimbrePack(meta);
        loadedTimbres.set(meta.id, pack);
    }
    attachTimbrePack(useGenerator.getState().template, pack);
    return pack;
}

let libraryPromise: Promise<LibraryMeta[]> | null = null;
let initStarted = false;

export const useGenerator = create<GeneratorState>((set, get) => ({
    ready: false,
    loadingText: null,
    template: null,
    songs: [],
    scores: [],
    library: null,
    libSort: "adds",
    timbres: [],
    selectedTimbres: ["piano"],
    previewTimbreId: "piano",
    pendingPreviewId: null,
    pendingAddId: null,
    addonName: "",
    addonDesc: "",
    randomUuid: true,
    exporting: false,
    templateVersion: "未加载",

    setLoading: (text) => set({ loadingText: text }),

    init: async () => {
        if (get().ready || initStarted) return;
        initStarted = true;

        if (!libraryPromise) libraryPromise = loadLibraryIndex();
        libraryPromise
            .then((library) => set({ library }))
            .catch((error) => notifyError("曲库加载失败", error));

        loadTimbreIndex()
            .then((index) => {
                const timbres = index.length ? index : fallbackTimbreIndex();
                if (!timbres.some((item) => item.id === get().previewTimbreId)) {
                    set({ previewTimbreId: "piano" });
                }
                set({
                    timbres,
                    selectedTimbres: timbres.filter((item) => item.required).map((item) => item.id),
                });
            })
            .catch((error) => notifyError("音色清单加载失败", error));

        try {
            set({ loadingText: "下载模板包…" });
            const res = await fetch(`./template.mcaddon?v=${Date.now()}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            await get().applyTemplate(await res.blob());
        } catch (error) {
            notifyError("默认底包加载失败", error, "你仍然可以手动更换模板包");
        } finally {
            set({ loadingText: null, ready: true });
        }
    },

    applyTemplate: async (file) => {
        set({ loadingText: "解析 Addon 模板…" });
        try {
            const template = await loadTemplate(file);
            for (const pack of loadedTimbres.values()) attachTimbrePack(template, pack);
            previewPlayer.bindTemplate(template);

            const previewMeta = get().timbres.find((item) => item.id === get().previewTimbreId);
            if (!previewMeta || (!previewMeta.bundled && !loadedTimbres.has(previewMeta.id))) {
                set({ previewTimbreId: "piano" });
            }
            previewPlayer.setTimbre(
                get().timbres.find((item) => item.id === get().previewTimbreId)?.value ?? 0
            );
            void previewPlayer.warmup().catch(() => {});

            const header = template.bpManifest.header;
            const version = header?.version;
            set({
                template,
                songs: template.songs,
                scores: template.scores,
                addonName: header?.name ?? "",
                addonDesc: header?.description ?? "",
                templateVersion: Array.isArray(version)
                    ? version.join(".")
                    : typeof version === "string"
                      ? version
                      : "Unknown",
            });
            notifications.show({
                title: "模板已加载",
                message: `${header?.name ?? "PianoBE 模板"} · ${template.songs.length} 首内置曲目`,
                color: "teal",
            });
        } catch (error) {
            previewPlayer.bindTemplate(null);
            notifyError("模板加载失败", error);
        } finally {
            set({ loadingText: null });
        }
    },

    setAddonName: (addonName) => set({ addonName }),
    setAddonDesc: (addonDesc) => set({ addonDesc }),
    setRandomUuid: (randomUuid) => set({ randomUuid }),

    addMidiFiles: async (files) => {
        if (!get().template) {
            notifications.show({ title: "模板尚未加载", message: "请等待底包解析完成后再导入 MIDI", color: "yellow" });
            return;
        }
        set({ loadingText: "正在转换 MIDI..." });
        let skipped = 0;
        const added: SongEntry[] = [];
        try {
            for (const file of files) {
                try {
                    const entry = await midiFileToEntry(file);
                    const libraryIds = new Set((get().library ?? []).map((meta) => meta.id));
                    const current = get().songs;
                    if (current.some((song) => song.id === entry.id) || libraryIds.has(entry.id)) {
                        skipped++;
                        continue;
                    }
                    added.push(entry);
                } catch (error) {
                    notifyError(`MIDI 导入失败：${file.name}`, error);
                }
            }
            if (added.length > 0) set({ songs: [...get().songs, ...added] });
            if (added.length > 0) {
                notifications.show({
                    title: "MIDI 已导入",
                    message: `新增 ${added.length} 首${skipped ? `，跳过 ${skipped} 首重复曲目` : ""}`,
                    color: "teal",
                });
            } else if (skipped > 0) {
                notifications.show({
                    title: "没有新增曲目",
                    message: `${skipped} 个文件已在列表或曲库中`,
                    color: "gray",
                });
            }
        } finally {
            set({ loadingText: null });
        }
    },

    loadLibraryEntry: async (meta) => {
        const song = await loadLibrarySong(meta);
        return libraryMetaToEntry(meta, song);
    },

    addLibrarySong: async (id) => {
        const library = get().library;
        if (!library) return;
        const meta = library.find((item) => item.id === id);
        if (!meta || get().songs.some((song) => song.id === id)) return;
        set({ pendingAddId: id });
        try {
            const song = await get().loadLibraryEntry(meta);
            set({ songs: [...get().songs, song] });
            notifications.show({ title: "已加入制作清单", message: meta.name, color: "teal" });
            void recordLibraryAdd(id).then((counted) => {
                if (!counted) return;
                const current = get().library;
                if (!current) return;
                set({ library: current.map((item) => (item.id === id ? { ...item, adds: item.adds + 1 } : item)) });
            });
        } catch (error) {
            notifyError("曲库加载失败", error);
        } finally {
            set({ pendingAddId: null });
        }
    },

    togglePreview: async (entry) => {
        if (!previewPlayer.available) {
            notifications.show({ title: "模板未加载", message: "底包模板解析完成后才能试听", color: "yellow" });
            return;
        }
        if (previewPlayer.playingId === entry.id) {
            previewPlayer.stop();
            return;
        }
        set({ pendingPreviewId: entry.id });
        try {
            await previewPlayer.play(entry);
            const library = get().library;
            const meta = library?.find((item) => item.id === entry.id);
            if (meta) {
                void recordLibraryPlay(entry.id).then((counted) => {
                    if (!counted) return;
                    const current = get().library;
                    if (!current) return;
                    set({
                        library: current.map((item) =>
                            item.id === entry.id ? { ...item, plays: item.plays + 1 } : item
                        ),
                    });
                });
            }
        } catch (error) {
            notifyError("试听失败", error);
        } finally {
            set({ pendingPreviewId: null });
        }
    },

    previewLibrarySong: async (meta) => {
        if (previewPlayer.playingId === meta.id) {
            previewPlayer.stop();
            return;
        }
        try {
            const entry = await get().loadLibraryEntry(meta);
            await get().togglePreview(entry);
        } catch (error) {
            notifyError("曲目加载失败", error);
        }
    },

    removeSong: (id) => {
        if (previewPlayer.playingId === id) previewPlayer.stop();
        set({ songs: get().songs.filter((song) => song.id !== id) });
    },

    clearSongs: () => {
        previewPlayer.stop();
        set({ songs: [] });
    },

    setLibSort: (libSort) => set({ libSort }),

    toggleTimbre: (id, checked) => {
        const timbre = get().timbres.find((item) => item.id === id);
        if (!timbre || timbre.required) return;
        const selected = new Set(get().selectedTimbres);
        checked ? selected.add(id) : selected.delete(id);
        set({ selectedTimbres: [...selected] });
    },

    setPreviewTimbre: async (id) => {
        const meta = get().timbres.find((item) => item.id === id);
        if (!meta || !get().template) return;
        previewPlayer.stop();
        if (!meta.bundled) {
            set({ loadingText: "加载音色包..." });
            try {
                await ensureTimbrePack(meta);
            } catch (error) {
                notifyError("音色包加载失败", error);
                set({ loadingText: null });
                return;
            } finally {
                set({ loadingText: null });
            }
        }
        previewPlayer.setTimbre(meta.value);
        set({ previewTimbreId: id });
        void previewPlayer.warmup().catch(() => {});
        notifications.show({ title: "试听音色已切换", message: meta.label, color: "gray" });
    },

    selectedTimbreSize: () => {
        return get()
            .timbres.filter((meta) => get().selectedTimbres.includes(meta.id) && !meta.bundled)
            .reduce((sum, meta) => sum + meta.size, 0);
    },

    setScores: (scores) => set({ scores }),

    importScorePackFiles: async (files) => {
        if (!get().template) {
            notifications.show({ title: "模板未加载", message: "请等待底包解析完成", color: "yellow" });
            return;
        }
        set({ loadingText: "解析曲谱包..." });
        const added: ScoreEntry[] = [];
        const errors: string[] = [];
        try {
            for (const file of files) {
                try {
                    const entries = await importScorePack(file, [...get().scores, ...added]);
                    added.push(...entries);
                } catch (error) {
                    console.error(`[generator] 曲谱包导入失败（${file.name}）：`, error);
                    errors.push(`${file.name}：${(error as Error).message}`);
                }
            }
            if (added.length > 0) set({ scores: [...get().scores, ...added] });
            if (errors.length > 0) {
                notifications.show({ title: "部分曲谱包导入失败", message: errors.join("；"), color: "red" });
            } else if (added.length > 0) {
                notifications.show({ title: "曲谱包已导入", message: `新增 ${added.length} 张曲谱`, color: "teal" });
            }
        } finally {
            set({ loadingText: null });
        }
    },

    importScorePageFiles: async (files, requestTitle) => {
        if (!get().template) {
            notifications.show({ title: "模板未加载", message: "请等待底包解析完成", color: "yellow" });
            return;
        }
        set({ loadingText: "正在导入曲谱..." });
        try {
            const result = await importScorePages(files, get().scores, {
                requestTitle: async (defaultTitle, hint) => {
                    set({ loadingText: null });
                    const title = await requestTitle(defaultTitle, hint);
                    set({ loadingText: "正在导入曲谱..." });
                    return title;
                },
                onProgress: (text) => set({ loadingText: text }),
            });
            if (result.scores.length > 0) {
                set({ scores: [...get().scores, ...result.scores] });
                notifications.show({
                    title: "曲谱已导入",
                    message: `新增 ${result.scores.length} 张曲谱`,
                    color: "teal",
                });
            }
            if (result.errors.length > 0) {
                notifications.show({ title: "部分曲谱导入失败", message: result.errors.join("；"), color: "red" });
            }
        } catch (error) {
            notifyError("曲谱导入失败", error);
        } finally {
            set({ loadingText: null });
        }
    },

    removeScore: (index) => {
        set({ scores: get().scores.filter((_, i) => i !== index) });
    },

    exportAddon: async () => {
        const { template, timbres, selectedTimbres, songs, scores } = get();
        if (!template) return;
        previewPlayer.stop();
        set({ exporting: true, loadingText: "加载音色包..." });
        try {
            const selectedPacks: LoadedTimbrePack[] = [];
            for (const meta of timbres) {
                if (meta.bundled || !selectedTimbres.includes(meta.id)) continue;
                selectedPacks.push(await ensureTimbrePack(meta));
            }
            set({ loadingText: "导出打包中..." });
            const name = get().addonName.trim() || "Piano Addon";
            const desc = get().addonDesc.trim() || "Powered by PianoBE";
            const blob = await generateAddonZip(template, songs, {
                name,
                desc,
                randomUuid: get().randomUuid,
                timbres: {
                    all: timbres,
                    selected: selectedPacks,
                    enabledIds: timbres.filter((meta) => selectedTimbres.includes(meta.id)).map((meta) => meta.id),
                },
                scores,
            });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = `${name.replace(/\s+/g, "_")}.mcaddon`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
            notifications.show({
                title: "附加包已导出",
                message: `${name} · ${songs.length} 首曲目 / ${scores.length} 张曲谱`,
                color: "teal",
            });
        } catch (error) {
            notifyError("打包失败", error);
        } finally {
            set({ exporting: false, loadingText: null });
        }
    },

    scoreChunks: (entry) => {
        if (!entry.data) return [];
        return planImportChunks(entry.data);
    },
}));

/** 用于 UI 的标题长度校验。 */
export { MAX_TITLE_CHARS };
