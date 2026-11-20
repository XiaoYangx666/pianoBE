import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
    PERFORMANCE_METHODS, PERFORMANCE_MOTIONS, PERFORMANCE_PALETTES, PERFORMANCE_ZONES,
    readSongHeader, songToNoteEvents, TIME_SCALE,
    type PerformanceBrush, type PerformanceMethod, type PerformanceMotion, type PerformanceZone,
} from "@piano/core";
import { grandDefinition, pianoDefinition } from "../src/domain/instrument/definition";
import { VFX_MAX_PIANOS, VFX_PARTICLES_PER_PIANO, VfxBudget } from "../src/domain/piano/vfxBudget";
import { BRUSH_INDEX } from "../src/domain/piano/vfxDraw";
import { VFX_EMITTERS_PER_TICK } from "../src/domain/piano/vfxLab";
import { quietFeatures, simulatedVfxNotes, VfxMusic } from "../src/domain/piano/vfxMusic";
import { VFX_PAINTERS, VFX_STAGE_THEMES, VfxThemePlayer, type VfxStageThemeName } from "../src/domain/piano/vfxPainters";
import { emitPerformanceMethod, VfxPerformancePlayer } from "../src/domain/piano/vfxPerformance";

const allowedVariablesByParticle = new Map<string, Set<string>>();
const runtimeSupplied = new Set(["right_x", "right_z", "scale", "stage_depth"]);
function allowedVariablesFor(particleName: string): Set<string> {
    let set = allowedVariablesByParticle.get(particleName);
    if (!set) {
        const source = readFileSync(new URL(`../rp/particles/pbe_vfx_${particleName}.particle.json`, import.meta.url), "utf8");
        set = new Set([...source.matchAll(/variable\.vfx_(\w+)/g)].map(match => match[1]));
        allowedVariablesByParticle.set(particleName, set);
    }
    return set;
}

test("seeking into an in-flight transition reconstructs intensity, scale, dual RGB, modifiers, slots and skips old flashes", () => {
    const player = new VfxPerformancePlayer([
        { tick: 0, method: "starfield", slot: 0, brush: "star", zone: "high", motion: "gentle",
            color: "#4080FF", color2: "#A0FFFF", level: 100, scale: 140, op: "set", fade: 200 },
        { tick: 0, method: "starfield", slot: 1, brush: "petal", zone: "low", motion: "reverse",
            color: "#FF8080", color2: "#FFE0B0", level: 50, scale: 90, op: "set", fade: 80 },
        { tick: 80, method: "shockwave", color: PERFORMANCE_PALETTES.gold, level: 100, scale: 100, op: "flash" },
        { tick: 200, method: "starfield", slot: 0, brush: "snow", zone: "mid", motion: "intense",
            color: "#FF8040", color2: "#40FF80", level: 60, scale: 100, op: "set", fade: 200 },
        { tick: 320, method: "shockwave", color: PERFORMANCE_PALETTES.gold, level: 100, scale: 100, op: "flash" },
    ], 11);

    const first = player.update(2, quietFeatures);
    expect(first.flatMap(batch => batch.emitters).map(emitter => emitter.particle)).toContain("cinema_shock");

    player.seek(2.5);
    const midway = player.update(2.5, quietFeatures).flatMap(batch => batch.emitters);
    expect(midway.filter(e => e.particle === "draw_point")).toHaveLength(2);
    expect(midway[0].variables.opacity).toBeCloseTo(0.26 + 0.54 * 0.5, 3);
    expect(midway[0].variables.brush).toBe(BRUSH_INDEX.star);
    expect(midway[1].variables.brush).toBe(BRUSH_INDEX.petal);

    player.seek(7.5);
    const interpolated = player.update(7.5, quietFeatures).flatMap(batch => batch.emitters);
    const slot0 = interpolated[0];
    expect(slot0.transform?.scale).toBeCloseTo(1.2, 4);
    expect(slot0.variables.red).toBeCloseTo(160 / 255, 2);
    expect(slot0.variables.red2).toBeCloseTo(112 / 255, 2);
    expect(slot0.variables.brush).toBe(BRUSH_INDEX.snow);

    expect(player.activeSummary(7.5).map(item => `${item.method}:${item.slot}`)).toEqual(["starfield:0", "starfield:1"]);

    player.seek(8);
    expect(player.update(8, quietFeatures).flatMap(batch => batch.emitters).map(emitter => emitter.particle))
        .not.toContain("cinema_shock");
    player.seek(7.95);
    expect(player.update(8, quietFeatures).flatMap(batch => batch.emitters).map(emitter => emitter.particle))
        .toContain("cinema_shock");
    expect(player.update(8, quietFeatures)).toEqual([]);
});

test("all 25 built-in performance methods emit valid finite parameters and declared particle variables", () => {
    const methods = Object.keys(PERFORMANCE_METHODS) as PerformanceMethod[];
    const brushes: PerformanceBrush[] = ["default", "mote", "star", "petal", "snow", "note", "shard", "spark", "ring"];
    const zones = Object.keys(PERFORMANCE_ZONES) as PerformanceZone[];
    const motions = Object.keys(PERFORMANCE_MOTIONS) as PerformanceMotion[];
    expect(methods).toHaveLength(25);
    expect(Object.keys(VFX_PAINTERS)).toHaveLength(25);

    const recentNotes = [
        { midi: 36, velocity: 0.78, duration: 1.2, tick: 10 },
        { midi: 52, velocity: 0.85, duration: 0.9, tick: 10 },
        { midi: 67, velocity: 0.88, duration: 0.8, tick: 10 },
        { midi: 84, velocity: 0.92, duration: 0.6, tick: 10 },
    ];

    for (const definition of [grandDefinition, pianoDefinition]) {
        for (const [index, method] of methods.entries()) {
            const variants: Array<{ brush: PerformanceBrush; zone: PerformanceZone; motion: PerformanceMotion }> = [
                { brush: "default", zone: "stage", motion: "normal" },
                {
                    brush: brushes[1 + (index % (brushes.length - 1))],
                    zone: zones[1 + (index % (zones.length - 1))],
                    motion: motions[1 + (index % (motions.length - 1))],
                },
            ];
            for (const variant of variants) {
                const result = emitPerformanceMethod(method, {
                    color: PERFORMANCE_PALETTES.aurora,
                    color2: PERFORMANCE_PALETTES.gold,
                    intensity: 0.9,
                    scale: 1.1,
                    brush: variant.brush,
                    zone: variant.zone,
                    motion: variant.motion,
                    music: { ...quietFeatures, activity: 0.72, sustain: 0.75, pitch: 0.62, surge: 0.80, density: 0.68, chord: 0.5, onset: 1 },
                    recentNotes,
                    lastNoteTick: 5,
                    definition,
                    phase: 30,
                });
                if (method === "key_style") {
                    expect(result.emitters).toEqual([]);
                    continue;
                }
                expect(result.emitters.length).toBeGreaterThan(0);
                for (const emitter of result.emitters) {
                    expect(Object.values(emitter.variables).every(Number.isFinite)).toBe(true);
                    expect(emitter.lifetime).toBeGreaterThan(0);
                    expect(emitter.lifetime).toBeLessThan(7);
                    const particleName = emitter.particle ?? emitter.effect;
                    const required = allowedVariablesFor(particleName);
                    for (const needed of required) {
                        if (!runtimeSupplied.has(needed)) {
                            expect(needed in emitter.variables).toBe(true);
                        }
                    }
                    if (particleName.startsWith("draw_")) {
                        for (const varName of Object.keys(emitter.variables)) {
                            expect(required.has(varName) || varName === "count" || varName === "life").toBe(true);
                        }
                    }
                }
            }
        }
    }
});

test("all four new painter stage themes complete four staggered pianos with zero dropped batches", () => {
    const themeNames = Object.keys(VFX_STAGE_THEMES) as VfxStageThemeName[];
    expect(themeNames).toEqual(["sakura", "starlight", "cathedral", "carnival"]);
    for (const name of themeNames) {
        const pianos = Array.from({ length: VFX_MAX_PIANOS }, (_, i) => ({
            start: i * 13,
            budget: new VfxBudget(),
            music: new VfxMusic(),
            player: new VfxThemePlayer(VFX_STAGE_THEMES[name], grandDefinition, 24),
        }));
        let peakReserved = 0;
        let peakDispatch = 0;
        let emitted = 0;
        for (let tick = 0; tick < 640; tick++) {
            let callsThisTick = 0;
            for (const piano of pianos) {
                const elapsed = tick - piano.start;
                piano.budget.expire(tick);
                if (elapsed < 0) continue;
                for (const note of simulatedVfxNotes(tick, elapsed, "phrase")) piano.music.note(note);
                const features = elapsed % 4 === 0 ? piano.music.sample(tick) : quietFeatures;
                piano.budget.enqueue(piano.player.update(elapsed, features, piano.music.recent()));
                let calls = 0;
                piano.budget.dispatch(tick, () => calls++);
                expect(calls).toBeLessThanOrEqual(VFX_EMITTERS_PER_TICK);
                expect(piano.budget.reserved).toBeWithin(0, VFX_PARTICLES_PER_PIANO + 1);
                expect(piano.budget.dropped).toBe(0);
                callsThisTick += calls;
                emitted += calls;
                peakReserved = Math.max(peakReserved, piano.budget.reserved);
            }
            peakDispatch = Math.max(peakDispatch, callsThisTick);
        }
        expect(peakDispatch).toBeLessThanOrEqual(VFX_MAX_PIANOS * VFX_EMITTERS_PER_TICK);
        expect(peakReserved).toBeGreaterThan(25);
        expect(emitted).toBeGreaterThan(200);
        expect(pianos.every(({ budget }) => budget.reserved === 0)).toBe(true);
    }
});

test("VfxPerformancePlayer interpolates key_style colors, switches modes/brushes, and releases at level 0", () => {
    const player = new VfxPerformancePlayer([
        { tick: 0, method: "key_style", brush: "star", color: "#0080FF", color2: "#FFFFFF", level: 100, scale: 100, op: "set", fade: 40 },
        { tick: 80, method: "key_style", brush: "snow", color: "#FF8000", color2: "#00FF80", level: 80, scale: 120, op: "set", fade: 80 },
        { tick: 200, method: "key_style", brush: "snow", motion: "gentle", color: "#8080FF", color2: "#FFFFFF", level: 80, scale: 100, op: "set", fade: 0 },
        { tick: 240, method: "key_style", motion: "reverse", color: "#8080FF", level: 80, scale: 100, op: "set", fade: 0 },
        { tick: 280, method: "key_style", brush: "star", color: "#8080FF", level: 0, scale: 100, op: "set", fade: 40 },
    ], 12);

    expect(player.keyParticleOverride(0)).toBeUndefined();
    const start = player.keyParticleOverride(1.5);
    expect(start?.style).toBe("stardust");
    expect(start?.glimmer).toBe(true);
    expect(start?.colors).toEqual(["#0080FF", "#FFFFFF"]);

    const mid = player.keyParticleOverride(3);
    expect(mid?.style).toBe("snow");
    expect(mid?.colors).toEqual(["#808080", "#80FFC0"]);
    expect(mid?.scale).toBeCloseTo(1.1, 3);

    const glimmerOnly = player.keyParticleOverride(5.2);
    expect(glimmerOnly?.style).toBe("none");
    expect(glimmerOnly?.glimmer).toBe(true);

    const silent = player.keyParticleOverride(6.2);
    expect(silent?.style).toBe("none");
    expect(silent?.glimmer).toBe(false);

    expect(player.keyParticleOverride(8.5)).toBeUndefined();
    expect(player.keyParticleOverride(12)).toBeUndefined();
    // key_style must not reserve stage emitter budget
    expect(player.update(3, quietFeatures)).toEqual([]);
});

test("four staggered Secret performances complete within dispatch and particle budgets with zero drops", () => {
    const data = readFileSync(new URL("../../../midis/library/e1563b03.pbe3", import.meta.url));
    const { duration, performance } = readSongHeader(data);
    expect(performance).toBeDefined();
    expect(performance!.length).toBeGreaterThanOrEqual(60);

    const notes = new Map<number, ReturnType<typeof songToNoteEvents>>();
    for (const note of songToNoteEvents(data)) {
        const tick = Math.round(note.time * 20);
        const group = notes.get(tick) ?? [];
        group.push(note);
        notes.set(tick, group);
    }

    const seconds = duration / TIME_SCALE;
    const pianos = Array.from({ length: VFX_MAX_PIANOS }, (_, offset) => ({
        start: offset * 13,
        budget: new VfxBudget(),
        music: new VfxMusic(),
        player: new VfxPerformancePlayer(performance!, seconds, grandDefinition),
        shocks: 0,
        strokes: 0,
        points: 0,
        planes: 0,
        shards: 0,
        fountains: 0,
    }));

    let peakReserved = 0;
    let peakCalls = 0;
    for (let tick = 0; tick < seconds * 20 + 200; tick++) {
        let totalCalls = 0;
        for (const piano of pianos) {
            const elapsed = tick - piano.start;
            piano.budget.expire(tick);
            if (elapsed < 0) continue;
            for (const note of notes.get(elapsed) ?? []) {
                piano.music.note({
                    midi: note.midi,
                    duration: note.duration,
                    tick,
                    velocity: Math.round(note.velocity * 127),
                    source: "midi",
                    hasVelocity: true,
                    songTime: note.time,
                });
            }
            const features = elapsed % 4 === 0 ? piano.music.sample(tick) : quietFeatures;
            piano.budget.enqueue(piano.player.update(elapsed / 20, features, true, piano.music.recent()));
            let count = 0;
            piano.budget.dispatch(tick, emitter => {
                count++;
                const name = emitter.particle ?? emitter.effect;
                if (name === "cinema_shock") piano.shocks++;
                if (name === "draw_stroke") piano.strokes++;
                if (name === "draw_point") piano.points++;
                if (name === "draw_plane") piano.planes++;
                if (name === "shard") piano.shards++;
                if (name === "fountain") piano.fountains++;
            });
            expect(count).toBeLessThanOrEqual(VFX_EMITTERS_PER_TICK);
            totalCalls += count;
            peakReserved = Math.max(peakReserved, piano.budget.reserved);
        }
        peakCalls = Math.max(peakCalls, totalCalls);
    }

    expect(peakCalls).toBeLessThanOrEqual(VFX_MAX_PIANOS * VFX_EMITTERS_PER_TICK);
    expect(peakReserved).toBeLessThanOrEqual(VFX_PARTICLES_PER_PIANO);
    expect(peakReserved).toBeGreaterThan(100);
    for (const piano of pianos) {
        expect(piano.player.keyParticleOverride(3)?.style).toBe("stardust");
        expect(piano.player.keyParticleOverride(28)?.style).toBe("blue_tears");
        expect(piano.player.keyParticleOverride(45)?.style).toBe("magic_trail");
        expect(piano.player.keyParticleOverride(56)?.style).toBe("snow");
        expect(piano.player.keyParticleOverride(66)?.style).toBe("prism_shards");
        expect(piano.player.keyParticleOverride(74)?.style).toBe("magic_trail");
        expect(piano.player.keyParticleOverride(85)).toBeUndefined();
        expect(piano.shocks).toBeGreaterThanOrEqual(2);
        expect(piano.strokes).toBeGreaterThan(400);
        expect(piano.points).toBeGreaterThan(200);
        expect(piano.planes).toBeGreaterThan(10);
        expect(piano.shards).toBeGreaterThanOrEqual(24);
        expect(piano.fountains).toBeGreaterThanOrEqual(2);
        expect(piano.budget.dropped).toBe(0);
        expect(piano.budget.reserved).toBe(0);
    }
});
