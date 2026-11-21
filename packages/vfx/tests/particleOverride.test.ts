import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PERFORMANCE_PALETTES } from "@piano/core";
import {
    createPerformanceProgram,
    createThemeProgram,
    keyParticleColorOptions,
    keyParticleColorMode,
    keyParticleOverrideFromParams,
    KEY_PARTICLE_STYLES,
    normalizeKeyParticlePalette,
    PIANO_PARTICLE_PALETTES,
    PIANO_PARTICLE_STYLES,
    POINT_BRUSH_INDEX,
    resolveKeyParticle,
    validateKeyParticleOverride,
    validateVfxTheme,
    VFX_THEME_ORDER,
    VFX_THEMES,
    VfxEngine,
} from "../src";

describe("弹奏粒子覆盖 resolveKeyParticle", () => {
    const baseSettings = { particleStyle: 3, particlePalette: 0 };
    const right = { x: 1, z: 0 };

    test("无覆盖时返回钢琴自身样式与调色板且 overridden 为 false", () => {
        const resolved = resolveKeyParticle(21, baseSettings, right);
        expect(resolved.overridden).toBe(false);
        expect(resolved.style).toBe("magic_trail");
        expect(resolved.emitters[0].particle).toBe("magic_trail");
        expect(resolved.emitters[0].variables.brush).toBe(POINT_BRUSH_INDEX.spark);
        expect(resolved.glimmer).toBe(true);
        expect(resolved.colors).toEqual(PIANO_PARTICLE_PALETTES[0].colors);
        expect(resolved.color.red).toBeCloseTo(0x64 / 255, 3);
        expect(resolved.color.green).toBeCloseTo(0xdb / 255, 3);
        expect(resolved.color.blue).toBeCloseTo(0xf2 / 255, 3);

        const high = resolveKeyParticle(108, { particleStyle: 5, particlePalette: 1 }, right);
        expect(high.style).toBe("sakura_drift");
        expect(high.emitters[0].particle).toBe("key_drift");
        expect(high.emitters[0].variables.brush).toBe(POINT_BRUSH_INDEX.petal);
        expect(keyParticleColorOptions("sakura_drift")).toBeUndefined();
        expect(high.colors).not.toEqual(PIANO_PARTICLE_PALETTES[1].colors);
        expect(high.color.red).toBeCloseTo(1, 3);
    });

    test("六种玩家样式按渲染原语拆分，并保留显式多色音域渐变", () => {
        const particles = { point: "draw_point", stream: "key_stream", drift: "key_drift" } as const;
        for (const option of PIANO_PARTICLE_STYLES) {
            const definition = KEY_PARTICLE_STYLES[option.style];
            if (!("render" in definition)) throw new Error(`${option.style} 应为渲染样式`);
            const resolved = resolveKeyParticle(64, baseSettings, right, {
                style: option.style,
                colors: ["#000000", "#FFFFFF"],
                glimmer: true,
            });
            expect(resolved.overridden).toBe(true);
            expect(resolved.style).toBe(option.style);
            expect(resolved.emitters[0].particle).toBe(definition.particle ?? particles[definition.render]);
            expect(resolved.emitters[0].variables.brush).toBe(POINT_BRUSH_INDEX[definition.brush]);
            expect(resolved.color.red).toBeCloseTo(43 / 87, 2);
        }

        const singleColor = resolveKeyParticle(80, baseSettings, right, {
            style: "blue_tears",
            colors: ["#FF8040"],
        });
        expect(singleColor.color.red).toBeCloseTo(1, 4);
        expect(singleColor.color.green).toBeCloseTo(0x80 / 255, 4);
        expect(singleColor.color.blue).toBeCloseTo(0x40 / 255, 4);
    });

    test("弹奏粒子只使用已声明的变量，并允许非等比尺寸", () => {
        const runtimeSupplied = new Set(["stage_depth"]);
        for (const option of PIANO_PARTICLE_STYLES) {
            const resolved = resolveKeyParticle(72, baseSettings, { x: 0, z: -1 }, {
                style: option.style,
                colors: [PERFORMANCE_PALETTES.ice, PERFORMANCE_PALETTES.silver],
                intensity: 0.9,
                scale: 1.2,
            });
            expect(resolved.emitters).toHaveLength(2);
            for (const emitter of resolved.emitters) {
                expect(Object.values(emitter.variables).every(Number.isFinite)).toBe(true);
                if (emitter.onKey) continue;
                const doc = readFileSync(
                    new URL(`../assets/particles/pbe_vfx_${emitter.particle}.particle.json`, import.meta.url),
                    "utf8",
                );
                const used = new Set([...doc.matchAll(/variable\.vfx_(\w+)/g)].map(match => match[1]));
                for (const name of used) {
                    if (!runtimeSupplied.has(name)) expect(emitter.variables).toHaveProperty(name);
                }
            }
            expect(resolved.emitters[0].variables.scale).toBeCloseTo(1.2, 4);
            expect(resolved.emitters[0].variables.right_x).toBe(0);
            expect(resolved.emitters[0].variables.right_z).toBe(-1);
            expect(resolved.emitters[1].onKey).toBe(true);
        }
    });

    test("颜色能力由样式声明：自由、限定与固定互不串用", () => {
        expect(keyParticleColorMode("magic_trail")).toBe("free");
        expect(keyParticleColorOptions("magic_trail")).toEqual(PIANO_PARTICLE_PALETTES);
        expect(PIANO_PARTICLE_PALETTES.map(palette => palette.value)).toEqual([0, 1, 3, 4]);

        expect(keyParticleColorMode("blue_tears")).toBe("limited");
        const tears = keyParticleColorOptions("blue_tears")!;
        expect(tears.length).toBeGreaterThan(1);
        expect(tears.every(palette => palette.colors.every(hex => /^#[0-9A-F]{6}$/i.test(hex)))).toBe(true);
        expect(tears).not.toEqual(PIANO_PARTICLE_PALETTES);

        expect(keyParticleColorMode("sakura_drift")).toBe("fixed");
        expect(keyParticleColorOptions("sakura_drift")).toBeUndefined();
        expect(keyParticleColorMode("snow")).toBe("fixed");

        expect(normalizeKeyParticlePalette(0, 5)).toBe(0);
        expect(normalizeKeyParticlePalette(4, 6)).toBe(tears[0].value);
        expect(normalizeKeyParticlePalette(5, 4)).toBe(0);

        const fixedLow = resolveKeyParticle(40, { particleStyle: 5, particlePalette: 0 }, right);
        const fixedHigh = resolveKeyParticle(40, { particleStyle: 5, particlePalette: 4 }, right);
        expect(fixedLow.colors).toEqual(fixedHigh.colors);

        const limited = resolveKeyParticle(40, { particleStyle: 4, particlePalette: tears[1].value }, right);
        expect(limited.colors).toEqual(tears[1].colors);

        const recolor = resolveKeyParticle(40, { particleStyle: 5, particlePalette: 0 }, right, {
            colors: ["#123456"], glimmer: false,
        });
        expect(recolor.colors).toEqual(["#123456"]);
    });

    test("电光涟漪已移除，旧存档数值安全回退", () => {
        expect("pulse_ring" in KEY_PARTICLE_STYLES).toBe(false);
        expect(PIANO_PARTICLE_STYLES.some(style => style.value === 2)).toBe(false);
        const resolved = resolveKeyParticle(60, { particleStyle: 2, particlePalette: 0 }, right);
        expect(resolved.style).toBe(PIANO_PARTICLE_STYLES[0].style);
    });

    test("inherit 仅替换颜色而保留玩家自选样式；none 支持仅微光与完全静音", () => {
        const inheritCustomColor = resolveKeyParticle(60, { particleStyle: 6, particlePalette: 0 }, right, {
            style: "inherit",
            colors: ["#FF0000", "#00FF00"],
        });
        expect(inheritCustomColor.overridden).toBe(true);
        expect(inheritCustomColor.style).toBe("stardust");
        expect(inheritCustomColor.emitters[0].particle).toBe("draw_point");

        const glimmerOnly = resolveKeyParticle(60, baseSettings, right, {
            style: "none",
            colors: ["#68E4FF"],
            glimmer: true,
        });
        expect(glimmerOnly.style).toBe("none");
        expect(glimmerOnly.emitters).toHaveLength(1);
        expect(glimmerOnly.emitters[0].onKey).toBe(true);
        expect(glimmerOnly.glimmer).toBe(true);
        expect(glimmerOnly.overridden).toBe(true);

        const silent = resolveKeyParticle(60, baseSettings, right, {
            style: "none",
            glimmer: false,
        });
        expect(silent.emitters).toHaveLength(0);
        expect(silent.glimmer).toBe(false);
        expect(silent.overridden).toBe(true);
    });
});

describe("显式 variant 语义、校验与统一引擎的弹奏粒子覆盖接入", () => {
    test("keyParticleOverrideFromParams 直接解析显式 variant，不复用 brush 或 motion", () => {
        expect(keyParticleOverrideFromParams({
            color: "#68E4FF", color2: "#68E4FF", intensity: 0, scale: 1,
            brush: "star", variant: "stardust", zone: "stage", motion: "normal",
        })).toBeUndefined();

        expect(keyParticleOverrideFromParams({
            color: "#68E4FF", color2: "#FFE29A", intensity: 0.85, scale: 1.1,
            brush: "star", variant: "sakura_drift", zone: "stage", motion: "reverse",
        })).toEqual({
            style: "sakura_drift",
            colors: ["#68E4FF", "#FFE29A"],
            glimmer: true,
            intensity: 0.85,
            scale: 1.1,
        });

        expect(keyParticleOverrideFromParams({
            color: "#68E4FF", color2: "#68E4FF", intensity: 0.8, scale: 1,
            variant: "glimmer", zone: "stage", motion: "normal",
        })).toEqual({
            style: "glimmer",
            colors: ["#68E4FF"],
            glimmer: true,
            intensity: 0.8,
            scale: 1,
        });

        expect(keyParticleOverrideFromParams({
            color: "#68E4FF", color2: "#68E4FF", intensity: 0.8, scale: 1,
            variant: "none", zone: "stage", motion: "normal",
        })).toEqual({
            style: "none",
            colors: ["#68E4FF"],
            glimmer: false,
            intensity: 0.8,
            scale: 1,
        });
    });

    test("validateKeyParticleOverride 与 validateVfxTheme 校验并拒绝非法参数", () => {
        const theme = validateVfxTheme({
            keyParticle: { style: "snow", colors: ["ice", "#FFB7D5"], glimmer: false, intensity: 0.8, scale: 1.1 },
            layers: [{ effect: "starfield", color: "#8EB8FF", level: 60 }],
        });
        expect(theme.keyParticle).toEqual({
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

    test("统一 VfxEngine 为全部 7 套舞台主题与曲目编排提供弹奏粒子覆盖", () => {
        for (const name of VFX_THEME_ORDER) {
            const engine = new VfxEngine(createThemeProgram(VFX_THEMES[name], { seconds: 20 }), "grand");
            expect(engine.keyParticleOverride()?.style).toBe(VFX_THEMES[name].keyParticle?.style);
        }

        const engine = new VfxEngine(createPerformanceProgram([
            { tick: 40, effect: "key_style", variant: "stardust", color: "#68E4FF", level: 90, scale: 100, op: "set", fade: 0 },
            { tick: 120, effect: "key_style", variant: "none", color: "#68E4FF", level: 0, scale: 100, op: "set", fade: 0 },
        ], 4), "grand");
        expect(engine.keyParticleOverride(0)).toBeUndefined();
        expect(engine.keyParticleOverride(1.1)?.style).toBe("stardust");
        expect(engine.keyParticleOverride(4)).toBeUndefined();
    });
});
