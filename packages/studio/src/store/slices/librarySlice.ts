import { decodeBase64Url, encodeSong, type LibraryRecord } from "@piano/core";
import { midiBufferToSong } from "@piano/core/convert";
import { readPbePluginArchive } from "@piano/vfx/package";
import { notify } from "@piano/ui";
import {
    addSongsToLocalLibrary,
    clearLocalLibrary,
    deleteLocalLibrary,
    deleteLocalPerformance,
    deleteLocalSong,
    exportLocalLibraryPlugin,
    getLocalImportCode,
    installLocalPluginBytes,
    removeSongFromLocalLibrary,
    renameLocalSong,
    saveLocalLibrary,
    saveLocalPerformance,
    saveLocalSongBytes,
} from "../../adapters/localAdapter";
import { parsePerformanceJsonText } from "../../adapters/performanceParser";
import { serverApi } from "../../adapters/serverAdapter";
import type { StudioPlugin } from "../../adapters/types";
import { persistAddonPlan, snapshotPlan } from "../derived";
import { downloadBlob } from "../helpers";
import type { LibrarySlice, StoreRuntime, StudioGet, StudioSet } from "../types";

export function createLibrarySlice(
    set: StudioSet,
    get: StudioGet,
    runtime: StoreRuntime,
): LibrarySlice {
    return {
        songs: [],
        libraries: [],

        importFiles(files, targetLibraryId) {
            return runtime.queue.enqueue(async () => {
                const { mode } = get();
                set({ busy: true });
                try {
                    let added = 0;
                    let merged = 0;
                    let pluginsInstalled = 0;
                    const trustQueue: Array<{ plugin: StudioPlugin; bytes: Uint8Array }> = [];

                    for (const file of files) {
                        const lower = file.name.toLowerCase();
                        const bytes = new Uint8Array(await file.arrayBuffer());

                        if (lower.endsWith(".pbeplugin")) {
                            if (mode === "server") {
                                const created = await serverApi.uploadPlugin(bytes);
                                pluginsInstalled++;
                                if (!created.trusted) {
                                    notify({
                                        title: `扩展已安装（待信任）：${created.name}`,
                                        message: "该扩展包含脚本，请在扩展中心确认信任后启用。",
                                        color: "yellow",
                                    });
                                }
                            } else {
                                const archive = readPbePluginArchive(bytes);
                                if (archive.hasExecutableCode) {
                                    const plugin = await installLocalPluginBytes(bytes, "local", false);
                                    trustQueue.push({ plugin, bytes });
                                } else {
                                    await installLocalPluginBytes(bytes, "local", true);
                                    pluginsInstalled++;
                                    if (archive.libraries.length > 0 || archive.timbres.length > 0) {
                                        const newLibIds = archive.libraries.map((l) => l.id);
                                        const newTimbreIds = archive.timbres.map((t) => t.id);
                                        set((s) => {
                                            const nextLibs = [
                                                ...new Set([...s.addonSelectedLibraryIds, ...newLibIds]),
                                            ];
                                            const nextTimbres = [
                                                ...new Set([...s.selectedTimbreIds, ...newTimbreIds]),
                                            ];
                                            persistAddonPlan({
                                                ...snapshotPlan(s),
                                                selectedLibraryIds: nextLibs,
                                                selectedTimbreIds: nextTimbres,
                                            });
                                            return {
                                                addonSelectedLibraryIds: nextLibs,
                                                selectedTimbreIds: nextTimbres,
                                            };
                                        });
                                    }
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
                            else if (res.status === "merged") merged++;
                            else if (res.status === "conflict") {
                                notify({ title: "曲目冲突", message: res.message, color: "red" });
                            }
                        }
                    }

                    if (trustQueue.length > 0) {
                        set((s) => ({ pendingTrustPlugins: [...s.pendingTrustPlugins, ...trustQueue] }));
                    }
                    if (added > 0 || merged > 0 || pluginsInstalled > 0) {
                        const msgParts: string[] = [];
                        if (added > 0) msgParts.push(`新增 ${added} 首曲目`);
                        if (merged > 0) msgParts.push(`合并 ${merged} 首相同音乐`);
                        if (pluginsInstalled > 0) msgParts.push(`安装 ${pluginsInstalled} 个扩展`);
                        notify({ title: "导入完成", message: msgParts.join("，"), color: "teal" });
                    }
                    await get().refresh();
                } catch (err) {
                    notify({
                        title: "导入失败",
                        message: err instanceof Error ? err.message : String(err),
                        color: "red",
                    });
                } finally {
                    set({ busy: false });
                }
            });
        },

        saveConvertedMidi(name, midiBytes, libraryId) {
            return runtime.queue.enqueue(async () => {
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
            });
        },

        renameSong(songId, name) {
            return runtime.queue.enqueue(async () => {
                if (get().mode === "server") {
                    await serverApi.renameSong(songId, name);
                } else {
                    await renameLocalSong(songId, name);
                }
                await get().refresh();
                notify({ title: "已重命名", color: "teal" });
            });
        },

        deleteSong(songId) {
            return runtime.queue.enqueue(async () => {
                const song = get().songs.find((s) => s.id === songId);
                if (get().mode === "server") {
                    await serverApi.deleteSong(songId);
                    await get().refresh();
                    notify({ title: "已移除曲目", color: "teal" });
                    return;
                }
                await deleteLocalSong(songId, song?.musicFingerprint);
                await get().refresh();
                const remaining = get().songs.find(
                    (s) =>
                        s.id === songId ||
                        (Boolean(song?.musicFingerprint) && s.musicFingerprint === song?.musicFingerprint),
                );
                if (remaining) {
                    const pluginOrigins = (remaining.origins ?? [])
                        .filter((o) => o.kind === "plugin")
                        .map((o) => o.name)
                        .join("、");
                    notify({
                        title: "已移除本地副本",
                        message: pluginOrigins
                            ? `该曲目仍由已启用的曲包「${pluginOrigins}」提供，如需彻底移除请停用或卸载对应扩展。`
                            : "该曲目仍由已启用的扩展提供。",
                        color: "yellow",
                    });
                    return;
                }
                notify({ title: "已移除曲目", color: "teal" });
            });
        },

        importPerformanceFile(songId, file) {
            return runtime.queue.enqueue(async () => {
                const song = get().songs.find((s) => s.id === songId);
                if (!song) throw new Error("曲目不存在");
                const text = await file.text();
                const fallback = file.name.replace(/\.json$/i, "").trim() || `${song.name} · 演出`;
                const parsed = parsePerformanceJsonText(text, song.id, fallback, song.musicFingerprint);

                if (get().mode === "server") {
                    await serverApi.addSongPerformance(song.id, {
                        id: parsed.id,
                        name: parsed.name,
                        author: parsed.author,
                        description: parsed.description,
                        cues: parsed.cues,
                    });
                } else {
                    await saveLocalPerformance(parsed);
                }
                await get().refresh();
                notify({ title: `已挂载演出「${parsed.name}」`, color: "teal" });
            });
        },

        deletePerformance(_songId, perfId) {
            return runtime.queue.enqueue(async () => {
                if (perfId === "__plain__") return;
                if (get().mode === "server") {
                    await serverApi.deletePerformance(perfId);
                    await get().refresh();
                    notify({ title: "已删除演出编排", color: "teal" });
                    return;
                }
                const deleted = await deleteLocalPerformance(perfId);
                if (!deleted) {
                    notify({
                        title: "无法单独删除",
                        message: "来自扩展包或 PBE3 内嵌的演出，请在扩展中心管理对应扩展包。",
                        color: "yellow",
                    });
                    return;
                }
                await get().refresh();
                notify({ title: "已删除独立演出", color: "teal" });
            });
        },

        async getSongBytes(songId) {
            const local = get().songs.find((s) => s.id === songId);
            if (local?.data) return local.data;
            if (get().mode === "server") {
                const detail = await serverApi.getSongDetail(songId);
                return decodeBase64Url(detail.data);
            }
            throw new Error("曲目数据未在本地加载");
        },

        async getImportCode(songId) {
            if (get().mode === "server") {
                return serverApi.getImportCode(songId);
            }
            const song = get().songs.find((s) => s.id === songId);
            if (!song) throw new Error("曲目不存在");
            return getLocalImportCode(song);
        },

        createLibrary(name, description) {
            return runtime.queue.enqueue(async () => {
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
                set((s) => {
                    const nextLibs = [...new Set([...s.addonSelectedLibraryIds, lib.id])];
                    persistAddonPlan({ ...snapshotPlan(s), selectedLibraryIds: nextLibs });
                    return { addonSelectedLibraryIds: nextLibs };
                });
                await get().refresh();
                return lib;
            });
        },

        renameLibrary(id, name) {
            return runtime.queue.enqueue(async () => {
                if (get().mode === "server") {
                    await serverApi.updateLibrary(id, { name });
                } else {
                    const existing = get().libraries.find((l) => l.id === id);
                    if (!existing) return;
                    await saveLocalLibrary({ ...existing, name: name.trim() });
                }
                await get().refresh();
            });
        },

        deleteLibrary(id) {
            return runtime.queue.enqueue(async () => {
                if (get().mode === "server") {
                    await serverApi.deleteLibrary(id);
                } else {
                    await deleteLocalLibrary(id);
                }
                await get().refresh();
                notify({ title: "曲库已删除", color: "teal" });
            });
        },

        clearLibrary(libraryId) {
            return runtime.queue.enqueue(async () => {
                if (get().mode === "server") {
                    await serverApi.clearLibrary(libraryId);
                } else {
                    await clearLocalLibrary(libraryId);
                }
                await get().refresh();
                notify({ title: "已清空曲库", color: "teal" });
            });
        },

        addSongsToLibrary(libraryId, songIds) {
            return runtime.queue.enqueue(async () => {
                if (get().mode === "server") {
                    await serverApi.addSongsToLibrary(libraryId, songIds);
                } else {
                    await addSongsToLocalLibrary(libraryId, songIds, get().songs);
                }
                await get().refresh();
                notify({ title: "已加入曲库", color: "teal" });
            });
        },

        removeSongFromLibrary(libraryId, songId) {
            return runtime.queue.enqueue(async () => {
                const song = get().songs.find((s) => s.id === songId);
                if (get().mode === "server") {
                    await serverApi.removeSongFromLibrary(libraryId, songId);
                } else {
                    await removeSongFromLocalLibrary(libraryId, songId, song?.musicFingerprint);
                }
                await get().refresh();
                notify({ title: "已从曲库移出", color: "teal" });
            });
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
    };
}
