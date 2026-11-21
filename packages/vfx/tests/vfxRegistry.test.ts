import { expect, test } from "bun:test";
import {
    isValidPerformanceParamKey,
    isValidPerformanceSymbol,
    PERFORMANCE_MOTIONS,
    PERFORMANCE_ZONES,
} from "@piano/core";
import {
    isPointBrush,
    isStrokeBrush,
    isValidBrush,
    POINT_BRUSH_IDS,
    POINT_BRUSH_INDEX,
    STROKE_BRUSH_IDS,
    STROKE_BRUSH_INDEX,
    validateVfxTheme,
    VFX_ATLAS,
    VFX_EFFECT_IDS,
    VFX_EFFECTS,
    VFX_THEME_ORDER,
    VFX_THEMES,
} from "../src";

test("effect registry keeps all registered effects valid, uniquely keyed, covering every category and backed by the single atlas", () => {
    expect(VFX_EFFECT_IDS.length).toBeGreaterThanOrEqual(33);
    expect(new Set(VFX_EFFECT_IDS).size).toBe(VFX_EFFECT_IDS.length);
    const categories = new Set(VFX_EFFECT_IDS.map(id => VFX_EFFECTS[id].category));
    for (const required of ["atmosphere", "curve", "stage", "keys", "accent", "control"] as const) {
        expect(categories.has(required)).toBe(true);
    }

    for (const id of VFX_EFFECT_IDS) {
        const effect = VFX_EFFECTS[id];
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

test("all 7 built-in stage themes pass validation and only reference registered effects, brushes, zones and motions", () => {
    expect(VFX_THEME_ORDER).toEqual(["galaxy", "neon", "stage", "sakura", "starlight", "cathedral", "carnival"]);
    for (const name of VFX_THEME_ORDER) {
        const theme = VFX_THEMES[name];
        expect(theme.layers.length).toBeGreaterThan(0);
        const validated = validateVfxTheme(theme);
        expect(validated.layers.length).toBe(theme.layers.length);
        for (const layer of theme.layers) {
            expect(Object.hasOwn(VFX_EFFECTS, layer.effect)).toBe(true);
            if (layer.brush) expect(isValidBrush(layer.brush)).toBe(true);
            if (layer.zone) expect(Object.hasOwn(PERFORMANCE_ZONES, layer.zone)).toBe(true);
            if (layer.motion) expect(Object.hasOwn(PERFORMANCE_MOTIONS, layer.motion)).toBe(true);
        }
    }
});
