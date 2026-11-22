import { DEFAULT_PIANO_TIMBRE, PIANO_TIMBRES } from "@piano/core";
import { DEFAULT_SCORE_ID, isValidScoreId } from "@domain/score/score";
import { ENABLED_PIANO_TIMBRES } from "./timbres";
import { DEFAULT_MANUAL_VELOCITY, isManualVelocity } from "./soundTypes";
import {
    DEFAULT_KEY_PARTICLE_SETTINGS,
    listPianoParticleStyles,
    listVfxThemes,
    normalizeKeyParticlePalette,
    PIANO_PARTICLE_PALETTES,
} from "@piano/vfx";

export { PIANO_PARTICLE_PALETTES, listPianoParticleStyles };

/** 按启用列表过滤音色；空列表回退到默认音色，保证设置里至少有一个选项。 */
export function availablePianoTimbres(enabled: readonly string[]) {
    const set = new Set(enabled);
    const available = PIANO_TIMBRES.filter((timbre) => set.has(timbre.id));
    return available.length ? available : [PIANO_TIMBRES[0]];
}

/** 当前包内可选的音色（生成器可能裁剪掉部分音色） */
export const AVAILABLE_PIANO_TIMBRES = availablePianoTimbres(ENABLED_PIANO_TIMBRES);

export type PianoStageThemeId = string;

export interface PianoStageThemeOption {
    value: number;
    id: PianoStageThemeId;
    label: string;
}

export function listPianoStageThemes(): PianoStageThemeOption[] {
    return [
        { value: 0, id: "off", label: "关闭（仅曲目自带编排）" },
        ...listVfxThemes().map(({ id, theme }, index) => ({
            value: index + 1,
            id,
            label: theme.label ?? id,
        })),
    ];
}

export function stageThemeIndexOf(id: PianoStageThemeId): number {
    return listPianoStageThemes().find(theme => theme.id === id)?.value ?? 0;
}

export function stageThemeAt(value: number): PianoStageThemeId | undefined {
    return listPianoStageThemes().find(theme => theme.value === value)?.id;
}

export type PianoSoundMode = "stereo" | "3d";

export const DEFAULT_PIANO_SETTINGS = {
    particles: true,
    stageChoreography: true,
    stageKeyParticles: true,
    stageTheme: "off" as PianoStageThemeId,
    scoreMounted: false,
    /** 谱架与面板同时显示的曲谱 id；生成器可替换可用曲谱列表 */
    scoreId: DEFAULT_SCORE_ID,
    particleStyle: DEFAULT_KEY_PARTICLE_SETTINGS.particleStyle as number,
    particlePalette: DEFAULT_KEY_PARTICLE_SETTINGS.particlePalette as number,
    volume: 100,
    timbre: DEFAULT_PIANO_TIMBRE as number,
    /** 开：按曲目自动拉平响度；关：保持原始 MIDI 动态（默认关）。 */
    normalizeLoudness: false,
    midiPerformance: true,
    /** 手动敲键力度（1~127）；谱面播放使用 MIDI 自带力度。 */
    manualVelocity: DEFAULT_MANUAL_VELOCITY as number,
    /** stereo = 立体声（无 3D 定位）；3d = 有距离衰减/定位（单声道） */
    soundMode: "stereo" as PianoSoundMode,
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
    // 100% 对应 playSound 的 volume 1.0（满响度）；200% 对应 2.0，可听距离也拉到上限。
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

/** 手动力度：优先读新字段，旧存档的 soundLayer 按 短/标准/长 迁移到 轻/标准/强。 */
function normalizeManualVelocity(saved: Record<string, unknown>, fallback: number): number {
    const value = saved.manualVelocity;
    if (isManualVelocity(value)) return value;
    const legacy = saved.soundLayer;
    if (legacy === "short") return 64;
    if (legacy === "standard") return 96;
    if (legacy === "long") return 116;
    return fallback;
}

/** 声音模式只接受两个稳定字符串；旧存档缺字段时回退到默认立体声。 */
function normalizeSoundMode(value: unknown): PianoSoundMode | undefined {
    return value === "stereo" || value === "3d" ? value : undefined;
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
    const particleStyles = listPianoParticleStyles();
    const particleStyle = particleStyles.find(style => style.value === saved.particleStyle)?.value
        ?? (particleStyles.some(style => style.value === defaults.particleStyle)
            ? defaults.particleStyle
            : (particleStyles[0]?.value ?? defaults.particleStyle));
    const savedPalette = typeof saved.particlePalette === "number" && Number.isFinite(saved.particlePalette)
        ? saved.particlePalette
        : defaults.particlePalette;
    const stageThemes = listPianoStageThemes();
    const stageTheme = stageThemes.find(theme => theme.id === saved.stageTheme)?.id
        ?? (stageThemes.some(theme => theme.id === defaults.stageTheme) ? defaults.stageTheme : "off");
    return {
        particles: typeof saved.particles === "boolean" ? saved.particles : defaults.particles,
        stageChoreography: typeof saved.stageChoreography === "boolean"
            ? saved.stageChoreography
            : defaults.stageChoreography,
        stageKeyParticles: typeof saved.stageKeyParticles === "boolean"
            ? saved.stageKeyParticles
            : defaults.stageKeyParticles,
        stageTheme,
        scoreMounted: typeof saved.scoreMounted === "boolean" ? saved.scoreMounted : defaults.scoreMounted,
        scoreId: isValidScoreId(saved.scoreId) ? saved.scoreId : defaults.scoreId,
        particleStyle,
        particlePalette: normalizeKeyParticlePalette(particleStyle, savedPalette),
        volume: number("volume"),
        timbre: AVAILABLE_PIANO_TIMBRES.find(timbre => timbre.value === saved.timbre)?.value
            ?? defaults.timbre,
        normalizeLoudness: typeof saved.normalizeLoudness === "boolean"
            ? saved.normalizeLoudness
            : defaults.normalizeLoudness,
        midiPerformance: typeof saved.midiPerformance === "boolean" ? saved.midiPerformance : defaults.midiPerformance,
        manualVelocity: normalizeManualVelocity(saved, defaults.manualVelocity),
        soundMode: normalizeSoundMode(saved.soundMode) ?? defaults.soundMode,
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
