import { PIANO_SAMPLE_KEYS, PIANO_TIMBRES, pianoSoundId, pianoSoundLayers } from "@piano/core";
import type { LoadedTimbrePack, TimbreIndexEntry } from "@piano/assembly";
import type { PbePluginArchive } from "@piano/vfx/package";
import type { StudioPlugin } from "./types";

const coreOrder = new Map<string, number>(PIANO_TIMBRES.map((t, i) => [t.id, i]));
const coreById = new Map<string, (typeof PIANO_TIMBRES)[number]>(PIANO_TIMBRES.map((t) => [t.id, t]));

export function bundledPianoEntry(): TimbreIndexEntry {
    const piano = PIANO_TIMBRES[0];
    const layers = pianoSoundLayers(piano.value);
    return {
        id: piano.id,
        value: piano.value,
        label: piano.label,
        description: piano.description,
        required: true,
        bundled: true,
        dirs: Object.fromEntries(layers.map((layer) => [`v${layer + 1}`, pianoSoundId(piano.value, layer)])),
        notes: [...PIANO_SAMPLE_KEYS],
        layers: layers.map((layer) => `v${layer + 1}`),
        size: 0,
        file: null,
    };
}

export function extractTimbrePacksFromArchive(archive: PbePluginArchive): LoadedTimbrePack[] {
    return archive.timbres.map((timbre) => {
        const files = new Map<string, Uint8Array>();
        for (const dir of Object.values(timbre.dirs)) {
            for (const note of timbre.notes) {
                const samplePath = `sounds/${dir}/${note}.ogg`;
                const bytes = archive.sounds.get(samplePath);
                if (bytes) files.set(samplePath, bytes);
            }
        }
        const meta: TimbreIndexEntry = {
            id: timbre.id,
            value: timbre.value ?? coreById.get(timbre.id)?.value ?? 0,
            label: timbre.label,
            description: timbre.description ?? coreById.get(timbre.id)?.description ?? "",
            required: false,
            bundled: false,
            dirs: timbre.dirs,
            notes: [...timbre.notes],
            layers: [...timbre.layers],
            size: archive.size,
            file: null,
        };
        return { meta, files, soundDefinitions: timbre.soundDefinitions };
    });
}

export function buildTimbreIndexFromPlugins(plugins: readonly StudioPlugin[]): TimbreIndexEntry[] {
    const byId = new Map<string, TimbreIndexEntry>();
    const piano = bundledPianoEntry();
    byId.set(piano.id, piano);

    for (const plugin of plugins) {
        const fromEntries = plugin.timbreEntries;
        if (fromEntries?.length) {
            for (const entry of fromEntries) {
                byId.set(entry.id, {
                    id: entry.id,
                    value: entry.value ?? coreById.get(entry.id)?.value ?? 0,
                    label: entry.label,
                    description: entry.description ?? coreById.get(entry.id)?.description ?? "",
                    required: false,
                    bundled: false,
                    dirs: entry.dirs,
                    notes: [...entry.notes],
                    layers: [...entry.layers],
                    size: plugin.sizeBytes,
                    file: plugin.file ?? null,
                });
            }
            continue;
        }
        for (const id of plugin.provides.timbres ?? []) {
            if (byId.has(id)) continue;
            const coreMeta = coreById.get(id);
            if (!coreMeta) continue;
            const layers = pianoSoundLayers(coreMeta.value);
            byId.set(id, {
                id: coreMeta.id,
                value: coreMeta.value,
                label: coreMeta.label,
                description: coreMeta.description,
                required: false,
                bundled: false,
                dirs: Object.fromEntries(layers.map((l) => [`v${l + 1}`, pianoSoundId(coreMeta.value, l)])),
                notes: [...PIANO_SAMPLE_KEYS],
                layers: layers.map((l) => `v${l + 1}`),
                size: plugin.sizeBytes,
                file: plugin.file ?? null,
            });
        }
    }

    return [...byId.values()].sort(
        (a, b) => (coreOrder.get(a.id) ?? 99) - (coreOrder.get(b.id) ?? 99) || a.label.localeCompare(b.label, "zh-CN"),
    );
}
