import { beforeEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
    compilePerformanceSource,
    createPerformanceProgram,
    createThemeProgram,
    listVfxEffects,
    listVfxThemes,
    placeVfxEmitter,
    quietFeatures,
    VFX_PARTICLES_PER_PIANO,
    VfxEngine,
    vfxStageFrame,
    type VfxEmitter,
} from "../src";
import { ensureBuiltinPluginsRegistered } from "./helpers/builtinPlugins";

ensureBuiltinPluginsRegistered();
beforeEach(ensureBuiltinPluginsRegistered);

const right = { x: 1, y: 0, z: 0 };
const stage = vfxStageFrame();

function check(label: string, emitter: VfxEmitter, seconds: number, out: string[]) {
    const placed = placeVfxEmitter({ x: 0, y: 1, z: 0 }, right, stage, emitter, seconds);
    for (const [k, v] of Object.entries(placed.variables)) {
        if (typeof v !== "number" || !Number.isFinite(v)) out.push(`${label} @${seconds} var ${k}=${v}`);
    }
    for (const [k, v] of Object.entries(placed.position)) {
        if (!Number.isFinite(v)) out.push(`${label} @${seconds} pos ${k}=${v}`);
    }
}

test("all performance JSON cues place finite variables through unified VfxEngine", () => {
    const songs = [
        ["e1563b03", 87, 0.1],
        ["c8159589", 317, 0.2],
        ["b0cae095", 385, 0.25],
        ["ff9c1534", 287, 0.25],
    ] as const;
    const music = { ...quietFeatures, velocity: 0.55, activity: 0.6, density: 0.55, sustain: 0.5, surge: 0.6, chord: 0.6, onset: 0.55 };
    const failures: string[] = [];

    for (const [id, duration, step] of songs) {
        const source = JSON.parse(readFileSync(new URL(`../../../midis/performances/${id}.json`, import.meta.url), "utf8"));
        const engine = new VfxEngine(createPerformanceProgram(compilePerformanceSource(source, id), duration));
        for (let t = 0; t <= duration; t += step) {
            const notes = [{ midi: 66, velocity: 0.8, duration: 0.8, tick: Math.round(t * 20) }];
            const batches = engine.update(t, Math.round(t * 20), music, notes);
            for (const batch of batches) {
                for (const emitter of batch.emitters) check(`${id} ${emitter.group}/${emitter.particle}`, emitter, t, failures);
            }
        }
    }
    expect([...new Set(failures)].slice(0, 30)).toEqual([]);
});

test("all registered effects place finite variables across solo and music modes", () => {
    const music = { ...quietFeatures, velocity: 0.5, activity: 0.55, density: 0.5, sustain: 0.4, surge: 0.45, chord: 0.5, onset: 0.5 };
    const failures: string[] = [];
    for (const def of listVfxEffects()) {
        if (!def.emit) continue;
        for (const solo of [true, false]) {
            for (const phase of [0, 137, 359]) {
                const state = def.createState?.();
                const batch = def.emit({
                    params: {
                        color: "#8EB8FF",
                        color2: "#D6EAFF",
                        intensity: 0.72,
                        scale: 1,
                        zone: "stage",
                        motion: "normal",
                    },
                    music,
                    recentNotes: [{ midi: 48, velocity: 0.7, duration: 0.8, tick: 1 }],
                    lastNoteTick: 0,
                    instrument: "upright",
                    phase,
                    solo,
                    state,
                });
                for (const emitter of batch?.emitters ?? []) check(`effect ${def.id}`, emitter, 3.7, failures);
            }
        }
    }
    expect([...new Set(failures)].slice(0, 30)).toEqual([]);
});

test("all 7 stage themes place finite variables under unified VfxEngine", () => {
    const music = { ...quietFeatures, velocity: 0.5, activity: 0.62, density: 0.5, sustain: 0.5, surge: 0.6, chord: 0.6, onset: 0.6 };
    const failures: string[] = [];
    for (const { id: name, theme } of listVfxThemes()) {
        const engine = new VfxEngine(createThemeProgram(theme, { seconds: 24 }));
        for (let t = 0; t < 20; t += 0.15) {
            const tick = Math.round(t * 20);
            const batches = engine.update(t, tick, music, [{ midi: 60, velocity: 0.8, duration: 0.8, tick }]);
            for (const batch of batches) {
                for (const emitter of batch.emitters) check(`${name} ${emitter.group}/${emitter.particle}`, emitter, t, failures);
            }
        }
    }
    expect([...new Set(failures)].slice(0, 30)).toEqual([]);
});

test("all parameterized effects remain finite and within per-piano particle budget at min/max/alt extremes", () => {
    const music = { ...quietFeatures, velocity: 0.9, activity: 0.95, density: 0.9, sustain: 0.9, surge: 0.95, chord: 0.8, onset: 1 };
    const failures: string[] = [];
    for (const def of listVfxEffects()) {
        if (!def.parameters || !def.emit) continue;
        const minParams: Record<string, number | boolean | string> = {};
        const maxParams: Record<string, number | boolean | string> = {};
        for (const [key, spec] of Object.entries(def.parameters)) {
            if (spec.type === "boolean") {
                minParams[key] = false;
                maxParams[key] = true;
            } else if (spec.type === "enum") {
                minParams[key] = spec.options[0];
                maxParams[key] = spec.options[spec.options.length - 1];
            } else {
                minParams[key] = spec.min;
                maxParams[key] = spec.max;
            }
        }
        for (const [mode, custom] of [["min", minParams], ["max", maxParams]] as const) {
            const state = def.createState?.();
            const batch = def.emit({
                params: {
                    color: "#68E4FF",
                    color2: "#FFE29A",
                    intensity: 1,
                    scale: 1.7,
                    variant: def.variants?.[0],
                    zone: "stage",
                    motion: "intense",
                    custom,
                },
                music,
                recentNotes: [{ midi: 60, velocity: 1, duration: 1, tick: 1 }],
                lastNoteTick: 0,
                instrument: "grand",
                phase: 17,
                solo: false,
                state,
            });
            const emitters = batch?.emitters ?? [];
            const particles = emitters.reduce((sum, emitter) => sum + emitter.particles, 0);
            expect(particles).toBeLessThanOrEqual(VFX_PARTICLES_PER_PIANO);
            for (const emitter of emitters) {
                expect(emitter.lifetime).toBeGreaterThan(0);
                expect(emitter.lifetime).toBeLessThan(7);
                check(`${def.id}:${mode}`, emitter, 2.5, failures);
            }
        }
    }
    expect([...new Set(failures)].slice(0, 30)).toEqual([]);
});
