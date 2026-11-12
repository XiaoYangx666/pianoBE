import { Player, system } from "@minecraft/server";
import { CustomForm, DataDrivenScreenClosedReason, ObservableBoolean, ObservableNumber, ObservableString } from "@minecraft/server-ui";
import { AVAILABLE_PIANO_TIMBRES, DEFAULT_PIANO_SETTINGS, normalizePianoColor, normalizePianoSettings, PIANO_PARTICLE_PALETTES, PIANO_PARTICLE_STYLES, PIANO_SETTINGS_LIMITS, type PianoSettings } from "@domain/piano/settings";
import { soundLayerAt, soundLayerIndexOf, soundTypes } from "@domain/piano/soundTypes";
import type { PianoRuntime } from "@app/PianoRuntime";

class PianoSettingsForm {
    private readonly form: CustomForm;
    private readonly syncFields: Array<(settings: PianoSettings) => void> = [];
    /** Observable 订阅；关闭表单时显式解绑，避免回调闭包拖住设置表单。 */
    private readonly cleanups: Array<() => void> = [];
    private readonly hasScreen = new ObservableBoolean(true);
    private target?: { piano: PianoRuntime; displayId: string };
    private unsubscribe?: () => void;
    private opening = false;
    private syncing = false;

    constructor(private readonly player: Player) {
        this.form = new CustomForm(player, "钢琴设置").label("下次发声或刷新时应用，关闭表单时保存");
        const writable = { clientWritable: true };
        const toggle = (label: string, key: "particles" | "textVisible") => {
            const value = new ObservableBoolean(DEFAULT_PIANO_SETTINGS[key], writable);
            this.bind(key, value);
            this.form.toggle(label, value, { visible: key === "textVisible" ? this.hasScreen : true });
        };
        const slider = (label: string, key: keyof typeof PIANO_SETTINGS_LIMITS) => {
            const value = new ObservableNumber(DEFAULT_PIANO_SETTINGS[key], writable);
            const [min, max] = PIANO_SETTINGS_LIMITS[key];
            this.bind(key, value);
            this.form.slider(label, value, min, max, { step: 1, visible: key === "volume" ? true : this.hasScreen });
        };
        const color = (label: string, key: "titleColor" | "statusColor") => {
            const value = new ObservableString(DEFAULT_PIANO_SETTINGS[key], writable);
            this.bind(key, value, normalizePianoColor);
            this.form.textField(label, value, { description: "输入 #RRGGBB，色值有效后生效", visible: this.hasScreen });
        };
        toggle("显示弹奏粒子", "particles");
        const particleStyle = new ObservableNumber(DEFAULT_PIANO_SETTINGS.particleStyle, writable);
        this.bind("particleStyle", particleStyle);
        this.form.dropdown("粒子样式", particleStyle, PIANO_PARTICLE_STYLES.map(({ label, value }) => ({ label, value })));
        const particlePalette = new ObservableNumber(DEFAULT_PIANO_SETTINGS.particlePalette, writable);
        this.bind("particlePalette", particlePalette);
        this.form.dropdown("粒子配色", particlePalette, PIANO_PARTICLE_PALETTES.map(({ label, value }) => ({ label, value })));
        slider("钢琴音量（%，100 为正常，200 为最大）", "volume");
        const timbre = new ObservableNumber(DEFAULT_PIANO_SETTINGS.timbre, writable);
        this.bind("timbre", timbre);
        this.form.dropdown("钢琴音色", timbre,
            AVAILABLE_PIANO_TIMBRES.map(({ label, value, description }) => ({ label, value, description })));
        const soundLayer = new ObservableNumber(soundLayerIndexOf(DEFAULT_PIANO_SETTINGS.soundLayer), writable);
        this.syncFields.push(settings => soundLayer.setData(soundLayerIndexOf(settings.soundLayer)));
        const onSoundLayer = (index: number) => {
            if (this.syncing || !this.target) return;
            const layer = soundLayerAt(index);
            if (layer) this.apply({ soundLayer: layer });
        };
        soundLayer.subscribe(onSoundLayer);
        this.cleanups.push(() => soundLayer.unsubscribe(onSoundLayer));
        this.form.dropdown("手动弹奏音长", soundLayer,
            soundTypes.map(({ name }, value) => ({ label: name, value })));
        this.form.divider({ visible: this.hasScreen });
        toggle("显示琴面文字", "textVisible");
        color("标题颜色", "titleColor");
        color("状态颜色", "statusColor");
        slider("文字大小（%）", "textScale");
        slider("文字左右偏移（1/16 格，向右为正）", "textRight");
        slider("文字上下偏移（1/16 格，向上为正）", "textUp");
        slider("文字前后偏移（1/16 格，朝演奏者为正）", "textForward");
        slider("文字可见距离（格）", "textDistance");
        this.form.button("恢复默认设置", () => {
            // 曲谱安装/选择属于独立的曲谱配置，不随显示设置一起重置。
            const current = this.target?.piano.settings;
            const defaults = current
                ? { ...DEFAULT_PIANO_SETTINGS, scoreMounted: current.scoreMounted, scoreId: current.scoreId }
                : DEFAULT_PIANO_SETTINGS;
            const settings = this.apply(defaults);
            if (settings) this.sync(settings);
        }).closeButton();
    }

    private bind<K extends keyof PianoSettings>(key: K, value: {
        setData(value: PianoSettings[K]): void;
        subscribe(callback: (value: PianoSettings[K]) => void): (value: PianoSettings[K]) => void;
        unsubscribe(callback: (value: PianoSettings[K]) => void): boolean;
    }, parse: (value: PianoSettings[K]) => PianoSettings[K] | undefined = value => value) {
        this.syncFields.push(settings => value.setData(settings[key]));
        const callback = (input: PianoSettings[K]) => {
            if (this.syncing || !this.target) return;
            const parsed = parse(input);
            if (parsed !== undefined) this.apply({ [key]: parsed });
        };
        value.subscribe(callback);
        this.cleanups.push(() => value.unsubscribe(callback));
    }

    private sync(settings: PianoSettings) {
        this.syncing = true;
        try {
            for (const field of this.syncFields) field(settings);
        } finally {
            this.syncing = false;
        }
    }

    private apply(patch: Partial<PianoSettings>) {
        const target = this.target;
        if (!target || !this.player.isValid) return;
        const { piano, displayId } = target;
        const current = piano.settings;
        if (!current || piano.displayId !== displayId ||
            this.player.dimension.id !== piano.location.dimension.id ||
            piano.verify(system.currentTick) !== "complete") {
            this.close();
            return;
        }
        const next = normalizePianoSettings(patch, current);
        if (Object.keys(next).every(key => next[key as keyof PianoSettings] === current[key as keyof PianoSettings])) {
            return current;
        }
        if (piano.updateSettings(current, next)) return next;
        this.close();
    }

    async show(piano: PianoRuntime) {
        if (this.opening || this.form.isShowing()) return;
        const settings = piano.settings;
        const displayId = piano.displayId;
        if (!settings || !displayId) {
            this.player.sendMessage("§e钢琴显示实体暂不可用。");
            return;
        }

        this.opening = true;
        try {
            this.hasScreen.setData(piano.hasScreen);
            this.sync(settings);
            this.target = { piano, displayId };
            this.unsubscribe = piano.disposedSignal.subscribe(() => this.close());
            for (let attempt = 0; attempt < 4 && this.target && this.player.isValid; attempt++) {
                if (await this.form.show() !== DataDrivenScreenClosedReason.UserBusy) return;
                await system.waitTicks(2);
            }
        } finally {
            this.opening = false;
            this.close();
        }
    }

    close() {
        const target = this.target;
        this.target = undefined;
        this.unsubscribe?.();
        this.unsubscribe = undefined;
        for (const cleanup of this.cleanups.splice(0)) {
            try {
                cleanup();
            } catch {
                // Observable 可能已随旧会话失效
            }
        }
        this.syncFields.length = 0;
        if (target) target.piano.flushSettings(target.displayId);
        if (this.player.isValid && this.form.isShowing()) this.form.close();
    }
}

/** 同一玩家同时只允许一个设置表单；关闭后实例直接丢弃。 */
const activePlayers = new Set<string>();

export async function openPianoSettings(player: Player, piano: PianoRuntime) {
    if (!player.isValid || activePlayers.has(player.id)) return;

    activePlayers.add(player.id);
    const form = new PianoSettingsForm(player);
    try {
        await form.show(piano);
    } catch (error) {
        console.warn("[piano] 打开钢琴设置失败", error);
        if (player.isValid) player.sendMessage("§e无法打开钢琴设置。");
    } finally {
        activePlayers.delete(player.id);
        form.close();
    }
}
