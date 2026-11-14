import { DEFAULT_PIANO_SETTINGS, PIANO_PARTICLE_PALETTES, PIANO_PARTICLE_STYLES } from "@domain/piano/settings";
import type { PianoRuntime } from "@app/PianoRuntime";
import { appPage, backButton } from "./ddui";
import { settingsEditor } from "./pianoSettings";

/** 粒子设置：只包含与弹奏特效相关的选项。 */
export const ParticleSettingsPage = appPage<{ piano: PianoRuntime }>("粒子设置", (ui, args) => {
    const editor = settingsEditor(ui, args.piano);
    if (!editor) return;
    const settings = editor.current();
    if (!settings) return;

    const particles = ui.boolean(settings.particles);
    ui.onChange(particles, (value) => editor.apply({ particles: value }));
    const style = ui.number(settings.particleStyle);
    ui.onChange(style, (value) => editor.apply({ particleStyle: value }));
    const palette = ui.number(settings.particlePalette);
    ui.onChange(palette, (value) => editor.apply({ particlePalette: value }));

    ui.label("§7弹奏时在琴键位置生成的特效。");
    ui.toggle("显示弹奏粒子", particles);
    ui.dropdown("粒子样式", style, PIANO_PARTICLE_STYLES.map(({ label, value }) => ({ label, value })));
    ui.dropdown("粒子配色", palette, PIANO_PARTICLE_PALETTES.map(({ label, value }) => ({ label, value })));
    ui.button("恢复本页默认", () => {
        editor.apply({
            particles: DEFAULT_PIANO_SETTINGS.particles,
            particleStyle: DEFAULT_PIANO_SETTINGS.particleStyle,
            particlePalette: DEFAULT_PIANO_SETTINGS.particlePalette,
        });
        ui.reopen();
    });
    backButton(ui);
    ui.closeButton();
});
