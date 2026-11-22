import { DDUI } from "sapi-pro";
import { DEFAULT_PIANO_SETTINGS, listPianoParticleStyles } from "@domain/piano/settings";
import { keyParticleColorOptions, normalizeKeyParticlePalette } from "@piano/vfx";
import type { PianoRuntime } from "@app/PianoRuntime";
import { settingsEditor } from "./pianoSettings";

/** 粒子设置：只包含与弹奏特效相关的选项。 */
export const ParticleSettingsPage = DDUI.page<{ piano: PianoRuntime }>("粒子设置", (ui, args) => {
    const editor = settingsEditor(ui, args.piano);
    if (!editor) return;
    const settings = editor.current();
    if (!settings) return;

    const styles = listPianoParticleStyles();
    const particles = ui.boolean(settings.particles);
    ui.onChange(particles, (value) => editor.apply({ particles: value }));
    const style = ui.number(settings.particleStyle);
    ui.onChange(style, (value) => {
        // Style changes can invalidate the persisted palette; repick a legal one
        // and rebuild so the color row appears, changes or disappears with it.
        const palette = normalizeKeyParticlePalette(value, editor.current()?.particlePalette ?? 0);
        editor.apply({ particleStyle: value, particlePalette: palette });
        ui.reopen();
    });
    const palette = ui.number(settings.particlePalette);
    ui.onChange(palette, (value) => editor.apply({ particlePalette: value }));

    ui.label("§7弹奏时在琴键位置生成的特效。");
    ui.toggle("显示弹奏粒子", particles);
    if (styles.length > 0) {
        ui.dropdown("粒子样式", style, styles.map(({ label, value }) => ({ label, value })));
        const colorOptions = keyParticleColorOptions(settings.particleStyle);
        if (colorOptions) {
            ui.dropdown("粒子配色", palette, colorOptions.map(({ label, value }) => ({ label, value })));
        } else {
            ui.label("§7该粒子使用固定的自然配色，无需选择颜色。");
        }
    } else {
        ui.label("§7当前未安装弹奏粒子样式插件，弹奏粒子已关闭。");
    }
    ui.button("恢复本页默认", () => {
        editor.apply({
            particles: DEFAULT_PIANO_SETTINGS.particles,
            particleStyle: DEFAULT_PIANO_SETTINGS.particleStyle,
            particlePalette: DEFAULT_PIANO_SETTINGS.particlePalette,
        });
        ui.reopen();
    });
    ui.closeButton();
});
