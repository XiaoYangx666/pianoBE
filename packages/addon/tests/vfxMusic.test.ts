import { expect, test } from "bun:test";
import type { PianoVisualNote } from "../src/domain/playback/visualEvent";
import { quietFeatures, simulatedVfxNotes, VfxMusic } from "../src/domain/piano/vfxMusic";
import { validateVfxPreset, VFX_PRESETS, VfxPresetPlayer } from "../src/domain/piano/vfxPreset";

const note = (midi: number, tick: number, extras: Partial<PianoVisualNote> = {}): PianoVisualNote => ({
    midi, tick, velocity: 100, duration: 0.55, hasVelocity: true, source: "midi", ...extras,
});

test("three-tick clusters count distinct pitches and detect an onset once per sample", () => {
    const music = new VfxMusic();
    music.note(note(48, 1));
    music.note(note(48, 1));
    music.note(note(55, 2));
    music.note(note(60, 3));
    const chord = music.sample(4);
    expect(chord.onset).toBe(1);
    expect(chord.chord).toBe(0.25);
    expect(chord.middle).toBeGreaterThan(0);
    expect(music.sample(8).chord).toBe(0);
    music.note(note(62, 10));
    expect(music.sample(12).chord).toBe(0);
});

test("velocity-free notes preserve a constant while sustained pitches and density decay", () => {
    const music = new VfxMusic();
    for (let tick = 0; tick < 16; tick++) music.note(note(94, tick, { velocity: tick, hasVelocity: false, duration: 2 }));
    const active = music.sample(16);
    expect(active.velocity).toBe(100 / 127);
    expect(active.dynamics).toBe(0);
    expect(active.pitch).toBeGreaterThan(0.6);
    expect(active.density).toBeGreaterThan(0.5);
    expect(active.sustain).toBeGreaterThan(0.6);
    const held = music.sample(36);
    expect(held.sustain).toBeGreaterThan(active.sustain);
    expect(held.density).toBeLessThan(active.density);
    expect(music.sample(110).activity).toBeLessThan(0.02);
});

test("pause clears old MIDI attacks, seeks reset response and manual notes still work", () => {
    const music = new VfxMusic();
    for (const key of [43, 48, 55]) music.note(note(key, 1, { duration: 4 }));
    music.transport({ type: "pause", position: 1 });
    expect(music.sample(4)).toEqual(quietFeatures);
    music.note(note(93, 6, { source: "manual", duration: 1.2 }));
    expect(music.sample(8).high).toBeGreaterThan(0.5);
    music.clear();
    expect(music.sample(12)).toEqual(quietFeatures);
});

test("custom wave still carries continuous amplitude changes to the client", () => {
    const player = new VfxPresetPlayer(validateVfxPreset({ layers: [{ effect: "wave", map: [
        { input: "density", parameter: "amplitude", from: 0.14, to: 0.62 },
    ] }] }));
    const center = (tick: number, density: number) => player.update(tick, { ...quietFeatures, density })
        .flatMap(batch => batch.emitters).find(e => e.effect === "wave" && e.variables.phase === 0)!;
    const quiet = center(0, 0);
    const louder = center(32, 0.8);
    expect(quiet.variables.amplitude).toBeCloseTo(0.14);
    expect(louder.variables.amplitude).toBeGreaterThan(0.5);
    expect(louder.variables.previous_amplitude).toBeCloseTo(quiet.variables.amplitude);
    expect(center(64, 0.22).variables.amplitude).toBeLessThan(louder.variables.amplitude);
    expect(player.update(player.duration, quietFeatures)).toEqual([]);
});

test("galaxy maps sustained pitch to height and length for its silk streams", () => {
    const galaxy = new VfxPresetPlayer(validateVfxPreset(VFX_PRESETS.galaxy));
    const beamAt = (tick: number, pitch: number, sustain: number) => galaxy.update(tick, { ...quietFeatures, pitch, sustain })
        .flatMap(batch => batch.emitters).find(e => e.effect === "beam")!;
    const low = beamAt(0, 0.24, 0.2);
    const high = beamAt(24, 0.85, 0.88);
    expect(high.offset.y).toBeGreaterThan(low.offset.y);
    expect(high.variables.length).toBeGreaterThan(low.variables.length);
    expect(high.variables.height_delta).toBeCloseTo(low.offset.y - high.offset.y);

    expect(high.variables.silk).toBe(1);
});

test("neon remains anchored while stage reserves its fan and sparks for a sustained crest", () => {
    const neon = new VfxPresetPlayer(validateVfxPreset(VFX_PRESETS.neon));
    const rails = neon.update(16, { ...quietFeatures, sustain: 0.85 })[0].emitters;
    const next = neon.update(32, { ...quietFeatures, sustain: 0.2 })[0].emitters;
    expect(rails.map(e => e.offset)).toEqual(next.map(e => e.offset));
    expect(rails).toHaveLength(4);
    expect([...rails, ...next].every(e => e.particle === "shaft_upright" && e.variables.dir_y === 1)).toBe(true);
    expect(rails.some(e => e.offset.x < -2)).toBe(true);
    expect(rails.some(e => e.offset.x > 2)).toBe(true);
    expect(next[0].variables.previous_length).toBeCloseTo(rails[0].variables.length);

    const music = new VfxMusic();
    const stage = new VfxPresetPlayer(validateVfxPreset(VFX_PRESETS.stage));
    const at = (tick: number) => stage.update(tick, music.sample(tick)).flatMap(batch => batch.emitters);
    const flourish = (e: ReturnType<typeof at>[number]) => e.effect === "fountain" || e.variables.shaft_style === 1;
    expect(at(0).some(flourish)).toBe(false);
    for (const midi of [43, 55, 64, 70]) music.note(note(midi, 1, { duration: 0.1 }));
    expect(at(4).some(flourish)).toBe(false);
    let peak = 0;
    let sparks = 0;
    for (let tick = 8; tick <= 80; tick += 4) {
        for (const midi of [43, 48, 55, 62, 69]) music.note(note(midi, tick));
        const emitters = at(tick);
        peak = Math.max(peak, ...emitters.filter(e => e.variables.shaft_style === 1).map(e => e.variables.length));
        sparks += emitters.filter(e => e.effect === "fountain").length;
    }
    expect(peak).toBeGreaterThan(4);
    expect(sparks).toBeGreaterThan(2);
    for (let tick = 84; tick < 240; tick += 4) at(tick);
    expect(at(240).some(flourish)).toBe(false);
});

test("all built-in presets respond to the deterministic music fixture with finite parameters", () => {
    for (const preset of Object.values(VFX_PRESETS)) {
        const music = new VfxMusic();
        const player = new VfxPresetPlayer(validateVfxPreset(preset));
        let emitterCount = 0;
        for (let tick = 0; tick < 240; tick++) {
            for (const event of simulatedVfxNotes(tick, tick, "phrase")) music.note(event);
            if (tick % 4) continue;
            const batches = player.update(tick, music.sample(tick));
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

test("preset validation rejects unsupported mappings and retains per-layer placement and fade", () => {
    const preset = validateVfxPreset({ seconds: 7, fadeIn: 0, fadeOut: 2,
        layers: [{ effect: "ripple", mode: "autonomous", options: { x: -2, scale: 1.25 } }] });
    const player = new VfxPresetPlayer(preset);
    const first = player.update(0, quietFeatures)[0].emitters[0];
    expect(first.transform).toMatchObject({ x: -2, scale: 1.25 });
    const last = player.update(135, quietFeatures)[0].emitters[0];
    expect(last.variables.opacity).toBeLessThan(first.variables.opacity / 3);
    for (const bad of [
        { layers: [{ effect: "fountain", map: [{ input: "pitch", parameter: "width", from: 0.06, to: 0.1 }] }] },
        { layers: [{ effect: "__proto__" }] },
        { layers: [{ effect: "fountain", options: { beamColor: "#ffffff" } }] },
        { seconds: Infinity, layers: [{ effect: "orbit" }] },
    ]) expect(() => validateVfxPreset(bad)).toThrow();
});
