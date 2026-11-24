import { readAddonArchive } from "@bepack/addon";
import type { TimbreIndexEntry, LoadedTimbrePack } from "@piano/assembly";

const packCache = new Map<string, Promise<LoadedTimbrePack>>();

export async function loadTimbreIndex(): Promise<TimbreIndexEntry[]> {
    try {
        const res = await fetch("./timbres/index.json");
        if (!res.ok) return [];
        return (await res.json()) as TimbreIndexEntry[];
    } catch {
        return [];
    }
}

export function loadTimbrePack(meta: TimbreIndexEntry): Promise<LoadedTimbrePack> {
    if (meta.bundled || !meta.file) {
        return Promise.reject(new Error(`${meta.label} 已内置`));
    }
    let pending = packCache.get(meta.id);
    if (!pending) {
        pending = (async () => {
            const res = await fetch(`./timbres/${meta.file}`);
            if (!res.ok) throw new Error(`加载音色失败 (${meta.label}: ${res.status})`);
            const entries = await readAddonArchive(new Uint8Array(await res.arrayBuffer()));
            const files = new Map(entries.map((f) => [f.path, f.bytes]));
            const defEntry = entries.find((f) => f.path === "sound_definitions.json");
            const soundDefinitions = defEntry
                ? (JSON.parse(new TextDecoder().decode(defEntry.bytes)).sound_definitions ?? {})
                : {};
            return { meta, files, soundDefinitions };
        })();
        pending.catch(() => packCache.delete(meta.id));
        packCache.set(meta.id, pending);
    }
    return pending;
}
