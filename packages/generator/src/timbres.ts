import { readAddonArchive } from "@bepack/addon";

/** public/timbres/index.json 的条目。可选音色额外带 file/size。 */
export interface TimbreIndexEntry {
    id: string;
    value: number;
    label: string;
    description: string;
    required: boolean;
    bundled: boolean;
    dirs: Record<string, string>;
    notes: string[];
    layers: string[];
    size: number;
    file: string | null;
}

export interface LoadedTimbrePack {
    meta: TimbreIndexEntry;
    /** 包内文件（相对 rp 根目录，如 sounds/meta_piano/C4.ogg） */
    files: Map<string, Uint8Array>;
    soundDefinitions: Record<string, unknown>;
}

const packCache = new Map<string, Promise<LoadedTimbrePack>>();

/**
 * preserve-modules 输出中 `domain/piano/timbres.ts` 的固定路径（相对 bp 根）。
 * 生成器覆写此模块，让游戏内设置只显示实际打包的音色。
 */
export const TIMBRES_SCRIPT_PATH = "scripts/packages/addon/src/domain/piano/timbres.js";

/** 加载音色选择清单；加载失败时返回空列表，生成器仍可使用内置默认音色。 */
export async function loadTimbreIndex(): Promise<TimbreIndexEntry[]> {
    try {
        const res = await fetch("./timbres/index.json?t=" + Date.now());
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as TimbreIndexEntry[];
    } catch (e) {
        console.error("[generator] 音色清单加载失败：", e);
        return [];
    }
}

/** 按需加载单个可选音色包（缓存；失败时下次会重试）。 */
export function loadTimbrePack(meta: TimbreIndexEntry): Promise<LoadedTimbrePack> {
    if (meta.bundled || !meta.file) {
        return Promise.reject(new Error(`${meta.label} 已内置在基础模板中`));
    }
    let pending = packCache.get(meta.id);
    if (!pending) {
        pending = (async () => {
            const res = await fetch(`./timbres/${meta.file}?t=` + Date.now());
            if (!res.ok) throw new Error(`音色包加载失败：${meta.label} (${res.status})`);
            const entries = await readAddonArchive(new Uint8Array(await res.arrayBuffer()));
            const files = new Map(entries.map((file) => [file.path, file.bytes]));
            const definitionsEntry = entries.find(
                (file) => file.path === "sound_definitions.json"
            );
            const soundDefinitions = definitionsEntry
                ? (JSON.parse(new TextDecoder().decode(definitionsEntry.bytes))
                      .sound_definitions ?? {})
                : {};
            return { meta, files, soundDefinitions };
        })();
        pending.catch(() => packCache.delete(meta.id));
        packCache.set(meta.id, pending);
    }
    return pending;
}
