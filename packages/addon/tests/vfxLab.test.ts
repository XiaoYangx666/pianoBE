import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { effectEmitters, parseVfxOptions, planVfxScene, VFX_EFFECTS, VFX_LIMITS,
    VFX_SCENES, VFX_EMITTERS_PER_TICK, type VfxEffect } from "../src/domain/piano/vfxLab";
import { vfxStageFrame } from "../src/domain/piano/vfxStage";
import { grandDefinition, pianoDefinition } from "../src/domain/instrument/definition";

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

test("wave closes around the instrument and seat without filling the middle", () => {
    const wave = planVfxScene("wave").filter(cue => cue.tick < 20).flatMap(cue => cue.emitters);
    const center = wave.filter(emitter => emitter.offset.y === 1.19);
    expect(center).toHaveLength(36);
    expect(wave.slice(0, 3).map(emitter => emitter.variables.phase)).toEqual([-37, 0, 37]);
    expect(wave.every(emitter => Math.hypot(emitter.offset.x, emitter.offset.z) > 1.7 &&
        emitter.variables.radius <= 0.16)).toBe(true);
    for (const definition of [pianoDefinition, grandDefinition]) {
        const stage = vfxStageFrame(definition);
        const depths = center.map(emitter => stage.centerZ + stage.depth * emitter.offset.z);
        expect(Math.min(...depths)).toBeLessThan(-1.4);
        expect(Math.max(...depths)).toBeGreaterThan(definition === grandDefinition ? 4.45 : 0.45);
    }
});

test("beam can emit a straight strip; default tracks sweep both the seat and cabinet sides", () => {
    const beam = planVfxScene("beam", { lanes: 1, segments: 1, bend: 0, heading: 90 }).flatMap(cue => cue.emitters);
    expect(beam).toHaveLength(2);
    expect(beam[0].variables.dir_z).toBeCloseTo(1);
    expect(beam[0].variables.bend).toBe(0);
    expect(beam[0].variables.around).toBe(0);
    const demo = planVfxScene("demo").flatMap(cue => cue.emitters.map(emitter => ({ ...emitter, tick: cue.tick })));
    expect([...new Set(demo.map(emitter => emitter.effect))]).toEqual(["field", "wave", "beam"]);
    expect(demo.at(-1)?.effect).toBe("field");
    expect(demo.filter(emitter => emitter.effect === "beam" && emitter.tick >= 230 && emitter.tick < 245)).toHaveLength(18);
    const tracks = demo.filter(emitter => emitter.effect === "beam");
    expect(tracks.every(emitter => emitter.variables.around === 1)).toBe(true);
    const depths = tracks.flatMap(({ variables }) => Array.from({ length: 17 }, (_, i) => {
        const angle = (variables.arc_phase + variables.arc_sweep * i / 16) * Math.PI / 180;
        return Math.sin(angle) * variables.arc_radius * (0.77 + 0.1 * Math.abs(variables.bend));
    }));
    expect(Math.min(...depths)).toBeLessThan(-1.7);
    expect(Math.max(...depths)).toBeGreaterThan(1.7);
    for (const effect of ["fountain", "curtain"] as const) {
        const offsets = effectEmitters(effect, {}).map(emitter => emitter.offset);
        expect(offsets.some(position => position.x < -1.5)).toBe(true);
        expect(offsets.some(position => position.x > 1.5)).toBe(true);
    }
});

test("particle documents reference the original atlas and declare only supplied or engine variables", () => {
    const resource = new URL("../rp/", import.meta.url);
    const atlas = readFileSync(new URL("textures/particle/vfx_lab.png", resource));
    expect(atlas.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    const width = atlas.readUInt32BE(16);
    const height = atlas.readUInt32BE(20);
    expect(atlas[25]).toBe(6);
    const textureSet = JSON.parse(readFileSync(new URL("textures/particle/vfx_lab.texture_set.json", resource), "utf8"));
    expect(textureSet["minecraft:texture_set"]).toEqual({ color: "vfx_lab", metalness_emissive_roughness: "vfx_lab_mer" });
    const mer = readFileSync(new URL("textures/particle/vfx_lab_mer.png", resource));
    expect([mer.readUInt32BE(16), mer.readUInt32BE(20), mer[25]]).toEqual([width, height, 2]);
    // The original atlas generator emits one IDAT with unfiltered RGB rows.
    expect(mer.toString("ascii", 37, 41)).toBe("IDAT");
    const emissive = inflateSync(mer.subarray(41, 41 + mer.readUInt32BE(33)));
    const green = (x: number, y: number) => emissive[y * (width * 3 + 1) + x * 3 + 2];
    expect(green(172, 72)).toBeGreaterThan(125);
    expect(green(80, 16)).toBeWithin(35, 64);
    expect(green(0, 48)).toBe(0);
    for (const effect of Object.keys(VFX_EFFECTS) as VfxEffect[]) {
        const source = readFileSync(new URL(`particles/pbe_vfx_${effect}.particle.json`, resource), "utf8");
        const document = JSON.parse(source).particle_effect;
        expect(document.description.identifier).toBe(`pbe:vfx_${effect}`);
        expect(document.description.basic_render_parameters.texture).toBe("textures/particle/vfx_lab");
        const billboard = document.components["minecraft:particle_appearance_billboard"];
        const uv = billboard.uv;
        if (effect === "beam" || effect === "shaft") {
            expect(billboard.direction.mode).toBe("custom");
            expect(billboard.direction.custom_direction).toHaveLength(3);
        }
        expect([uv.texture_width, uv.texture_height]).toEqual([width, height]);
        // Generated atlas switches list literal alternatives in descending variant order.
        function coordinate(value: number | string, variant: number) {
            if (typeof value === "number") return value;
            const choices = [...value.matchAll(/\? (\d+)|: (\d+)\)*$/g)]
                .map(match => Number(match[1] ?? match[2])).reverse();
            expect(choices.length).toBeGreaterThan(1);
            return choices[Math.min(variant, choices.length - 1)];
        }
        for (const variant of [0, 1, 2]) {
            const [u, v] = uv.uv.map((value: number | string) => coordinate(value, variant));
            const [w, h] = uv.uv_size.map((value: number | string) => coordinate(value, variant));
            expect(u + w).toBeLessThanOrEqual(width);
            expect(v + h).toBeLessThanOrEqual(height);
        }
        const variables = new Set(Object.keys(effectEmitters(effect, {})[0].variables));
        variables.add("right_x").add("right_z").add("scale").add("stage_depth");
        for (const match of source.matchAll(/variable\.vfx_(\w+)/g)) expect(variables.has(match[1])).toBe(true);
        for (const match of source.matchAll(/variable\.(?!vfx_)(\w+)/g)) {
            expect(/^(particle_age|particle_lifetime|particle_random_[1-4])$/.test(match[1])).toBe(true);
        }
    }
});

test("generic draw primitives reference the 1024x1024 atlas, valid brush UVs and custom direction", () => {
    const resource = new URL("../rp/", import.meta.url);
    const atlas = readFileSync(new URL("textures/particle/vfx_lab.png", resource));
    const width = atlas.readUInt32BE(16);
    const height = atlas.readUInt32BE(20);
    expect([width, height]).toEqual([1024, 1024]);

    const allowedPointVars = new Set([
        "count", "life", "life_jitter", "brush", "spin", "spin_jitter", "spin_rate",
        "phase", "phase_spread", "omega", "radius", "radius_end", "curve", "radial_jitter",
        "depth_ratio", "tilt", "rise", "flutter", "spread_x", "spread_y", "spread_z",
        "vx", "vy", "vz", "ax", "ay", "az", "size", "size_end", "size_jitter",
        "red", "green", "blue", "red2", "green2", "blue2", "opacity", "fade_in", "fade_out", "twinkle",
        "right_x", "right_z", "scale", "stage_depth",
    ]);
    const allowedStrokeVars = new Set([
        "count", "life", "brush", "length", "length_end", "width",
        "vx", "vy", "vz", "ax", "ay", "az", "tx", "ty", "tz",
        "red", "green", "blue", "red2", "green2", "blue2", "opacity", "fade_in", "fade_out",
        "right_x", "right_z", "scale", "stage_depth",
    ]);
    const allowedPlaneVars = new Set([
        "life", "spin", "spin_rate", "vy", "radius_start", "radius_end", "curve", "style",
        "red", "green", "blue", "red2", "green2", "blue2", "opacity", "fade_in", "fade_out",
        "right_x", "right_z", "scale", "stage_depth",
    ]);

    const specs = [
        ["draw_point", allowedPointVars],
        ["draw_stroke", allowedStrokeVars],
        ["draw_plane", allowedPlaneVars],
    ] as const;

    for (const [name, allowedVars] of specs) {
        const source = readFileSync(new URL(`particles/pbe_vfx_${name}.particle.json`, resource), "utf8");
        const doc = JSON.parse(source).particle_effect;
        expect(doc.description.identifier).toBe(`pbe:vfx_${name}`);
        expect(doc.description.basic_render_parameters.texture).toBe("textures/particle/vfx_lab");
        const billboard = doc.components["minecraft:particle_appearance_billboard"];
        const uv = billboard.uv;
        expect([uv.texture_width, uv.texture_height]).toEqual([width, height]);
        if (name === "draw_stroke") {
            expect(billboard.facing_camera_mode).toBe("direction_x");
            expect(billboard.direction.mode).toBe("custom");
            expect(billboard.direction.custom_direction).toHaveLength(3);
            expect(uv.uv[1]).toBe(896);
            expect(uv.uv_size).toEqual([256, 96]);
            for (let b = 0; b <= 3; b++) {
                expect(b * 256 + 256).toBeLessThanOrEqual(width);
                expect(896 + 96).toBeLessThanOrEqual(height);
            }
        } else if (name === "draw_point") {
            expect(uv.uv_size).toEqual([128, 128]);
            expect(String(uv.uv[1])).toContain("768");
            expect(String(uv.uv[1])).toContain("640");
            for (let b = 0; b <= 7; b++) {
                expect(b * 128 + 128).toBeLessThanOrEqual(width);
                expect(768 + 128).toBeLessThanOrEqual(height);
            }
            expect(256 + 128).toBeLessThanOrEqual(width);
            expect(640 + 128).toBeLessThanOrEqual(height);
        } else {
            expect(billboard.facing_camera_mode).toBe("emitter_transform_xz");
            for (const val of [uv.uv_size[0], uv.uv_size[1]]) {
                expect(typeof val === "string" || typeof val === "number").toBe(true);
            }
        }
        for (const match of source.matchAll(/variable\.vfx_(\w+)/g)) expect(allowedVars.has(match[1])).toBe(true);
        for (const match of source.matchAll(/variable\.(?!vfx_)(\w+)/g)) {
            expect(/^(particle_age|particle_lifetime|particle_random_[1-4])$/.test(match[1])).toBe(true);
        }
    }
});
