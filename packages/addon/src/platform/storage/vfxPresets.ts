import { world } from "@minecraft/server";
import { validateVfxPreset, VFX_PRESETS, type VfxPreset } from "@domain/piano/vfxPreset";

const key = "pbe:vfx_lab_presets";

export function loadVfxPresets(): Map<string, VfxPreset> {
    const stored = world.getDynamicProperty(key);
    if (typeof stored !== "string") return new Map();
    const data: unknown = JSON.parse(stored);
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("VFX 自定义预设存储格式错误");
    return new Map(Object.entries(data).filter(([name]) => /^[a-z][a-z0-9_-]{0,23}$/.test(name))
        .map(([name, preset]) => [name, validateVfxPreset(preset)]));
}

export function saveVfxPreset(name: string, preset: VfxPreset | undefined) {
    if (!/^[a-z][a-z0-9_-]{0,23}$/.test(name) || Object.hasOwn(VFX_PRESETS, name)) {
        throw new Error("预设名需以英文字母开头，最多 24 字符，内置预设名保留");
    }
    const entries = loadVfxPresets();
    if (preset) {
        if (!entries.has(name) && entries.size >= 12) throw new Error("当前世界自定义预设已达 12 个");
        entries.set(name, preset);
    } else {
        entries.delete(name);
    }
    const serialized = JSON.stringify(Object.fromEntries(entries));
    if (serialized.length > 28_000) throw new Error("预设超过世界存储预算");
    world.setDynamicProperty(key, serialized);
}
