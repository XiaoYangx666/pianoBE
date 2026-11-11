import { describe, expect, test } from "bun:test";
import {
    DEFAULT_SHORTCUTS,
    isValidShortcutKey,
    normalizeShortcutBindings,
    SHORTCUT_ACTIONS,
    SHORTCUT_CHARS,
    shortcutAction,
} from "../src/domain/piano/shortcuts";

describe("piano shortcuts", () => {
    test("只接受约定的符号字符", () => {
        expect(SHORTCUT_CHARS).toBe("!@#$%^&*()_+:\"<>?{}|");
        for (const char of SHORTCUT_CHARS) {
            expect(isValidShortcutKey(char)).toBe(true);
        }
        for (const invalid of ["a", "A", "1", " ", "~", "`", "@@"]) {
            expect(isValidShortcutKey(invalid)).toBe(false);
        }
    });

    test("空字符串表示不绑定", () => {
        expect(isValidShortcutKey("")).toBe(true);
    });

    test("动态属性里的损坏数据回退为空绑定", () => {
        expect(normalizeShortcutBindings(undefined)).toEqual(DEFAULT_SHORTCUTS);
        expect(normalizeShortcutBindings("not json")).toEqual(DEFAULT_SHORTCUTS);
        expect(normalizeShortcutBindings('{"compact":"a","octave":"!"}')).toEqual({
            ...DEFAULT_SHORTCUTS,
            octave: "!",
        });
    });

    test("每个动作都能通过字符反查", () => {
        const chars = Array.from(SHORTCUT_CHARS);
        const bindings = {
            ...DEFAULT_SHORTCUTS,
        };
        SHORTCUT_ACTIONS.forEach(({ id }, index) => {
            bindings[id] = chars[index];
        });
        expect(SHORTCUT_ACTIONS.map(({ id }) => shortcutAction(bindings, bindings[id])))
            .toEqual(SHORTCUT_ACTIONS.map(({ id }) => id));
        expect(shortcutAction(bindings, "~")).toBeUndefined();
        expect(shortcutAction(bindings, "")).toBeUndefined();
        expect(shortcutAction(bindings, "a")).toBeUndefined();
    });
});
