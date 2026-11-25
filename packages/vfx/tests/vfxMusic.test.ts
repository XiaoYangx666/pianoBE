import { beforeEach, expect, test } from "bun:test";
import type { VfxNoteEvent } from "../src";
import {
    createThemeProgram,
    getVfxTheme,
    listVfxThemes,
    quietFeatures,
    simulatedVfxNotes,
    validateVfxTheme,
    VfxEngine,
    VfxMusic,
} from "../src";
import { ensureBuiltinPluginsRegistered } from "./helpers/builtinPlugins";
import { tt } from "./helpers/time";

ensureBuiltinPluginsRegistered();
beforeEach(ensureBuiltinPluginsRegistered);

const note = (midi: number, tick: number, extras: Partial<VfxNoteEvent> = {}): VfxNoteEvent => ({
    midi, timelineTick: tt(tick), velocity: 100, duration: 0.55, hasVelocity: true, source: "midi", ...extras,
});

test("three-tick clusters count distinct pitches and detect an onset once per sample", () => {
    const music = new VfxMusic();
    music.note(note(48, 1));
    music.note(note(48, 1));
    music.note(note(55, 2));
    music.note(note(60, 3));
    const chord = music.sample(tt(4));
    expect(chord.onset).toBe(1);
    expect(chord.chord).toBe(0.25);
    expect(chord.middle).toBeGreaterThan(0);
    expect(music.sample(tt(8)).chord).toBe(0);
    music.note(note(62, 10));
    expect(music.sample(tt(12)).chord).toBe(0);
});

test("velocity-free notes preserve a constant while sustained pitches and density decay", () => {
    const music = new VfxMusic();
    for (let tick = 0; tick < 16; tick++) music.note(note(94, tick, { velocity: tick, hasVelocity: false, duration: 2 }));
    const active = music.sample(tt(16));
    expect(active.velocity).toBe(100 / 127);
    expect(active.dynamics).toBe(0);
    expect(active.pitch).toBeGreaterThan(0.6);
    expect(active.density).toBeGreaterThan(0.5);
    expect(active.sustain).toBeGreaterThan(0.6);
    const held = music.sample(tt(36));
    expect(held.sustain).toBeGreaterThan(active.sustain);
    expect(held.density).toBeLessThan(active.density);
    expect(music.sample(tt(110)).activity).toBeLessThan(0.02);
});

test("pause clears old MIDI attacks, seeks reset response and manual notes still work", () => {
    const music = new VfxMusic();
    for (const key of [43, 48, 55]) music.note(note(key, 1, { duration: 4 }));
    music.transport({ type: "pause", position: 1 });
    expect(music.sample(tt(4))).toEqual(quietFeatures);
    music.note(note(93, 6, { source: "manual", duration: 1.2 }));
    expect(music.sample(tt(8)).high).toBeGreaterThan(0.5);
    music.clear();
    expect(music.sample(tt(12))).toEqual(quietFeatures);
});

test("continuous wave_ribbon effect carries amplitude continuity across ticks", () => {
    const theme = validateVfxTheme({
        seconds: 10,
        layers: [{ effect: "wave_ribbon", variant: "ribbon", color: "#8EB8FF", level: { input: "activity", from: 25, to: 100 } }],
    });
    const engine = new VfxEngine(createThemeProgram(theme, { seconds: 10 }));
    const waveAt = (tick: number, activity: number) => engine.update(tick / 20, { ...quietFeatures, activity })
        .flatMap(batch => batch.emitters).find(emitter => emitter.particle === "wave")!;
    const quiet = waveAt(0, 0);
    const louder = waveAt(32, 0.85);
    expect(louder.variables.amplitude).toBeGreaterThan(quiet.variables.amplitude);
    expect(louder.variables.previous_amplitude).toBeCloseTo(quiet.variables.amplitude);
    expect(waveAt(64, 0.2).variables.amplitude).toBeLessThan(louder.variables.amplitude);
    expect(engine.update(10, quietFeatures)).toEqual([]);
});

test("galaxy theme maps sustained pitch and sustain to height and length for silk_streams", () => {
    const galaxy = new VfxEngine(createThemeProgram(getVfxTheme("galaxy")!, { seconds: 30 }));
    const beamAt = (tick: number, pitch: number, sustain: number) =>
        galaxy.update(tick / 20, { ...quietFeatures, pitch, sustain })
            .flatMap(batch => batch.emitters)
            .find(emitter => emitter.particle === "beam" && emitter.transform?.x !== undefined && emitter.transform.x > 0)!;
    const low = beamAt(0, 0.24, 0.2);
    const high = beamAt(24, 0.85, 0.88);
    expect(high.offset.y).toBeGreaterThan(low.offset.y);
    expect(high.variables.length).toBeGreaterThan(low.variables.length);
    expect(high.variables.height_delta).toBeCloseTo(low.offset.y - high.offset.y);
    expect(high.variables.silk).toBe(1);
});

test("neon remains anchored while stage reserves crown fan and sparks for sustained crests", () => {
    const neon = new VfxEngine(createThemeProgram(getVfxTheme("neon")!, { seconds: 30 }));
    const pillarsAt = (tick: number, sustain: number) =>
        neon.update(tick / 20, { ...quietFeatures, sustain })
            .flatMap(batch => batch.emitters)
            .filter(emitter => emitter.particle === "shaft_upright");
    const first = pillarsAt(0, 0.85);
    const next = pillarsAt(16, 0.2);
    expect(first).toHaveLength(6);
    expect(next).toHaveLength(6);
    expect(first.map(e => e.offset)).toEqual(next.map(e => e.offset));
    expect(next.every(e => e.variables.dir_y === 1)).toBe(true);
    expect(next.some(e => e.offset.x < -2)).toBe(true);
    expect(next.some(e => e.offset.x > 2)).toBe(true);
    expect(next[0].variables.previous_length).toBeCloseTo(first[0].variables.length);

    const music = new VfxMusic();
    const stage = new VfxEngine(createThemeProgram(getVfxTheme("stage")!, { seconds: 30 }));
    const emitAt = (tick: number) => stage.update(tick / 20, music.sample(tt(tick))).flatMap(batch => batch.emitters);
    const isCrest = (emitter: ReturnType<typeof emitAt>[number]) =>
        emitter.particle === "fountain" || emitter.variables.shaft_style === 1;
    expect(emitAt(0).some(isCrest)).toBe(false);
    let peak = 0;
    let sparks = 0;
    for (let tick = 4; tick <= 80; tick += 4) {
        for (const midi of [43, 48, 55, 62, 69]) music.note(note(midi, tick));
        const emitters = emitAt(tick);
        peak = Math.max(peak, 0, ...emitters.filter(e => e.variables.shaft_style === 1).map(e => e.variables.length));
        sparks += emitters.filter(e => e.particle === "fountain").length;
    }
    expect(peak).toBeGreaterThan(1.5);
    expect(sparks).toBeGreaterThan(2);
    for (let tick = 84; tick < 240; tick += 4) emitAt(tick);
    expect(emitAt(240).some(isCrest)).toBe(false);
});

test("all 7 built-in themes respond to deterministic music fixture with finite parameters", () => {
    for (const { theme } of listVfxThemes()) {
        const music = new VfxMusic();
        const engine = new VfxEngine(createThemeProgram(validateVfxTheme(theme), { seconds: 24 }));
        let emitterCount = 0;
        for (let tick = 0; tick < 240; tick++) {
            for (const event of simulatedVfxNotes(tt(tick), "phrase")) music.note(event);
            const batches = engine.update(tick / 20, tick % 4 === 0 ? music.sample(tt(tick)) : quietFeatures, music.recent(tt(tick)));
            for (const emitter of batches.flatMap(batch => batch.emitters)) {
                expect(Object.values(emitter.variables).every(Number.isFinite)).toBe(true);
                expect(emitter.lifetime).toBeLessThan(7);
                expect(emitter.variables.opacity).toBeWithin(0, 1.00001);
                emitterCount++;
            }
        }
        expect(emitterCount).toBeGreaterThan(15);
    }
});

test("theme validation preserves fade envelopes and rejects unsupported inputs", () => {
    const theme = validateVfxTheme({
        seconds: 7,
        fadeIn: 0,
        fadeOut: 2,
        layers: [{ effect: "aurora_veil", color: "#68E4FF", level: 90 }],
    });
    const engine = new VfxEngine(createThemeProgram(theme, { seconds: theme.seconds }));
    const first = engine.update(0, quietFeatures)[0].emitters[0];
    const last = engine.update(6.75, quietFeatures)[0].emitters[0];
    expect(last.variables.opacity).toBeLessThan(first.variables.opacity / 3);

    for (const bad of [
        { layers: [{ effect: "key_fountain", level: { input: "unknown_feature", from: 0, to: 100 } }] },
        { layers: [{ effect: "__proto__", level: 50 }] },
        { layers: [{ effect: "firefly_rise", brush: "nonexistent_brush", level: 50 }] },
        { seconds: Infinity, layers: [{ effect: "orbit_halo", level: 50 }] },
        { layers: [] },
    ]) {
        expect(() => validateVfxTheme(bad)).toThrow();
    }
});
