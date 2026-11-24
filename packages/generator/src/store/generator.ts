import { create } from "zustand";
import {
    BEDROCK_SIMULTANEOUS_SOUND,
    MAX_SONG_NAME_CHARS,
    PIANO_SAMPLE_KEYS,
    PIANO_TIMBRES,
    pianoSoundLayers,
    pianoSoundId,
    planImportChunks,
    renameSong,
} from "@piano/core";
import { notifications } from "@piano/ui";
import { loadTemplate, type TemplateInfo } from "../addon/template";
import { generateAddonZip } from "../addon/export";
import { midiFileToEntry } from "../music/convert";
import { mergeSongEntries } from "../music/groupSongs";
import {
    libraryMetaToEntry,
    loadLibraryIndex,
    loadLibrarySong,
    recordLibraryAdd,
    recordLibraryPlay,
    type LibraryMeta,
} from "../music/library";
import { previewPlayer } from "../music/player";
import { loadTimbreIndex, loadTimbrePack, type LoadedTimbrePack, type TimbreIndexEntry } from "../addon/timbres";
import { importScorePack, MAX_TITLE_CHARS, type ScoreEntry } from "../scores/scores";
import { importScorePages } from "../scores/importPages";
import type { SongEntry } from "../types";
import { deleteLocalSong, listLocalSongs, putLocalSongs, type StoredSong } from "../music/localLibrary";
import { deleteLocalPlugin, listLocalPlugins, putLocalPlugins, type StoredPlugin } from "../addon/localPlugins";
import {
    loadPluginArchive,
    loadPluginIndex,
    matchSongPlugins,
    mergePluginLists,
    parsePbePluginFile,
    storedPluginToEntry,
    unpackSongBundles,
    withPluginDependencies,
    type GeneratorPluginEntry,
} from "../addon/plugins";
import type { PbePluginArchive } from "@piano/vfx/package";

export type LibrarySort = "adds" | "plays" | "name" | "default";

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
    return PIANO_TIMBRES.map((timbre) => {
        const layers = pianoSoundLayers(timbre.value);
        return {
            id: timbre.id,
            value: timbre.value,
            label: timbre.label,
            description: timbre.description,
            required: timbre.id === "piano",
            bundled: timbre.id === "piano",
            dirs: Object.fromEntries(
                layers.map((layer) => [`v${layer + 1}`, pianoSoundId(timbre.value, layer)])
            ),
            notes: [...PIANO_SAMPLE_KEYS],
            layers: layers.map((layer) => `v${layer + 1}`),
            size: 0,
            file: null,
        };
    });
}

function bytesToMB(bytes: number) {
    return `${(bytes / 1048576).toFixed(2)} MB`;
}

export { bytesToMB };

interface GeneratorState {
    ready: boolean;
    loadingText: string | null;
    template: TemplateInfo | null;
    /** 当前附加包工作区：模板曲目 + 从在线曲库或「我的音乐」直接加入的曲目 */
    songs: SongEntry[];
    /** 本地持久音乐库：只存 PBE3，跨刷新保留 */
    myMusic: StoredSong[];
    myMusicReady: boolean;
    scores: ScoreEntry[];
    library: LibraryMeta[] | null;
    libSort: LibrarySort;
    timbres: TimbreIndexEntry[];
    selectedTimbres: string[];
    plugins: GeneratorPluginEntry[];
    selectedPlugins: string[];
    manualPluginOverrides: Record<string, boolean>;
    pendingTrustPlugins: GeneratorPluginEntry[];
    pluginsReady: boolean;
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
    applyTemplate: (file: Blob, options?: { silent?: boolean }) => Promise<void>;
    setAddonName: (value: string) => void;
    setAddonDesc: (value: string) => void;
    setRandomUuid: (value: boolean) => void;

    addMidiFiles: (files: File[], options?: { addToAddon?: boolean }) => Promise<void>;
    addLibrarySong: (id: string) => Promise<void>;
    /** 把在线曲库曲目保存到本地「我的音乐」，不自动加入附加包 */
    saveLibrarySong: (id: string) => Promise<void>;
    addToAddon: (entry: SongEntry) => void;
    /** 同时重命名「我的音乐」（含本地持久化）与制作清单里的同 id 曲目。 */
    renameSong: (id: string, name: string) => Promise<void>;
    removeMyMusicSong: (id: string) => Promise<void>;
    togglePreview: (entry: SongEntry) => Promise<void>;
    previewLibrarySong: (meta: LibraryMeta) => Promise<void>;
    removeSong: (id: string) => void;
    clearSongs: () => void;

    setLibSort: (sort: LibrarySort) => void;

    toggleTimbre: (id: string, checked: boolean) => void;
    setPreviewTimbre: (id: string) => Promise<void>;
    selectedTimbreSize: () => number;

    togglePlugin: (id: string, checked: boolean) => void;
    selectZeroPlugins: () => void;
    autoSelectRequiredPlugins: () => void;
    importPluginFiles: (files: File[]) => Promise<void>;
    importSongBundleFiles: (files: File[]) => Promise<void>;
    confirmTrustPlugins: (ids: string[]) => Promise<void>;
    dismissTrustPlugins: () => void;
    uninstallPlugin: (id: string) => Promise<void>;

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

function computeNextSelectedPlugins(
    songs: readonly SongEntry[],
    plugins: readonly GeneratorPluginEntry[],
    currentSelected: readonly string[],
    overrides: Readonly<Record<string, boolean>>,
): string[] {
    const available = new Set(
        plugins.filter((plugin) => plugin.compatible && plugin.trusted).map((plugin) => plugin.id),
    );
    const next = new Set(currentSelected.filter((id) => available.has(id)));
    const match = matchSongPlugins(songs, plugins, [...next]);
    for (const requiredId of match.autoSelectedIds) {
        if (available.has(requiredId) && overrides[requiredId] !== false) {
            next.add(requiredId);
        }
    }
    return withPluginDependencies([...next], plugins).filter(id => overrides[id] !== false);
}

function withSyncedPlugins(
    state: Pick<GeneratorState, "pluginsReady" | "plugins" | "selectedPlugins" | "manualPluginOverrides">,
    songs: SongEntry[],
): Pick<GeneratorState, "songs" | "selectedPlugins"> {
    return {
        songs,
        selectedPlugins: state.pluginsReady
            ? computeNextSelectedPlugins(
                  songs,
                  state.plugins,
                  state.selectedPlugins,
                  state.manualPluginOverrides,
              )
            : state.selectedPlugins,
    };
}

let libraryPromise: Promise<LibraryMeta[]> | null = null;
let initStarted = false;

export const useGenerator = create<GeneratorState>((set, get) => ({
    ready: false,
    loadingText: null,
    template: null,
    songs: [],
    myMusic: [],
    myMusicReady: false,
    scores: [],
    library: null,
    libSort: "adds",
    timbres: [],
    selectedTimbres: ["piano"],
    plugins: [],
    selectedPlugins: [],
    manualPluginOverrides: {},
    pendingTrustPlugins: [],
    pluginsReady: false,
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

        listLocalSongs()
            .then((myMusic) => set((state) => ({
                myMusic: mergeSongEntries(myMusic, state.myMusic).rows.sort((a, b) => b.createdAt - a.createdAt),
                myMusicReady: true,
            })))
            .catch((error) => {
                console.error("[generator] 本地音乐库加载失败", error);
                set({ myMusicReady: true });
            });

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

        Promise.all([
            loadPluginIndex(),
            listLocalPlugins().catch((error) => {
                console.error("[generator] 本地插件加载失败", error);
                return [];
            }),
        ])
            .then(([builtins, storedLocals]) => {
                const locals = storedLocals
                    .map(storedPluginToEntry)
                    .filter((entry): entry is GeneratorPluginEntry => entry !== null);
                const plugins = mergePluginLists(builtins, locals);
                const overrides = get().manualPluginOverrides;
                const baseSelected = plugins
                    .filter((plugin) => plugin.compatible && plugin.trusted && plugin.source === "builtin" && overrides[plugin.id] !== false)
                    .map((plugin) => plugin.id);
                const selectedPlugins = computeNextSelectedPlugins(
                    get().songs,
                    plugins,
                    baseSelected,
                    overrides,
                );
                set({ plugins, selectedPlugins, pluginsReady: true });
            })
            .catch((error) => {
                console.error("[generator] 插件清单初始化失败", error);
                set({ pluginsReady: true });
            });

        try {
            set({ loadingText: "下载模板包…" });
            const res = await fetch(`./template.mcaddon?v=${Date.now()}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            await get().applyTemplate(await res.blob(), { silent: true });
        } catch (error) {
            notifyError("默认底包加载失败", error, "你仍然可以手动更换模板包");
        } finally {
            set({ loadingText: null, ready: true });
        }
    },

    applyTemplate: async (file, options) => {
        set({ loadingText: "解析 Addon 模板…" });
        try {
            const template = await loadTemplate(file);
            if (options?.silent && get().template) return;
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
            set((state) => ({
                template,
                ...withSyncedPlugins(state, options?.silent
                    ? mergeSongEntries(template.songs, state.songs).rows
                    : template.songs),
                scores: template.scores,
                addonName: header?.name ?? "",
                addonDesc: header?.description ?? "",
                templateVersion: Array.isArray(version)
                    ? version.join(".")
                    : typeof version === "string"
                      ? version
                      : "Unknown",
            }));
            if (!options?.silent) {
                notifications.show({
                    title: "模板已加载",
                    message: `${header?.name ?? "PianoBE 模板"} · ${template.songs.length} 首内置曲目`,
                    color: "teal",
                });
            }
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

    addMidiFiles: async (files, options) => {
        const addToAddon = options?.addToAddon ?? false;
        set({ loadingText: "正在转换 MIDI..." });
        let skipped = 0;
        const added: StoredSong[] = [];
        const overloaded: StoredSong[] = [];
        const base = Date.now();
        try {
            for (const file of files) {
                try {
                    const entry = await midiFileToEntry(file);
                    added.push({ ...entry, createdAt: base + added.length });
                    if ((entry.voicePeak ?? 0) > BEDROCK_SIMULTANEOUS_SOUND) overloaded.push({ ...entry, createdAt: 0 });
                } catch (error) {
                    notifyError(`MIDI 导入失败：${file.name}`, error);
                }
            }
            if (added.length > 0) {
                const local = mergeSongEntries(get().myMusic, added);
                skipped = added.length - local.changed.length;
                try {
                    await putLocalSongs(local.changed);
                } catch (error) {
                    notifyError("写入我的音乐失败", error);
                    return;
                }
                set({ myMusic: local.rows.sort((a, b) => b.createdAt - a.createdAt) });
                if (addToAddon) {
                    set((state) => {
                        return withSyncedPlugins(state, mergeSongEntries(state.songs, added).rows);
                    });
                }
                notifications.show({
                    title: addToAddon ? "已导入并加入附加包" : "已加入我的音乐",
                    message: `新增或更新 ${local.changed.length} 首${skipped ? `，已归并或跳过 ${skipped} 份导入` : ""}`,
                    color: "teal",
                });
                if (overloaded.length > 0) {
                    const worst = overloaded.reduce((a, b) => ((b.voicePeak ?? 0) > (a.voicePeak ?? 0) ? b : a));
                    const names = overloaded.slice(0, 3).map((song) => `《${song.name}》`).join("、");
                    notifications.show({
                        title: "部分曲目声部超限",
                        message:
                            `${overloaded.length} 首曲目最密集处同时发声超过 ${BEDROCK_SIMULTANEOUS_SOUND} 个` +
                            `（${names}${overloaded.length > 3 ? " 等" : ""}，最高 ${worst.voicePeak} 个）。` +
                            "游戏内超出上限的音会自动省略，建议精简声部后再导入。",
                        color: "yellow",
                        duration: 10_000,
                    });
                }
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
        if (get().pendingAddId === id) return;
        const library = get().library;
        if (!library) return;
        const meta = library.find((item) => item.id === id);
        if (!meta) return;
        set({ pendingAddId: id });
        try {
            const song = await get().loadLibraryEntry(meta);
            const state = get();
            const merged = mergeSongEntries(state.songs, [song]);
            if (!merged.changed.length) {
                notifications.show({ title: "已在附加包中", message: meta.name, color: "gray" });
                return;
            }
            set(withSyncedPlugins(state, merged.rows));
            notifications.show({ title: "已加入附加包", message: meta.name, color: "teal" });
            void recordLibraryAdd(id).then((counted) => {
                if (!counted) return;
                const current = get().library;
                if (!current) return;
                set({ library: current.map((item) => (item.id === id ? { ...item, adds: item.adds + 1 } : item)) });
            });
        } catch (error) {
            notifyError("加入附加包失败", error);
        } finally {
            set({ pendingAddId: null });
        }
    },

    saveLibrarySong: async (id) => {
        if (get().pendingAddId === id) return;
        const library = get().library;
        if (!library) return;
        const meta = library.find((item) => item.id === id);
        if (!meta) return;
        set({ pendingAddId: id });
        try {
            const song = await get().loadLibraryEntry(meta);
            const stored: StoredSong = { ...song, fromLibrary: true, createdAt: Date.now() };
            const local = mergeSongEntries(get().myMusic, [stored]);
            await putLocalSongs(local.changed);
            set({ myMusic: local.rows.sort((a, b) => b.createdAt - a.createdAt) });
            notifications.show({ title: "已保存到我的音乐", message: meta.name, color: "teal" });
        } catch (error) {
            notifyError("保存到我的音乐失败", error);
        } finally {
            set({ pendingAddId: null });
        }
    },

    addToAddon: (entry) => {
        const state = get();
        const merged = mergeSongEntries(state.songs, [entry]);
        if (!merged.changed.length) return;
        set(withSyncedPlugins(state, merged.rows));
        notifications.show({ title: "已加入附加包", message: entry.name, color: "teal" });
    },

    renameSong: async (id, name) => {
        const next = name.trim();
        if (!next) {
            notifications.show({ title: "改名失败", message: "曲名不能为空", color: "red" });
            return;
        }
        if (Array.from(next).length > MAX_SONG_NAME_CHARS) {
            notifications.show({
                title: "改名失败",
                message: `曲名最多 ${MAX_SONG_NAME_CHARS} 个字符`,
                color: "red",
            });
            return;
        }
        const inMine = get().myMusic.find((song) => song.id === id);
        const inAddon = get().songs.find((song) => song.id === id);
        const current = inMine ?? inAddon;
        if (!current) return;
        if (current.name === next) return;

        // 索引和 PBE3 文件头里的名字都更新，保证列表、导入码、导出包一致。
        let mineData = inMine?.data;
        let addonData = inAddon?.data;
        try {
            if (mineData) mineData = renameSong(mineData, next);
            if (addonData) addonData = renameSong(addonData, next);
        } catch (error) {
            notifyError("改名失败", error);
            return;
        }

        const mine = get().myMusic;
        const nextMine = inMine
            ? mine.map((song) =>
                  song.id === id ? { ...song, name: next, data: mineData ?? song.data } : song
              )
            : mine;
        if (inMine) set({ myMusic: nextMine });
        if (inAddon) {
            set({
                songs: get().songs.map((song) =>
                    song.id === id ? { ...song, name: next, data: addonData ?? song.data } : song
                ),
            });
        }

        try {
            if (inMine) {
                const stored = nextMine.find((song) => song.id === id);
                if (stored) await putLocalSongs([stored]);
            }
            notifications.show({ title: "已改名", message: next, color: "teal" });
        } catch (error) {
            notifyError("保存新曲名失败", error);
        }
    },

    removeMyMusicSong: async (id) => {
        try {
            await deleteLocalSong(id);
            set({ myMusic: get().myMusic.filter((song) => song.id !== id) });
        } catch (error) {
            notifyError("从我的音乐删除失败", error);
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

    togglePlugin: (id, checked) => {
        const plugin = get().plugins.find((item) => item.id === id);
        if (!plugin) return;
        if (checked && (!plugin.compatible || !plugin.trusted)) {
            notifications.show({
                title: "无法启用插件",
                message: !plugin.compatible
                    ? (plugin.compatibilityReason ?? "插件与当前 VFX API 不兼容")
                    : "请先确认信任该插件后再启用",
                color: "yellow",
            });
            return;
        }
        const selected = new Set(get().selectedPlugins);
        checked ? selected.add(id) : selected.delete(id);
        const overrides = { ...get().manualPluginOverrides, [id]: checked };
        let nextSelected = [...selected];
        if (checked) {
            for (const required of withPluginDependencies([id], get().plugins)) {
                selected.add(required);
                overrides[required] = true;
            }
            nextSelected = [...selected];
        } else {
            nextSelected = nextSelected.filter(selectedId => !withPluginDependencies([selectedId], get().plugins).includes(id));
            for (const dependent of selected) {
                if (!nextSelected.includes(dependent)) overrides[dependent] = false;
            }
        }
        set({ selectedPlugins: nextSelected, manualPluginOverrides: overrides });

        if (!checked) {
            const match = matchSongPlugins(get().songs, get().plugins, nextSelected);
            const affected = match.disabledRequiredEffects.filter((item) => item.pluginId === id);
            if (affected.length > 0) {
                const effectList = [...new Set(affected.map((item) => item.effect))].slice(0, 4).join("、");
                notifications.show({
                    title: "已取消曲目所需插件",
                    message: `演出会跳过引用 ${effectList}${affected.length > 4 ? " 等" : ""} 的提示`,
                    color: "yellow",
                    duration: 8_000,
                });
            }
        }
    },

    selectZeroPlugins: () => {
        const overrides: Record<string, boolean> = {};
        for (const plugin of get().plugins) overrides[plugin.id] = false;
        set({ selectedPlugins: [], manualPluginOverrides: overrides });
        notifications.show({
            title: "已切换为零插件模式",
            message: "导出包将不包含任何 VFX 特效插件，仅保留公共底座与音频播放能力",
            color: "gray",
        });
    },

    autoSelectRequiredPlugins: () => {
        const { songs, plugins } = get();
        const match = matchSongPlugins(songs, plugins, []);
        const next = match.autoSelectedIds.filter((id) => {
            const plugin = plugins.find((item) => item.id === id);
            return plugin?.compatible && plugin.trusted;
        });
        const overrides: Record<string, boolean> = {};
        for (const plugin of plugins) {
            if (!next.includes(plugin.id)) overrides[plugin.id] = false;
        }
        set({ selectedPlugins: next, manualPluginOverrides: overrides });
        notifications.show({
            title: "已按曲目自动匹配插件",
            message:
                next.length > 0
                    ? `已自动选中 ${next.length} 个所需 VFX 插件`
                    : "当前曲目未声明特定 VFX 特效需求（已设为零插件）",
            color: "teal",
        });
    },

    importPluginFiles: async (files) => {
        if (files.length === 0) return;
        set({ loadingText: "正在解析插件包..." });
        try {
            const parsed = new Map<string, GeneratorPluginEntry>();
            for (const file of files) {
                try {
                    const entry = await parsePbePluginFile(file, "local");
                    parsed.set(entry.id, entry);
                } catch (error) {
                    notifyError(`插件解析失败：${file.name}`, error);
                }
            }
            if (parsed.size > 0) {
                const existing = new Map(get().pendingTrustPlugins.map((item) => [item.id, item]));
                for (const [id, entry] of parsed) existing.set(id, entry);
                set({ pendingTrustPlugins: [...existing.values()] });
            }
        } finally {
            set({ loadingText: null });
        }
    },

    importSongBundleFiles: async (files) => {
        if (files.length === 0) return;
        set({ loadingText: "正在解析曲目与附带资源..." });
        try {
            const bundle = await unpackSongBundles(files);
            const now = Date.now();
            const local = mergeSongEntries(get().myMusic,
                bundle.songs.map((song, index) => ({ ...song, createdAt: now + index })));
            await putLocalSongs(local.changed);
            if (bundle.songs.length > 0) {
                set((state) => {
                    const nextSongs = mergeSongEntries(state.songs, bundle.songs);
                    return {
                        myMusic: local.rows.sort((a, b) => b.createdAt - a.createdAt),
                        ...withSyncedPlugins(state, nextSongs.rows),
                    };
                });
                notifications.show({
                    title: "已导入曲目",
                    message: `已处理 ${bundle.songs.length} 份 PBE3，按音乐内容归并到当前附加包`,
                    color: "teal",
                });
            }
            if (bundle.plugins.length > 0) {
                const pending = new Map(get().pendingTrustPlugins.map((item) => [item.id, item]));
                for (const plugin of bundle.plugins) pending.set(plugin.id, plugin);
                set({ pendingTrustPlugins: [...pending.values()] });
            }
            if (bundle.errors.length > 0) {
                notifications.show({
                    title: "部分文件导入失败",
                    message: bundle.errors.join("；"),
                    color: "red",
                });
            }
        } catch (error) {
            notifyError("曲目导入失败", error);
        } finally {
            set({ loadingText: null });
        }
    },

    confirmTrustPlugins: async (ids) => {
        const idSet = new Set(ids);
        const approved = get().pendingTrustPlugins.filter((item) => idSet.has(item.id));
        if (approved.length === 0) {
            set({ pendingTrustPlugins: [] });
            return;
        }
        const trustedEntries: GeneratorPluginEntry[] = approved.map((item) => ({
            ...item,
            trusted: true,
        }));
        const toStore: StoredPlugin[] = trustedEntries
            .filter((item): item is GeneratorPluginEntry & { bytes: Uint8Array } => Boolean(item.bytes))
            .map((item) => ({
                id: item.id,
                bytes: item.bytes,
                source: item.source === "song" ? "song" : "local",
                trusted: true,
                importedAt: Date.now(),
                ...(item.songSourceName ? { songSourceName: item.songSourceName } : {}),
            }));
        try {
            await putLocalPlugins(toStore);
        } catch (error) {
            notifyError("保存本地插件失败", error);
            return;
        }

        set((state) => {
            const plugins = mergePluginLists(state.plugins, trustedEntries);
            const overrides = { ...state.manualPluginOverrides };
            const selected = new Set(state.selectedPlugins);
            for (const entry of trustedEntries) {
                if (entry.compatible) {
                    overrides[entry.id] = true;
                    selected.add(entry.id);
                }
            }
            const nextSelected = computeNextSelectedPlugins(state.songs, plugins, [...selected], overrides);
            return {
                plugins,
                selectedPlugins: nextSelected,
                manualPluginOverrides: overrides,
                pendingTrustPlugins: [],
            };
        });
        notifications.show({
            title: "插件已信任并安装",
            message: `已添加 ${trustedEntries.length} 个插件`,
            color: "teal",
        });
    },

    dismissTrustPlugins: () => set({ pendingTrustPlugins: [] }),

    uninstallPlugin: async (id) => {
        const entry = get().plugins.find((item) => item.id === id);
        if (!entry || entry.source === "builtin") return;
        try {
            await deleteLocalPlugin(id);
            set((state) => {
                const plugins = state.plugins.filter((item) => item.id !== id);
                const selectedPlugins = state.selectedPlugins.filter((item) => item !== id);
                const overrides = { ...state.manualPluginOverrides };
                delete overrides[id];
                return { plugins, selectedPlugins, manualPluginOverrides: overrides };
            });
            notifications.show({ title: "已卸载插件", message: entry.manifest.name, color: "gray" });
        } catch (error) {
            notifyError("卸载插件失败", error);
        }
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
        const { template, timbres, selectedTimbres, songs, scores, plugins, selectedPlugins } = get();
        if (!template) return;
        previewPlayer.stop();
        set({ exporting: true, loadingText: "加载音色包与 VFX 插件..." });
        try {
            const match = matchSongPlugins(songs, plugins, selectedPlugins);
            if (match.missingEffects.length > 0 || match.disabledRequiredEffects.length > 0) {
                const missingNames = [
                    ...match.missingEffects.map((item) => item.effect),
                    ...match.disabledRequiredEffects.map((item) => item.effect),
                ];
                const uniqueEffects = [...new Set(missingNames)];
                notifications.show({
                    title: "导出包的演出效果不完整",
                    message: `缺少或未启用的资源：${uniqueEffects.slice(0, 4).join("、")}${uniqueEffects.length > 4 ? " 等" : ""}。播放时会保留可用的演出提示。`,
                    color: "yellow",
                    duration: 9_000,
                });
            }

            const selectedPacks: LoadedTimbrePack[] = [];
            for (const meta of timbres) {
                if (meta.bundled || !selectedTimbres.includes(meta.id)) continue;
                selectedPacks.push(await ensureTimbrePack(meta));
            }

            const selectedPluginArchives: PbePluginArchive[] = [];
            for (const entry of plugins) {
                if (!selectedPlugins.includes(entry.id) || !entry.trusted || !entry.compatible) continue;
                selectedPluginArchives.push(await loadPluginArchive(entry));
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
                plugins: selectedPluginArchives,
            });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = `${name.replace(/\s+/g, "_")}.mcaddon`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
            notifications.show({
                title: "附加包已导出",
                message: `${name} · ${songs.length} 首曲目 / ${selectedPluginArchives.length} 个插件 / ${scores.length} 张曲谱`,
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
