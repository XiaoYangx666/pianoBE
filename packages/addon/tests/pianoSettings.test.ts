import { describe, expect, test } from "bun:test";
import { PIANO_TIMBRES } from "@piano/core";
import { AVAILABLE_PIANO_TIMBRES, availablePianoTimbres, DEFAULT_PIANO_SETTINGS, normalizePianoSettings, readPianoSettings } from "../src/domain/piano/settings";
import { FOLLOW_PIANO_LAYER, resolveSoundLayer, soundTypes } from "../src/domain/piano/soundTypes";

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
});

describe("piano sound layer settings", () => {
    test("默认音长是标准音", () => {
        expect(soundTypes[DEFAULT_PIANO_SETTINGS.soundLayer].layer).toBe("standard");
    });

    test("合法层编号保留，非法值回退默认", () => {
        expect(normalizePianoSettings({ soundLayer: 0 }).soundLayer).toBe(0);
        expect(normalizePianoSettings({ soundLayer: 2 }).soundLayer).toBe(2);
        expect(normalizePianoSettings({ soundLayer: 9 }).soundLayer).toBe(DEFAULT_PIANO_SETTINGS.soundLayer);
        expect(normalizePianoSettings({ soundLayer: "1" }).soundLayer).toBe(DEFAULT_PIANO_SETTINGS.soundLayer);
    });

    test("旧版设置没有 soundLayer 时平滑迁移", () => {
        expect(readPianoSettings(JSON.stringify({ volume: 80 })).soundLayer)
            .toBe(DEFAULT_PIANO_SETTINGS.soundLayer);
    });

    test("玩家覆盖优先，跟随钢琴时用钢琴设置", () => {
        expect(resolveSoundLayer(2, 0)).toBe("short");
        expect(resolveSoundLayer(FOLLOW_PIANO_LAYER, 0)).toBe("long");
        expect(resolveSoundLayer(FOLLOW_PIANO_LAYER, 1)).toBe("standard");
        expect(resolveSoundLayer(FOLLOW_PIANO_LAYER, 99)).toBe("standard");
    });
});
