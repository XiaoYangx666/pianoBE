import { create } from "zustand";
import { PLAIN_PERFORMANCE_ID } from "@piano/core";
import { notify } from "@piano/ui";
import { loadDefaultTemplate, loadLocalState } from "../adapters/localAdapter";
import {
    normalizeServerDeployment,
    normalizeServerPlugin,
    serverApi,
    setServerToken,
} from "../adapters/serverAdapter";
import type { StudioMode } from "../adapters/types";
import { studioPlayer } from "../audio/player";
import type { ScoreEntry } from "../scores/scores";
import { createLatestTracker, createMutationQueue } from "./concurrency";
import {
    computeAddonSongIds,
    deriveLocalSnapshot,
    deriveServerSnapshot,
    extractSongEffectRequirements,
    findTimbrePlugin,
    snapshotPlan,
    summarizePluginCapabilities,
} from "./derived";
import { formatManifestVersion } from "./helpers";
import { createAddonSlice } from "./slices/addonSlice";
import { createAudioSlice } from "./slices/audioSlice";
import { createLibrarySlice } from "./slices/librarySlice";
import { createPluginsSlice } from "./slices/pluginsSlice";
import type { StoreRuntime, StudioState } from "./types";

const MODE_PREF_KEY = "pianobe_studio_mode";

let initPromise: Promise<void> | null = null;
let templateLoadPromise: Promise<void> | null = null;

const runtime: StoreRuntime = {
    queue: createMutationQueue(),
    refreshTracker: createLatestTracker(),
};

export const useStudio = create<StudioState>((set, get) => ({
    initialized: false,
    loading: true,
    busy: false,
    mode: "local",
    serverAvailable: false,
    authRequired: false,
    authenticated: false,

    ...createAudioSlice(set, get),
    ...createLibrarySlice(set, get, runtime),
    ...createPluginsSlice(set, get, runtime),
    ...createAddonSlice(set, get, runtime),

    async init() {
        initPromise ??= (async () => {
            set({ loading: true });
            try {
                const probe = await serverApi.checkAvailable();
                const preferred = localStorage.getItem(MODE_PREF_KEY) as StudioMode | null;
                const mode: StudioMode =
                    probe.ok && preferred !== "local" ? "server" : "local";

                set({
                    serverAvailable: probe.ok,
                    authRequired: probe.authRequired,
                    authenticated: probe.authenticated,
                    mode,
                    initialized: true,
                });

                await get().refresh();
                void get().loadTemplate();
                const timbres = get().timbreIndex;
                void studioPlayer
                    .setTimbre(get().previewTimbreId, timbres, async (tid) => {
                        const plugin = findTimbrePlugin(get().plugins, tid);
                        return plugin ? get().loadPluginArchive(plugin) : null;
                    })
                    .catch(() => {});
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
        const seq = runtime.refreshTracker.next();
        const { mode, authenticated } = get();
        if (mode === "server") {
            if (!authenticated) {
                const probe = await serverApi.checkAvailable();
                if (!runtime.refreshTracker.isLatest(seq)) return;
                set({ authRequired: probe.authRequired, authenticated: probe.authenticated });
                if (!probe.authenticated) return;
            }
            const [songsRes, libsRes, pluginsRes, addonRes] = await Promise.all([
                serverApi.listSongs({ page: 1, pageSize: 2000 }),
                serverApi.listLibraries(),
                serverApi.listPlugins(),
                serverApi.getAddonStatus(),
            ]);
            if (!runtime.refreshTracker.isLatest(seq)) return;

            const deployment = normalizeServerDeployment(addonRes);
            const normalizedPlugins = pluginsRes.items.map(normalizeServerPlugin);
            const songs = songsRes.items.map((item) => ({
                ...item,
                performanceEntries: item.performanceEntries ?? [],
            }));
            const snap = deriveServerSnapshot(
                songs,
                libsRes.items,
                normalizedPlugins,
                deployment,
                get().previewTimbreId,
            );
            if (snap.previewResetToPiano) {
                void studioPlayer.setTimbre("piano", snap.timbreIndex).catch(() => {});
            }
            set({
                songs: snap.songs,
                libraries: snap.libraries,
                plugins: snap.plugins,
                deploymentStatus: snap.deploymentStatus,
                timbreIndex: snap.timbreIndex,
                installedTimbreIds: snap.installedTimbreIds,
                selectedTimbreIds: snap.selectedTimbreIds,
                previewTimbreId: snap.previewTimbreId,
            });
            return;
        }

        const local = await loadLocalState();
        if (!runtime.refreshTracker.isLatest(seq)) return;

        for (const p of local.plugins) {
            if (p.installed && p.archive && p.archive.timbres.length > 0) {
                studioPlayer.registerTimbreArchive(p.archive);
            }
        }
        const snap = deriveLocalSnapshot(local, snapshotPlan(get()), get().previewTimbreId);
        if (snap.previewResetToPiano) {
            void studioPlayer.setTimbre("piano", snap.timbreIndex).catch(() => {});
        }
        set({
            songs: local.songs,
            libraries: local.libraries,
            plugins: local.plugins,
            deploymentStatus: null,
            timbreIndex: snap.timbreIndex,
            installedTimbreIds: snap.installedTimbreIds,
            selectedTimbreIds: snap.selectedTimbreIds,
            previewTimbreId: snap.previewTimbreId,
            addonSelectedLibraryIds: snap.cleanedPlan.selectedLibraryIds,
            addonExtraSongIds: snap.cleanedPlan.extraSongIds,
            addonExcludedSongIds: snap.cleanedPlan.excludedSongIds,
            selectedSongIds: snap.selectedSongIds,
            selectedPluginIds: snap.selectedPluginIds,
        });
    },
}));

export {
    PLAIN_PERFORMANCE_ID,
    computeAddonSongIds,
    extractSongEffectRequirements,
    summarizePluginCapabilities,
};
export type { StudioState } from "./types";
