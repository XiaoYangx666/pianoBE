import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolvePerformanceColor } from "@piano/core";
import { VfxPerformancePlayer } from "@domain/piano/vfxPerformance";
import { VFX_PAINTERS, VFX_STAGE_THEMES, VfxThemePlayer } from "@domain/piano/vfxPainters";
import { placeVfxEmitter, vfxStageFrame } from "@domain/piano/vfxStage";
import { quietFeatures } from "@domain/piano/vfxMusic";
import type { VfxEmitter } from "@domain/piano/vfxLab";

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

test("e1563b03 performance places finite variables", () => {
    const source = JSON.parse(readFileSync(new URL("../../../midis/performances/e1563b03.json", import.meta.url), "utf8"));
    const instant = new Set(["floor_sweep", "shockwave", "prism_rewind", "firework_bloom"]);
    const cues = source.cues.map((cue: any) => {
        const base = {
            tick: Math.round(cue.at * 20),
            method: cue.method,
            slot: cue.slot,
            color: resolvePerformanceColor(cue.color),
            color2: cue.color2 ? resolvePerformanceColor(cue.color2) : undefined,
            brush: cue.brush,
            zone: cue.zone,
            motion: cue.motion,
            level: cue.level,
            scale: cue.scale,
        };
        return instant.has(cue.method) ? { ...base, op: "flash" as const }
            : { ...base, op: "set" as const, fade: Math.round((cue.fade ?? 1.5) * 20) };
    });
    const player = new VfxPerformancePlayer(cues, 87);
    const music = { ...quietFeatures, velocity: 0.5, activity: 0.6, density: 0.55, sustain: 0.5, surge: 0.6, chord: 0.6, onset: 0.55 };
    const failures: string[] = [];
    for (let t = 0; t <= 87; t += 0.1) {
        const notes = [{ midi: 60, velocity: 0.8, duration: 0.8, tick: Math.round(t * 20) }];
        const batches = player.update(t, music, true, notes, false);
        for (const batch of batches) for (const emitter of batch.emitters) check(`pbe3 ${emitter.effect}/${emitter.particle ?? ""}`, emitter, t, failures);
    }
    expect([...new Set(failures)].slice(0, 30)).toEqual([]);
});

test("all painters place finite variables", () => {
    const music = { ...quietFeatures, velocity: 0.5, activity: 0.55, density: 0.5, sustain: 0.4, surge: 0.45, chord: 0.5, onset: 0.5 };
    const failures: string[] = [];
    for (const [method, painter] of Object.entries(VFX_PAINTERS)) {
        if (method === "key_style") continue;
        for (const solo of [true, false]) {
            for (const phase of [0, 137, 359]) {
                const result = painter.emit({
                    color: "#8EB8FF", color2: "#D6EAFF", intensity: 0.72, scale: 1,
                    music, recentNotes: [{ midi: 48, velocity: 0.7, duration: 0.8, tick: 1 }],
                    lastNoteTick: 0, phase, solo,
                });
                for (const emitter of result.emitters) check(`painter ${method}`, emitter, 3.7, failures);
            }
        }
    }
    expect([...new Set(failures)].slice(0, 30)).toEqual([]);
});

test("stage themes place finite variables", () => {
    const music = { ...quietFeatures, velocity: 0.5, activity: 0.62, density: 0.5, sustain: 0.5, surge: 0.6, chord: 0.6, onset: 0.6 };
    const failures: string[] = [];
    for (const [name, theme] of Object.entries(VFX_STAGE_THEMES)) {
        const player = new VfxThemePlayer(theme);
        for (let t = 0; t < 20; t += 0.15) {
            const tick = Math.round(t * 20);
            const batches = player.update(tick, music, [{ midi: 60, velocity: 0.8, duration: 0.8, tick }], tick % 60 === 0);
            for (const batch of batches) for (const emitter of batch.emitters) check(`${name} ${emitter.effect}/${emitter.particle ?? ""}`, emitter, t, failures);
        }
    }
    expect([...new Set(failures)].slice(0, 30)).toEqual([]);
});
