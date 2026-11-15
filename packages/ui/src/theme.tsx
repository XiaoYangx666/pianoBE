import { useCallback, useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

export type ThemeMode = "light" | "dark";

const STORAGE_KEY = "pianobe:theme";
const listeners = new Set<(mode: ThemeMode) => void>();

let current: ThemeMode = "light";

function readStored(): ThemeMode | null {
    try {
        const value = window.localStorage.getItem(STORAGE_KEY);
        return value === "light" || value === "dark" ? value : null;
    } catch {
        return null;
    }
}

function apply(mode: ThemeMode) {
    current = mode;
    document.documentElement.dataset.theme = mode;
    document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute("content", mode === "dark" ? "#1c1d21" : "#eff1f5");
    for (const listener of listeners) listener(mode);
}

export function getTheme(): ThemeMode {
    return current;
}

export function setTheme(mode: ThemeMode) {
    apply(mode);
    try {
        window.localStorage.setItem(STORAGE_KEY, mode);
    } catch {
        // 隐私模式下写不进去，忽略即可
    }
}

/** 在 React 挂载前调用，避免首帧闪白/闪黑 */
export function initTheme(): ThemeMode {
    const mode =
        readStored() ??
        (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    apply(mode);
    return mode;
}

export function useThemeMode(): ThemeMode {
    const [mode, setMode] = useState<ThemeMode>(current);

    useEffect(() => {
        const listener = (next: ThemeMode) => setMode(next);
        listeners.add(listener);
        setMode(current);
        return () => {
            listeners.delete(listener);
        };
    }, []);

    return mode;
}

export function useToggleTheme() {
    const mode = useThemeMode();
    return useCallback(() => setTheme(mode === "dark" ? "light" : "dark"), [mode]);
}

/** 顶栏的深浅色切换按钮 */
export function ThemeToggle({ className }: { className?: string }) {
    const mode = useThemeMode();
    const toggle = useToggleTheme();
    const dark = mode === "dark";

    return (
        <button
            type="button"
            onClick={toggle}
            aria-label={dark ? "切换到浅色模式" : "切换到深色模式"}
            title={dark ? "切换到浅色模式" : "切换到深色模式"}
            className={[
                "grid h-8 w-8 place-items-center rounded-md text-ore-dim transition-colors",
                "hover:bg-[var(--pb-hover)] hover:text-ore-text",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
                className ?? "",
            ].join(" ")}
        >
            {dark ? <Sun size={16} /> : <Moon size={16} />}
        </button>
    );
}
