import { readPbePluginArchive, type PbePluginArchive } from "@piano/vfx/package";
import { resolvePluginDependencies, type PluginCatalogEntry } from "@piano/assembly";
import { notify } from "@piano/ui";
import {
    computeLocalSongPluginMatch,
    fetchBuiltinPluginBytes,
    installLocalPluginBytes,
    saveLocalPerformance,
    saveLocalSongBytes,
    setLocalPluginEnabled,
    trustLocalPlugin,
    uninstallLocalPlugin,
} from "../../adapters/localAdapter";
import { serverApi } from "../../adapters/serverAdapter";
import {
    extractSongEffectRequirements,
    isVfxPlugin,
    persistAddonPlan,
    snapshotPlan,
} from "../derived";
import type { PluginsSlice, StoreRuntime, StudioGet, StudioSet } from "../types";

/**
 * 同一插件包只下载/解压一次。服务端模式下 `plugin.archive` 始终为空，
 * 没有这层缓存时每次打开「浏览/挑单曲」或切换音色都会重新请求 /archive 并解包。
 */
const archiveLoadCache = new Map<string, Promise<PbePluginArchive>>();

function archiveLoadKey(plugin: { id: string; version: string; sizeBytes: number }): string {
    return `${plugin.id}@${plugin.version}@${plugin.sizeBytes}`;
}

export function createPluginsSlice(
    set: StudioSet,
    get: StudioGet,
    runtime: StoreRuntime,
): PluginsSlice {
    return {
        plugins: [],
        pendingTrustPlugins: [],

        async loadPluginArchive(plugin) {
            if (plugin.archive) return plugin.archive;
            const key = archiveLoadKey(plugin);
            const cached = archiveLoadCache.get(key);
            if (cached) return cached;
            const pending = (async () => {
                if (get().mode === "server") {
                    const bytes = await serverApi.fetchPluginArchive(plugin.id);
                    return readPbePluginArchive(bytes);
                }
                if (!plugin.file) throw new Error("找不到扩展包文件");
                const bytes = await fetchBuiltinPluginBytes(plugin.file);
                return readPbePluginArchive(bytes);
            })();
            archiveLoadCache.set(key, pending);
            pending.catch(() => archiveLoadCache.delete(key));
            return pending;
        },

        importSingleSongFromPlugin(archive, songId, opts) {
            return runtime.queue.enqueue(async () => {
                const ps = archive.songs.get(songId);
                if (!ps) throw new Error("扩展包内未找到该曲目");
                const matchedPerfs = archive.performances.filter(
                    (pf) => pf.songId === ps.id || pf.musicFingerprint === ps.musicFingerprint,
                );

                if (get().mode === "server") {
                    const saved = await serverApi.uploadSong(
                        `${ps.name}.pbe3`,
                        ps.bytes,
                        opts.targetLibraryId,
                    );
                    if (opts.includePerformances) {
                        for (const pf of matchedPerfs) {
                            await serverApi.addSongPerformance(saved.id, {
                                id: pf.id,
                                name: pf.name,
                                author: pf.author ?? archive.manifest.author,
                                description: pf.description,
                                cues: pf.cues,
                            });
                        }
                    }
                } else {
                    const res = await saveLocalSongBytes(
                        `${ps.name}.pbe3`,
                        ps.bytes,
                        opts.targetLibraryId,
                    );
                    if (res.status === "conflict") throw new Error(res.message);
                    const savedId = res.songId ?? ps.id;
                    if (opts.includePerformances && res.songId) {
                        for (const pf of matchedPerfs) {
                            await saveLocalPerformance({
                                id: pf.id,
                                songId: res.songId,
                                musicFingerprint: pf.musicFingerprint ?? ps.musicFingerprint,
                                name: pf.name,
                                author: pf.author ?? archive.manifest.author,
                                description: pf.description,
                                cues: [...pf.cues],
                                requiredEffects: [...pf.requiredEffects],
                            });
                        }
                    }
                    const targetLib = opts.targetLibraryId || "user-default";
                    set((s) => {
                        const nextExcluded = s.addonExcludedSongIds.filter((id) => id !== savedId);
                        const covered = s.addonSelectedLibraryIds.includes(targetLib);
                        const nextExtra = covered
                            ? s.addonExtraSongIds
                            : [...new Set([...s.addonExtraSongIds, savedId])];
                        persistAddonPlan({
                            ...snapshotPlan(s),
                            extraSongIds: nextExtra,
                            excludedSongIds: nextExcluded,
                        });
                        return {
                            addonExtraSongIds: nextExtra,
                            addonExcludedSongIds: nextExcluded,
                        };
                    });
                }

                await get().refresh();
                notify({
                    title: `已添加「${ps.name}」到我的曲库`,
                    message:
                        opts.includePerformances && matchedPerfs.length > 0
                            ? `同时挂载 ${matchedPerfs.length} 套独立演出`
                            : undefined,
                    color: "teal",
                });
            });
        },

        installBuiltinPlugin(id) {
            return runtime.queue.enqueue(async () => {
                set({ busy: true });
                try {
                    if (get().mode === "server") {
                        await serverApi.installBuiltinPlugin(id);
                        await get().refresh();
                        notify({ title: `已安装内置扩展 ${id}`, color: "teal" });
                        return;
                    }
                    const plugin = get().plugins.find((p) => p.id === id);
                    if (!plugin?.file) throw new Error(`未找到内置扩展：${id}`);
                    const bytes = await fetchBuiltinPluginBytes(plugin.file);
                    // 官方随应用分发的扩展默认可信，自动启用（含曲库包会在音乐库立即可用）
                    await installLocalPluginBytes(bytes, "builtin", true);
                    const archive = readPbePluginArchive(bytes);
                    if (archive.libraries.length > 0 || archive.timbres.length > 0) {
                        const newLibIds = archive.libraries.map((l) => l.id);
                        const newSongIds = new Set(archive.libraries.flatMap((l) => l.songs));
                        const newTimbreIds = archive.timbres.map((t) => t.id);
                        set((s) => {
                            const nextLibs = [...new Set([...s.addonSelectedLibraryIds, ...newLibIds])];
                            const nextExcluded = s.addonExcludedSongIds.filter((sid) => !newSongIds.has(sid));
                            const nextTimbres = [...new Set([...s.selectedTimbreIds, ...newTimbreIds])];
                            persistAddonPlan({
                                ...snapshotPlan(s),
                                selectedLibraryIds: nextLibs,
                                excludedSongIds: nextExcluded,
                                selectedTimbreIds: nextTimbres,
                            });
                            return {
                                addonSelectedLibraryIds: nextLibs,
                                addonExcludedSongIds: nextExcluded,
                                selectedTimbreIds: nextTimbres,
                            };
                        });
                    }
                    await get().refresh();
                    notify({
                        title: `已安装「${plugin.name}」`,
                        message:
                            plugin.contents.songs > 0
                                ? `已加入音乐库（${plugin.contents.songs} 首），已默认纳入导出清单`
                                : "已启用，可在扩展中心或附加包页随时调整",
                        color: "teal",
                    });
                } finally {
                    set({ busy: false });
                }
            });
        },

        trustPlugin(id) {
            return runtime.queue.enqueue(async () => {
                if (get().mode === "server") {
                    await serverApi.trustPlugin(id);
                } else {
                    await trustLocalPlugin(id);
                }
                await get().refresh();
                notify({ title: "已信任并启用扩展", color: "teal" });
            });
        },

        confirmPendingTrust(approvedIds) {
            return runtime.queue.enqueue(async () => {
                for (const id of approvedIds) {
                    await trustLocalPlugin(id);
                }
                set({ pendingTrustPlugins: [] });
                await get().refresh();
                notify({ title: `已信任并启用 ${approvedIds.length} 个扩展`, color: "teal" });
            });
        },

        cancelPendingTrust() {
            set({ pendingTrustPlugins: [] });
        },

        togglePlugin(id, enabled) {
            return runtime.queue.enqueue(async () => {
                if (get().mode === "server") {
                    await serverApi.setPluginEnabled(id, enabled);
                    await get().refresh();
                    return;
                }
                const plugins = get().plugins;
                const installedCatalog: PluginCatalogEntry[] = plugins
                    .filter((p) => p.installed && p.archive)
                    .map((p) => ({
                        id: p.id,
                        manifest: p.archive!.manifest,
                        trusted: p.trusted,
                        compatible: p.compatible,
                    }));

                if (enabled) {
                    const dep = resolvePluginDependencies([id], installedCatalog);
                    if (dep.missingDependencies.length > 0) {
                        for (const item of dep.missingDependencies) {
                            const builtin = plugins.find((p) => p.id === item.dependencyId && p.file);
                            if (builtin?.file) {
                                const bytes = await fetchBuiltinPluginBytes(builtin.file);
                                await installLocalPluginBytes(bytes, "builtin", true);
                            } else {
                                throw new Error(`缺少依赖扩展：${item.dependencyId}`);
                            }
                        }
                    }
                    for (const depId of dep.resolvedIds) {
                        await setLocalPluginEnabled(depId, true);
                    }
                    await setLocalPluginEnabled(id, true);
                } else {
                    const dependents = plugins.filter(
                        (p) =>
                            p.installed &&
                            p.enabled &&
                            p.id !== id &&
                            p.dependencies.some((d) => d.id === id),
                    );
                    if (dependents.length > 0) {
                        throw new Error(
                            `以下已启用扩展仍依赖此扩展：${dependents.map((d) => d.name).join("、")}`,
                        );
                    }
                    await setLocalPluginEnabled(id, false);
                }
                await get().refresh();
            });
        },

        uninstallPlugin(id) {
            return runtime.queue.enqueue(async () => {
                if (get().mode === "server") {
                    await serverApi.uninstallPlugin(id);
                } else {
                    await uninstallLocalPlugin(id, get().plugins);
                }
                await get().refresh();
                notify({ title: "扩展已卸载", color: "teal" });
            });
        },

        autoMatchLocalPlugins() {
            return runtime.queue.enqueue(async () => {
                const { songs, selectedSongIds, plugins } = get();
                const pickedSongs = songs.filter((s) => selectedSongIds.includes(s.id));

                const effectProviderMap = new Map<string, (typeof plugins)[number]>();
                for (const p of plugins) {
                    for (const eff of p.provides.effects ?? []) {
                        if (!effectProviderMap.has(eff) || p.installed) {
                            effectProviderMap.set(eff, p);
                        }
                    }
                }
                const neededEffects = new Set<string>();
                for (const song of pickedSongs) {
                    for (const eff of extractSongEffectRequirements(song)) neededEffects.add(eff);
                }
                let installedNew = 0;
                for (const eff of neededEffects) {
                    const provider = effectProviderMap.get(eff);
                    if (provider && !provider.installed && provider.file) {
                        const bytes = await fetchBuiltinPluginBytes(provider.file);
                        await installLocalPluginBytes(bytes, "builtin", true);
                        installedNew++;
                    }
                }
                if (installedNew > 0) await get().refresh();

                const currentPlugins = get().plugins;
                const match = computeLocalSongPluginMatch(
                    pickedSongs,
                    currentPlugins,
                    get().selectedPluginIds,
                );
                for (const reqId of match.requiredPluginIds) {
                    await setLocalPluginEnabled(reqId, true);
                }
                await get().refresh();
                notify({
                    title: "已按打包曲目自动匹配扩展",
                    message:
                        match.requiredPluginIds.length > 0
                            ? `已启用 ${match.requiredPluginIds.length} 个所需特效扩展${installedNew ? `（新安装 ${installedNew} 个）` : ""}`
                            : "当前选中的曲目未需要额外 VFX 特效扩展",
                    color: "teal",
                });
            });
        },

        zeroLocalPlugins() {
            return runtime.queue.enqueue(async () => {
                for (const p of get().plugins) {
                    if (p.installed && p.enabled && isVfxPlugin(p)) {
                        await setLocalPluginEnabled(p.id, false);
                    }
                }
                await get().refresh();
                notify({ title: "已停用所有 VFX 特效扩展（纯净模式）", color: "teal" });
            });
        },
    };
}
