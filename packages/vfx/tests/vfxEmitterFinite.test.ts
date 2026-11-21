import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolvePerformanceColor } from "@piano/core";
import {
    createPerformanceProgram,
    createThemeProgram,
    placeVfxEmitter,
    quietFeatures,
    VFX_EFFECT_IDS,
    VFX_EFFECTS,
    VFX_THEME_ORDER,
    VFX_THEMES,
    VfxEngine,
    vfxStageFrame,
    type VfxEmitter,
} from "../src";

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

function parseJsonPerformanceCues(source: any) {
    return source.cues.map((cue: any) => {
        const def = VFX_EFFECTS[cue.effect as keyof typeof VFX_EFFECTS];
        const base = {
            tick: Math.round(cue.at * 40),
            effect: cue.effect as string,
            slot: cue.slot,
            color: resolvePerformanceColor(cue.color),
            color2: cue.color2 ? resolvePerformanceColor(cue.color2) : undefined,
            brush: cue.brush,
            variant: cue.variant,
            zone: cue.zone,
            motion: cue.motion,
            level: cue.level,
            scale: cue.scale,
        };
        return cue.op === "flash" || def?.trigger === "instant"
            ? { ...base, op: "flash" as const }
            : { ...base, op: "set" as const, fade: Math.round((cue.fade ?? 1.5) * 40) };
    });
}

test("all performance JSON cues place finite variables through unified VfxEngine", () => {
    const songs = [
        ["e1563b03", 87, 0.1],
        ["c8159589", 317, 0.2],
        ["b0cae095", 385, 0.25],
    ] as const;
    const music = { ...quietFeatures, velocity: 0.55, activity: 0.6, density: 0.55, sustain: 0.5, surge: 0.6, chord: 0.6, onset: 0.55 };
    const failures: string[] = [];

    for (const [id, duration, step] of songs) {
        const source = JSON.parse(readFileSync(new URL(`../../../midis/performances/${id}.json`, import.meta.url), "utf8"));
        const engine = new VfxEngine(createPerformanceProgram(parseJsonPerformanceCues(source), duration));
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

test("all 33 effects place finite variables across solo and music modes", () => {
    const music = { ...quietFeatures, velocity: 0.5, activity: 0.55, density: 0.5, sustain: 0.4, surge: 0.45, chord: 0.5, onset: 0.5 };
    const failures: string[] = [];
    for (const id of VFX_EFFECT_IDS) {
        const def = VFX_EFFECTS[id];
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
                    phase,
                    solo,
                    state,
                });
                for (const emitter of batch?.emitters ?? []) check(`effect ${id}`, emitter, 3.7, failures);
            }
        }
    }
    expect([...new Set(failures)].slice(0, 30)).toEqual([]);
});

test("all 7 stage themes place finite variables under unified VfxEngine", () => {
    const music = { ...quietFeatures, velocity: 0.5, activity: 0.62, density: 0.5, sustain: 0.5, surge: 0.6, chord: 0.6, onset: 0.6 };
    const failures: string[] = [];
    for (const name of VFX_THEME_ORDER) {
        const engine = new VfxEngine(createThemeProgram(VFX_THEMES[name], { seconds: 24 }));
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
