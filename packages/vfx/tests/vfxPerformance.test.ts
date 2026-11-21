import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
    attachSongPerformance,
    encodeSong,
    PERFORMANCE_MOTIONS,
    PERFORMANCE_PALETTES,
    PERFORMANCE_ZONES,
    readSongHeader,
    songToNoteEvents,
    TIME_SCALE,
    type PerformanceCue,
    type PerformanceMotion,
    type PerformanceZone,
} from "@piano/core";
import {
    createPerformanceProgram,
    createSingleEffectProgram,
    createThemeProgram,
    POINT_BRUSH_IDS,
    POINT_BRUSH_INDEX,
    quietFeatures,
    resolveEffectCustomParams,
    simulatedVfxNotes,
    STROKE_BRUSH_IDS,
    validateEffectCustomParams,
    validateVfxTheme,
    VFX_EFFECT_IDS,
    VFX_EFFECTS,
    VFX_EMITTERS_PER_TICK,
    VFX_MAX_PIANOS,
    VFX_PARTICLES_PER_PIANO,
    VFX_THEME_ORDER,
    VFX_THEMES,
    VfxBudget,
    VfxEngine,
    VfxMusic,
} from "../src";

const allowedVariablesByParticle = new Map<string, Set<string>>();
const runtimeSupplied = new Set(["right_x", "right_z", "scale", "stage_depth"]);

function allowedVariablesFor(particleName: string): Set<string> {
    let set = allowedVariablesByParticle.get(particleName);
    if (!set) {
        const source = readFileSync(new URL(`../assets/particles/pbe_vfx_${particleName}.particle.json`, import.meta.url), "utf8");
        set = new Set([...source.matchAll(/variable\.vfx_(\w+)/g)].map(match => match[1]));
        allowedVariablesByParticle.set(particleName, set);
    }
    return set;
}

test("seeking into an in-flight transition reconstructs intensity, scale, dual RGB, modifiers, slots and skips old flashes", () => {
    const engine = new VfxEngine(createPerformanceProgram([
        {
            tick: 0, effect: "starfield", slot: 0, brush: "star", zone: "high", motion: "gentle",
            color: "#4080FF", color2: "#A0FFFF", level: 100, scale: 140, op: "set", fade: 200,
        },
        {
            tick: 0, effect: "starfield", slot: 1, brush: "petal", zone: "low", motion: "reverse",
            color: "#FF8080", color2: "#FFE0B0", level: 50, scale: 90, op: "set", fade: 80,
        },
        { tick: 80, effect: "shockwave", color: PERFORMANCE_PALETTES.gold, level: 100, scale: 100, op: "flash" },
        {
            tick: 200, effect: "starfield", slot: 0, brush: "snow", zone: "mid", motion: "intense",
            color: "#FF8040", color2: "#40FF80", level: 60, scale: 100, op: "set", fade: 200,
        },
        { tick: 320, effect: "shockwave", color: PERFORMANCE_PALETTES.gold, level: 100, scale: 100, op: "flash" },
    ], 11));

    const first = engine.update(2, 40, quietFeatures);
    expect(first.flatMap(batch => batch.emitters).map(emitter => emitter.particle)).toContain("shock");

    engine.seek(2.5);
    const midway = engine.update(2.5, 50, quietFeatures).flatMap(batch => batch.emitters);
    expect(midway.filter(e => e.particle === "draw_point")).toHaveLength(2);
    expect(midway[0].variables.opacity).toBeCloseTo(0.26 + 0.54 * 0.5, 3);
    expect(midway[0].variables.brush).toBe(POINT_BRUSH_INDEX.star);
    expect(midway[1].variables.brush).toBe(POINT_BRUSH_INDEX.petal);

    engine.seek(7.5);
    const interpolated = engine.update(7.5, 150, quietFeatures).flatMap(batch => batch.emitters);
    const slot0 = interpolated[0];
    expect(slot0.transform?.scale).toBeCloseTo(1.2, 4);
    expect(slot0.variables.red).toBeCloseTo(160 / 255, 2);
    expect(slot0.variables.red2).toBeCloseTo(112 / 255, 2);
    expect(slot0.variables.brush).toBe(POINT_BRUSH_INDEX.snow);

    expect(engine.activeSummary(7.5).map(item => `${item.effect}:${item.slot}`)).toEqual(["starfield:0", "starfield:1"]);

    engine.seek(8);
    expect(engine.update(8, 160, quietFeatures).flatMap(batch => batch.emitters).map(emitter => emitter.particle))
        .not.toContain("shock");
    engine.seek(7.95);
    expect(engine.update(8, 160, quietFeatures).flatMap(batch => batch.emitters).map(emitter => emitter.particle))
        .toContain("shock");
    expect(engine.update(8, 160, quietFeatures)).toEqual([]);
});

test("all 33 registered effects emit valid finite parameters and declared particle variables", () => {
    expect(VFX_EFFECT_IDS).toHaveLength(33);
    const zones = Object.keys(PERFORMANCE_ZONES) as PerformanceZone[];
    const motions = Object.keys(PERFORMANCE_MOTIONS) as PerformanceMotion[];
    const allBrushes = [...POINT_BRUSH_IDS, ...STROKE_BRUSH_IDS];

    const recentNotes = [
        { midi: 36, velocity: 0.78, duration: 1.2, tick: 10 },
        { midi: 52, velocity: 0.85, duration: 0.9, tick: 10 },
        { midi: 67, velocity: 0.88, duration: 0.8, tick: 10 },
        { midi: 84, velocity: 0.92, duration: 0.6, tick: 10 },
    ];

    for (const definition of ["grand", "upright"]) {
        for (const [index, id] of VFX_EFFECT_IDS.entries()) {
            const def = VFX_EFFECTS[id];
            if (def.trigger === "control") {
                expect(def.emit).toBeUndefined();
                expect(typeof def.resolveKeyParticle).toBe("function");
                continue;
            }
            const configs = [
                { brush: undefined, variant: def.variants?.[0], zone: "stage" as PerformanceZone, motion: "normal" as PerformanceMotion },
                {
                    brush: allBrushes[index % allBrushes.length],
                    variant: def.variants?.[def.variants.length - 1],
                    zone: zones[1 + (index % (zones.length - 1))],
                    motion: motions[1 + (index % (motions.length - 1))],
                },
            ];
            for (const cfg of configs) {
                const state = def.createState?.();
                const batch = def.emit!({
                    params: {
                        color: PERFORMANCE_PALETTES.aurora,
                        color2: PERFORMANCE_PALETTES.gold,
                        intensity: 0.9,
                        scale: 1.1,
                        brush: cfg.brush,
                        variant: cfg.variant,
                        zone: cfg.zone,
                        motion: cfg.motion,
                    },
                    music: { ...quietFeatures, activity: 0.72, sustain: 0.75, pitch: 0.62, surge: 0.80, density: 0.68, chord: 0.5, onset: 1 },
                    recentNotes,
                    lastNoteTick: 5,
                    definition,
                    phase: 30,
                    solo: false,
                    state,
                });
                expect(batch?.emitters.length).toBeGreaterThan(0);
                for (const emitter of batch!.emitters) {
                    expect(Object.values(emitter.variables).every(Number.isFinite)).toBe(true);
                    expect(emitter.lifetime).toBeGreaterThan(0);
                    expect(emitter.lifetime).toBeLessThan(7);
                    const required = allowedVariablesFor(emitter.particle);
                    for (const needed of required) {
                        if (!runtimeSupplied.has(needed)) {
                            expect(needed in emitter.variables).toBe(true);
                        }
                    }
                    if (emitter.particle.startsWith("draw_")) {
                        for (const varName of Object.keys(emitter.variables)) {
                            expect(required.has(varName) || varName === "count" || varName === "life").toBe(true);
                        }
                    }
                }
            }
        }
    }
});

test("all 7 unified stage themes complete four staggered pianos with zero dropped batches", () => {
    expect(VFX_THEME_ORDER).toEqual(["galaxy", "neon", "stage", "sakura", "starlight", "cathedral", "carnival"]);
    for (const name of VFX_THEME_ORDER) {
        const pianos = Array.from({ length: VFX_MAX_PIANOS }, (_, i) => ({
            start: i * 13,
            budget: new VfxBudget(),
            music: new VfxMusic(),
            engine: new VfxEngine(createThemeProgram(VFX_THEMES[name], { seconds: 24 }), "grand"),
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
                piano.budget.enqueue(piano.engine.update(elapsed / 20, elapsed, features, piano.music.recent()));
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
        expect(peakReserved).toBeGreaterThan(15);
        expect(emitted).toBeGreaterThan(200);
        expect(pianos.every(({ budget }) => budget.reserved === 0)).toBe(true);
    }
});

test("VfxEngine interpolates key_style colors, switches explicit variant, and releases at level 0", () => {
    const engine = new VfxEngine(createPerformanceProgram([
        { tick: 0, effect: "key_style", variant: "stardust", color: "#0080FF", color2: "#FFFFFF", level: 100, scale: 100, op: "set", fade: 40 },
        { tick: 80, effect: "key_style", variant: "snow", color: "#FF8000", color2: "#00FF80", level: 80, scale: 120, op: "set", fade: 80 },
        { tick: 200, effect: "key_style", variant: "glimmer", color: "#8080FF", color2: "#FFFFFF", level: 80, scale: 100, op: "set", fade: 0 },
        { tick: 240, effect: "key_style", variant: "none", color: "#8080FF", level: 80, scale: 100, op: "set", fade: 0 },
        { tick: 280, effect: "key_style", variant: "stardust", color: "#8080FF", level: 0, scale: 100, op: "set", fade: 40 },
    ], 12));

    expect(engine.keyParticleOverride(0)).toBeUndefined();
    const start = engine.keyParticleOverride(1.5);
    expect(start?.style).toBe("stardust");
    expect(start?.glimmer).toBe(true);
    expect(start?.colors).toEqual(["#0080FF", "#FFFFFF"]);

    const mid = engine.keyParticleOverride(3);
    expect(mid?.style).toBe("snow");
    expect(mid?.colors).toEqual(["#808080", "#80FFC0"]);
    expect(mid?.scale).toBeCloseTo(1.1, 3);

    const glimmerOnly = engine.keyParticleOverride(5.2);
    expect(glimmerOnly?.style).toBe("glimmer");
    expect(glimmerOnly?.glimmer).toBe(true);

    const silent = engine.keyParticleOverride(6.2);
    expect(silent?.style).toBe("none");
    expect(silent?.glimmer).toBe(false);

    expect(engine.keyParticleOverride(8.5)).toBeUndefined();
    expect(engine.keyParticleOverride(12)).toBeUndefined();
    // key_style must not reserve stage emitter budget
    expect(engine.update(3, 60, quietFeatures)).toEqual([]);
});

function simulateSongPerformance(fileName: string, starts: readonly number[]) {
    const data = readFileSync(new URL(`../../../midis/library/${fileName}`, import.meta.url));
    const { duration, performance } = readSongHeader(data);
    expect(performance).toBeDefined();

    const notes = new Map<number, ReturnType<typeof songToNoteEvents>>();
    for (const note of songToNoteEvents(data)) {
        const tick = Math.round(note.time * 20);
        const list = notes.get(tick) ?? [];
        list.push(note);
        notes.set(tick, list);
    }

    const seconds = duration / TIME_SCALE;
    const pianos = starts.map((start, index) => ({
        start,
        music: new VfxMusic(),
        engine: new VfxEngine(createPerformanceProgram(performance!, seconds), index % 2 === 0 ? "grand" : "upright"),
        budget: new VfxBudget(),
        counts: new Map<string, number>(),
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
            piano.budget.enqueue(piano.engine.update(elapsed / 20, elapsed, features, piano.music.recent()));
            let count = 0;
            piano.budget.dispatch(tick, emitter => {
                count++;
                piano.counts.set(emitter.particle, (piano.counts.get(emitter.particle) ?? 0) + 1);
            });
            expect(count).toBeLessThanOrEqual(VFX_EMITTERS_PER_TICK);
            totalCalls += count;
            peakReserved = Math.max(peakReserved, piano.budget.reserved);
        }
        peakCalls = Math.max(peakCalls, totalCalls);
    }

    expect(peakCalls).toBeLessThanOrEqual(VFX_MAX_PIANOS * VFX_EMITTERS_PER_TICK);
    expect(peakReserved).toBeLessThanOrEqual(VFX_PARTICLES_PER_PIANO);
    for (const piano of pianos) {
        expect(piano.budget.dropped).toBe(0);
        expect(piano.budget.reserved).toBe(0);
    }
    return { performance: performance!, pianos, peakReserved };
}

test("four staggered Secret performances complete within dispatch and particle budgets with zero drops", () => {
    const { performance, pianos, peakReserved } = simulateSongPerformance("e1563b03.pbe3", [0, 13, 26, 39]);
    expect(performance.length).toBeGreaterThanOrEqual(60);
    expect(peakReserved).toBeGreaterThan(100);
    for (const piano of pianos) {
        expect(piano.engine.keyParticleOverride(3)?.style).toBe("stardust");
        expect(piano.engine.keyParticleOverride(28)?.style).toBe("blue_tears");
        expect(piano.engine.keyParticleOverride(45)?.style).toBe("magic_trail");
        expect(piano.engine.keyParticleOverride(56)?.style).toBe("snow");
        expect(piano.engine.keyParticleOverride(66)?.style).toBe("prism_shards");
        expect(piano.engine.keyParticleOverride(74)?.style).toBe("magic_trail");
        expect(piano.engine.keyParticleOverride(85)).toBeUndefined();
        expect(piano.counts.get("shock") ?? 0).toBeGreaterThanOrEqual(2);
        expect(piano.counts.get("draw_stroke") ?? 0).toBeGreaterThan(400);
        expect(piano.counts.get("draw_point") ?? 0).toBeGreaterThan(200);
        expect(piano.counts.get("draw_plane") ?? 0).toBeGreaterThan(10);
        expect(piano.counts.get("shard") ?? 0).toBeGreaterThanOrEqual(24);
        expect(piano.counts.get("fountain") ?? 0).toBeGreaterThanOrEqual(2);
    }
});

test("Animenz secret base performance completes within dispatch and particle budgets with zero drops", () => {
    const { performance, pianos } = simulateSongPerformance("c8159589.pbe3", [0, 7, 19, 31]);
    expect(performance.length).toBeGreaterThanOrEqual(90);
    for (const piano of pianos) {
        expect(piano.engine.keyParticleOverride(5)?.style).toBe("stardust");
        expect(piano.engine.keyParticleOverride(40)?.style).toBe("blue_tears");
        expect(piano.engine.keyParticleOverride(102)?.style).toBe("snow");
        expect(piano.engine.keyParticleOverride(132)?.style).toBe("sakura_drift");
        expect(piano.engine.keyParticleOverride(172)?.style).toBe("magic_trail");
        expect(piano.engine.keyParticleOverride(205)?.style).toBe("stardust");
        expect(piano.engine.keyParticleOverride(236)?.style).toBe("prism_shards");
        expect(piano.engine.keyParticleOverride(295)?.style).toBe("stardust");
        expect(piano.engine.keyParticleOverride(316.5)).toBeUndefined();
        expect(piano.counts.get("draw_stroke") ?? 0).toBeGreaterThan(800);
        expect(piano.counts.get("draw_point") ?? 0).toBeGreaterThan(400);
    }
});

test("Animenz Sparkle performance completes within dispatch and particle budgets with zero drops", () => {
    const { performance, pianos } = simulateSongPerformance("b0cae095.pbe3", [0, 7, 19, 31]);
    expect(performance.length).toBeGreaterThanOrEqual(60);
    for (const piano of pianos) {
        expect(piano.engine.keyParticleOverride(5)?.style).toBe("stardust");
        expect(piano.engine.keyParticleOverride(70)?.style).toBe("blue_tears");
        expect(piano.engine.keyParticleOverride(105)?.style).toBe("magic_trail");
        expect(piano.engine.keyParticleOverride(160)?.style).toBe("sakura_drift");
        expect(piano.engine.keyParticleOverride(262)).toBeUndefined();
        expect(piano.engine.keyParticleOverride(272)?.style).toBe("snow");
        expect(piano.engine.keyParticleOverride(332)?.style).toBe("prism_shards");
        expect(piano.engine.keyParticleOverride(366)?.style).toBe("magic_trail");
        expect(piano.engine.keyParticleOverride(384.4)).toBeUndefined();
        expect(piano.counts.get("draw_cloud") ?? 0).toBeGreaterThan(200);
        expect(piano.counts.get("draw_comet") ?? 0).toBeGreaterThan(150);
        expect(piano.counts.get("draw_point") ?? 0).toBeGreaterThan(600);
    }
});

test("custom numeric params interpolate smoothly via set+fade, inherit active channel values, and roundtrip through PBE3", () => {
    const cues: PerformanceCue[] = [
        {
            tick: 0,
            effect: "double_helix",
            color: PERFORMANCE_PALETTES.aurora,
            level: 100,
            scale: 100,
            op: "set",
            fade: 0,
            params: { radius: 1.2, height: 1.0, angularSpeed: 90, particleSize: 0.04 },
        },
        {
            tick: 80, // t = 2s
            effect: "double_helix",
            color: PERFORMANCE_PALETTES.gold,
            level: 100,
            scale: 100,
            op: "set",
            fade: 160, // fades 2s -> 6s; t = 4s is exact midpoint (smoothstep 0.5)
            params: { radius: 3.6, angularSpeed: 270 },
        },
        {
            tick: 240, // t = 6s fade out over 2s
            effect: "double_helix",
            color: PERFORMANCE_PALETTES.gold,
            level: 0,
            scale: 100,
            op: "set",
            fade: 80,
        },
        {
            tick: 360, // t = 9s restart from silence with only height overridden
            effect: "double_helix",
            color: PERFORMANCE_PALETTES.ice,
            level: 80,
            scale: 100,
            op: "set",
            fade: 0,
            params: { height: 4.0 },
        },
    ];

    const rawSong = encodeSong({
        id: "paramtest",
        name: "参数测试",
        duration: 480,
        tracks: [{ instrument: { family: "", number: 0, name: "" }, notes: [60, 0, 100, 100] }],
    });
    const packed = attachSongPerformance(rawSong, cues);
    const decodedCues = readSongHeader(packed).performance!;
    expect(decodedCues).toEqual(cues);

    const engine = new VfxEngine(createPerformanceProgram(decodedCues, 12));
    const first = engine.update(0.5, 10, quietFeatures)[0].emitters[0];
    expect(first.variables.radius).toBeCloseTo(1.2, 4);
    expect(first.variables.rise).toBeCloseTo(1.0, 4);
    expect(first.variables.omega).toBeCloseTo(90, 4);
    expect(first.variables.size).toBeCloseTo(0.04 + 0.025, 4);

    // Seek to midpoint t = 4.0s: radius & angularSpeed interpolate to midpoint, height & particleSize inherit from active channel
    engine.seek(4.0, true);
    const mid = engine.update(4.0, 80, quietFeatures)[0].emitters[0];
    expect(mid.variables.radius).toBeCloseTo(2.4, 4);
    expect(mid.variables.omega).toBeCloseTo(180, 4);
    expect(mid.variables.rise).toBeCloseTo(1.0, 4);
    expect(mid.variables.size).toBeCloseTo(0.04 + 0.025, 4);

    // At t = 7.0s (midway through level: 0 fade-out), radius remains 3.6 rather than snapping back to default
    engine.seek(7.0, true);
    const fadingOut = engine.update(7.0, 140, quietFeatures)[0].emitters[0];
    expect(fadingOut.variables.radius).toBeCloseTo(3.6, 4);

    // At t = 9.0s (restart from silence), unspecified params reset to defaults while height = 4.0
    engine.seek(9.0, true);
    const restarted = engine.update(9.0, 180, quietFeatures)[0].emitters[0];
    expect(restarted.variables.radius).toBeCloseTo(2.2, 4);
    expect(restarted.variables.rise).toBeCloseTo(4.0, 4);
    expect(restarted.variables.omega).toBeCloseTo(135, 4);
});

test("boolean and enum custom params switch immediately at cue time and control emitted geometry", () => {
    const engine = new VfxEngine(createPerformanceProgram([
        {
            tick: 40,
            effect: "firework_bloom",
            color: PERFORMANCE_PALETTES.gold,
            level: 90,
            scale: 100,
            op: "flash",
            params: { burstRadius: 2.8, burstShape: "ring", fountain: false, particleSize: 0.12 },
        },
        {
            tick: 80,
            effect: "shockwave",
            color: PERFORMANCE_PALETTES.ice,
            level: 90,
            scale: 100,
            op: "flash",
            params: { radius: 4.0, dualRing: false },
        },
    ], 5));

    const fw = engine.update(1.0, 20, quietFeatures).flatMap(b => b.emitters);
    expect(fw.some(e => e.particle === "fountain")).toBe(false);
    const fwPoints = fw.filter(e => e.particle === "draw_point");
    expect(fwPoints).toHaveLength(3);
    expect(fwPoints[0].variables.depth_ratio).toBeCloseTo(0.32, 4);
    expect(fwPoints[0].variables.radius_end).toBeCloseTo(2.8 + 0.35 * 0.9, 4);
    expect(fwPoints[0].variables.size).toBeCloseTo(0.12 + 0.025 * 0.9, 4);

    const sw = engine.update(2.0, 40, quietFeatures).flatMap(b => b.emitters);
    const planes = sw.filter(e => e.particle === "draw_plane");
    expect(planes).toHaveLength(1);
    expect(planes[0].variables.radius_end).toBeCloseTo(4.0 + 0.65 * 0.9, 4);
});

test("custom parameter validation rejects invalid names/bounds while runtime resolution clamps safely and works in themes/single mode", () => {
    expect(validateEffectCustomParams("double_helix", { radius: 2.8, angularSpeed: -180 })).toEqual({
        radius: 2.8,
        angularSpeed: -180,
    });
    expect(validateEffectCustomParams("double_helix", {})).toBeUndefined();
    expect(() => validateEffectCustomParams("double_helix", { unknownParam: 1 })).toThrow(/不支持参数/);
    expect(() => validateEffectCustomParams("double_helix", { radius: 99 })).toThrow(/0.5 到 4/);
    expect(() => validateEffectCustomParams("firework_bloom", { burstShape: "cube" })).toThrow(/sphere \/ ring/);
    expect(() => validateEffectCustomParams("firework_bloom", { fountain: "yes" })).toThrow(/布尔值/);

    expect(resolveEffectCustomParams("double_helix", { radius: 99, angularSpeed: -999, unknown: 1 })).toEqual({
        radius: 4.0,
        height: 1.95,
        angularSpeed: -360,
        particleSize: 0.068,
    });

    const theme = validateVfxTheme({
        seconds: 10,
        layers: [
            {
                effect: "double_helix",
                color: "aurora",
                level: 80,
                params: { radius: 3.2, height: 3.4 },
            },
        ],
    });
    const themeEngine = new VfxEngine(createThemeProgram(theme, { seconds: 10 }));
    const themeEmitter = themeEngine.update(0, 0, quietFeatures)[0].emitters[0];
    expect(themeEmitter.variables.radius).toBeCloseTo(3.2, 4);
    expect(themeEmitter.variables.rise).toBeCloseTo(3.4, 4);

    expect(() => validateVfxTheme({
        layers: [{ effect: "double_helix", color: "aurora", level: 80, params: { radius: 0.1 } }],
    })).toThrow();

    const singleEngine = new VfxEngine(createSingleEffectProgram({
        effect: "comet_split",
        color: "#68E4FF",
        level: 90,
        params: { length: 4.5, split: false },
    }));
    const cometEmitters = singleEngine.update(0, 0, quietFeatures)[0].emitters;
    expect(cometEmitters.filter(e => e.particle === "draw_comet")).toHaveLength(1);
    expect(cometEmitters.find(e => e.particle === "draw_comet")!.variables.length).toBeCloseTo(4.5, 4);
});
