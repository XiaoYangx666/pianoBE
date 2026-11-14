import { system } from "@minecraft/server";
import type { DDUIContext, contextArgs } from "sapi-pro";
import { normalizePianoSettings, type PianoSettings } from "@domain/piano/settings";
import type { PianoRuntime } from "@app/PianoRuntime";

/**
 * 钢琴设置编辑会话（主表单与子表单共用）：
 * 每次修改都校验“还是同一架钢琴/同一个显示实体”，失效就关掉当前页。
 */
export interface SettingsEditor {
    readonly displayId: string;
    readonly hasScreen: boolean;
    current(): PianoSettings | undefined;
    apply(patch: Partial<PianoSettings>): PianoSettings | undefined;
    /** 页面关闭时把设置落盘（幂等）。 */
    flush(): void;
}

export function settingsEditor(ui: DDUIContext<contextArgs>, piano: PianoRuntime): SettingsEditor | undefined {
    const geometry = piano.settings;
    const displayId = piano.displayId;
    if (!geometry || !displayId) {
        ui.player.sendMessage("§e钢琴显示实体暂不可用。");
        ui.close();
        return;
    }

    const editor: SettingsEditor = {
        displayId,
        hasScreen: piano.hasScreen,
        current: () => piano.settings,
        flush: () => piano.flushSettings(displayId),
        apply: (patch) => {
            const current = piano.settings;
            if (
                !current ||
                piano.displayId !== displayId ||
                !ui.player.isValid ||
                ui.player.dimension.id !== piano.location.dimension.id ||
                piano.verify(system.currentTick) !== "complete"
            ) {
                ui.close();
                return;
            }
            const next = normalizePianoSettings(patch, current);
            const unchanged = Object.keys(next).every(
                key => next[key as keyof PianoSettings] === current[key as keyof PianoSettings]
            );
            if (unchanged) return current;
            if (piano.updateSettings(current, next)) return next;
            ui.close();
        },
    };

    ui.onClose(() => editor.flush());
    ui.subscribe(piano.disposedSignal, () => ui.close());
    return editor;
}
