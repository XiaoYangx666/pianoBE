import { world } from "@minecraft/server";
import { Configdb } from "sapi-pro";
import { normalizePbeSettings, type PbeSettings } from "@domain/settings/pbeSettings";

/** Configdb 中的键（实际世界动态属性名为 Config.pbe.settings） */
export const PBE_SETTINGS_KEY = "pbe.settings";
/** 旧版直接写入世界动态属性的键，迁移后删除 */
const LEGACY_WORLD_KEY = "pbe.settings";

function readStored(value: unknown): PbeSettings | undefined {
    if (typeof value !== "string") return undefined;
    try {
        return normalizePbeSettings(JSON.parse(value));
    } catch {
        return undefined;
    }
}

export function loadPbeSettings(): PbeSettings {
    const current = readStored(Configdb.get(PBE_SETTINGS_KEY));
    if (current) return current;

    // 旧版直接写入 pbe.settings 的配置：一次性迁移到 Configdb。
    const legacy = readStored(world.getDynamicProperty(LEGACY_WORLD_KEY));
    if (legacy) {
        savePbeSettings(legacy);
        world.setDynamicProperty(LEGACY_WORLD_KEY); // 置 undefined 即删除
        return legacy;
    }
    return normalizePbeSettings(undefined);
}

export function savePbeSettings(settings: PbeSettings): void {
    Configdb.set(PBE_SETTINGS_KEY, JSON.stringify(normalizePbeSettings(settings)));
}
