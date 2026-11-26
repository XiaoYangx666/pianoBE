import { loadAddonTemplate } from "@piano/assembly";
import { notify } from "@piano/ui";
import { exportLocalAddon } from "../../adapters/localAdapter";
import { normalizeServerDeployment, serverApi } from "../../adapters/serverAdapter";
import { studioPlayer } from "../../audio/player";
import type { ScoreEntry } from "../../scores/scores";
import {
    computeAddonSongIds,
    computeSelectedPluginIds,
    findTimbrePlugin,
    persistAddonPlan,
    readStoredAddonPlan,
    snapshotPlan,
} from "../derived";
import { bytesToBase64, downloadBlob, formatManifestVersion } from "../helpers";
import type {
    AddonSlice,
    LocalAddonPlan,
    StoreRuntime,
    StudioGet,
    StudioSet,
} from "../types";

export function createAddonSlice(
    set: StudioSet,
    get: StudioGet,
    runtime: StoreRuntime,
): AddonSlice {
    const initialPlan = readStoredAddonPlan();

    return {
        deploymentStatus: null,
        template: null,
        templateVersion: "-",
        addonName: initialPlan.addonName,
        addonDesc: initialPlan.addonDesc,
        randomUuid: initialPlan.randomUuid,
        timbreIndex: [],
        installedTimbreIds: ["piano"],
        selectedTimbreIds: initialPlan.selectedTimbreIds,
        scores: [],
        addonSelectedLibraryIds: initialPlan.selectedLibraryIds,
        addonExtraSongIds: initialPlan.extraSongIds,
        addonExcludedSongIds: initialPlan.excludedSongIds,
        selectedSongIds: [],
        selectedPluginIds: [],

        toggleLibraryInAddon(libraryId) {
            set((s) => {
                const has = s.addonSelectedLibraryIds.includes(libraryId);
                const nextLibs = has
                    ? s.addonSelectedLibraryIds.filter((id) => id !== libraryId)
                    : [...s.addonSelectedLibraryIds, libraryId];
                let nextExcluded = s.addonExcludedSongIds;
                if (!has) {
                    const lib = s.libraries.find((l) => l.id === libraryId);
                    const libSongIds = new Set(lib?.songIds ?? []);
                    nextExcluded = nextExcluded.filter((id) => !libSongIds.has(id));
                }
                const nextPlan: LocalAddonPlan = {
                    ...snapshotPlan(s),
                    selectedLibraryIds: nextLibs,
                    excludedSongIds: nextExcluded,
                };
                persistAddonPlan(nextPlan);
                return {
                    addonSelectedLibraryIds: nextLibs,
                    addonExcludedSongIds: nextExcluded,
                    selectedSongIds: computeAddonSongIds(s.songs, s.libraries, nextPlan),
                };
            });
        },

        toggleSongInAddon(songId) {
            set((s) => {
                const currentlyIncluded = s.selectedSongIds.includes(songId);
                const libSet = new Set(s.addonSelectedLibraryIds);
                const song = s.songs.find((item) => item.id === songId);
                const coveredByLib =
                    Boolean(song?.libraries?.some((lid) => libSet.has(lid))) ||
                    s.libraries.some((l) => libSet.has(l.id) && l.songIds.includes(songId));

                let nextExtra = [...s.addonExtraSongIds];
                let nextExcluded = [...s.addonExcludedSongIds];

                if (currentlyIncluded) {
                    nextExtra = nextExtra.filter((id) => id !== songId);
                    if (coveredByLib && !nextExcluded.includes(songId)) nextExcluded.push(songId);
                } else {
                    nextExcluded = nextExcluded.filter((id) => id !== songId);
                    if (!coveredByLib && !nextExtra.includes(songId)) nextExtra.push(songId);
                }

                const nextPlan: LocalAddonPlan = {
                    ...snapshotPlan(s),
                    extraSongIds: nextExtra,
                    excludedSongIds: nextExcluded,
                };
                persistAddonPlan(nextPlan);
                return {
                    addonExtraSongIds: nextExtra,
                    addonExcludedSongIds: nextExcluded,
                    selectedSongIds: computeAddonSongIds(s.songs, s.libraries, nextPlan),
                };
            });
        },

        includeAllSongsInAddon() {
            set((s) => {
                const allLibIds = s.libraries.map((l) => l.id);
                const libSongs = new Set(s.libraries.flatMap((l) => l.songIds));
                const extra = s.songs
                    .filter((song) => !libSongs.has(song.id) && !song.libraries?.length)
                    .map((song) => song.id);
                const nextPlan: LocalAddonPlan = {
                    ...snapshotPlan(s),
                    selectedLibraryIds: allLibIds,
                    extraSongIds: extra,
                    excludedSongIds: [],
                };
                persistAddonPlan(nextPlan);
                return {
                    addonSelectedLibraryIds: allLibIds,
                    addonExtraSongIds: extra,
                    addonExcludedSongIds: [],
                    selectedSongIds: computeAddonSongIds(s.songs, s.libraries, nextPlan),
                };
            });
        },

        clearAddonSongs() {
            set((s) => {
                const nextPlan: LocalAddonPlan = {
                    ...snapshotPlan(s),
                    selectedLibraryIds: [],
                    extraSongIds: [],
                    excludedSongIds: [],
                };
                persistAddonPlan(nextPlan);
                return {
                    addonSelectedLibraryIds: [],
                    addonExtraSongIds: [],
                    addonExcludedSongIds: [],
                    selectedSongIds: [],
                };
            });
        },

        setAddonName(addonName) {
            set((s) => {
                persistAddonPlan({ ...snapshotPlan(s), addonName });
                return { addonName };
            });
        },

        setAddonDesc(addonDesc) {
            set((s) => {
                persistAddonPlan({ ...snapshotPlan(s), addonDesc });
                return { addonDesc };
            });
        },

        setRandomUuid(randomUuid) {
            set((s) => {
                persistAddonPlan({ ...snapshotPlan(s), randomUuid });
                return { randomUuid };
            });
        },

        async toggleTimbre(id) {
            const meta = get().timbreIndex.find((t) => t.id === id);
            if (meta?.required || id === "piano") return;

            const { mode } = get();
            const plugin = findTimbrePlugin(get().plugins, id);
            if (mode === "local") {
                if (plugin && !plugin.installed) {
                    await get().installBuiltinPlugin(plugin.id);
                    return;
                }
                set((s) => {
                    const has = s.selectedTimbreIds.includes(id);
                    const nextTimbres = has
                        ? s.selectedTimbreIds.filter((x) => x !== id)
                        : [...s.selectedTimbreIds, id];
                    const normalized: string[] = [
                        "piano",
                        ...nextTimbres.filter((x) => x !== "piano"),
                    ];
                    const nextPlan: LocalAddonPlan = {
                        ...snapshotPlan(s),
                        selectedTimbreIds: normalized,
                    };
                    persistAddonPlan(nextPlan);
                    return {
                        selectedTimbreIds: normalized,
                        selectedPluginIds: computeSelectedPluginIds(s.plugins, normalized),
                    };
                });
                return;
            }

            if (plugin) {
                if (!plugin.installed) {
                    await get().installBuiltinPlugin(plugin.id);
                } else {
                    await get().togglePlugin(plugin.id, !plugin.enabled);
                }
                return;
            }
            notify({ title: "请先安装对应音色插件", color: "yellow" });
        },

        addScores(entries) {
            return runtime.queue.enqueue(async () => {
                if (entries.length === 0) return;
                if (get().mode === "server") {
                    for (const entry of entries) {
                        const assets: Record<string, string> = {};
                        if (entry.assets) {
                            for (const [rel, bytes] of entry.assets) {
                                assets[rel] = bytesToBase64(bytes);
                            }
                        }
                        const res = await serverApi.addServerScore({
                            id: entry.id,
                            title: entry.title,
                            pages: entry.pages,
                            pageCount: entry.pageCount,
                            assets,
                        });
                        set({ deploymentStatus: normalizeServerDeployment(res.status) });
                    }
                    return;
                }
                set((s) => ({ scores: [...s.scores, ...entries] }));
            });
        },

        removeScore(id) {
            return runtime.queue.enqueue(async () => {
                if (get().mode === "server") {
                    const res = await serverApi.deleteServerScore(id);
                    set({ deploymentStatus: normalizeServerDeployment(res.status) });
                    return;
                }
                set((s) => ({ scores: s.scores.filter((item) => item.id !== id) }));
            });
        },

        applyTemplateFile(file) {
            return runtime.queue.enqueue(async () => {
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
            });
        },

        async exportLocalMcaddon() {
            const {
                template,
                songs,
                libraries,
                selectedSongIds,
                plugins,
                selectedPluginIds,
                selectedTimbreIds,
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
                    libraries,
                    plugins,
                    selectedPluginIds,
                    selectedTimbreIds,
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

        updateBdsConfig(patch) {
            return runtime.queue.enqueue(async () => {
                const res = await serverApi.updateAddonConfig(patch);
                set({ deploymentStatus: normalizeServerDeployment(res.status) });
                notify({ title: "BDS 配置已更新", color: "teal" });
            });
        },

        deployServerToBds() {
            return runtime.queue.enqueue(async () => {
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
            });
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
    };
}
