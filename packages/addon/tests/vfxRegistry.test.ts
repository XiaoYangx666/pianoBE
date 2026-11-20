import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import {
    PERFORMANCE_BRUSHES, PERFORMANCE_METHODS, PERFORMANCE_MOTIONS, PERFORMANCE_ZONES,
    isInstantPerformanceMethod, type PerformanceMethod,
} from "@piano/core";
import { VFX_PAINTERS, VFX_STAGE_THEMES } from "@domain/piano/vfxPainters";

const methodNames = Object.keys(PERFORMANCE_METHODS) as PerformanceMethod[];

test("painter registry mirrors the method IDs and keeps them stable and contiguous", () => {
    const ids = methodNames.map(name => PERFORMANCE_METHODS[name]);
    expect(ids).toEqual(ids.map((_, index) => index + 1));
    expect(new Set(ids).size).toBe(ids.length);
    expect(Object.keys(VFX_PAINTERS).sort()).toEqual([...methodNames].sort());
});

test("every painter has a usable definition", () => {
    for (const name of methodNames) {
        const painter = VFX_PAINTERS[name];
        expect(painter.label.trim().length).toBeGreaterThan(0);
        expect(painter.instant).toBe(isInstantPerformanceMethod(name));
        expect(Object.hasOwn(PERFORMANCE_BRUSHES, painter.defaultBrush)).toBe(true);
        expect(painter.defaultBrush).not.toBe("default");
        expect(painter.interval).toBeGreaterThanOrEqual(painter.instant ? 0 : 1);
        expect(Number.isFinite(painter.priority)).toBe(true);
        expect(typeof painter.emit).toBe("function");
    }
});

test("stage themes only reference registered methods, brushes, zones and motions", () => {
    for (const theme of Object.values(VFX_STAGE_THEMES)) {
        expect(theme.layers.length).toBeGreaterThan(0);
        for (const layer of theme.layers) {
            expect(Object.hasOwn(PERFORMANCE_METHODS, layer.method)).toBe(true);
            if (layer.brush) expect(Object.hasOwn(PERFORMANCE_BRUSHES, layer.brush)).toBe(true);
            if (layer.zone) expect(Object.hasOwn(PERFORMANCE_ZONES, layer.zone)).toBe(true);
            if (layer.motion) expect(Object.hasOwn(PERFORMANCE_MOTIONS, layer.motion)).toBe(true);
        }
    }
});

test("the format document lists exactly the registered methods", () => {
    const doc = readFileSync(new URL("../../../docs/pbe3-format.md", import.meta.url), "utf8");
    const start = doc.indexOf("内置绘制方法由");
    expect(start).toBeGreaterThan(0);
    const end = doc.indexOf("定义", start);
    expect(end).toBeGreaterThan(start);
    const listed = [...doc.slice(start, end).matchAll(/`([a-z_]+)`/g)]
        .map(match => match[1])
        .filter(name => Object.hasOwn(PERFORMANCE_METHODS, name));
    expect([...new Set(listed)].sort()).toEqual([...methodNames].sort());
});
