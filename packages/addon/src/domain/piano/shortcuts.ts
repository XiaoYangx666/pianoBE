/**
 * 面板快捷键：只允许绑定数字/符号键，避免和钢琴音域按键冲突。
 * 这些字符在当前键位方案里都不发声。
 */
export const SHORTCUT_CHARS = "!@#$%^&*()_+:\"<>?{}|";

export const SHORTCUT_ACTIONS = [
    { id: "compact", label: "切换简洁模式" },
    { id: "octave", label: "升八度" },
    { id: "sound", label: "切换音长" },
    { id: "legato", label: "切换连音" },
    { id: "score", label: "切换曲谱显示" },
    { id: "prevPage", label: "曲谱上一页" },
    { id: "nextPage", label: "曲谱下一页" },
] as const;

export type ShortcutAction = (typeof SHORTCUT_ACTIONS)[number]["id"];
export type ShortcutBindings = Record<ShortcutAction, string>;

export const DEFAULT_SHORTCUTS: ShortcutBindings = {
    compact: "",
    octave: "",
    sound: "",
    legato: "",
    score: "",
    prevPage: "",
    nextPage: "",
};

/** 空字符串表示不绑定；否则必须是允许字符中的一个。 */
export function isValidShortcutKey(value: string): boolean {
    return value.length === 0 || (value.length === 1 && SHORTCUT_CHARS.includes(value));
}

/** 从动态属性读出的任意值恢复成完整绑定表。 */
export function normalizeShortcutBindings(raw: unknown): ShortcutBindings {
    let source: unknown = raw;
    if (typeof raw === "string") {
        try {
            source = JSON.parse(raw);
        } catch {
            source = undefined;
        }
    }
    const record = source && typeof source === "object" ? source as Record<string, unknown> : {};
    const bindings = { ...DEFAULT_SHORTCUTS };
    for (const { id } of SHORTCUT_ACTIONS) {
        const value = record[id];
        if (typeof value === "string" && isValidShortcutKey(value)) bindings[id] = value;
    }
    return bindings;
}

/** 找出某个字符绑定的动作；未绑定时返回 undefined。 */
export function shortcutAction(bindings: ShortcutBindings, char: string): ShortcutAction | undefined {
    if (char.length !== 1 || !SHORTCUT_CHARS.includes(char)) return undefined;
    return SHORTCUT_ACTIONS.find(({ id }) => bindings[id] === char)?.id;
}
