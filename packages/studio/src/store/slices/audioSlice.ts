import { notify } from "@piano/ui";
import {
    readStoredNormalizeLoudness,
    readStoredPreviewTimbreId,
    studioPlayer,
} from "../../audio/player";
import { findTimbrePlugin } from "../derived";
import type { AudioSlice, StudioGet, StudioSet } from "../types";

export function createAudioSlice(set: StudioSet, get: StudioGet): AudioSlice {
    const resolveTimbreLoader = async (timbreId: string) => {
        const plugin = findTimbrePlugin(get().plugins, timbreId);
        return plugin ? get().loadPluginArchive(plugin) : null;
    };

    return {
        previewTimbreId: readStoredPreviewTimbreId(),
        normalizeLoudness: readStoredNormalizeLoudness(),

        async setPreviewTimbre(id) {
            const { installedTimbreIds, timbreIndex } = get();
            if (id !== "piano" && !(installedTimbreIds ?? ["piano"]).includes(id)) {
                notify({
                    title: "该音色尚未安装",
                    message: "请先前往「扩展中心 → 钢琴音色」安装后再切换使用。",
                    color: "yellow",
                });
                return;
            }
            set({ previewTimbreId: id });
            try {
                await studioPlayer.setTimbre(id, timbreIndex, resolveTimbreLoader);
                const label = timbreIndex.find((t) => t.id === id)?.label ?? id;
                notify({ title: `试听音色已切换：${label}`, color: "teal" });
            } catch (err) {
                notify({
                    title: "加载音色失败",
                    message: err instanceof Error ? err.message : String(err),
                    color: "red",
                });
            }
        },

        async previewTimbreDemo(id) {
            const index = get().timbreIndex;
            set({ previewTimbreId: id });
            try {
                await studioPlayer.previewTimbreDemo(id, index, resolveTimbreLoader);
            } catch (err) {
                notify({
                    title: "试听音色失败",
                    message: err instanceof Error ? err.message : String(err),
                    color: "red",
                });
            }
        },

        async auditionTimbreSample(id) {
            const index = get().timbreIndex;
            try {
                await studioPlayer.auditionTimbreDemo(id, index, resolveTimbreLoader);
            } catch (err) {
                notify({
                    title: "试听样音失败",
                    message: err instanceof Error ? err.message : String(err),
                    color: "red",
                });
            }
        },

        setNormalizeLoudness(enabled) {
            studioPlayer.setNormalizeLoudness(enabled);
            set({ normalizeLoudness: enabled });
        },
    };
}
