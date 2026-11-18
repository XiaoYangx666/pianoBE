import { expect, test } from "bun:test";
import { VFX_MAX_PIANOS, VFX_PARTICLES_PER_PIANO, VfxBudget } from "../src/domain/piano/vfxBudget";
import { VFX_EMITTERS_PER_TICK } from "../src/domain/piano/vfxLab";
import { simulatedVfxNotes, VfxMusic } from "../src/domain/piano/vfxMusic";
import { VFX_PRESETS, VfxPresetPlayer } from "../src/domain/piano/vfxPreset";

test("four staggered pianos share the real dispatch limits through the dense passage and release", () => {
    const pianos = ["galaxy", "neon", "stage", "galaxy"].map((name, i) => ({
        start: i * 13, budget: new VfxBudget(), player: new VfxPresetPlayer(VFX_PRESETS[name]), music: new VfxMusic(),
    }));
    expect(pianos).toHaveLength(VFX_MAX_PIANOS);
    let peakReserved = 0;
    let peakDispatch = 0;
    let emitted = 0;
    for (let tick = 0; tick < 1080; tick++) {
        let totalCalls = 0;
        let totalReserved = 0;
        for (const { start, budget, player, music } of pianos) {
            const elapsed = tick - start;
            budget.expire(tick);
            if (elapsed < 0) continue;
            for (const note of simulatedVfxNotes(tick, elapsed, "phrase")) music.note(note);
            if (elapsed % 4 === 0) budget.enqueue(player.update(elapsed, music.sample(tick)));
            let calls = 0;
            budget.dispatch(tick, () => calls++);
            expect(calls).toBeLessThanOrEqual(VFX_EMITTERS_PER_TICK);
            expect(budget.reserved).toBeWithin(0, VFX_PARTICLES_PER_PIANO + 1);
            expect(budget.dropped).toBe(0);
            totalCalls += calls;
            totalReserved += budget.reserved;
        }
        peakReserved = Math.max(peakReserved, totalReserved);
        peakDispatch = Math.max(peakDispatch, totalCalls);
        emitted += totalCalls;
    }
    expect(peakReserved).toBeGreaterThan(150);
    expect(peakDispatch).toBeLessThanOrEqual(VFX_MAX_PIANOS * VFX_EMITTERS_PER_TICK);
    expect(emitted).toBeGreaterThan(500);
    expect(pianos.every(({ budget }) => budget.reserved === 0)).toBe(true);
});
