import { Player } from "@minecraft/server";
import { DDUI, type ObservableLike } from "sapi-pro";
import {
    AVAILABLE_PIANO_TIMBRES,
    DEFAULT_PIANO_SETTINGS,
    PIANO_SETTINGS_LIMITS,
    type PianoSettings,
} from "@domain/piano/settings";
import { soundLayerAt, soundLayerIndexOf, soundTypes } from "@domain/piano/soundTypes";
import type { PianoRuntime } from "@app/PianoRuntime";
import { settingsEditor } from "./pianoSettings";
import { ParticleSettingsPage } from "./particleSettingsUI";
import { TextSettingsPage } from "./textSettingsUI";
import { PianoScorePage } from "./scoreUI";

/**
 * 钢琴设置主表单：只放最常用的演奏设置，其余按主题拆成子表单。
 *
 * 主表单 → 粒子设置 / 文字设置 / 曲谱配置；子表单“返回”回到这里，
 * 关闭（ESC 在一级页面）才会退出整个界面。
 */
export const PianoSettingsPage = DDUI.page<{ piano: PianoRuntime }>("钢琴设置", (ui, args) => {
    const piano = args.piano;
    const editor = settingsEditor(ui, piano);
    if (!editor) return;
    const settings = editor.current();
    if (!settings) return;

    const apply = (patch: Partial<PianoSettings>) => editor.apply(patch);

    const field = <K extends keyof PianoSettings>(
        key: K,
        observable: ObservableLike<PianoSettings[K]>
    ) => {
        ui.set(observable, settings[key]);
        ui.onChange(observable, (value) => apply({ [key]: value } as Partial<PianoSettings>));
        return observable;
    };

    const volume = field("volume", ui.number(settings.volume));
    const timbre = field("timbre", ui.number(settings.timbre));
    const soundLayer = ui.number(soundLayerIndexOf(settings.soundLayer));
    ui.onChange(soundLayer, (index) => {
        const layer = soundLayerAt(index);
        if (layer) apply({ soundLayer: layer });
    });

    const spatialAudio = ui.boolean(settings.soundMode === "3d");
    ui.onChange(spatialAudio, (enabled) => apply({ soundMode: enabled ? "3d" : "stereo" }));
    const spatialLabel = ui.computed([spatialAudio], () =>
        spatialAudio.getData() ? "3D 定位：开" : "3D 定位：关"
    );

    const particleSummary = ui.string(settings.particles ? "§7粒子：§a开" : "§7粒子：§c关", { clientWritable: false });
    const textSummary = ui.string(settings.textVisible ? "§7琴面文字：§a显示" : "§7琴面文字：§c隐藏", { clientWritable: false });

    ui.label(particleSummary).label(textSummary);
    ui.dropdown("钢琴音色", timbre,
        AVAILABLE_PIANO_TIMBRES.map(({ label, value, description }) => ({ label, value, description })));
    ui.slider("钢琴音量（%）", volume, ...PIANO_SETTINGS_LIMITS.volume, { step: 1 });
    ui.toggle(spatialLabel, spatialAudio, { description: "开：有方位与距离衰减。" });
    ui.dropdown("手动弹奏音长", soundLayer, soundTypes.map(({ name }, value) => ({ label: name, value })));

    ui.divider();
    ui.button("粒子设置", () => ui.push(ParticleSettingsPage, { piano }));
    ui.button("文字设置", () => ui.push(TextSettingsPage, { piano }), { visible: editor.hasScreen });
    ui.button("曲谱配置", () => ui.push(PianoScorePage, { piano }));
    ui.divider();
    ui.button("恢复默认设置", () => {
        // 曲谱安装/选择属于独立的曲谱配置，不随显示设置一起重置。
        const current = editor.current();
        const defaults = current
            ? { ...DEFAULT_PIANO_SETTINGS, scoreMounted: current.scoreMounted, scoreId: current.scoreId }
            : DEFAULT_PIANO_SETTINGS;
        // 保存后重开本页，用新设置重建控件状态。
        if (apply(defaults)) ui.reopen();
    });
    ui.closeButton();
});

/** 同一玩家同时只允许一个界面；DDUI 会关闭旧界面并清理上一次的页面资源。 */
export function openPianoSettings(player: Player, piano: PianoRuntime) {
    if (!player.isValid) return;
    if (!piano.settings || !piano.displayId) {
        player.sendMessage("§e钢琴显示实体暂不可用。");
        return;
    }
    DDUI.open(player, PianoSettingsPage, { piano });
}
