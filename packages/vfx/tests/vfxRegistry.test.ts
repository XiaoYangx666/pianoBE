import { beforeEach, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
    isValidPerformanceParamKey,
    isValidPerformanceSymbol,
    PERFORMANCE_MOTIONS,
    PERFORMANCE_ZONES,
} from "@piano/core";
import {
    getVfxEffect,
    getVfxEffectIds,
    getVfxTheme,
    getVfxThemeIds,
    isPointBrush,
    isStrokeBrush,
    isValidBrush,
    listVfxEffects,
    listVfxPlugins,
    POINT_BRUSH_IDS,
    POINT_BRUSH_INDEX,
    STROKE_BRUSH_IDS,
    STROKE_BRUSH_INDEX,
    validateVfxTheme,
    VFX_ATLAS,
} from "../src";
import { ensureBuiltinPluginsRegistered } from "./helpers/builtinPlugins";

ensureBuiltinPluginsRegistered();
beforeEach(ensureBuiltinPluginsRegistered);

test("effect registry keeps all registered effects valid, uniquely keyed, covering every category and backed by the single atlas", () => {
    const effectIds = getVfxEffectIds();
    expect(effectIds.length).toBeGreaterThanOrEqual(38);
    expect(new Set(effectIds).size).toBe(effectIds.length);
    const categories = new Set(listVfxEffects().map(effect => effect.category));
    for (const required of ["atmosphere", "curve", "stage", "keys", "accent", "control"] as const) {
        expect(categories.has(required)).toBe(true);
    }

    for (const id of effectIds) {
        const effect = getVfxEffect(id)!;
        expect(effect).toBeDefined();
        expect(effect.id).toBe(id);
        expect(effect.label.trim().length).toBeGreaterThan(0);
        expect(["atmosphere", "curve", "stage", "keys", "accent", "control"]).toContain(effect.category);
        expect(["continuous", "note", "instant", "control"]).toContain(effect.trigger);
        expect(Number.isFinite(effect.priority)).toBe(true);
        expect(effect.interval).toBeGreaterThanOrEqual(effect.trigger === "instant" || effect.trigger === "control" ? 0 : 1);
        if (effect.defaultBrush) expect(isPointBrush(effect.defaultBrush)).toBe(true);
        if (effect.defaultStroke) expect(isStrokeBrush(effect.defaultStroke)).toBe(true);
        if (effect.trigger === "control") {
            expect(typeof effect.resolveKeyParticle).toBe("function");
        } else {
            expect(typeof effect.emit).toBe("function");
        }
        if (effect.parameters) {
            const entries = Object.entries(effect.parameters);
            expect(entries.length).toBeGreaterThan(0);
            expect(entries.length).toBeLessThanOrEqual(16);
            for (const [paramKey, spec] of entries) {
                expect(isValidPerformanceParamKey(paramKey)).toBe(true);
                if (spec.type === "boolean") {
                    expect(typeof spec.default).toBe("boolean");
                } else if (spec.type === "enum") {
                    expect(spec.options.length).toBeGreaterThan(0);
                    for (const option of spec.options) {
                        expect(isValidPerformanceSymbol(option)).toBe(true);
                    }
                    expect(spec.options).toContain(spec.default);
                } else {
                    expect(Number.isFinite(spec.min)).toBe(true);
                    expect(Number.isFinite(spec.max)).toBe(true);
                    expect(Number.isFinite(spec.default)).toBe(true);
                    expect(spec.min).toBeLessThan(spec.max);
                    expect(spec.default).toBeGreaterThanOrEqual(spec.min);
                    expect(spec.default).toBeLessThanOrEqual(spec.max);
                    if (spec.step !== undefined) {
                        expect(Number.isFinite(spec.step) && spec.step > 0).toBe(true);
                    }
                }
            }
        }
    }
});

test("single-source vfxAtlas.json brushes and tile regions fit within the 1024x1024 atlas", () => {
    const { width, height, pointBrushGrid, strokeBrushStrip, tiles } = VFX_ATLAS;
    expect([width, height]).toEqual([1024, 1024]);
    expect(POINT_BRUSH_IDS.length).toBeLessThanOrEqual(pointBrushGrid.cols * pointBrushGrid.rows);

    POINT_BRUSH_IDS.forEach((brushId, index) => {
        expect(POINT_BRUSH_INDEX[brushId]).toBe(index);
        const col = index % pointBrushGrid.cols;
        const row = Math.floor(index / pointBrushGrid.cols);
        const x = pointBrushGrid.originX + col * pointBrushGrid.cellSize;
        const y = pointBrushGrid.originY + row * pointBrushGrid.cellSize;
        expect(x + pointBrushGrid.cellSize).toBeLessThanOrEqual(width);
        expect(y + pointBrushGrid.cellSize).toBeLessThanOrEqual(height);
    });

    STROKE_BRUSH_IDS.forEach((strokeId, index) => {
        expect(STROKE_BRUSH_INDEX[strokeId]).toBe(index);
        const x = strokeBrushStrip.originX + index * strokeBrushStrip.cellWidth;
        const y = strokeBrushStrip.originY;
        expect(x + strokeBrushStrip.cellWidth).toBeLessThanOrEqual(width);
        expect(y + strokeBrushStrip.cellHeight).toBeLessThanOrEqual(height);
    });

    for (const [name, [u, v, w, h]] of Object.entries(tiles)) {
        expect(name.length).toBeGreaterThan(0);
        expect(u).toBeGreaterThanOrEqual(0);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(u + w).toBeLessThanOrEqual(width);
        expect(v + h).toBeLessThanOrEqual(height);
    }
});

test("all built-in stage themes pass validation and only reference registered effects, brushes, zones and motions", () => {
    const themeOrder = getVfxThemeIds();
    expect(themeOrder).toEqual(["galaxy", "neon", "stage", "sakura", "starlight", "cathedral", "carnival", "chinese_misty_rain"]);
    for (const name of themeOrder) {
        const theme = getVfxTheme(name)!;
        expect(theme).toBeDefined();
        expect(theme.layers.length).toBeGreaterThan(0);
        const validated = validateVfxTheme(theme);
        expect(validated.layers.length).toBe(theme.layers.length);
        for (const layer of theme.layers) {
            expect(getVfxEffect(layer.effect)).toBeDefined();
            if (layer.brush) expect(isValidBrush(layer.brush)).toBe(true);
            if (layer.zone) expect(Object.hasOwn(PERFORMANCE_ZONES, layer.zone)).toBe(true);
            if (layer.motion) expect(Object.hasOwn(PERFORMANCE_MOTIONS, layer.motion)).toBe(true);
        }
    }
});

test("built-in plugin manifests accurately declare every registered effect, theme, layout and keyStyle", () => {
    const plugins = listVfxPlugins();
    expect(plugins.map(p => p.manifest.id)).toEqual([
        "pianobe.atmosphere",
        "pianobe.curves",
        "pianobe.stage",
        "pianobe.keys",
        "pianobe.accents",
        "pianobe.themes",
        "pianobe.chinese",
    ]);
    const pluginsRoot = join(import.meta.dir, "..", "..", "..", "plugins");
    for (const record of plugins) {
        expect(record.effects).toEqual([...(record.manifest.provides.effects ?? [])]);
        expect(record.themes).toEqual([...(record.manifest.provides.themes ?? [])]);
        expect([...record.lightLayouts, ...record.veilLayouts]).toEqual([...(record.manifest.provides.layouts ?? [])]);
        expect(record.keyStyles).toEqual([...(record.manifest.provides.keyStyles ?? [])]);

        const shortDir = record.manifest.id.replace(/^pianobe\./, "");
        const particlesDir = join(pluginsRoot, shortDir, "particles");
        const diskParticles = existsSync(particlesDir)
            ? readdirSync(particlesDir)
                .filter(name => name.startsWith("pbe_vfx_") && name.endsWith(".particle.json"))
                .map(name => name.slice("pbe_vfx_".length, -".particle.json".length))
                .sort()
            : [];
        expect([...(record.manifest.provides.particles ?? [])].sort()).toEqual(diskParticles);
    }
});
