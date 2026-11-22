import { DDUI } from "sapi-pro";
import {
    DEFAULT_PIANO_SETTINGS, listPianoStageThemes, stageThemeAt, stageThemeIndexOf,
} from "@domain/piano/settings";
import type { PianoRuntime } from "@app/PianoRuntime";
import { settingsEditor } from "./pianoSettings";

/** 舞台演出设置：控制曲目自带 PBE3 舞台编排与默认演奏主题。 */
export const StageSettingsPage = DDUI.page<{ piano: PianoRuntime }>("舞台演出", (ui, args) => {
    const editor = settingsEditor(ui, args.piano);
    if (!editor) return;
    const settings = editor.current();
    if (!settings) return;

    const stageThemes = listPianoStageThemes();
    const stageChoreography = ui.boolean(settings.stageChoreography);
    ui.onChange(stageChoreography, (value) => editor.apply({ stageChoreography: value }));
    const stageKeyParticles = ui.boolean(settings.stageKeyParticles);
    ui.onChange(stageKeyParticles, (value) => editor.apply({ stageKeyParticles: value }));
    const stageTheme = ui.number(stageThemeIndexOf(settings.stageTheme));
    ui.onChange(stageTheme, (index) => {
        const theme = stageThemeAt(index);
        if (theme) editor.apply({ stageTheme: theme });
    });

    ui.label("§7控制曲目自带舞台编排、弹奏粒子替换与默认演奏主题。");
    ui.toggle("启用曲目自带舞台编排", stageChoreography, {
        description: "播放含演出区块的 PBE3 曲目时自动呈现定制舞台。",
    });
    ui.toggle("允许舞台替换弹奏粒子", stageKeyParticles, {
        description: "开启后，曲目编排或舞台主题可替换弹奏时的琴键粒子样式与配色。",
    });
    ui.dropdown("默认舞台主题", stageTheme, stageThemes.map(({ label, value }) => ({ label, value })));
    ui.button("恢复本页默认", () => {
        editor.apply({
            stageChoreography: DEFAULT_PIANO_SETTINGS.stageChoreography,
            stageKeyParticles: DEFAULT_PIANO_SETTINGS.stageKeyParticles,
            stageTheme: DEFAULT_PIANO_SETTINGS.stageTheme,
        });
        ui.reopen();
    });
    ui.closeButton();
});
