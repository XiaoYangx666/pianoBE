import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { attachSongPerformance, SECRET_MUSIC_ID, SongCache } from "@piano/core";
import { grandDefinition, pianoDefinition } from "../src/domain/instrument/definition";
import { VFX_EMITTERS_PER_TICK } from "../src/domain/piano/vfxLab";
import { VfxBudget, VFX_PARTICLES_PER_PIANO } from "../src/domain/piano/vfxBudget";
import { SECRET_ARC_SAMPLES, SecretCinemaPlayer, secretScoreForSong } from "../src/domain/piano/secretCinema";
import { vfxStageFrame } from "../src/domain/piano/vfxStage";

const data = readFileSync(new URL("../../../midis/library/e1563b03.pbe3", import.meta.url));

async function createScore() {
    const bytes = attachSongPerformance(data, []);
    const handle = (await new SongCache(async () => bytes).acquire(SECRET_MUSIC_ID))!;
    expect(handle.song.header.performance).toBeUndefined();
    const score = secretScoreForSong(handle.song)!;
    expect(score.peaks).toEqual([72.05, 74.15]);
    return score;
}

test("runs the native Secret staging from plain song bytes through both accents and the tail", async () => {
    const score = await createScore();
    for (const definition of [grandDefinition, pianoDefinition]) {
        const player = new SecretCinemaPlayer(score, definition, 0, true);
        const budget = new VfxBudget();
        const emitted = new Map<string, number>();
        let peak = 0;
        let maximumCalls = 0;
        for (let tick = 0; tick <= (score.duration + 3) * 20; tick++) {
            budget.expire(tick);
            budget.enqueue(player.update(tick / 20));
            let calls = 0;
            budget.dispatch(tick, emitter => {
                calls++;
                const name = emitter.particle!;
                if (!Object.values(emitter.variables).every(Number.isFinite)) throw new Error(`Invalid ${name} parameters`);
                emitted.set(name, (emitted.get(name) ?? 0) + 1);
            });
            peak = Math.max(peak, budget.reserved);
            maximumCalls = Math.max(maximumCalls, calls);
        }
        expect(emitted.get("cinema_shock")).toBe(2);
        expect(emitted.get("cinema_filament")).toBeGreaterThan(4000);
        expect(emitted.get("cinema_note")).toBeGreaterThan(400);
        expect(emitted.get("cinema_dust")).toBeGreaterThan(65);
        expect(maximumCalls).toBeLessThanOrEqual(VFX_EMITTERS_PER_TICK);
        expect(peak).toBeLessThanOrEqual(VFX_PARTICLES_PER_PIANO);
        expect(budget.dropped).toBe(0);
        expect(budget.active).toBe(0);
    }
});

test("seeking into the break restores the spatial field and skips passed one-shots", async () => {
    const score = await createScore();
    const player = new SecretCinemaPlayer(score, grandDefinition, 72.2);
    const first = player.update(72.25).flatMap(batch => batch.emitters);
    const arc = first.find(emitter => emitter.particle === "cinema_filament")!;
    expect(arc.variables.length).toBeGreaterThan(0.12);
    expect(Math.hypot(arc.variables.x3, arc.variables.y3, arc.variables.z3)).toBeGreaterThan(0.1);
    expect(first.some(emitter => emitter.particle === "cinema_shock")).toBe(false);
    for (let tick = 1446; tick < 1483; tick++) player.update(tick / 20);
    expect(player.update(74.15).flatMap(batch => batch.emitters).map(emitter => emitter.particle)).toContain("cinema_shock");
    expect(player.update(74.15)).toEqual([]);
});

test("the arc samples tile both three-dimensional curves at the climactic radius", async () => {
    const score = await createScore();
    const curve = score.at(74.4);
    const player = new SecretCinemaPlayer({ ...score, at: () => ({ ...curve, recent: [] }) },
        grandDefinition, 75);
    const samples = [];
    for (let tick = 1; tick <= 20; tick++) {
        samples.push(...player.update(75 + tick / 20).flatMap(batch =>
            batch.emitters.filter(emitter => emitter.particle === "cinema_filament")));
    }
    const depth = vfxStageFrame(grandDefinition).depth;
    for (const [lane, count] of SECRET_ARC_SAMPLES.entries()) {
        const points = samples.filter((_, index) => index % 2 === lane).slice(0, count);
        expect(points).toHaveLength(count);
        for (let i = 1; i < points.length; i++) {
            const a = points[i - 1], b = points[i];
            const gap = Math.hypot(a.offset.x - b.offset.x, a.offset.y - b.offset.y, depth * (a.offset.z - b.offset.z));
            expect(gap).toBeGreaterThan(0.05);
            expect(gap).toBeLessThan((a.variables.length + b.variables.length) * 0.67);
            const aligned = (b.offset.x - a.offset.x) * a.variables.tx0 + (b.offset.y - a.offset.y) * a.variables.ty0
                + depth * (b.offset.z - a.offset.z) * a.variables.tz0;
            expect(aligned / gap).toBeGreaterThan(0.92);
        }
    }
});
