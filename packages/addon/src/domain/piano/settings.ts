import { DEFAULT_PIANO_TIMBRE, PIANO_TIMBRES, type PianoSoundLayer } from "@piano/core";
import { DEFAULT_SCORE_ID, isValidScoreId } from "@domain/score/score";
import { ENABLED_PIANO_TIMBRES } from "./timbres";
import { isSoundLayer, soundLayerAt } from "./soundTypes";

/** 按启用列表过滤音色；空列表回退到默认音色，保证设置里至少有一个选项。 */
export function availablePianoTimbres(enabled: readonly string[]) {
    const set = new Set(enabled);
    const available = PIANO_TIMBRES.filter((timbre) => set.has(timbre.id));
    return available.length ? available : [PIANO_TIMBRES[0]];
}

/** 当前包内可选的音色（生成器可能裁剪掉部分音色） */
export const AVAILABLE_PIANO_TIMBRES = availablePianoTimbres(ENABLED_PIANO_TIMBRES);

export const PIANO_PARTICLE_STYLES = [
    { value: 3, label: "魔法流光", effect: "xypiano:magic_trail" },
    { value: 4, label: "蓝眼泪 · 发光气泡", effect: "xypiano:blue_tears" },
    { value: 0, label: "霓虹音符", effect: "xypiano:neon_note" },
    { value: 2, label: "电光涟漪", effect: "xypiano:pulse_ring" },
    { value: 5, label: "樱吹雪 · 粉色花瓣", effect: "xypiano:sakura_drift" },
    { value: 6, label: "星火 · 闪烁星芒", effect: "xypiano:stardust" },
    { value: 7, label: "棱光 · 彩色晶片", effect: "xypiano:prism_shards" },
] as const;

export const PIANO_PARTICLE_PALETTES = [
    { value: 0, label: "极光 · 青蓝到淡紫", colors: ["#64DBF2", "#E1A0F7"] },
    { value: 1, label: "琥珀 · 暖橙到浅金", colors: ["#E88F54", "#FFE0A1"] },
    { value: 2, label: "森语 · 青绿到嫩黄", colors: ["#48C4AD", "#D4ED92"] },
    { value: 3, label: "月白 · 冷白", colors: ["#D5E6FF", "#D5E6FF"] },
    { value: 4, label: "虹谱 · 紫蓝、青、绿、金、橙红", colors: ["#9362F5", "#45CFFF", "#60E7A4", "#FADF65", "#FA694F"] },
    { value: 5, label: "冰火 · 冰蓝、紫红、金橙", colors: ["#43DBFF", "#CD67F4", "#F5638A", "#FFC061"] },
    { value: 6, label: "深海 · 深蓝到亮青", colors: ["#176FFF", "#29B6FF", "#4DE8FF"] },
] as const;

export const DEFAULT_PIANO_SETTINGS = {
    particles: true,
    scoreMounted: false,
    /** 谱架与面板同时显示的曲谱 id；生成器可替换可用曲谱列表 */
    scoreId: DEFAULT_SCORE_ID,
    particleStyle: PIANO_PARTICLE_STYLES[0].value as number,
    particlePalette: 0,
    volume: 100,
    timbre: DEFAULT_PIANO_TIMBRE as number,
    soundLayer: "standard" as PianoSoundLayer,
    textVisible: true,
    titleColor: "#D4FFE8",
    statusColor: "#A6EBCF",
    textScale: 100,
    textRight: 0,
    textUp: 0,
    textForward: 0,
    textDistance: 12,
};

export type PianoSettings = Readonly<typeof DEFAULT_PIANO_SETTINGS>;

export const PIANO_SETTINGS_LIMITS = {
    volume: [0, 200],
    textScale: [25, 250],
    textRight: [-16, 16],
    textUp: [-16, 16],
    textForward: [-16, 16],
    textDistance: [2, 48],
} as const;

export function normalizePianoColor(value: unknown) {
    if (typeof value !== "string") return;
    const hex = value.trim().replace(/^#/, "");
    return /^[0-9a-f]{6}$/i.test(hex) ? `#${hex.toUpperCase()}` : undefined;
}

/** 音长存稳定字符串；兼容早期版本存的下标。 */
function normalizeSoundLayer(value: unknown): PianoSoundLayer | undefined {
    if (isSoundLayer(value)) return value;
    return typeof value === "number" ? soundLayerAt(value) : undefined;
}

export function pianoTextColor(hex: string) {
    const rgb = Number.parseInt(hex.slice(1), 16);
    return { red: (rgb >> 16) / 255, green: ((rgb >> 8) & 255) / 255, blue: (rgb & 255) / 255, alpha: 1 };
}

export function readPianoSettings(raw: unknown): PianoSettings {
    let value: unknown;
    if (typeof raw === "string") {
        try { value = JSON.parse(raw); }
        catch { value = undefined; }
    }
    const saved = value && typeof value === "object" ? value as Record<string, unknown> : {};
    return normalizePianoSettings({ ...saved, volume: saved.volume ?? saved.midiVolume });
}

export function normalizePianoSettings(saved: Record<string, unknown>,
    defaults: PianoSettings = DEFAULT_PIANO_SETTINGS): PianoSettings {
    const number = (key: keyof typeof PIANO_SETTINGS_LIMITS) => {
        const input = saved[key];
        if (typeof input !== "number" || !Number.isFinite(input)) return defaults[key];
        const [min, max] = PIANO_SETTINGS_LIMITS[key];
        return Math.min(max, Math.max(min, Math.round(input)));
    };
    return {
        particles: typeof saved.particles === "boolean" ? saved.particles : defaults.particles,
        scoreMounted: typeof saved.scoreMounted === "boolean" ? saved.scoreMounted : defaults.scoreMounted,
        scoreId: isValidScoreId(saved.scoreId) ? saved.scoreId : defaults.scoreId,
        particleStyle: PIANO_PARTICLE_STYLES.find(style => style.value === saved.particleStyle)?.value
            ?? defaults.particleStyle,
        particlePalette: PIANO_PARTICLE_PALETTES.find(palette => palette.value === saved.particlePalette)?.value
            ?? defaults.particlePalette,
        volume: number("volume"),
        timbre: AVAILABLE_PIANO_TIMBRES.find(timbre => timbre.value === saved.timbre)?.value
            ?? defaults.timbre,
        soundLayer: normalizeSoundLayer(saved.soundLayer) ?? defaults.soundLayer,
        textVisible: typeof saved.textVisible === "boolean" ? saved.textVisible : defaults.textVisible,
        titleColor: normalizePianoColor(saved.titleColor) ?? defaults.titleColor,
        statusColor: normalizePianoColor(saved.statusColor) ?? defaults.statusColor,
        textScale: number("textScale"),
        textRight: number("textRight"),
        textUp: number("textUp"),
        textForward: number("textForward"),
        textDistance: number("textDistance"),
    };
}
