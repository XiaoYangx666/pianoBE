import { describe, expect, test } from "bun:test";
import { PIANO_TIMBRES } from "@piano/core";
import { AVAILABLE_PIANO_TIMBRES, availablePianoTimbres, DEFAULT_PIANO_SETTINGS, normalizePianoSettings, PIANO_PARTICLE_STYLES, PIANO_SETTINGS_LIMITS, PIANO_STAGE_THEMES, readPianoSettings, stageThemeAt, stageThemeIndexOf } from "../src/domain/piano/settings";
import { AVAILABLE_SCORES, DEFAULT_SCORE_ID } from "../src/domain/score/score";
import { DEFAULT_MANUAL_VELOCITY, FOLLOW_PIANO_VELOCITY, manualVelocityAt, manualVelocityIndexOf, manualVelocityPresets, resolveManualVelocity } from "../src/domain/piano/soundTypes";

test("old pianos start with the score off and the former peach selection becomes sakura", () => {
    const old = readPianoSettings('{"particleStyle":5}');
    expect(old.scoreMounted).toBe(false);
    expect(PIANO_PARTICLE_STYLES.find(style => style.value === old.particleStyle)?.style).toBe("sakura_drift");
    expect(readPianoSettings(JSON.stringify({ ...old, scoreMounted: true })).scoreMounted).toBe(true);
});

test("removed pulse ring value falls back without renumbering other styles", () => {
    const migrated = readPianoSettings('{"particleStyle":2}');
    expect(migrated.particleStyle).toBe(DEFAULT_PIANO_SETTINGS.particleStyle);
    expect(PIANO_PARTICLE_STYLES.map(style => style.value)).toEqual([3, 4, 0, 5, 6, 7]);
    expect(PIANO_PARTICLE_STYLES.find(style => style.value === 5)?.style).toBe("sakura_drift");
    expect(PIANO_PARTICLE_STYLES.find(style => style.value === 7)?.style).toBe("prism_shards");
});

test("retired and style-incompatible palettes fall back safely", () => {
    expect(readPianoSettings('{"particleStyle":3,"particlePalette":2}').particlePalette).toBe(0);
    expect(readPianoSettings('{"particleStyle":3,"particlePalette":5}').particlePalette).toBe(0);
    expect(readPianoSettings('{"particleStyle":4,"particlePalette":4}').particlePalette).toBe(0);
    expect(readPianoSettings('{"particleStyle":4,"particlePalette":1}').particlePalette).toBe(1);
    expect(readPianoSettings('{"particleStyle":5,"particlePalette":4}').particlePalette).toBe(0);
});

test("score selection keeps a published score and ignores unknown ids", () => {
    expect(readPianoSettings("{}").scoreId).toBe(DEFAULT_SCORE_ID);
    expect(readPianoSettings('{"scoreId":"missing"}').scoreId).toBe(DEFAULT_SCORE_ID);
    const first = AVAILABLE_SCORES[0];
    if (first) {
        expect(readPianoSettings(JSON.stringify({ scoreId: first.id })).scoreId).toBe(first.id);
    }
});

describe("piano timbre settings", () => {
    test("默认音色为标准钢琴", () => {
        expect(DEFAULT_PIANO_SETTINGS.timbre).toBe(PIANO_TIMBRES[0].value);
    });

    test("开发构建默认启用全部音色", () => {
        expect(AVAILABLE_PIANO_TIMBRES.map((t) => t.id)).toEqual(
            PIANO_TIMBRES.map((t) => t.id)
        );
    });

    test("生成器裁剪后只显示实际启用的音色，且至少保留默认音色", () => {
        expect(availablePianoTimbres(["piano"]).map((t) => t.id)).toEqual(["piano"]);
        expect(availablePianoTimbres(["piano", "classic_grand"]).map((t) => t.id)).toEqual([
            "piano",
            "classic_grand",
        ]);
        expect(availablePianoTimbres([]).map((t) => t.id)).toEqual(["piano"]);
    });

    test("已知音色编号会保留", () => {
        for (const timbre of PIANO_TIMBRES) {
            expect(normalizePianoSettings({ timbre: timbre.value }).timbre).toBe(timbre.value);
        }
    });

    test("未知音色编号回退到默认值", () => {
        expect(normalizePianoSettings({ timbre: 999 }).timbre).toBe(DEFAULT_PIANO_SETTINGS.timbre);
        expect(normalizePianoSettings({ timbre: "classic_grand" }).timbre).toBe(DEFAULT_PIANO_SETTINGS.timbre);
    });

    test("旧版设置没有 timbre 时平滑迁移", () => {
        const migrated = readPianoSettings(JSON.stringify({ volume: 80, particles: false }));
        expect(migrated.timbre).toBe(DEFAULT_PIANO_SETTINGS.timbre);
        expect(migrated.volume).toBe(80);
    });

    test("音量上限为 200%，100% 对应 playSound 的 1.0", () => {
        expect(PIANO_SETTINGS_LIMITS.volume).toEqual([0, 200]);
        expect(readPianoSettings(JSON.stringify({ volume: 150 })).volume).toBe(150);
        expect(readPianoSettings(JSON.stringify({ volume: 200 })).volume).toBe(200);
        expect(readPianoSettings(JSON.stringify({ volume: 250 })).volume).toBe(200);
        expect(readPianoSettings(JSON.stringify({ volume: 37 })).volume).toBe(37);
    });

    test("响度归一化默认关闭，布尔值可持久化", () => {
        expect(DEFAULT_PIANO_SETTINGS.normalizeLoudness).toBe(false);
        expect(readPianoSettings(JSON.stringify({ normalizeLoudness: true })).normalizeLoudness).toBe(true);
        expect(readPianoSettings(JSON.stringify({ normalizeLoudness: false })).normalizeLoudness).toBe(false);
        expect(normalizePianoSettings({ normalizeLoudness: "yes" }).normalizeLoudness).toBe(false);
    });
});

describe("piano sound mode settings", () => {
    test("默认使用立体声（关闭 3D 定位）", () => {
        expect(DEFAULT_PIANO_SETTINGS.soundMode).toBe("stereo");
    });

    test("旧存档缺少 soundMode 时回退到立体声", () => {
        expect(readPianoSettings(JSON.stringify({ volume: 80 })).soundMode).toBe("stereo");
    });

    test("合法的 soundMode 原样保留，非法值回退默认", () => {
        expect(normalizePianoSettings({ soundMode: "3d" }).soundMode).toBe("3d");
        expect(normalizePianoSettings({ soundMode: "stereo" }).soundMode).toBe("stereo");
        expect(normalizePianoSettings({ soundMode: "mono" }).soundMode).toBe(DEFAULT_PIANO_SETTINGS.soundMode);
        expect(normalizePianoSettings({ soundMode: true }).soundMode).toBe(DEFAULT_PIANO_SETTINGS.soundMode);
    });
});

describe("piano manual velocity settings", () => {
    test("默认手动力度是标准力度", () => {
        expect(DEFAULT_PIANO_SETTINGS.manualVelocity).toBe(DEFAULT_MANUAL_VELOCITY);
    });

    test("合法力度原样保留", () => {
        for (const { velocity } of manualVelocityPresets) {
            expect(normalizePianoSettings({ manualVelocity: velocity }).manualVelocity).toBe(velocity);
        }
    });

    test("旧版音长档位迁移成力度", () => {
        expect(normalizePianoSettings({ soundLayer: "short" }).manualVelocity).toBe(64);
        expect(normalizePianoSettings({ soundLayer: "standard" }).manualVelocity).toBe(96);
        expect(normalizePianoSettings({ soundLayer: "long" }).manualVelocity).toBe(116);
    });

    test("非法力度回退默认值", () => {
        expect(normalizePianoSettings({ manualVelocity: -3 }).manualVelocity).toBe(DEFAULT_MANUAL_VELOCITY);
        expect(normalizePianoSettings({ manualVelocity: 300 }).manualVelocity).toBe(DEFAULT_MANUAL_VELOCITY);
        expect(normalizePianoSettings({ manualVelocity: null }).manualVelocity).toBe(DEFAULT_MANUAL_VELOCITY);
        expect(normalizePianoSettings({ soundLayer: "bass" }).manualVelocity).toBe(DEFAULT_MANUAL_VELOCITY);
        expect(normalizePianoSettings({ soundLayer: 9 }).manualVelocity).toBe(DEFAULT_MANUAL_VELOCITY);
    });

    test("旧版设置没有力度字段时平滑迁移", () => {
        expect(readPianoSettings(JSON.stringify({ volume: 80 })).manualVelocity)
            .toBe(DEFAULT_MANUAL_VELOCITY);
    });

    test("力度下标与设置值可以互转", () => {
        for (const [index, { velocity }] of manualVelocityPresets.entries()) {
            expect(manualVelocityAt(index)).toBe(velocity);
            expect(manualVelocityIndexOf(velocity)).toBe(index);
        }
    });

    test("玩家覆盖优先，跟随钢琴时用钢琴设置", () => {
        expect(resolveManualVelocity(2, 116)).toBe(manualVelocityPresets[2].velocity);
        expect(resolveManualVelocity(FOLLOW_PIANO_VELOCITY, 116)).toBe(116);
        expect(resolveManualVelocity(FOLLOW_PIANO_VELOCITY, 96)).toBe(96);
        expect(resolveManualVelocity(99, 64)).toBe(64);
    });
});

describe("piano stage choreography and theme settings", () => {
    test("默认开启曲目自带舞台编排与舞台弹奏粒子替换，默认舞台主题为关闭，旧存档平滑迁移", () => {
        expect(DEFAULT_PIANO_SETTINGS.stageChoreography).toBe(true);
        expect(DEFAULT_PIANO_SETTINGS.stageKeyParticles).toBe(true);
        expect(DEFAULT_PIANO_SETTINGS.stageTheme).toBe("off");
        const migrated = readPianoSettings(JSON.stringify({ particles: false }));
        expect(migrated.stageChoreography).toBe(true);
        expect(migrated.stageKeyParticles).toBe(true);
        expect(migrated.stageTheme).toBe("off");
    });

    test("合法舞台字段持久化，非法值回退默认", () => {
        for (const theme of PIANO_STAGE_THEMES) {
            expect(normalizePianoSettings({ stageTheme: theme.id }).stageTheme).toBe(theme.id);
            expect(stageThemeAt(stageThemeIndexOf(theme.id))).toBe(theme.id);
        }
        expect(normalizePianoSettings({ stageChoreography: false }).stageChoreography).toBe(false);
        expect(normalizePianoSettings({ stageChoreography: "no" }).stageChoreography).toBe(true);
        expect(normalizePianoSettings({ stageKeyParticles: false }).stageKeyParticles).toBe(false);
        expect(normalizePianoSettings({ stageKeyParticles: 123 }).stageKeyParticles).toBe(true);
        expect(normalizePianoSettings({ stageTheme: "invalid" }).stageTheme).toBe("off");
        expect(normalizePianoSettings({ stageTheme: 3 }).stageTheme).toBe("off");
    });
});
