import { describe, expect, test } from "bun:test";
import { PIANO_TIMBRES } from "@piano/core";
import { AVAILABLE_PIANO_TIMBRES, availablePianoTimbres, DEFAULT_PIANO_SETTINGS, normalizePianoSettings, PIANO_PARTICLE_STYLES, PIANO_SETTINGS_LIMITS, readPianoSettings } from "../src/domain/piano/settings";
import { AVAILABLE_SCORES, DEFAULT_SCORE_ID } from "../src/domain/score/score";
import { FOLLOW_PIANO_LAYER, resolveSoundLayer, soundLayerAt, soundLayerIndexOf, soundTypes } from "../src/domain/piano/soundTypes";

test("old pianos start with the score off and the former peach selection becomes sakura", () => {
    const old = readPianoSettings('{"particleStyle":5}');
    expect(old.scoreMounted).toBe(false);
    expect(PIANO_PARTICLE_STYLES.find(style => style.value === old.particleStyle)?.effect).toBe("xypiano:sakura_drift");
    expect(readPianoSettings(JSON.stringify({ ...old, scoreMounted: true })).scoreMounted).toBe(true);
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
    test("默认音色为经典 P-88", () => {
        expect(DEFAULT_PIANO_SETTINGS.timbre).toBe(PIANO_TIMBRES[0].value);
    });

    test("开发构建默认启用全部音色", () => {
        expect(AVAILABLE_PIANO_TIMBRES.map((t) => t.id)).toEqual(
            PIANO_TIMBRES.map((t) => t.id)
        );
    });

    test("生成器裁剪后只显示实际启用的音色，且至少保留默认音色", () => {
        expect(availablePianoTimbres(["piano"]).map((t) => t.id)).toEqual(["piano"]);
        expect(availablePianoTimbres(["piano", "meta_piano"]).map((t) => t.id)).toEqual([
            "piano",
            "meta_piano",
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
        expect(normalizePianoSettings({ timbre: "meta_piano" }).timbre).toBe(DEFAULT_PIANO_SETTINGS.timbre);
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

describe("piano sound layer settings", () => {
    test("默认音长是标准音", () => {
        expect(DEFAULT_PIANO_SETTINGS.soundLayer).toBe("standard");
    });

    test("合法音长字符串原样保留", () => {
        for (const { layer } of soundTypes) {
            expect(normalizePianoSettings({ soundLayer: layer }).soundLayer).toBe(layer);
        }
    });

    test("旧版存的下标迁移成音长字符串", () => {
        expect(normalizePianoSettings({ soundLayer: 0 }).soundLayer).toBe("long");
        expect(normalizePianoSettings({ soundLayer: 2 }).soundLayer).toBe("short");
    });

    test("非法音长回退默认值", () => {
        expect(normalizePianoSettings({ soundLayer: "bass" }).soundLayer).toBe(DEFAULT_PIANO_SETTINGS.soundLayer);
        expect(normalizePianoSettings({ soundLayer: 9 }).soundLayer).toBe(DEFAULT_PIANO_SETTINGS.soundLayer);
        expect(normalizePianoSettings({ soundLayer: null }).soundLayer).toBe(DEFAULT_PIANO_SETTINGS.soundLayer);
    });

    test("旧版设置没有 soundLayer 时平滑迁移", () => {
        expect(readPianoSettings(JSON.stringify({ volume: 80 })).soundLayer)
            .toBe(DEFAULT_PIANO_SETTINGS.soundLayer);
    });

    test("音长下标与设置值可以互转", () => {
        for (const [index, { layer }] of soundTypes.entries()) {
            expect(soundLayerAt(index)).toBe(layer);
            expect(soundLayerIndexOf(layer)).toBe(index);
        }
    });

    test("玩家覆盖优先，跟随钢琴时用钢琴设置", () => {
        expect(resolveSoundLayer(2, "long")).toBe("short");
        expect(resolveSoundLayer(FOLLOW_PIANO_LAYER, "long")).toBe("long");
        expect(resolveSoundLayer(FOLLOW_PIANO_LAYER, "standard")).toBe("standard");
        expect(resolveSoundLayer(99, "short")).toBe("short");
    });
});
