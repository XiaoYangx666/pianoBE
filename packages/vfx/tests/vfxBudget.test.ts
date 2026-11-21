import { expect, test } from "bun:test";
import {
    createThemeProgram,
    simulatedVfxNotes,
    VFX_EMITTERS_PER_TICK,
    VFX_MAX_PIANOS,
    VFX_PARTICLES_PER_PIANO,
    VFX_THEME_ORDER,
    VFX_THEMES,
    VfxBudget,
    VfxEngine,
    VfxMusic,
} from "../src";

test("four staggered pianos share the real dispatch limits across all built-in themes with zero drops", () => {
    for (const name of VFX_THEME_ORDER) {
        const pianos = Array.from({ length: VFX_MAX_PIANOS }, (_, i) => ({
            start: i * 13,
            budget: new VfxBudget(),
            engine: new VfxEngine(createThemeProgram(VFX_THEMES[name], { seconds: 32 })),
            music: new VfxMusic(),
        }));
        expect(pianos).toHaveLength(VFX_MAX_PIANOS);

        let peakReserved = 0;
        let peakDispatch = 0;
        let emitted = 0;
        for (let tick = 0; tick < 1080; tick++) {
            let totalCalls = 0;
            let totalReserved = 0;
            for (const { start, budget, engine, music } of pianos) {
                const elapsed = tick - start;
                budget.expire(tick);
                if (elapsed < 0) continue;
                for (const note of simulatedVfxNotes(tick, elapsed, "phrase")) music.note(note);
                const features = music.sample(tick);
                budget.enqueue(engine.update(elapsed / 20, elapsed, features, music.recent()));
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
        expect(peakReserved).toBeGreaterThan(15);
        expect(peakDispatch).toBeLessThanOrEqual(VFX_MAX_PIANOS * VFX_EMITTERS_PER_TICK);
        expect(emitted).toBeGreaterThan(250);
        expect(pianos.every(({ budget }) => budget.reserved === 0)).toBe(true);
    }
});
