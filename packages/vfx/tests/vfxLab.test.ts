import { beforeEach, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import {
    createSingleEffectProgram,
    getVfxEffect,
    POINT_BRUSH_IDS,
    quietFeatures,
    STROKE_BRUSH_IDS,
    VFX_ATLAS,
    VfxEngine,
    vfxStageFrame,
    type VfxParticle,
} from "../src";
import { ensureBuiltinPluginsRegistered, readParticleDoc } from "./helpers/builtinPlugins";

ensureBuiltinPluginsRegistered();
beforeEach(ensureBuiltinPluginsRegistered);

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
    "key_blue_tears",
    "magic_trail",
    "dust",
    "shock",
];

test("single vfx_lab atlas and MER textures match declared dimensions without secret_cinema leftovers", () => {
    const resource = new URL("../assets/", import.meta.url);
    const keysPluginAssets = new URL("../../../plugins/keys/", import.meta.url);
    expect(existsSync(new URL("textures/particle/secret_cinema.png", resource))).toBe(false);
    expect(existsSync(new URL("textures/particle/secret_cinema.texture_set.json", resource))).toBe(false);
    expect(existsSync(new URL("particles/pbe_vfx_cinema_dust.particle.json", resource))).toBe(false);
    expect(existsSync(new URL("particles/pbe_vfx_cinema_shock.particle.json", resource))).toBe(false);
    expect(existsSync(new URL("textures/particle/piano_fx.png", keysPluginAssets))).toBe(true);
    const pianoFxMer = readFileSync(new URL("textures/particle/piano_fx_mer.png", keysPluginAssets));
    expect([pianoFxMer.readUInt32BE(16), pianoFxMer.readUInt32BE(20)]).toEqual([256, 128]);
    const pianoFxSet = JSON.parse(readFileSync(new URL("textures/particle/piano_fx.texture_set.json", keysPluginAssets), "utf8"));
    expect(pianoFxSet["minecraft:texture_set"]).toEqual({
        color: "piano_fx",
        metalness_emissive_roughness: "piano_fx_mer",
    });

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

test("all 21 pbe_vfx particle definitions use declared textures and clean Molang variables", () => {
    for (const particle of ALL_VFX_PARTICLES) {
        const source = readParticleDoc(particle);
        const doc = JSON.parse(source).particle_effect;
        const pianoFx = particle === "key_blue_tears" || particle === "magic_trail";
        expect(doc.description.identifier).toBe(`pbe:vfx_${particle}`);
        expect(doc.description.basic_render_parameters.texture).toBe(
            pianoFx ? "textures/particle/piano_fx" : VFX_ATLAS.texture,
        );
        const billboard = doc.components["minecraft:particle_appearance_billboard"];
        const uv = billboard.uv;
        expect([uv.texture_width, uv.texture_height]).toEqual(
            pianoFx ? [256, 128] : [VFX_ATLAS.width, VFX_ATLAS.height],
        );

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
        const dynamic = doc.components["minecraft:particle_motion_dynamic"];
        if (dynamic?.linear_acceleration) expect(dynamic.linear_acceleration).toHaveLength(3);
        const parametric = doc.components["minecraft:particle_motion_parametric"];
        if (parametric?.relative_position) expect(parametric.relative_position).toHaveLength(3);
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
    const wave = waveEngine.update(0, { ...quietFeatures, activity: 0.7 }).flatMap(batch => batch.emitters);
    expect(wave.some(emitter => emitter.offset.y > 0.5)).toBe(true);

    const wingRibbons = getVfxEffect("wing_ribbons")!;
    const wingOffsets = wingRibbons.emit!({
        params: { color: "#90C8FF", color2: "#C58CFF", intensity: 0.8, scale: 1, zone: "stage", motion: "normal" },
        music: { ...quietFeatures, surge: 0.7, sustain: 0.6 },
        recentNotes: [],
        lastNoteSequence: 0,
        instrument: "upright",
        phase: 0,
        solo: false,
        state: wingRibbons.createState?.(),
    })!.emitters.map(emitter => emitter.offset);
    expect(wingOffsets.some(offset => offset.x < -1.5)).toBe(true);
    expect(wingOffsets.some(offset => offset.x > 1.5)).toBe(true);

    const magicCircle = getVfxEffect("magic_circle")!;
    const depths = magicCircle.emit!({
        params: { color: "#68E4FF", color2: "#C58CFF", intensity: 0.8, scale: 1, zone: "stage", motion: "normal" },
        music: quietFeatures,
        recentNotes: [],
        lastNoteSequence: 0,
        instrument: "grand",
        phase: 0,
        solo: false,
        state: magicCircle.createState?.(),
    })!.emitters.map(emitter => grand.centerZ + grand.depth * emitter.offset.z);
    expect(Math.min(...depths)).toBeLessThan(0);
    expect(Math.max(...depths)).toBeGreaterThan(3);
});
