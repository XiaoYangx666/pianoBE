import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createSecretScore, PERFORMANCE_PALETTES } from "@piano/core";
import { grandDefinition } from "../src/domain/instrument/definition";
import {
    KEY_PARTICLE_STYLE_EFFECTS,
    keyParticleOverrideFromCue,
    parseKeyParticleAlias,
    PIANO_PARTICLE_PALETTES,
    PIANO_PARTICLE_STYLES,
    resolveKeyParticle,
    validateKeyParticleOverride,
} from "../src/domain/piano/particleOverride";
import { SecretCinemaPlayer } from "../src/domain/piano/secretCinema";
import { VFX_STAGE_THEMES, VfxThemePlayer, type VfxStageThemeName } from "../src/domain/piano/vfxPainters";
import { validateVfxPreset, VFX_PRESETS, VfxPresetPlayer } from "../src/domain/piano/vfxPreset";

describe("弹奏粒子覆盖 resolveKeyParticle", () => {
    const baseSettings = { particleStyle: 3, particlePalette: 0 };
    const right = { x: 1, z: 0 };

    test("无覆盖时返回钢琴自身样式与调色板且 overridden 为 false", () => {
        const resolved = resolveKeyParticle(21, baseSettings, right);
        expect(resolved.overridden).toBe(false);
        expect(resolved.style).toBe("magic_trail");
        expect(resolved.mainParticle).toBe("pbe:magic_trail");
        expect(resolved.glimmer).toBe(true);
        expect(resolved.colors).toEqual(PIANO_PARTICLE_PALETTES[0].colors);
        expect(resolved.color.red).toBeCloseTo(0x64 / 255, 3);
        expect(resolved.color.green).toBeCloseTo(0xdb / 255, 3);
        expect(resolved.color.blue).toBeCloseTo(0xf2 / 255, 3);

        const high = resolveKeyParticle(108, { particleStyle: 5, particlePalette: 1 }, right);
        expect(high.style).toBe("sakura_drift");
        expect(high.mainParticle).toBe("pbe:sakura_drift");
        expect(high.color.red).toBeCloseTo(0xff / 255, 3);
        expect(high.color.green).toBeCloseTo(0xe0 / 255, 3);
        expect(high.color.blue).toBeCloseTo(0xa1 / 255, 3);
    });

    test("覆盖全部 7 种经典弹奏粒子样式并支持单色与多色音域渐变", () => {
        for (const [styleId, effectId] of Object.entries(KEY_PARTICLE_STYLE_EFFECTS)) {
            const resolved = resolveKeyParticle(64, baseSettings, right, {
                style: styleId as keyof typeof KEY_PARTICLE_STYLE_EFFECTS,
                colors: ["#000000", "#FFFFFF"],
                glimmer: true,
            });
            expect(resolved.overridden).toBe(true);
            expect(resolved.mainParticle).toBe(effectId);
            expect(resolved.color.red).toBeCloseTo(64 - 21 === 43 ? 43 / 87 : 0.5, 2);
        }

        const singleColor = resolveKeyParticle(80, baseSettings, right, {
            style: "blue_tears",
            colors: ["#FF8040"],
        });
        expect(singleColor.color.red).toBeCloseTo(1, 4);
        expect(singleColor.color.green).toBeCloseTo(0x80 / 255, 4);
        expect(singleColor.color.blue).toBeCloseTo(0x40 / 255, 4);
    });

    test("snow 样式映射到 pbe:vfx_draw_point 且仅传递粒子 JSON 声明的合法变量", () => {
        const doc = readFileSync(new URL("../rp/particles/pbe_vfx_draw_point.particle.json", import.meta.url), "utf8");
        const allowed = new Set([...doc.matchAll(/variable\.vfx_(\w+)/g)].map(match => match[1]));
        const resolved = resolveKeyParticle(72, baseSettings, { x: 0, z: -1 }, {
            style: "snow",
            colors: [PERFORMANCE_PALETTES.ice, PERFORMANCE_PALETTES.silver],
            intensity: 0.9,
            scale: 1.2,
        });
        expect(resolved.overridden).toBe(true);
        expect(resolved.mainParticle).toBe("pbe:vfx_draw_point");
        expect(resolved.drawPointVars).toBeDefined();
        const vars = resolved.drawPointVars!;
        expect(vars.brush).toBe(3);
        expect(vars.right_x).toBe(0);
        expect(vars.right_z).toBe(-1);
        expect(vars.scale).toBeCloseTo(1.2, 4);
        expect(Object.values(vars).every(Number.isFinite)).toBe(true);
        for (const key of Object.keys(vars)) {
            expect(allowed.has(key)).toBe(true);
        }
    });

    test("inherit 仅替换颜色而保留玩家自选样式；none 支持仅微光与完全静音", () => {
        const inheritCustomColor = resolveKeyParticle(60, { particleStyle: 6, particlePalette: 0 }, right, {
            style: "inherit",
            colors: ["#FF0000", "#00FF00"],
        });
        expect(inheritCustomColor.overridden).toBe(true);
        expect(inheritCustomColor.style).toBe("stardust");
        expect(inheritCustomColor.mainParticle).toBe(PIANO_PARTICLE_STYLES.find(s => s.value === 6)?.effect);

        const glimmerOnly = resolveKeyParticle(60, baseSettings, right, {
            style: "none",
            colors: ["#68E4FF"],
            glimmer: true,
        });
        expect(glimmerOnly.mainParticle).toBeUndefined();
        expect(glimmerOnly.glimmer).toBe(true);
        expect(glimmerOnly.overridden).toBe(true);

        const silent = resolveKeyParticle(60, baseSettings, right, {
            style: "none",
            glimmer: false,
        });
        expect(silent.mainParticle).toBeUndefined();
        expect(silent.glimmer).toBe(false);
        expect(silent.overridden).toBe(true);
    });
});

describe("别名、校验与各舞台播放器覆盖接入", () => {
    test("parseKeyParticleAlias 与 keyParticleOverrideFromCue 正确映射全部别名", () => {
        expect(parseKeyParticleAlias("snow")).toEqual({ brush: "snow" });
        expect(parseKeyParticleAlias("SAKURA_DRIFT")).toEqual({ brush: "petal" });
        expect(parseKeyParticleAlias("glimmer")).toEqual({ motion: "gentle" });
        expect(parseKeyParticleAlias("off")).toEqual({ motion: "reverse" });
        expect(parseKeyParticleAlias("nonexistent")).toBeUndefined();

        expect(keyParticleOverrideFromCue({
            color: "#68E4FF", intensity: 0, scale: 1, brush: "star",
        })).toBeUndefined();
        expect(keyParticleOverrideFromCue({
            color: "#68E4FF", color2: "#FFE29A", intensity: 0.85, scale: 1.1, brush: "petal",
        })).toEqual({
            style: "sakura_drift",
            colors: ["#68E4FF", "#FFE29A"],
            glimmer: true,
            intensity: 0.85,
            scale: 1.1,
        });
    });

    test("validateKeyParticleOverride 与 validateVfxPreset 校验并拒绝非法参数", () => {
        const preset = validateVfxPreset({
            keyParticle: { style: "snow", colors: ["ice", "#FFB7D5"], glimmer: false, intensity: 0.8, scale: 1.1 },
            layers: [{ effect: "field" }],
        });
        expect(preset.keyParticle).toEqual({
            style: "snow",
            colors: ["#68E4FF", "#FFB7D5"],
            glimmer: false,
            intensity: 0.8,
            scale: 1.1,
        });

        for (const bad of [
            null,
            [],
            { style: "unknown_style" },
            { colors: [] },
            { colors: ["#111111", "#222222", "#333333", "#444444", "#555555", "#666666", "#777777"] },
            { colors: ["not_a_color"] },
            { glimmer: "yes" },
            { intensity: 1.5 },
            { scale: 0.2 },
            { extraField: 1 },
        ]) {
            expect(() => validateKeyParticleOverride(bad)).toThrow();
        }
    });

    test("VfxThemePlayer / VfxPresetPlayer / SecretCinemaPlayer 都提供舞台联动弹奏粒子覆盖", () => {
        for (const name of Object.keys(VFX_STAGE_THEMES) as VfxStageThemeName[]) {
            const player = new VfxThemePlayer(VFX_STAGE_THEMES[name], grandDefinition);
            expect(player.keyParticleOverride()?.style).toBe(VFX_STAGE_THEMES[name].keyParticle?.style);
        }
        for (const key of ["galaxy", "neon", "stage"] as const) {
            const player = new VfxPresetPlayer(validateVfxPreset(VFX_PRESETS[key]));
            expect(player.keyParticleOverride()?.style).toBe(VFX_PRESETS[key].keyParticle?.style);
        }

        const score = createSecretScore([
            { time: 1, midi: 60, velocity: 0.8, duration: 0.8, keyDuration: 0.5 },
            { time: 1.2, midi: 67, velocity: 0.9, duration: 0.8, keyDuration: 0.5 },
        ], 4);
        const cinema = new SecretCinemaPlayer(score, grandDefinition, 0, true);
        expect(cinema.keyParticleOverride(-1)).toBeUndefined();
        expect(cinema.keyParticleOverride(1.1)?.style).toBe("stardust");
        expect(cinema.keyParticleOverride(4)).toBeUndefined();
    });
});
