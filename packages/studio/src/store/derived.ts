import { extractCueEffects, type LibraryRecord } from "@piano/core";
import type { TimbreIndexEntry } from "@piano/assembly";
import { buildTimbreIndexFromPlugins } from "../adapters/timbres";
import type { StudioDeploymentStatus, StudioPlugin, StudioSong } from "../adapters/types";
import type { LocalAddonPlan, StudioState } from "./types";

export const ADDON_PLAN_KEY = "pianobe_studio_addon_plan_v1";

export function defaultAddonPlan(): LocalAddonPlan {
    return {
        selectedLibraryIds: ["user-default"],
        extraSongIds: [],
        excludedSongIds: [],
        selectedTimbreIds: ["piano"],
        addonName: "PianoBE 钢琴附加包",
        addonDesc: "Powered by PianoBE Studio",
        randomUuid: false,
    };
}

export function readStoredAddonPlan(): LocalAddonPlan {
    try {
        if (typeof localStorage === "undefined") return defaultAddonPlan();
        const raw = localStorage.getItem(ADDON_PLAN_KEY);
        if (!raw) return defaultAddonPlan();
        const parsed = JSON.parse(raw) as Partial<LocalAddonPlan>;
        const def = defaultAddonPlan();
        return {
            selectedLibraryIds: Array.isArray(parsed.selectedLibraryIds)
                ? parsed.selectedLibraryIds
                : def.selectedLibraryIds,
            extraSongIds: Array.isArray(parsed.extraSongIds) ? parsed.extraSongIds : [],
            excludedSongIds: Array.isArray(parsed.excludedSongIds) ? parsed.excludedSongIds : [],
            selectedTimbreIds: Array.isArray(parsed.selectedTimbreIds)
                ? ["piano", ...parsed.selectedTimbreIds.filter((id) => id !== "piano")]
                : def.selectedTimbreIds,
            addonName: typeof parsed.addonName === "string" ? parsed.addonName : def.addonName,
            addonDesc: typeof parsed.addonDesc === "string" ? parsed.addonDesc : def.addonDesc,
            randomUuid: Boolean(parsed.randomUuid),
        };
    } catch {
        return defaultAddonPlan();
    }
}

export function persistAddonPlan(plan: LocalAddonPlan): void {
    try {
        if (typeof localStorage === "undefined") return;
        localStorage.setItem(ADDON_PLAN_KEY, JSON.stringify(plan));
    } catch {
        // ignore storage quota errors
    }
}

export function snapshotPlan(state: StudioState): LocalAddonPlan {
    return {
        selectedLibraryIds: state.addonSelectedLibraryIds,
        extraSongIds: state.addonExtraSongIds,
        excludedSongIds: state.addonExcludedSongIds,
        selectedTimbreIds: state.selectedTimbreIds,
        addonName: state.addonName,
        addonDesc: state.addonDesc,
        randomUuid: state.randomUuid,
    };
}

export function computeAddonSongIds(
    songs: readonly StudioSong[],
    libraries: readonly LibraryRecord[],
    plan: Pick<LocalAddonPlan, "selectedLibraryIds" | "extraSongIds" | "excludedSongIds">,
): string[] {
    const selectedLibs = new Set(plan.selectedLibraryIds);
    const extraSet = new Set(plan.extraSongIds);
    const excludedSet = new Set(plan.excludedSongIds);
    const libCoveredSongs = new Set<string>();
    for (const lib of libraries) {
        if (!selectedLibs.has(lib.id)) continue;
        for (const sid of lib.songIds) libCoveredSongs.add(sid);
    }

    const out: string[] = [];
    for (const song of songs) {
        if (excludedSet.has(song.id)) continue;
        const inSelectedLib =
            libCoveredSongs.has(song.id) ||
            Boolean(song.libraries?.some((lid) => selectedLibs.has(lid)));
        if (inSelectedLib || extraSet.has(song.id)) {
            out.push(song.id);
        }
    }
    return out;
}

export function findTimbrePlugin(plugins: readonly StudioPlugin[], timbreId: string): StudioPlugin | undefined {
    return plugins.find(
        (p) =>
            p.provides.timbres?.includes(timbreId) ||
            Boolean(p.timbreEntries?.some((entry) => entry.id === timbreId)),
    );
}

export function isVfxPlugin(plugin: StudioPlugin): boolean {
    const c = plugin.contents;
    return Boolean(plugin.hasExecutableCode || c.effects || c.themes || c.keyStyles || c.particles || c.stageProps);
}

export function summarizePluginCapabilities(plugin: StudioPlugin): string {
    const parts: string[] = [];
    const c = plugin.contents;
    if (c.songs) parts.push(`${c.songs} 首曲目`);
    if (c.libraries) parts.push(`${c.libraries} 个曲库`);
    if (c.performances) parts.push(`${c.performances} 套演出`);
    if (c.timbres) parts.push(`${c.timbres} 套钢琴音色`);
    if (c.effects) parts.push(`${c.effects} 项特效`);
    if (c.themes) parts.push(`${c.themes} 套主题`);
    if (c.keyStyles) parts.push(`${c.keyStyles} 种琴键样式`);
    if (c.stageProps) parts.push(`${c.stageProps} 个舞台道具`);
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

export function getPluginTimbreIds(plugin: StudioPlugin): string[] {
    return plugin.timbreEntries?.map((t) => t.id) ?? plugin.provides.timbres ?? [];
}

function isPureTimbrePlugin(plugin: StudioPlugin): boolean {
    const c = plugin.contents;
    return (
        getPluginTimbreIds(plugin).length > 0 &&
        !plugin.hasExecutableCode &&
        !c.songs &&
        !c.libraries &&
        !c.performances &&
        !c.effects &&
        !c.themes &&
        !c.keyStyles &&
        !c.particles &&
        !c.stageProps
    );
}

export function computeSelectedPluginIds(
    plugins: readonly StudioPlugin[],
    selectedTimbreIds: readonly string[],
): string[] {
    const selectedTimbreSet = new Set(selectedTimbreIds);
    return plugins
        .filter((p) => {
            if (!p.installed || !p.enabled || !p.trusted) return false;
            if (isPureTimbrePlugin(p)) {
                return getPluginTimbreIds(p).some((id) => selectedTimbreSet.has(id));
            }
            return true;
        })
        .map((p) => p.id);
}

export function deriveLocalSnapshot(
    local: { songs: StudioSong[]; libraries: LibraryRecord[]; plugins: StudioPlugin[] },
    currentPlan: LocalAddonPlan,
    currentPreviewTimbreId: string,
): {
    timbreIndex: TimbreIndexEntry[];
    installedTimbreIds: string[];
    selectedTimbreIds: string[];
    previewTimbreId: string;
    previewResetToPiano: boolean;
    cleanedPlan: LocalAddonPlan;
    selectedSongIds: string[];
    selectedPluginIds: string[];
} {
    const timbreIndex = buildTimbreIndexFromPlugins(local.plugins);
    const installedPluginTimbres = local.plugins
        .filter((p) => p.installed && p.trusted)
        .flatMap(getPluginTimbreIds);
    const installedTimbreIds = [
        "piano",
        ...new Set(installedPluginTimbres.filter((id) => id !== "piano")),
    ];
    const installedTimbreSet = new Set(installedTimbreIds);
    const selectedTimbreIds = [
        "piano",
        ...new Set(
            (currentPlan.selectedTimbreIds ?? []).filter(
                (id) => id !== "piano" && installedTimbreSet.has(id),
            ),
        ),
    ];
    const previewTimbreId = installedTimbreSet.has(currentPreviewTimbreId)
        ? currentPreviewTimbreId
        : "piano";

    const validSongIds = new Set(local.songs.map((s) => s.id));
    const validLibIds = new Set(local.libraries.map((l) => l.id));
    const cleanedPlan: LocalAddonPlan = {
        ...currentPlan,
        selectedLibraryIds: currentPlan.selectedLibraryIds.filter((id) => validLibIds.has(id)),
        extraSongIds: currentPlan.extraSongIds.filter((id) => validSongIds.has(id)),
        excludedSongIds: currentPlan.excludedSongIds.filter((id) => validSongIds.has(id)),
        selectedTimbreIds,
    };
    const selectedSongIds = computeAddonSongIds(local.songs, local.libraries, cleanedPlan);
    const selectedPluginIds = computeSelectedPluginIds(local.plugins, selectedTimbreIds);

    return {
        timbreIndex,
        installedTimbreIds,
        selectedTimbreIds,
        previewTimbreId,
        previewResetToPiano: previewTimbreId !== currentPreviewTimbreId,
        cleanedPlan,
        selectedSongIds,
        selectedPluginIds,
    };
}

export function deriveServerSnapshot(
    songs: StudioSong[],
    libraries: LibraryRecord[],
    plugins: StudioPlugin[],
    deployment: StudioDeploymentStatus,
    currentPreviewTimbreId: string,
): {
    songs: StudioSong[];
    libraries: LibraryRecord[];
    plugins: StudioPlugin[];
    deploymentStatus: StudioDeploymentStatus;
    timbreIndex: TimbreIndexEntry[];
    installedTimbreIds: string[];
    selectedTimbreIds: string[];
    previewTimbreId: string;
    previewResetToPiano: boolean;
} {
    const pluginTimbreIndex = buildTimbreIndexFromPlugins(plugins);
    const timbreIndex = [...pluginTimbreIndex];
    for (const item of deployment.availableTimbres) {
        if (!timbreIndex.some((t) => t.id === item.id)) timbreIndex.push(item);
    }
    const installedPluginTimbres = plugins
        .filter((p) => p.installed && p.trusted)
        .flatMap(getPluginTimbreIds);
    const installedTimbreIds = [
        "piano",
        ...new Set([...installedPluginTimbres, ...deployment.enabledTimbres].filter((id) => id !== "piano")),
    ];
    const allowed = new Set(installedTimbreIds);
    const previewTimbreId = allowed.has(currentPreviewTimbreId)
        ? currentPreviewTimbreId
        : "piano";
    return {
        songs,
        libraries,
        plugins,
        deploymentStatus: deployment,
        timbreIndex,
        installedTimbreIds,
        selectedTimbreIds: deployment.enabledTimbres,
        previewTimbreId,
        previewResetToPiano: previewTimbreId !== currentPreviewTimbreId,
    };
}
