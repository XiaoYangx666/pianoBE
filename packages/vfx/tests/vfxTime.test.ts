import { beforeEach, describe, expect, test } from "bun:test";
import {
    createSingleEffectProgram,
    hostTickAt,
    quietFeatures,
    simulatedVfxNotes,
    timelineTickAt,
    VfxEngine,
    VfxMusic,
} from "../src";
import { ensureBuiltinPluginsRegistered } from "./helpers/builtinPlugins";
import { tt } from "./helpers/time";

ensureBuiltinPluginsRegistered();
beforeEach(ensureBuiltinPluginsRegistered);

describe("VFX time domains", () => {
    test("timeline conversion is centralized and host ticks reject fractional values", () => {
        expect(timelineTickAt(2.5)).toBe(50);
        expect(timelineTickAt(2.5 + 1e-9)).toBe(50);
        expect(timelineTickAt(-0.05)).toBe(-1);
        expect(hostTickAt(120)).toBe(120);
        expect(() => hostTickAt(1.5)).toThrow(RangeError);
        expect(() => hostTickAt(Number.NaN)).toThrow(RangeError);
    });

    test("music rejects a backward timeline instead of silently mixing clocks", () => {
        const music = new VfxMusic();
        music.note({
            midi: 60,
            velocity: 100,
            duration: 1,
            timelineTick: tt(20),
            source: "midi",
            hasVelocity: true,
        });
        music.sample(tt(20));
        expect(() => music.sample(tt(19))).toThrow(/backwards/i);
        expect(() => music.note({
            midi: 62,
            velocity: 100,
            duration: 1,
            timelineTick: tt(19),
            source: "midi",
            hasVelocity: true,
        })).toThrow(/backwards/i);

        music.transport({ type: "seek", position: 1 });
        expect(() => music.sample(tt(19))).not.toThrow();

        music.clear();
        music.note({
            midi: 64,
            velocity: 100,
            duration: 1,
            timelineTick: tt(21),
            source: "midi",
            hasVelocity: true,
        });
        // Clearing transients must not reuse note identity under an existing engine.
        expect(music.recent(tt(21)).at(-1)?.sequence).toBeGreaterThan(1);
    });

    test("the engine requires an explicit seek before replaying an earlier position", () => {
        const engine = new VfxEngine(createSingleEffectProgram({
            effect: "wave_ribbon",
            variant: "ribbon",
            color: "#68E4FF",
            level: 85,
        }));
        engine.update(2, quietFeatures);
        expect(() => engine.update(1.9, quietFeatures)).toThrow(/seek/i);
        engine.seek(1.9, true);
        expect(() => engine.update(1.95, quietFeatures)).not.toThrow();
    });

    test("simulated notes derive all timing from one timeline tick", () => {
        const first = simulatedVfxNotes(tt(44), "phrase");
        const second = simulatedVfxNotes(tt(44), "phrase");
        expect(second).toEqual(first);
        expect(first.every(note => note.timelineTick === tt(44))).toBe(true);
    });
});
