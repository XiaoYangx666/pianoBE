import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PERFORMANCE_LAYERS, readSongHeader, songToNoteEvents, TIME_SCALE } from "@piano/core";
import { VFX_MAX_PIANOS, VFX_PARTICLES_PER_PIANO, VfxBudget } from "../src/domain/piano/vfxBudget";
import { VFX_EMITTERS_PER_TICK } from "../src/domain/piano/vfxLab";
import { quietFeatures, VfxMusic } from "../src/domain/piano/vfxMusic";
import { VfxPerformancePlayer } from "../src/domain/piano/vfxPerformance";

const { moonDust, goldSparks } = PERFORMANCE_LAYERS;

test("seeking into an in-flight transition reconstructs its partial state and skips old flashes", () => {
    const player = new VfxPerformancePlayer([
        { tick: 0, layer: moonDust, level: 100, scale: 140, op: "set", fade: 400 },
        { tick: 80, layer: goldSparks, level: 100, scale: 100, op: "flash" },
        { tick: 320, layer: goldSparks, level: 100, scale: 100, op: "flash" },
    ], 11);
    const first = player.update(2, quietFeatures);
    expect(first.flatMap(batch => batch.emitters).map(emitter => emitter.effect)).toContain("fountain");
    player.seek(5);
    const midway = player.update(5, quietFeatures).flatMap(batch => batch.emitters);
    expect(midway.map(emitter => emitter.effect)).toEqual(["field"]);
    player.seek(10);
    const full = player.update(10, quietFeatures).flatMap(batch => batch.emitters);
    expect(full[0].variables.opacity).toBeGreaterThan(midway[0].variables.opacity);
    expect(midway[0].variables.opacity / full[0].variables.opacity).toBeCloseTo(0.5);
    player.seek(8);
    expect(player.update(8, quietFeatures).flatMap(batch => batch.emitters).map(emitter => emitter.effect))
        .not.toContain("fountain");
    player.seek(7.95);
    expect(player.update(8, quietFeatures).flatMap(batch => batch.emitters).map(emitter => emitter.effect))
        .toContain("fountain");
    expect(player.update(8, quietFeatures)).toEqual([]);
});

test("four staggered Secret performances complete within the dispatch and particle budgets", () => {
    const data = readFileSync(new URL("../../../midis/library/e1563b03.pbe3", import.meta.url));
    const { duration, performance } = readSongHeader(data);
    expect(performance).toBeDefined();
    const notes = new Map<number, ReturnType<typeof songToNoteEvents>>();
    for (const note of songToNoteEvents(data)) {
        const tick = Math.round(note.time * 20);
        const group = notes.get(tick) ?? [];
        group.push(note);
        notes.set(tick, group);
    }
    const seconds = duration / TIME_SCALE;
    const pianos = Array.from({ length: VFX_MAX_PIANOS }, (_, offset) => ({
        start: offset * 13, budget: new VfxBudget(), music: new VfxMusic(),
        player: new VfxPerformancePlayer(performance!, seconds), sparks: 0, shardEmitters: 0,
    }));
    let peakReserved = 0;
    let peakCalls = 0;
    for (let tick = 0; tick < seconds * 20 + 180; tick++) {
        let totalCalls = 0;
        for (const piano of pianos) {
            const elapsed = tick - piano.start;
            piano.budget.expire(tick);
            if (elapsed < 0) continue;
            for (const note of notes.get(elapsed) ?? []) piano.music.note({
                midi: note.midi, duration: note.duration, tick, velocity: Math.round(note.velocity * 127),
                source: "midi", hasVelocity: true, songTime: note.time,
            });
            piano.budget.enqueue(piano.player.update(elapsed / 20, piano.music.sample(tick)));
            let count = 0;
            piano.budget.dispatch(tick, emitter => {
                count++;
                if (emitter.effect === "fountain") piano.sparks++;
                if (emitter.effect === "shard") piano.shardEmitters++;
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
    for (const { budget, sparks, shardEmitters } of pianos) {
        expect(sparks).toBe(2);
        expect(shardEmitters).toBe(36);
        expect(budget.dropped).toBe(0);
        expect(budget.reserved).toBe(0);
    }
});
