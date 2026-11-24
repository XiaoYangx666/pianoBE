import { create } from "zustand";
import {
    PLAIN_PERFORMANCE_ID,
    attachSongPerformance,
    decodeBase64Url,
    encodeSong,
    extractCueEffects,
    type LibraryRecord,
} from "@piano/core";
import { midiBufferToSong } from "@piano/core/convert";
import { readPbePluginArchive } from "@piano/vfx/package";
import { loadAddonTemplate, type TemplateInfo, type TimbreIndexEntry } from "@piano/assembly";
import { notify } from "@piano/ui";
import type {
    OfficialCatalog,
    StudioDeploymentStatus,
    StudioMode,
    StudioPlugin,
    StudioSong,
} from "../adapters/types";
import {
    addSongsToLocalLibrary,
    computeLocalSongPluginMatch,
    deleteLocalLibrary,
    deleteLocalSong,
    exportLocalAddon,
    exportLocalLibraryPlugin,
    fetchOfficialPerformanceCues,
    fetchOfficialSongBytes,
    getLocalImportCode,
    installLocalPluginBytes,
    loadDefaultTemplate,
    loadLocalState,
    loadOfficialCatalog,
    loadOfficialLibraryPack,
    loadTimbreIndex,
    renameLocalSong,
    saveLocalLibrary,
    saveLocalSongBytes,
    saveLocalSongsBulk,
    setLocalPluginEnabled,
    trustLocalPlugin,
    uninstallLocalPlugin,
} from "../adapters/localAdapter";
import {
    normalizeServerDeployment,
    normalizeServerPlugin,
    serverApi,
    setServerToken,
} from "../adapters/serverAdapter";
import { studioPlayer } from "../audio/player";
import type { ScoreEntry } from "../scores/scores";

const MODE_PREF_KEY = "pianobe_studio_mode";

let initPromise: Promise<void> | null = null;
let templateLoadPromise: Promise<void> | null = null;

function formatManifestVersion(ver: unknown): string {
    if (Array.isArray(ver)) return ver.join(".");
    if (typeof ver === "string" && ver.trim()) return ver;
    return "-";
}

function downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface StudioState {
    initialized: boolean;
    loading: boolean;
    busy: boolean;
    importProgress: { done: number; total: number; label: string } | null;
    mode: StudioMode;
    serverAvailable: boolean;
    authRequired: boolean;
    authenticated: boolean;

    songs: StudioSong[];
    libraries: LibraryRecord[];
    officialCatalog: OfficialCatalog | null;
    plugins: StudioPlugin[];
    deploymentStatus: StudioDeploymentStatus | null;

    // Local assembly state
    template: TemplateInfo | null;
    templateVersion: string;
    addonName: string;
    addonDesc: string;
    randomUuid: boolean;
    timbreIndex: TimbreIndexEntry[];
    selectedTimbreIds: string[];
    scores: ScoreEntry[];
    selectedSongIds: string[];
    selectedPluginIds: string[];
    pendingTrustPlugins: Array<{
        plugin: StudioPlugin;
        bytes: Uint8Array;
    }>;

    init: () => Promise<void>;
    loadTemplate: () => Promise<void>;
    switchMode: (mode: StudioMode) => Promise<void>;
    loginServer: (token: string) => Promise<void>;
    logoutServer: () => Promise<void>;
    refresh: () => Promise<void>;

    importFiles: (files: File[], targetLibraryId?: string) => Promise<void>;
    saveConvertedMidi: (name: string, midiBytes: Uint8Array, libraryId?: string) => Promise<void>;
    importOfficialSongs: (
        songIds: string[],
        targetLibraryId?: string,
        quiet?: boolean,
    ) => Promise<{ added: number; merged: number; failed: number }>;
    importOfficialCollection: (collectionId: string) => Promise<void>;

    renameSong: (songId: string, name: string) => Promise<void>;
    deleteSong: (songId: string) => Promise<void>;
    deletePerformance: (songId: string, perfId: string) => Promise<void>;
    getSongBytes: (songId: string) => Promise<Uint8Array>;
    getImportCode: (songId: string) => Promise<{ name: string; chunks: string[]; bytes: number }>;

    createLibrary: (name: string, description?: string) => Promise<LibraryRecord>;
    renameLibrary: (id: string, name: string) => Promise<void>;
    deleteLibrary: (id: string) => Promise<void>;
    addSongsToLibrary: (libraryId: string, songIds: string[]) => Promise<void>;
    removeSongFromLibrary: (libraryId: string, songId: string) => Promise<void>;
    exportLibraryPlugin: (libraryId: string) => Promise<void>;

    toggleSongInAddon: (songId: string) => void;
    setSelectedSongIds: (ids: string[]) => void;

    installBuiltinPlugin: (id: string) => Promise<void>;
    trustPlugin: (id: string) => Promise<void>;
    confirmPendingTrust: (approvedIds: string[]) => Promise<void>;
    cancelPendingTrust: () => void;
    togglePlugin: (id: string, enabled: boolean) => Promise<void>;
    uninstallPlugin: (id: string) => Promise<void>;
    autoMatchLocalPlugins: () => void;
    zeroLocalPlugins: () => void;

    setAddonName: (value: string) => void;
    setAddonDesc: (value: string) => void;
    setRandomUuid: (value: boolean) => void;
    toggleTimbre: (id: string) => void;
    addScores: (entries: ScoreEntry[]) => void;
    removeScore: (id: string) => void;
    applyTemplateFile: (file: File) => Promise<void>;
    exportLocalMcaddon: () => Promise<void>;

    updateBdsConfig: (patch: {
        bdsDir?: string;
        bdsWorld?: string;
        bdsBpName?: string;
        bdsRpName?: string;
    }) => Promise<void>;
    deployServerToBds: () => Promise<void>;
    downloadServerAddon: () => Promise<void>;
}

export const useStudio = create<StudioState>((set, get) => ({
    initialized: false,
    loading: true,
    busy: false,
    importProgress: null,
    mode: "local",
    serverAvailable: false,
    authRequired: false,
    authenticated: false,

    songs: [],
    libraries: [],
    officialCatalog: null,
    plugins: [],
    deploymentStatus: null,

    template: null,
    templateVersion: "-",
    addonName: "PianoBE 钢琴附加包",
    addonDesc: "Powered by PianoBE Studio",
    randomUuid: false,
    timbreIndex: [],
    selectedTimbreIds: ["piano"],
    scores: [],
    selectedSongIds: [],
    selectedPluginIds: [],
    pendingTrustPlugins: [],

    async init() {
        initPromise ??= (async () => {
            set({ loading: true });
            try {
                const [probe, catalog, timbres] = await Promise.all([
                    serverApi.checkAvailable(),
                    loadOfficialCatalog(),
                    loadTimbreIndex(),
                ]);

                const preferred = localStorage.getItem(MODE_PREF_KEY) as StudioMode | null;
                const mode: StudioMode =
                    probe.ok && preferred !== "local" ? "server" : "local";

                set({
                    serverAvailable: probe.ok,
                    authRequired: probe.authRequired,
                    authenticated: probe.authenticated,
                    mode,
                    officialCatalog: catalog,
                    timbreIndex: timbres,
                    selectedTimbreIds: timbres.filter((t) => t.required).map((t) => t.id),
                    initialized: true,
                });

                await get().refresh();

                // 模板体积较大（数 MB），首屏就绪后再后台加载，避免阻塞初始化。
                void get().loadTemplate();
            } catch (err) {
                console.error("[studio] 初始化失败", err);
            } finally {
                set({ loading: false });
            }
        })();
        return initPromise;
    },

    async loadTemplate() {
        if (get().template) return;
        templateLoadPromise ??= (async () => {
            try {
                const template = await loadDefaultTemplate();
                studioPlayer.setTemplate(template);
                set({
                    template,
                    templateVersion: formatManifestVersion(template.bpManifest.header?.version),
                    scores: template.scores as ScoreEntry[],
                });
            } catch (err) {
                console.warn("[studio] 模板加载失败", err);
                templateLoadPromise = null;
            }
        })();
        await templateLoadPromise;
    },

    async switchMode(mode) {
        if (mode === "server" && !get().serverAvailable) {
            const probe = await serverApi.checkAvailable();
            if (!probe.ok) {
                notify({ title: "未检测到服务器后端", message: "当前保持在本地模式运行。", color: "yellow" });
                return;
            }
            set({
                serverAvailable: true,
                authRequired: probe.authRequired,
                authenticated: probe.authenticated,
            });
        }
        studioPlayer.stop();
        localStorage.setItem(MODE_PREF_KEY, mode);
        set({ mode });
        await get().refresh();
    },

    async loginServer(token) {
        setServerToken(token);
        try {
            await serverApi.listSongs({ pageSize: 1 });
            set({ authenticated: true, authRequired: true, mode: "server" });
            localStorage.setItem(MODE_PREF_KEY, "server");
            await get().refresh();
        } catch (err) {
            setServerToken(null);
            throw err;
        }
    },

    async logoutServer() {
        studioPlayer.stop();
        setServerToken(null);
        const probe = await serverApi.checkAvailable();
        set({
            authenticated: probe.authenticated,
            authRequired: probe.authRequired,
            songs: [],
            libraries: [],
            plugins: [],
            deploymentStatus: null,
        });
    },

    async refresh() {
        const { mode, authenticated, officialCatalog } = get();
        if (mode === "server") {
            if (!authenticated) {
                const probe = await serverApi.checkAvailable();
                set({ authRequired: probe.authRequired, authenticated: probe.authenticated });
                if (!probe.authenticated) return;
            }
            const [songsRes, libsRes, pluginsRes, addonRes] = await Promise.all([
                serverApi.listSongs({ page: 1, pageSize: 1000 }),
                serverApi.listLibraries(),
                serverApi.listPlugins(),
                serverApi.getAddonStatus(),
            ]);
            set({
                songs: songsRes.items.map((item) => ({
                    ...item,
                    performanceEntries: item.performanceEntries ?? [],
                })),
                libraries: libsRes.items,
                plugins: pluginsRes.items.map(normalizeServerPlugin),
                deploymentStatus: normalizeServerDeployment(addonRes),
            });
            return;
        }

        const local = await loadLocalState(officialCatalog);
        const prevSelectedSongs = get().selectedSongIds;
        const validSongIds = new Set(local.songs.map((s) => s.id));
        const nextSelectedSongs =
            prevSelectedSongs.length > 0
                ? prevSelectedSongs.filter((id) => validSongIds.has(id))
                : local.songs.map((s) => s.id);

        const prevSelectedPlugins = get().selectedPluginIds;
        const nextSelectedPlugins =
            prevSelectedPlugins.length > 0
                ? prevSelectedPlugins.filter((id) => local.plugins.some((p) => p.id === id && p.enabled))
                : local.plugins.filter((p) => p.enabled).map((p) => p.id);

        set({
            songs: local.songs,
            libraries: local.libraries,
            plugins: local.plugins,
            deploymentStatus: null,
            selectedSongIds: nextSelectedSongs,
            selectedPluginIds: nextSelectedPlugins,
        });
    },

    async importFiles(files, targetLibraryId) {
        const { mode } = get();
        set({ busy: true });
        try {
            let added = 0;
            let merged = 0;
            const trustQueue: Array<{ plugin: StudioPlugin; bytes: Uint8Array }> = [];

            for (const file of files) {
                const lower = file.name.toLowerCase();
                const bytes = new Uint8Array(await file.arrayBuffer());

                if (lower.endsWith(".pbeplugin")) {
                    if (mode === "server") {
                        const created = await serverApi.uploadPlugin(bytes);
                        notify({
                            title: `插件已安装：${created.name}`,
                            message: created.trusted ? "可前往扩展中心启用/部署" : "插件包含脚本或资源，请在扩展中心确认信任。",
                            color: "teal",
                        });
                    } else {
                        const archive = readPbePluginArchive(bytes);
                        if (archive.hasExecutableCode) {
                            const plugin = await installLocalPluginBytes(bytes, "local", false);
                            trustQueue.push({ plugin, bytes });
                        } else {
                            const plugin = await installLocalPluginBytes(bytes, "local", true);
                            set((s) => ({
                                selectedPluginIds: [...new Set([...s.selectedPluginIds, plugin.id])],
                            }));
                            notify({ title: `扩展包已导入：${plugin.name}`, color: "teal" });
                        }
                    }
                    continue;
                }

                if (!lower.endsWith(".mid") && !lower.endsWith(".midi") && !lower.endsWith(".pbe3")) {
                    notify({ title: `跳过不支持的文件：${file.name}`, color: "yellow" });
                    continue;
                }

                if (mode === "server") {
                    await serverApi.uploadSong(file.name, bytes, targetLibraryId);
                    added++;
                } else {
                    const res = await saveLocalSongBytes(file.name, bytes, targetLibraryId);
                    if (res.status === "added") added++;
                    else if (res.status === "merged") {
                        merged++;
                        notify({ title: "音乐本体合并", message: res.message, color: "teal" });
                    } else if (res.status === "conflict") {
                        notify({ title: "曲目冲突", message: res.message, color: "red" });
                    }
                }
            }

            if (trustQueue.length > 0) {
                set((s) => ({ pendingTrustPlugins: [...s.pendingTrustPlugins, ...trustQueue] }));
            }
            if (added > 0 || merged > 0) {
                notify({
                    title: "导入完成",
                    message: `新增 ${added} 首${merged ? `，合并 ${merged} 首` : ""}`,
                    color: "teal",
                });
            }
            await get().refresh();
            if (mode === "local") {
                const allIds = get().songs.map((s) => s.id);
                set({ selectedSongIds: allIds });
            }
        } catch (err) {
            notify({
                title: "导入失败",
                message: err instanceof Error ? err.message : String(err),
                color: "red",
            });
        } finally {
            set({ busy: false });
        }
    },

    async saveConvertedMidi(name, midiBytes, libraryId) {
        const clean = name.trim() || "转录曲目";
        const pbe3 = encodeSong(midiBufferToSong(midiBytes, clean));
        if (get().mode === "server") {
            await serverApi.uploadSong(`${clean}.pbe3`, pbe3, libraryId);
        } else {
            const res = await saveLocalSongBytes(`${clean}.pbe3`, pbe3, libraryId);
            if (res.status === "conflict") throw new Error(res.message);
        }
        await get().refresh();
        notify({ title: `已保存「${clean}」到音乐库`, color: "teal" });
    },

    async importOfficialSongs(songIds, targetLibraryId, quiet = false) {
        const summary = { added: 0, merged: 0, failed: 0 };
        if (songIds.length === 0) return summary;
        const { mode, officialCatalog } = get();
        const perfIds = new Set(Object.keys(officialCatalog?.performances ?? {}));
        const titleOf = (id: string) =>
            officialCatalog?.songs.find((s) => s.id === id)?.name ?? id;
        const total = songIds.length;
        const failures: string[] = [];
        let done = 0;
        let uploaded = 0;
        const progress = (label: string) =>
            set({ importProgress: { done, total, label } });
        set({ busy: true });
        progress("正在准备曲目…");

        try {
            // 大集合用单文件曲库包；小集合仍走逐曲请求，避免为几首曲子下载整库。
            const pack = mode === "local" && total >= 32 ? await loadOfficialLibraryPack() : null;
            if (pack) progress("正在加载曲库包…");
            const queue = [...songIds];
            const concurrency = Math.min(pack ? 8 : 4, total);
            const collected: Array<{ fileName: string; bytes: Uint8Array }> = [];

            const worker = async () => {
                for (;;) {
                    const songId = queue.shift();
                    if (!songId) return;
                    try {
                        let bytes = pack?.get(songId) ?? (await fetchOfficialSongBytes(songId));
                        if (perfIds.has(songId)) {
                            const cues = await fetchOfficialPerformanceCues(songId);
                            if (cues && cues.length > 0) bytes = attachSongPerformance(bytes, cues);
                        }
                        const fileName = `${titleOf(songId)}.pbe3`;
                        if (mode === "server") {
                            await serverApi.uploadSong(fileName, bytes, targetLibraryId);
                            uploaded++;
                        } else {
                            collected.push({ fileName, bytes });
                        }
                    } catch (err) {
                        failures.push(
                            `${titleOf(songId)}：${err instanceof Error ? err.message : String(err)}`,
                        );
                    } finally {
                        done++;
                        progress("正在导入曲目…");
                    }
                }
            };
            await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));

            if (mode === "local" && collected.length > 0) {
                progress("正在写入本地曲库…");
                const res = await saveLocalSongsBulk(collected, targetLibraryId);
                summary.added = res.added;
                summary.merged = res.merged;
                for (const name of res.conflicts) failures.push(`${name}：曲目 ID 冲突`);
            } else if (mode === "server") {
                summary.added = uploaded;
            }
            summary.failed = failures.length;

            await get().refresh();
            if ((!quiet || failures.length > 0) && (summary.added > 0 || summary.merged > 0 || failures.length > 0)) {
                const parts = [];
                if (summary.added > 0) parts.push(`新增 ${summary.added} 首`);
                if (summary.merged > 0) parts.push(`合并 ${summary.merged} 首`);
                if (failures.length > 0) parts.push(`失败 ${failures.length} 首`);
                notify({
                    title: failures.length > 0 ? "曲目导入完成（有失败）" : "曲目导入完成",
                    message: parts.join("，"),
                    color: failures.length > 0 ? "yellow" : "teal",
                });
            }
            return summary;
        } catch (err) {
            summary.failed = failures.length + 1;
            notify({
                title: "导入失败",
                message: err instanceof Error ? err.message : String(err),
                color: "red",
            });
            return summary;
        } finally {
            set({ busy: false, importProgress: null });
        }
    },

    async importOfficialCollection(collectionId) {
        const catalog = get().officialCatalog;
        const col =
            collectionId === "all"
                ? catalog
                    ? {
                          id: "all",
                          name: "完整曲库",
                          description: "在线曲库中的全部曲目",
                          songIds: catalog.songs.map((s) => s.id),
                      }
                    : null
                : catalog?.collections.find((c) => c.id === collectionId) ?? null;
        if (!col || col.songIds.length === 0) return;
        const lib = await get().createLibrary(col.name, col.description);
        const summary = await get().importOfficialSongs(col.songIds, lib.id, true);
        if (summary.added + summary.merged === 0 && summary.failed > 0) {
            // 整库导入全部失败时不留下空曲库
            await get().deleteLibrary(lib.id).catch(() => undefined);
        }
        const parts = [];
        if (summary.added > 0) parts.push(`新增 ${summary.added} 首`);
        if (summary.merged > 0) parts.push(`合并 ${summary.merged} 首`);
        if (summary.failed > 0) parts.push(`失败 ${summary.failed} 首`);
        notify({
            title: `已导入「${col.name}」`,
            message: parts.join("，") || "没有可导入的曲目",
            color: summary.failed > 0 ? "yellow" : "teal",
        });
    },

    async renameSong(songId, name) {
        if (get().mode === "server") {
            await serverApi.renameSong(songId, name);
            await get().refresh();
        } else {
            await renameLocalSong(songId, name);
            const clean = name.trim();
            set((s) => ({
                songs: s.songs.map((song) =>
                    song.id === songId && clean ? { ...song, name: clean } : song,
                ),
            }));
        }
        notify({ title: "已重命名", color: "teal" });
    },

    async deleteSong(songId) {
        if (get().mode === "server") {
            await serverApi.deleteSong(songId);
            await get().refresh();
        } else {
            await deleteLocalSong(songId);
            // 本地删除直接就地更新状态，避免为了移除一首曲子重扫整个曲库。
            set((s) => ({
                songs: s.songs.filter((song) => song.id !== songId),
                libraries: s.libraries.map((lib) =>
                    lib.songIds.includes(songId)
                        ? { ...lib, songIds: lib.songIds.filter((id) => id !== songId) }
                        : lib,
                ),
                selectedSongIds: s.selectedSongIds.filter((id) => id !== songId),
            }));
        }
        notify({ title: "已移除曲目", color: "teal" });
    },

    async deletePerformance(songId, perfId) {
        if (perfId === PLAIN_PERFORMANCE_ID) return;
        if (get().mode === "server") {
            await serverApi.deletePerformance(perfId);
            await get().refresh();
            notify({ title: "已删除演出编排", color: "teal" });
        } else {
            notify({ title: "本地源自插件或PBE3内嵌的演出请通过插件卸载管理", color: "yellow" });
        }
        void songId;
    },

    async getSongBytes(songId) {
        const local = get().songs.find((s) => s.id === songId);
        if (local?.data) return local.data;
        if (get().mode === "server") {
            const detail = await serverApi.getSongDetail(songId);
            return decodeBase64Url(detail.data);
        }
        return fetchOfficialSongBytes(songId);
    },

    async getImportCode(songId) {
        if (get().mode === "server") {
            return serverApi.getImportCode(songId);
        }
        const song = get().songs.find((s) => s.id === songId);
        if (!song) throw new Error("曲目不存在");
        return getLocalImportCode(song);
    },

    async createLibrary(name, description) {
        if (get().mode === "server") {
            const created = await serverApi.createLibrary(name, description);
            await get().refresh();
            return created;
        }
        const lib: LibraryRecord = {
            id: `lib_${Date.now().toString(36)}`,
            name: name.trim(),
            description: description?.trim(),
            kind: "user",
            songIds: [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };
        await saveLocalLibrary(lib);
        await get().refresh();
        return lib;
    },

    async renameLibrary(id, name) {
        if (get().mode === "server") {
            await serverApi.updateLibrary(id, { name });
        } else {
            const existing = get().libraries.find((l) => l.id === id);
            if (!existing) return;
            await saveLocalLibrary({ ...existing, name: name.trim() });
        }
        await get().refresh();
    },

    async deleteLibrary(id) {
        if (get().mode === "server") {
            await serverApi.deleteLibrary(id);
        } else {
            await deleteLocalLibrary(id);
        }
        await get().refresh();
        notify({ title: "曲库已删除", color: "teal" });
    },

    async addSongsToLibrary(libraryId, songIds) {
        if (get().mode === "server") {
            await serverApi.addSongsToLibrary(libraryId, songIds);
        } else {
            await addSongsToLocalLibrary(libraryId, songIds);
        }
        await get().refresh();
        notify({ title: "已加入曲库", color: "teal" });
    },

    async removeSongFromLibrary(libraryId, songId) {
        if (get().mode === "server") {
            await serverApi.removeSongFromLibrary(libraryId, songId);
        } else {
            const lib = get().libraries.find((l) => l.id === libraryId);
            if (lib) {
                await saveLocalLibrary({
                    ...lib,
                    songIds: lib.songIds.filter((id) => id !== songId),
                });
            }
        }
        await get().refresh();
    },

    async exportLibraryPlugin(libraryId) {
        if (get().mode === "server") {
            const blob = await serverApi.exportLibraryPlugin(libraryId);
            downloadBlob(blob, `${libraryId}.pbeplugin`);
            notify({ title: "已导出曲库插件 (.pbeplugin)", color: "teal" });
            return;
        }
        const lib = get().libraries.find((l) => l.id === libraryId);
        if (!lib) throw new Error("曲库不存在");
        const { blob, filename } = exportLocalLibraryPlugin(lib, get().songs);
        downloadBlob(blob, filename);
        notify({ title: `已打包导出 ${filename}`, color: "teal" });
    },

    toggleSongInAddon(songId) {
        set((s) => {
            const has = s.selectedSongIds.includes(songId);
            return {
                selectedSongIds: has
                    ? s.selectedSongIds.filter((id) => id !== songId)
                    : [...s.selectedSongIds, songId],
            };
        });
    },

    setSelectedSongIds(ids) {
        set({ selectedSongIds: ids });
    },

    async installBuiltinPlugin(id) {
        if (get().mode !== "server") return;
        await serverApi.installBuiltinPlugin(id);
        await get().refresh();
        notify({ title: `已安装内置插件 ${id}`, color: "teal" });
    },

    async trustPlugin(id) {
        if (get().mode === "server") {
            await serverApi.trustPlugin(id);
        } else {
            await trustLocalPlugin(id);
            set((s) => ({ selectedPluginIds: [...new Set([...s.selectedPluginIds, id])] }));
        }
        await get().refresh();
        notify({ title: "已信任插件", color: "teal" });
    },

    async confirmPendingTrust(approvedIds) {
        const setIds = new Set(approvedIds);
        for (const id of setIds) {
            await trustLocalPlugin(id);
        }
        set((s) => ({
            pendingTrustPlugins: [],
            selectedPluginIds: [...new Set([...s.selectedPluginIds, ...approvedIds])],
        }));
        await get().refresh();
        notify({ title: `已信任并启用 ${approvedIds.length} 个扩展`, color: "teal" });
    },

    cancelPendingTrust() {
        set({ pendingTrustPlugins: [] });
    },

    async togglePlugin(id, enabled) {
        if (get().mode === "server") {
            await serverApi.setPluginEnabled(id, enabled);
            await get().refresh();
            return;
        }
        await setLocalPluginEnabled(id, enabled);
        set((s) => ({
            selectedPluginIds: enabled
                ? [...new Set([...s.selectedPluginIds, id])]
                : s.selectedPluginIds.filter((item) => item !== id),
        }));
        await get().refresh();
    },

    async uninstallPlugin(id) {
        if (get().mode === "server") {
            await serverApi.uninstallPlugin(id);
        } else {
            await uninstallLocalPlugin(id, get().plugins);
            set((s) => ({
                selectedPluginIds: s.selectedPluginIds.filter((item) => item !== id),
            }));
        }
        await get().refresh();
        notify({ title: "插件已卸载", color: "teal" });
    },

    autoMatchLocalPlugins() {
        const { songs, selectedSongIds, plugins, selectedPluginIds } = get();
        const selectedSongs = songs.filter((s) => selectedSongIds.includes(s.id));
        const match = computeLocalSongPluginMatch(selectedSongs, plugins, selectedPluginIds);
        const nextIds = [...new Set([...selectedPluginIds, ...match.requiredPluginIds])];
        set({ selectedPluginIds: nextIds });
        notify({
            title: "已按曲目演出匹配插件",
            message: `当前共选中 ${nextIds.length} 个扩展`,
            color: "teal",
        });
    },

    zeroLocalPlugins() {
        set({ selectedPluginIds: [] });
        notify({ title: "已切换为零插件纯净模式", color: "teal" });
    },

    setAddonName: (addonName) => set({ addonName }),
    setAddonDesc: (addonDesc) => set({ addonDesc }),
    setRandomUuid: (randomUuid) => set({ randomUuid }),
    toggleTimbre(id) {
        const meta = get().timbreIndex.find((t) => t.id === id);
        if (meta?.required) return;
        set((s) => ({
            selectedTimbreIds: s.selectedTimbreIds.includes(id)
                ? s.selectedTimbreIds.filter((x) => x !== id)
                : [...s.selectedTimbreIds, id],
        }));
    },
    addScores: (entries) => set((s) => ({ scores: [...s.scores, ...entries] })),
    removeScore: (id) => set((s) => ({ scores: s.scores.filter((item) => item.id !== id) })),

    async applyTemplateFile(file) {
        const { mode } = get();
        if (mode === "server") {
            const bytes = new Uint8Array(await file.arrayBuffer());
            const status = await serverApi.uploadServerTemplate(bytes);
            set({ deploymentStatus: normalizeServerDeployment(status) });
            notify({ title: "已更新服务器底层模板", color: "teal" });
            return;
        }
        const info = await loadAddonTemplate(file);
        studioPlayer.setTemplate(info);
        set({
            template: info,
            templateVersion: formatManifestVersion(info.bpManifest.header?.version),
            scores: info.scores as ScoreEntry[],
        });
        notify({ title: `已加载自定义模板 ${file.name}`, color: "teal" });
    },

    async exportLocalMcaddon() {
        const {
            template,
            songs,
            selectedSongIds,
            plugins,
            selectedPluginIds,
            selectedTimbreIds,
            timbreIndex,
            scores,
            addonName,
            addonDesc,
            randomUuid,
        } = get();
        if (!template) throw new Error("基础模板尚未就绪");
        set({ busy: true });
        try {
            const pickedSongs = songs.filter((s) => selectedSongIds.includes(s.id));
            const blob = await exportLocalAddon({
                template,
                songs: pickedSongs,
                plugins,
                selectedPluginIds,
                timbreIds: selectedTimbreIds,
                timbreIndex,
                scores,
                name: addonName,
                desc: addonDesc,
                randomUuid,
            });
            downloadBlob(blob, `${addonName.trim() || "pianobe"}.mcaddon`);
            notify({
                title: "已导出 .mcaddon 附加包",
                message: `包含 ${pickedSongs.length} 首曲目与 ${selectedPluginIds.length} 个扩展`,
                color: "teal",
            });
        } finally {
            set({ busy: false });
        }
    },

    async updateBdsConfig(patch) {
        const res = await serverApi.updateAddonConfig(patch);
        set({ deploymentStatus: normalizeServerDeployment(res.status) });
        notify({ title: "BDS 配置已更新", color: "teal" });
    },

    async deployServerToBds() {
        set({ busy: true });
        try {
            const status = await serverApi.deployToBds();
            set({ deploymentStatus: normalizeServerDeployment(status) });
            await get().refresh();
            notify({
                title: "已部署 BP / RP 到 BDS",
                message: "请重启 BDS 服务端以使新行为包/资源包生效",
                color: "teal",
            });
        } finally {
            set({ busy: false });
        }
    },

    async downloadServerAddon() {
        set({ busy: true });
        try {
            const blob = await serverApi.downloadServerAddon();
            downloadBlob(blob, "pianobe-server.mcaddon");
            notify({ title: "已生成服务端附加包 (.mcaddon)", color: "teal" });
        } finally {
            set({ busy: false });
        }
    },
}));

export function summarizePluginCapabilities(plugin: StudioPlugin): string {
    const parts: string[] = [];
    const p = plugin.provides ?? {};
    if (p.effects?.length) parts.push(`${p.effects.length} 项特效`);
    if (p.themes?.length) parts.push(`${p.themes.length} 套主题`);
    if (p.songs?.length) parts.push(`${p.songs.length} 首曲目`);
    if (p.performances?.length) parts.push(`${p.performances.length} 套演出`);
    if (p.libraries?.length) parts.push(`${p.libraries.length} 个曲库`);
    if (p.stageProps?.length) parts.push(`${p.stageProps.length} 个舞台道具`);
    return parts.join(" · ") || "内容扩展";
}

export function extractSongEffectRequirements(song: StudioSong): string[] {
    const set = new Set<string>();
    for (const p of song.performanceEntries) {
        for (const e of p.requiredEffects ?? []) set.add(e);
        if (p.cues) {
            for (const e of extractCueEffects(p.cues)) set.add(e);
        }
    }
    return [...set];
}

export { PLAIN_PERFORMANCE_ID };
