import { world } from "@minecraft/server";
import { isVfxTheme, validateVfxTheme, type VfxTheme } from "@piano/vfx";

const key = "pbe:vfx_themes";

export function loadVfxThemes(): Map<string, VfxTheme> {
    const stored = world.getDynamicProperty(key);
    if (typeof stored !== "string") return new Map();
    const data: unknown = JSON.parse(stored);
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("VFX 自定义主题存储格式错误");
    return new Map(
        Object.entries(data)
            .filter(([name]) => /^[a-z][a-z0-9_-]{0,23}$/.test(name))
            .map(([name, theme]) => [name, validateVfxTheme(theme)]),
    );
}

export function saveVfxTheme(name: string, theme: VfxTheme | undefined) {
    if (!/^[a-z][a-z0-9_-]{0,23}$/.test(name) || isVfxTheme(name)) {
        throw new Error("主题名需以英文字母开头，最多 24 字符，内置主题名保留");
    }
    const entries = loadVfxThemes();
    if (theme) {
        if (!entries.has(name) && entries.size >= 12) throw new Error("当前世界自定义主题已达 12 个");
        entries.set(name, theme);
    } else {
        entries.delete(name);
    }
    const serialized = JSON.stringify(Object.fromEntries(entries));
    if (serialized.length > 28_000) throw new Error("主题超过世界存储预算");
    world.setDynamicProperty(key, serialized);
}
