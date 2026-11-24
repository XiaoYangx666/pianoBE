import {
    extractCueEffects,
    readSongHeader,
    type PerformanceCue,
    type ResourceDeployStatus,
} from "@piano/core";
import { isValidBrush, type VfxPluginManifest } from "@piano/vfx";
import type { AssemblySongEntry } from "./types.js";

export interface PluginCatalogEntry {
    id: string;
    manifest: VfxPluginManifest;
    trusted: boolean;
    compatible: boolean;
    hasExecutableCode?: boolean;
}

export interface DependencyResolution {
    resolvedIds: string[];
    missingDependencies: { pluginId: string; dependencyId: string }[];
    untrustedDependencies: { pluginId: string; dependencyId: string }[];
}

export function resolvePluginDependencies(
    targetIds: readonly string[],
    plugins: readonly PluginCatalogEntry[],
): DependencyResolution {
    const byId = new Map(plugins.map((p) => [p.id, p]));
    const resolved = new Set<string>();
    const visiting = new Set<string>();
    const missingDependencies: { pluginId: string; dependencyId: string }[] = [];
    const untrustedDependencies: { pluginId: string; dependencyId: string }[] = [];

    function visit(id: string) {
        if (resolved.has(id) || visiting.has(id)) return;
        const entry = byId.get(id);
        if (!entry || !entry.compatible) return;
        visiting.add(id);
        for (const depId of entry.manifest.dependencies ?? []) {
            const dep = byId.get(depId);
            if (!dep || !dep.compatible) {
                missingDependencies.push({ pluginId: id, dependencyId: depId });
                continue;
            }
            if (!dep.trusted) {
                untrustedDependencies.push({ pluginId: id, dependencyId: depId });
                continue;
            }
            visit(depId);
        }
        visiting.delete(id);
        resolved.add(id);
    }

    for (const id of targetIds) visit(id);
    return { resolvedIds: [...resolved], missingDependencies, untrustedDependencies };
}

export function findDependentPlugins<T extends { id: string; manifest: Pick<VfxPluginManifest, "dependencies" | "name"> }>(
    pluginId: string,
    enabledPlugins: readonly T[],
): T[] {
    return enabledPlugins.filter(
        (plugin) => plugin.id !== pluginId && Boolean(plugin.manifest.dependencies?.includes(pluginId)),
    );
}

export function checkPluginUninstall<T extends { id: string; manifest: Pick<VfxPluginManifest, "dependencies" | "name"> }>(
    pluginId: string,
    enabledPlugins: readonly T[],
): { ok: true } | { ok: false; dependents: T[]; message: string } {
    const dependents = findDependentPlugins(pluginId, enabledPlugins);
    if (dependents.length === 0) return { ok: true };
    const names = dependents.map((p) => p.manifest.name || p.id).join("、");
    return {
        ok: false,
        dependents,
        message: `无法卸载：以下已启用插件仍依赖它：${names}`,
    };
}

export function collectSongEffects(song: AssemblySongEntry): string[] {
    const cues: PerformanceCue[] = [];
    if (song.data) {
        try {
            const header = readSongHeader(song.data);
            if (header.performance?.length) cues.push(...header.performance);
        } catch { /* ignore */ }
    }
    for (const entry of song.performanceEntries ?? []) {
        if (entry.cues?.length) cues.push(...entry.cues);
    }
    for (const list of song.performances ?? []) {
        cues.push(...list);
    }
    return extractCueEffects(cues);
}

export interface SongPluginRequirementSummary {
    songEffects: Map<string, string[]>;
    requiredPluginIds: string[];
    missingEffects: { effect: string; songs: string[] }[];
    disabledRequiredEffects: { effect: string; pluginId: string; pluginName: string; songs: string[]; untrusted: boolean }[];
}

export function matchSongsToPlugins(
    songs: readonly AssemblySongEntry[],
    plugins: readonly PluginCatalogEntry[],
    selectedIds: readonly string[],
): SongPluginRequirementSummary {
    const selectedSet = new Set(selectedIds);
    const songEffects = new Map<string, string[]>();
    const effectToSongs = new Map<string, Set<string>>();
    const missingEffects: { effect: string; songs: string[] }[] = [];

    for (const song of songs) {
        const effects = collectSongEffects(song);
        songEffects.set(song.id, effects);
        const cues: PerformanceCue[] = [
            ...(song.data ? (() => { try { return readSongHeader(song.data).performance ?? []; } catch { return []; } })() : []),
            ...(song.performanceEntries?.flatMap((p) => p.cues ?? []) ?? []),
            ...(song.performances?.flat() ?? []),
        ];
        const invalidBrushes = new Set(cues.flatMap((c) => (c.brush && !isValidBrush(c.brush) ? [c.brush] : [])));
        for (const brush of invalidBrushes) missingEffects.push({ effect: `画笔 ${brush}`, songs: [song.name] });
        for (const effect of effects) {
            const set = effectToSongs.get(effect) ?? new Set<string>();
            set.add(song.name);
            effectToSongs.set(effect, set);
        }
    }

    const providersByEffect = new Map<string, PluginCatalogEntry[]>();
    for (const plugin of plugins) {
        for (const effect of plugin.manifest.provides.effects ?? []) {
            const list = providersByEffect.get(effect) ?? [];
            list.push(plugin);
            providersByEffect.set(effect, list);
        }
    }

    const autoSelected = new Set<string>();
    const disabledRequiredEffects: SongPluginRequirementSummary["disabledRequiredEffects"] = [];

    for (const [effect, songNames] of effectToSongs) {
        const candidates = (providersByEffect.get(effect) ?? []).filter((p) => p.compatible);
        const chosen =
            candidates.find((p) => p.trusted && selectedSet.has(p.id)) ??
            candidates.find((p) => p.trusted) ??
            candidates[0];
        if (!chosen) {
            missingEffects.push({ effect, songs: [...songNames] });
            continue;
        }
        if (chosen.trusted) {
            autoSelected.add(chosen.id);
            if (!selectedSet.has(chosen.id)) {
                disabledRequiredEffects.push({
                    effect,
                    pluginId: chosen.id,
                    pluginName: chosen.manifest.name,
                    songs: [...songNames],
                    untrusted: false,
                });
            }
        } else {
            disabledRequiredEffects.push({
                effect,
                pluginId: chosen.id,
                pluginName: chosen.manifest.name,
                songs: [...songNames],
                untrusted: true,
            });
        }
    }

    const resolved = resolvePluginDependencies([...autoSelected], plugins);
    return {
        songEffects,
        requiredPluginIds: resolved.resolvedIds,
        missingEffects,
        disabledRequiredEffects,
    };
}

export function computePluginDeployStatus(input: {
    enabled: boolean;
    trusted: boolean;
    compatible: boolean;
    requiresPackDeploy: boolean;
    hasMissingDeps?: boolean;
    hasConflict?: boolean;
    deployedPluginIds: readonly string[];
    loadedPluginIds: readonly string[];
    pluginId: string;
}): ResourceDeployStatus {
    if (!input.compatible || !input.trusted || !input.enabled || input.hasMissingDeps || input.hasConflict) {
        return "unavailable";
    }
    if (!input.requiresPackDeploy) {
        return "active";
    }
    const inLoaded = input.loadedPluginIds.includes(input.pluginId);
    const inDeployed = input.deployedPluginIds.includes(input.pluginId);
    if (inLoaded) return "active";
    if (inDeployed) return "pending_restart";
    return "pending_deploy";
}
