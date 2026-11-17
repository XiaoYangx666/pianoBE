import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseVfxOptions, planVfxScene, VFX_LIMITS, VFX_SCENES, VFX_EMITTERS_PER_TICK } from "../src/domain/piano/vfxLab";

test("Lab rejects malformed, non-finite, out-of-range and unknown options", () => {
    expect(parseVfxOptions('{"range":1.4,"waveColor":"#2ED9FF","lanes":1}')).toEqual({
        range: 1.4, waveColor: "#2ED9FF", lanes: 1,
    });
    for (const input of ["null", "[]", '{"range":1e400}', '{"speed":0}', '{"width":"0.1"}',
        '{"lanes":1.5}', '{"fieldColor":"red"}', '{"unknown":1}', '{"__proto__":{}}']) {
        expect(() => parseVfxOptions(input)).toThrow();
    }
});

test("every scene stays inside its tick and particle budgets at maximum settings", () => {
    const options = Object.fromEntries(Object.entries(VFX_LIMITS).map(([key, [, maximum]]) => [key, maximum]));
    options.speed = VFX_LIMITS.speed[0];
    const stats = VFX_SCENES.map(scene => {
        const cues = planVfxScene(scene, options);
        let lastTick = -1;
        let peak = 0;
        let live: { expires: number; particles: number }[] = [];
        for (const cue of cues) {
            expect(cue.tick).toBeGreaterThan(lastTick);
            expect(cue.emitters.length).toBeLessThanOrEqual(VFX_EMITTERS_PER_TICK);
            lastTick = cue.tick;
            live = live.filter(entry => entry.expires > cue.tick);
            for (const emitter of cue.emitters) {
                expect(Object.values(emitter.variables).every(Number.isFinite)).toBe(true);
                expect(emitter.lifetime + 0.1).toBeLessThan(7);
                live.push({ expires: cue.tick + Math.ceil(emitter.lifetime * 20) + 2, particles: emitter.particles });
            }
            peak = Math.max(peak, live.reduce((sum, entry) => sum + entry.particles, 0));
        }
        return peak;
    });
    expect(Math.max(...stats)).toBeLessThanOrEqual(275);
});

test("wave covers every center column and offsets its two inner layers in depth and phase", () => {
    const wave = planVfxScene("wave").filter(cue => cue.tick < 20).flatMap(cue => cue.emitters);
    const columns = [...new Set(wave.map(emitter => emitter.offset.x))];
    expect(columns).toHaveLength(21);
    expect(columns[0]).toBeCloseTo(-2.75);
    expect(columns.at(-1)).toBeCloseTo(2.75);
    expect(columns.slice(1).every((x, i) => Math.abs(x - columns[i] - 0.275) < 1e-8)).toBe(true);
    const center = wave.filter(emitter => emitter.offset.x === 0);
    expect(center.map(emitter => emitter.variables.phase)).toEqual([-37, 0, 37]);
    expect(center[0].offset.z).toBeLessThan(center[1].offset.z);
    expect(center[1].offset.z).toBeLessThan(center[2].offset.z);
});

test("beam can emit a single straight strip and demo enters each layer in order", () => {
    const beam = planVfxScene("beam", { lanes: 1, segments: 1, bend: 0, heading: 90 }).flatMap(cue => cue.emitters);
    expect(beam).toHaveLength(2);
    expect(beam[0].variables.dir_z).toBeCloseTo(1);
    expect(beam[0].variables.bend).toBe(0);
    const demo = planVfxScene("demo").flatMap(cue => cue.emitters.map(emitter => ({ ...emitter, tick: cue.tick })));
    expect([...new Set(demo.map(emitter => emitter.effect))]).toEqual(["field", "wave", "beam"]);
    expect(demo.at(-1)?.effect).toBe("field");
    expect(demo.filter(emitter => emitter.effect === "beam" && emitter.tick >= 230 && emitter.tick < 245)).toHaveLength(18);
});

test("particle documents reference the original atlas and declare only supplied or engine variables", () => {
    const resource = new URL("../rp/", import.meta.url);
    const atlas = readFileSync(new URL("textures/particle/vfx_lab.png", resource));
    expect(atlas.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    const width = atlas.readUInt32BE(16);
    const height = atlas.readUInt32BE(20);
    expect(atlas[25]).toBe(6);
    const build = planVfxScene("demo").flatMap(cue => cue.emitters);
    for (const effect of ["field", "wave", "beam"]) {
        const source = readFileSync(new URL(`particles/pbe_vfx_${effect}.particle.json`, resource), "utf8");
        const document = JSON.parse(source).particle_effect;
        expect(document.description.identifier).toBe(`pbe:vfx_${effect}`);
        expect(document.description.basic_render_parameters.texture).toBe("textures/particle/vfx_lab");
        const uv = document.components["minecraft:particle_appearance_billboard"].uv;
        expect([uv.texture_width, uv.texture_height]).toEqual([width, height]);
        const origins = effect === "field" ? [[0, 0], [32, 0]] : [uv.uv];
        for (const [u, v] of origins) {
            expect(u + uv.uv_size[0]).toBeLessThanOrEqual(width);
            expect(v + uv.uv_size[1]).toBeLessThanOrEqual(height);
        }
        const variables = new Set(Object.keys(build.find(emitter => emitter.effect === effect)!.variables));
        variables.add("right_x").add("right_z");
        for (const match of source.matchAll(/variable\.vfx_(\w+)/g)) expect(variables.has(match[1])).toBe(true);
        for (const match of source.matchAll(/variable\.(?!vfx_)(\w+)/g)) {
            expect(/^(particle_age|particle_lifetime|particle_random_[1-4])$/.test(match[1])).toBe(true);
        }
    }
});
