import { Player, system } from "@minecraft/server";
import { DDUI, type ObservableLike } from "sapi-pro";
import {
    AVAILABLE_PIANO_TIMBRES,
    DEFAULT_PIANO_SETTINGS,
    normalizePianoColor,
    normalizePianoSettings,
    PIANO_PARTICLE_PALETTES,
    PIANO_PARTICLE_STYLES,
    PIANO_SETTINGS_LIMITS,
    type PianoSettings,
} from "@domain/piano/settings";
import { soundLayerAt, soundLayerIndexOf, soundTypes } from "@domain/piano/soundTypes";
import type { PianoRuntime } from "@app/PianoRuntime";

/**
 * 钢琴设置面板。
 *
 * 原生 Observable 双向绑定：玩家改动写回 PianoRuntime，实体失效/玩家离线/界面关闭时
 * 订阅、定时器与 flush 都由 DDUI 页面作用域自动处理。
 */
export const PianoSettingsPage = DDUI.page<{ piano: PianoRuntime }>("钢琴设置", (ui, args) => {
    const piano = args.piano;
    const settings = piano.settings;
    const displayId = piano.displayId;
    if (!settings || !displayId) {
        ui.player.sendMessage("§e钢琴显示实体暂不可用。");
        ui.close();
        return;
    }

    ui.label("下次发声或刷新时应用，关闭表单时保存");
    ui.onClose(() => piano.flushSettings(displayId));
    ui.subscribe(piano.disposedSignal, () => ui.close());

    /** 目标仍有效时保存补丁；失效就关面板，避免把旧设置写回新实体 */
    const apply = (patch: Partial<PianoSettings>): PianoSettings | undefined => {
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
            (key) => next[key as keyof PianoSettings] === current[key as keyof PianoSettings]
        );
        if (unchanged) return current;
        if (piano.updateSettings(current, next)) return next;
        ui.close();
    };

    /** 一个字段 = 原生 Observable + 玩家输入回写 + 初始同步 */
    const field = <K extends keyof PianoSettings>(
        key: K,
        observable: ObservableLike<PianoSettings[K]>
    ) => {
        ui.set(observable, settings[key]);
        ui.onChange(observable, (value) => apply({ [key]: value } as Partial<PianoSettings>));
        return observable;
    };

    const color = (key: "titleColor" | "statusColor") => {
        const observable = ui.string(settings[key]);
        ui.onChange(observable, (input) => {
            const value = normalizePianoColor(input);
            if (value) apply({ [key]: value });
        });
        return observable;
    };

    const hasScreen = ui.boolean(piano.hasScreen, { clientWritable: false });
    const particles = field("particles", ui.boolean(settings.particles));
    const particleStyle = field("particleStyle", ui.number(settings.particleStyle));
    const particlePalette = field("particlePalette", ui.number(settings.particlePalette));
    const volume = field("volume", ui.number(settings.volume));
    const timbre = field("timbre", ui.number(settings.timbre));
    const textVisible = field("textVisible", ui.boolean(settings.textVisible));
    const titleColor = color("titleColor");
    const statusColor = color("statusColor");
    const textScale = field("textScale", ui.number(settings.textScale));
    const textRight = field("textRight", ui.number(settings.textRight));
    const textUp = field("textUp", ui.number(settings.textUp));
    const textForward = field("textForward", ui.number(settings.textForward));
    const textDistance = field("textDistance", ui.number(settings.textDistance));

    const spatialAudio = ui.boolean(settings.soundMode === "3d");
    ui.onChange(spatialAudio, (enabled) => apply({ soundMode: enabled ? "3d" : "stereo" }));
    const spatialLabel = ui.computed([spatialAudio], () =>
        spatialAudio.getData() ? "3D 定位：开" : "3D 定位：关"
    );

    const soundLayer = ui.number(soundLayerIndexOf(settings.soundLayer));
    ui.onChange(soundLayer, (index) => {
        const layer = soundLayerAt(index);
        if (layer) apply({ soundLayer: layer });
    });

    ui.toggle("显示弹奏粒子", particles)
        .dropdown("粒子样式", particleStyle, PIANO_PARTICLE_STYLES.map(({ label, value }) => ({ label, value })))
        .dropdown("粒子配色", particlePalette, PIANO_PARTICLE_PALETTES.map(({ label, value }) => ({ label, value })))
        .slider("钢琴音量（%，100 为正常，200 为最大）", volume, ...PIANO_SETTINGS_LIMITS.volume, { step: 1 })
        .dropdown("钢琴音色", timbre,
            AVAILABLE_PIANO_TIMBRES.map(({ label, value, description }) => ({ label, value, description })))
        .toggle(spatialLabel, spatialAudio, {
            description: "开 = 有距离衰减/定位（单声道）；关 = 立体声（无定位）",
        })
        .dropdown("手动弹奏音长", soundLayer, soundTypes.map(({ name }, value) => ({ label: name, value })))
        .divider({ visible: hasScreen })
        .toggle("显示琴面文字", textVisible, { visible: hasScreen })
        .textField("标题颜色", titleColor, { description: "输入 #RRGGBB，色值有效后生效", visible: hasScreen })
        .textField("状态颜色", statusColor, { description: "输入 #RRGGBB，色值有效后生效", visible: hasScreen })
        .slider("文字大小（%）", textScale, ...PIANO_SETTINGS_LIMITS.textScale, { step: 1, visible: hasScreen })
        .slider("文字左右偏移（1/16 格，向右为正）", textRight, ...PIANO_SETTINGS_LIMITS.textRight, { step: 1, visible: hasScreen })
        .slider("文字上下偏移（1/16 格，向上为正）", textUp, ...PIANO_SETTINGS_LIMITS.textUp, { step: 1, visible: hasScreen })
        .slider("文字前后偏移（1/16 格，朝演奏者为正）", textForward, ...PIANO_SETTINGS_LIMITS.textForward, { step: 1, visible: hasScreen })
        .slider("文字可见距离（格）", textDistance, ...PIANO_SETTINGS_LIMITS.textDistance, { step: 1, visible: hasScreen })
        .button("恢复默认设置", () => {
            // 曲谱安装/选择属于独立的曲谱配置，不随显示设置一起重置。
            const current = piano.settings;
            const defaults = current
                ? { ...DEFAULT_PIANO_SETTINGS, scoreMounted: current.scoreMounted, scoreId: current.scoreId }
                : DEFAULT_PIANO_SETTINGS;
            // 保存后重开本页，用新设置重建控件状态（不需要手写 sync 列表）
            if (apply(defaults)) ui.reopen();
        })
        .closeButton();
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
