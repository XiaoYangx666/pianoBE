import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import {
    createSingleEffectProgram,
    POINT_BRUSH_IDS,
    quietFeatures,
    STROKE_BRUSH_IDS,
    VFX_ATLAS,
    VFX_EFFECTS,
    VfxEngine,
    vfxStageFrame,
    type VfxParticle,
} from "../src";

const ALL_VFX_PARTICLES: readonly VfxParticle[] = [
    "field",
    "wave",
    "beam",
    "ripple",
    "fountain",
    "curtain",
    "orbit",
    "shaft",
    "shaft_upright",
    "shard",
    "draw_point",
    "draw_stroke",
    "draw_plane",
    "draw_cloud",
    "draw_comet",
    "key_stream",
    "key_drift",
    "dust",
    "shock",
];

test("single vfx_lab atlas and MER textures match declared dimensions without secret_cinema leftovers", () => {
    const resource = new URL("../assets/", import.meta.url);
    expect(existsSync(new URL("textures/particle/secret_cinema.png", resource))).toBe(false);
    expect(existsSync(new URL("textures/particle/secret_cinema.texture_set.json", resource))).toBe(false);
    expect(existsSync(new URL("particles/pbe_vfx_cinema_dust.particle.json", resource))).toBe(false);
    expect(existsSync(new URL("particles/pbe_vfx_cinema_shock.particle.json", resource))).toBe(false);

    const atlas = readFileSync(new URL("textures/particle/vfx_lab.png", resource));
    expect(atlas.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    const width = atlas.readUInt32BE(16);
    const height = atlas.readUInt32BE(20);
    expect([width, height]).toEqual([VFX_ATLAS.width, VFX_ATLAS.height]);
    expect(atlas[25]).toBe(6);

    const textureSet = JSON.parse(readFileSync(new URL("textures/particle/vfx_lab.texture_set.json", resource), "utf8"));
    expect(textureSet["minecraft:texture_set"]).toEqual({ color: "vfx_lab", metalness_emissive_roughness: "vfx_lab_mer" });

    const mer = readFileSync(new URL("textures/particle/vfx_lab_mer.png", resource));
    expect([mer.readUInt32BE(16), mer.readUInt32BE(20), mer[25]]).toEqual([width, height, 2]);
    expect(mer.toString("ascii", 37, 41)).toBe("IDAT");
    const emissive = inflateSync(mer.subarray(41, 41 + mer.readUInt32BE(33)));
    const green = (x: number, y: number) => emissive[y * (width * 3 + 1) + x * 3 + 2];
    expect(green(172, 72)).toBeGreaterThan(125);
    expect(green(80, 16)).toBeWithin(35, 64);
    expect(green(0, 48)).toBe(0);
});

test("all 19 pbe_vfx particle definitions use vfx_lab 1024x1024 atlas and clean Molang variables", () => {
    const resource = new URL("../assets/", import.meta.url);
    for (const particle of ALL_VFX_PARTICLES) {
        const source = readFileSync(new URL(`particles/pbe_vfx_${particle}.particle.json`, resource), "utf8");
        const doc = JSON.parse(source).particle_effect;
        expect(doc.description.identifier).toBe(`pbe:vfx_${particle}`);
        expect(doc.description.basic_render_parameters.texture).toBe(VFX_ATLAS.texture);
        const billboard = doc.components["minecraft:particle_appearance_billboard"];
        const uv = billboard.uv;
        expect([uv.texture_width, uv.texture_height]).toEqual([VFX_ATLAS.width, VFX_ATLAS.height]);

        if (particle === "beam" || particle === "shaft" || particle === "draw_stroke" || particle === "draw_comet") {
            expect(billboard.direction.mode).toBe("custom");
            expect(billboard.direction.custom_direction).toHaveLength(3);
        }
        if (particle === "draw_point") {
            const { originX, originY, cellSize, cols, rows } = VFX_ATLAS.pointBrushGrid;
            expect(uv.uv_size).toEqual([cellSize, cellSize]);
            expect(String(uv.uv[0])).toContain("math.mod");
            expect(String(uv.uv[1])).toContain("math.floor");
            for (let b = 0; b < POINT_BRUSH_IDS.length; b++) {
                const u = originX + (b % cols) * cellSize;
                const v = originY + Math.floor(b / cols) * cellSize;
                expect(u + cellSize).toBeLessThanOrEqual(VFX_ATLAS.width);
                expect(v + cellSize).toBeLessThanOrEqual(originY + rows * cellSize);
            }
        }
        if (particle === "draw_stroke") {
            const { originX, originY, cellWidth, cellHeight } = VFX_ATLAS.strokeBrushStrip;
            expect(billboard.facing_camera_mode).toBe("direction_x");
            expect(uv.uv[1]).toBe(originY);
            expect(uv.uv_size).toEqual([cellWidth, cellHeight]);
            for (let b = 0; b < STROKE_BRUSH_IDS.length; b++) {
                expect(originX + (b + 1) * cellWidth).toBeLessThanOrEqual(VFX_ATLAS.width);
                expect(originY + cellHeight).toBeLessThanOrEqual(VFX_ATLAS.height);
            }
        }
        if (particle === "draw_plane") {
            expect(billboard.facing_camera_mode).toBe("emitter_transform_xz");
        }
        for (const match of source.matchAll(/variable\.(?!vfx_)(\w+)/g)) {
            expect(/^(particle_age|particle_lifetime|particle_random_[1-4])$/.test(match[1])).toBe(true);
        }
    }
});

test("stage frame adapts to upright vs grand piano and emitters surround the instrument cleanly", () => {
    const upright = vfxStageFrame("upright");
    const grand = vfxStageFrame("grand");
    expect(grand.depth).toBeGreaterThan(upright.depth);

    const waveEngine = new VfxEngine(createSingleEffectProgram({
        effect: "wave_ribbon",
        variant: "ribbon",
        color: "#68E4FF",
        level: 85,
    }));
    const wave = waveEngine.update(0, 0, { ...quietFeatures, activity: 0.7 }).flatMap(batch => batch.emitters);
    expect(wave.some(emitter => emitter.offset.y > 0.5)).toBe(true);

    const wingOffsets = VFX_EFFECTS.wing_ribbons.emit!({
        params: { color: "#90C8FF", color2: "#C58CFF", intensity: 0.8, scale: 1, zone: "stage", motion: "normal" },
        music: { ...quietFeatures, surge: 0.7, sustain: 0.6 },
        recentNotes: [],
        lastNoteTick: -1,
        phase: 0,
        solo: false,
        state: VFX_EFFECTS.wing_ribbons.createState?.(),
    })!.emitters.map(emitter => emitter.offset);
    expect(wingOffsets.some(offset => offset.x < -1.5)).toBe(true);
    expect(wingOffsets.some(offset => offset.x > 1.5)).toBe(true);

    const depths = VFX_EFFECTS.magic_circle.emit!({
        params: { color: "#68E4FF", color2: "#C58CFF", intensity: 0.8, scale: 1, zone: "stage", motion: "normal" },
        music: quietFeatures,
        recentNotes: [],
        lastNoteTick: -1,
        phase: 0,
        solo: false,
        state: VFX_EFFECTS.magic_circle.createState?.(),
    })!.emitters.map(emitter => grand.centerZ + grand.depth * emitter.offset.z);
    expect(Math.min(...depths)).toBeLessThan(0);
    expect(Math.max(...depths)).toBeGreaterThan(3);
});
