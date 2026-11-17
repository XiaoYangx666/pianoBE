import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const root = new URL("../../packages/addon/rp/", import.meta.url);
const check = process.argv.includes("--check");
const width = 256;
const height = 256;
const texture = "textures/particle/vfx_lab";
const tiles = {
    mote: [0, 0, 32, 32],
    glint: [32, 0, 32, 32],
    silk: [64, 0, 32, 32],
    curtain: [96, 0, 32, 48],
    spark: [128, 0, 32, 32],
    beam: [0, 48, 256, 48],
    ripple: [0, 104, 128, 128],
};

function write(path, contents) {
    const file = fileURLToPath(new URL(path, root));
    if (check) {
        const matches = typeof contents === "string"
            ? readFileSync(file, "utf8").replaceAll("\r\n", "\n") === contents
            : readFileSync(file).equals(contents);
        if (!matches) throw new Error(`VFX asset differs: ${path}`);
    } else {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, contents);
    }
}

const clamp = (x) => Math.max(0, Math.min(1, x));
const smooth = (x) => clamp(x) ** 2 * (3 - 2 * clamp(x));
const gaussian = (x, sigma) => Math.exp(-0.5 * (x / sigma) ** 2);
const pixels = Buffer.alloc((width * 4 + 1) * height);
const merPixels = Buffer.alloc((width * 3 + 1) * height);
for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) merPixels[y * (width * 3 + 1) + x * 3 + 3] = 255;
}

function paint([left, top, w, h], emissive, profile) {
    for (let y = 2; y < h - 2; y++) {
        for (let x = 2; x < w - 2; x++) {
            const u = (x + 0.5) / w * 2 - 1;
            const v = (y + 0.5) / h * 2 - 1;
            const [light, alpha] = profile(u, v);
            const index = (top + y) * (width * 4 + 1) + (left + x) * 4 + 1;
            pixels.fill(Math.round(clamp(light) * 255), index, index + 3);
            pixels[index + 3] = Math.round(clamp(alpha) * 255);
            const green = (top + y) * (width * 3 + 1) + (left + x) * 3 + 2;
            merPixels[green] = Math.round(255 * emissive * clamp(alpha) * clamp(light));
        }
    }
}

paint(tiles.mote, 0.56, (x, y) => {
    const r = Math.hypot(x, y);
    return [0.66 + 0.34 * gaussian(r, 0.16), (0.77 * gaussian(r, 0.16) + 0.23 * gaussian(r, 0.36)) * smooth((0.86 - r) / 0.3)];
});
paint(tiles.glint, 0.81, (x, y) => {
    const r = Math.hypot(x, y);
    const halo = 0.28 * gaussian(r, 0.29);
    const flare = 0.34 * gaussian(x, 0.075) * gaussian(y, 0.37)
        + 0.23 * gaussian(x, 0.33) * gaussian(y, 0.068);
    return [0.77 + 0.23 * gaussian(r, 0.15), (halo + flare + 0.45 * gaussian(r, 0.115)) * smooth((0.86 - r) / 0.25)];
});
paint(tiles.silk, 0.23, (x, y) => {
    const radius = Math.hypot(x, y);
    const core = gaussian(radius, 0.24);
    const halo = gaussian(radius, 0.49);
    return [0.72 + 0.28 * core, smooth((0.93 - radius) / 0.29) * (0.76 * core + 0.16 * halo)];
});
paint(tiles.beam, 0.59, (x, y) => {
    // Taper cross-section along the beam and extend a softer, asymmetric wake.
    const progress = (x + 1) / 2;
    const end = smooth((progress - 0.015) / 0.34) * smooth((0.986 - progress) / 0.19);
    const profile = 0.36 + 0.64 * end;
    const cross = y / profile;
    const core = gaussian(cross, 0.132);
    const halo = gaussian(cross, 0.41);
    const shoulder = gaussian(cross, 0.22);
    const filaments = gaussian(cross - 0.21, 0.056) + gaussian(cross + 0.21, 0.056);
    const head = 0.77 + 0.23 * gaussian(x - 0.48, 0.32);
    return [0.74 + 0.26 * Math.max(core, 0.5 * shoulder),
        end * head * smooth((0.89 - Math.abs(y)) / 0.24) * (0.77 * core + 0.18 * shoulder + 0.24 * halo + 0.06 * filaments)];
});
paint(tiles.curtain, 0.26, (x, y) => {
    const edges = smooth((0.85 - Math.abs(x)) / 0.47) * smooth((0.9 - Math.abs(y)) / 0.45);
    const threads = 0.54 * gaussian(x, 0.17) + 0.16 * gaussian(x - 0.36, 0.09) + 0.14 * gaussian(x + 0.3, 0.12);
    return [0.76 + 0.24 * gaussian(x, 0.19), edges * threads * (0.86 + 0.14 * Math.cos(y * 10))];
});
paint(tiles.spark, 0.53, (x, y) => {
    const radius = Math.abs(x) + 0.71 * Math.abs(y);
    return [0.71 + 0.29 * gaussian(radius, 0.21), gaussian(radius, 0.32) * smooth((0.9 - radius) / 0.32)];
});
paint(tiles.ripple, 0.35, (x, y) => {
    const radius = Math.hypot(x, y);
    const angle = Math.atan2(y, x);
    const grooves = 0.84 + 0.16 * Math.cos(angle * 9 + 0.35 * Math.sin(angle * 4));
    return [0.81 + 0.19 * gaussian(radius - 0.78, 0.02),
        grooves * (0.78 * gaussian(radius - 0.78, 0.021) + 0.27 * gaussian(radius - 0.71, 0.033))
        * smooth((0.92 - radius) / 0.12)];
});

function chunk(type, data) {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    let crc = 0xffffffff;
    for (const byte of body) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const size = Buffer.alloc(4);
    const checksum = Buffer.alloc(4);
    size.writeUInt32BE(data.length);
    checksum.writeUInt32BE(~crc >>> 0);
    return Buffer.concat([size, body, checksum]);
}

function png(data, colorType) {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width);
    header.writeUInt32BE(height, 4);
    header[8] = 8;
    header[9] = colorType;
    return Buffer.concat([
        Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", header), chunk("IDAT", deflateSync(data)), chunk("IEND", Buffer.alloc(0)),
    ]);
}

write(`${texture}.png`, png(pixels, 6));
write(`${texture}_mer.png`, png(merPixels, 2));
write(`${texture}.texture_set.json`, JSON.stringify({
    format_version: "1.21.30",
    "minecraft:texture_set": { color: "vfx_lab", metalness_emissive_roughness: "vfx_lab_mer" },
}, null, 2) + "\n");

const param = (name, fallback) => `(variable.vfx_${name} ?? ${fallback})`;
const age = "variable.particle_age";
const random = (index) => `variable.particle_random_${index}`;
const saturate = (expr) => `math.clamp(${expr}, 0, 1)`;
const fade = (inTime, outTime, time = age, life = "variable.particle_lifetime") =>
    `${saturate(`(${time}) / ${inTime}`)} * ${saturate(`(${life} - (${time})) / ${outTime}`)}`;
const rightX = param("right_x", 1);
const rightZ = param("right_z", 0);
const rotate = (x, y, z) => [`(${x}) * ${rightX} + (${z}) * ${rightZ}`, y, `(${x}) * ${rightZ} - (${z}) * ${rightX}`];
const scaled = (expr) => `(${expr}) * ${param("scale", 1)}`;
const position = (x, y, z) => rotate(x, y, z).map(scaled);
const stageDepth = param("stage_depth", 1);
const uv = ([x, y, w, h]) => ({ texture_width: width, texture_height: height, uv: [x, y], uv_size: [w, h] });
const tint = ([r, g, b], alpha) => ({ color: [param("red", r), param("green", g), param("blue", b), `${param("opacity", 0.75)} * ${alpha}`] });
const localSpace = { position: true, rotation: true };
const point = { offset: [0, 0, 0] };

function particle(name, components) {
    const description = {
        identifier: `pbe:vfx_${name}`,
        basic_render_parameters: { material: "particles_add", texture },
    };
    const document = { format_version: "1.10.0", particle_effect: { description, components } };
    write(`particles/pbe_vfx_${name}.particle.json`, JSON.stringify(document, null, 2) + "\n");
}

const extent = param("range", 1);
const fieldAngle = `360 * ${random(1)}`;
const fieldRadius = `(1.49 + 1.32 * ${random(3)}) * ${extent}`;
const moteSize = scaled(`${param("size", 1)} * (0.042 + 0.105 * math.pow(${random(4)}, 2.6))`);
const drift = (scale, seed) => `${random(4)} < 0.32 ? 0 : ${scale} * ${param("speed", 1)} * (2 * ${random(seed)} - 1)`;
particle("field", {
    "minecraft:emitter_rate_steady": { spawn_rate: param("rate", 12), max_particles: param("max_particles", 38) },
    "minecraft:emitter_lifetime_once": { active_time: param("active", 2.1) },
    "minecraft:emitter_shape_custom": {
        offset: position(`math.cos(${fieldAngle}) * ${fieldRadius}`,
            `1.08 + ${param("height", 0)} + 1.64 * (${random(2)} - 0.5)`,
            `math.sin(${fieldAngle}) * ${fieldRadius} * 0.91 * ${stageDepth}`),
        direction: [0, 1, 0],
    },
    "minecraft:particle_initial_speed": position(drift(0.22, 3), drift(0.13, 1), drift(0.17, 2)),
    "minecraft:particle_motion_dynamic": { linear_drag_coefficient: 0.38 },
    "minecraft:particle_lifetime_expression": { max_lifetime: `1.2 + 2.0 * ${random(1)}` },
    "minecraft:particle_appearance_billboard": {
        facing_camera_mode: "lookat_xyz", size: [moteSize, moteSize],
        uv: { ...uv(tiles.mote), uv: [`${random(4)} > 0.82 ? ${tiles.glint[0]} : 0`, 0] },
    },
    "minecraft:particle_appearance_tinting": tint([0.65, 0.72, 0.98],
        `${fade(0.78, 0.86)} * (0.26 + 0.63 * ${random(4)}) * (0.87 + 0.13 * math.sin(${age} * 180 + ${random(2)} * 360))`),
});

const phase = `${param("phase", 0)} - ${param("angular_speed", 124)} * ${age}`;
const waveLife = param("life", 4.7);
const harmonic = `math.sin(${phase}) + 0.23 * math.sin(2 * (${phase}) + 30)`;
const waveRadius = scaled(param("radius", 0.109));
const amplitude = param("amplitude", 0.37);
const previousAmplitude = param("previous_amplitude", 0.37);
particle("wave", {
    "minecraft:emitter_rate_instant": { num_particles: 1 },
    "minecraft:emitter_lifetime_once": { active_time: waveLife },
    "minecraft:emitter_local_space": localSpace,
    "minecraft:emitter_shape_point": point,
    "minecraft:particle_motion_parametric": { relative_position: [0,
        scaled(`math.lerp(${previousAmplitude}, ${amplitude}, ${saturate(`${age} / 0.48`)}) * (${harmonic})`), 0] },
    "minecraft:particle_lifetime_expression": { max_lifetime: waveLife },
    "minecraft:particle_appearance_billboard": {
        facing_camera_mode: "rotate_xyz",
        size: [waveRadius, `0.72 * ${waveRadius}`],
        uv: uv(tiles.silk),
    },
    "minecraft:particle_appearance_tinting": tint([0.58, 0.90, 1],
        `${fade(0.66, 0.86)} * (0.88 + 0.12 * math.sin((${phase}) - 60))`),
});

const delay = param("delay", 0);
const life = param("life", 2.7);
const beamLife = `${life} + ${delay}`;
const elapsed = `${age} - ${delay}`;
const progress = saturate(`(${elapsed}) / ${life}`);
const bend = param("bend", 0.56);
const span = param("span", 4.8);
const track = `${param("start", -2.4)} + ${span} * ${progress}`;
const lateral = `${bend} * math.sin(180 * ${progress})`;
const dirX = param("dir_x", 1);
const dirZ = param("dir_z", 0);
const crossSlope = `3.141593 * ${bend} * math.cos(180 * ${progress}) / ${span}`;
const heightDelta = param("height_delta", 0);
const climb = `${heightDelta} * (1 - ${saturate(`(${elapsed}) / 0.64`)})`;
const arc = param("around", 1);
const arcSweep = param("arc_sweep", 212);
const arcAngle = `${param("arc_phase", 35)} + ${arcSweep} * ${progress}`;
const arcRadius = param("arc_radius", 2.48);
const arcDepth = `(0.77 + 0.1 * math.abs(${bend})) * ${stageDepth}`;
const arcSign = `${arcSweep} < 0 ? -1 : 1`;
const arcOrLine = (curve, line) => `(${arc} > 0.5 ? (${curve}) : (${line}))`;
const lineSlopeY = `(1.665044 * math.abs(${bend}) * math.cos(180 * ${progress} - 24) - ((${elapsed}) >= 0 && (${elapsed}) < 0.64 ? ${heightDelta} * ${life} / 0.64 : 0)) / ${span}`;
particle("beam", {
    "minecraft:emitter_rate_instant": { num_particles: 1 },
    "minecraft:emitter_lifetime_once": { active_time: beamLife },
    "minecraft:emitter_local_space": localSpace,
    "minecraft:emitter_shape_point": point,
    "minecraft:particle_motion_parametric": {
        relative_position: position(
            arcOrLine(`math.cos(${arcAngle}) * ${arcRadius}`, `(${track}) * ${dirX} - (${lateral}) * ${dirZ}`),
            `${arcOrLine(`0.59 * ${bend} * math.sin(${arcAngle} - 24)`,
                `0.53 * math.abs(${bend}) * math.sin(180 * ${progress} - 24)`)} + ${climb}`,
            arcOrLine(`math.sin(${arcAngle}) * ${arcRadius} * ${arcDepth}`, `(${track}) * ${dirZ} + (${lateral}) * ${dirX}`)),
    },
    "minecraft:particle_lifetime_expression": { max_lifetime: beamLife },
    "minecraft:particle_appearance_billboard": {
        facing_camera_mode: "direction_x",
        size: [scaled(`0.5 * ${param("length", 1.36)} * (0.64 + 0.36 * math.sin(180 * ${progress}))`),
            scaled(`0.5 * ${param("width", 0.16)}`)],
        direction: {
            mode: "custom_direction",
            custom_direction: rotate(
                arcOrLine(`-(${arcSign}) * math.sin(${arcAngle})`, `${dirX} - (${crossSlope}) * ${dirZ}`),
                arcOrLine(`(${arcSign}) * 0.59 * ${bend} * math.cos(${arcAngle} - 24) / ${arcRadius}`, lineSlopeY),
                arcOrLine(`(${arcSign}) * math.cos(${arcAngle}) * ${arcDepth}`, `${dirZ} + (${crossSlope}) * ${dirX}`)),
        },
        uv: uv(tiles.beam),
    },
    "minecraft:particle_appearance_tinting": tint([1, 0.85, 0.70], fade(0.22, 0.53, elapsed, life)),
});

const shortLife = "variable.particle_lifetime";
const normalizedAge = saturate(`${age} / ${shortLife}`);
const ringRadius = scaled(`${param("radius", 2.15)} * (0.16 + 0.84 * math.pow(${normalizedAge}, 0.65)) * ${param("size", 1)} * ${stageDepth}`);
particle("ripple", {
    "minecraft:emitter_rate_instant": { num_particles: 1 },
    "minecraft:emitter_lifetime_once": { active_time: param("life", 1.1) },
    "minecraft:emitter_shape_point": point,
    "minecraft:particle_lifetime_expression": { max_lifetime: param("life", 1.1) },
    "minecraft:particle_appearance_billboard": {
        facing_camera_mode: "emitter_transform_xz", size: [ringRadius, ringRadius], uv: uv(tiles.ripple),
    },
    "minecraft:particle_appearance_tinting": tint([0.54, 0.89, 0.86], fade(0.13, 0.65)),
});

const fountainSpeed = param("speed", 1);
const sparkSize = scaled(`(0.036 + 0.035 * ${random(3)}) * ${param("size", 1)}`);
particle("fountain", {
    "minecraft:emitter_rate_instant": { num_particles: param("count", 8) },
    "minecraft:emitter_lifetime_once": { active_time: 1.4 },
    "minecraft:emitter_shape_custom": { offset: position(`0.19 * (2 * ${random(1)} - 1)`, 0, `0.15 * (2 * ${random(4)} - 1)`) },
    "minecraft:particle_initial_speed": position(`${param("side", 1)} * (0.22 + 0.85 * ${random(1)})`,
        `(2.6 + 1.65 * ${random(2)}) * ${fountainSpeed}`, `0.15 + 0.58 * ${random(4)}`),
    "minecraft:particle_motion_dynamic": { linear_acceleration: [0, scaled(-7.6), 0], linear_drag_coefficient: 0.15 },
    "minecraft:particle_lifetime_expression": { max_lifetime: `${param("life", 1.15)} * (0.65 + 0.5 * ${random(2)})` },
    "minecraft:particle_appearance_billboard": {
        facing_camera_mode: "rotate_xyz", size: [sparkSize, `1.45 * ${sparkSize}`], uv: uv(tiles.spark),
    },
    "minecraft:particle_appearance_tinting": tint([1, 0.86, 0.65], fade(0.09, 0.46)),
});

const curtainLife = param("life", 1.38);
const curtainPhase = `${param("phase", 0)} + 130 * ${param("speed", 1)} * ${age}`;
particle("curtain", {
    "minecraft:emitter_rate_instant": { num_particles: 1 },
    "minecraft:emitter_lifetime_once": { active_time: curtainLife },
    "minecraft:emitter_local_space": localSpace,
    "minecraft:emitter_shape_point": point,
    "minecraft:particle_motion_parametric": { relative_position: position(0,
        `0.16 * math.sin(${curtainPhase}) - 0.32 * ${age}`, `0.21 * math.cos(${curtainPhase})`) },
    "minecraft:particle_lifetime_expression": { max_lifetime: curtainLife },
    "minecraft:particle_appearance_billboard": {
        facing_camera_mode: "lookat_y",
        size: [scaled(`0.5 * ${param("width", 0.14)}`), scaled(`0.5 * ${param("length", 1.4)}`)],
        uv: uv(tiles.curtain),
    },
    "minecraft:particle_appearance_tinting": tint([0.55, 0.62, 0.94], fade(0.34, 0.52)),
});

const orbitLife = param("life", 2.45);
const orbitAngle = `${param("phase", 0)} + 360 * ${random(1)} + 67 * ${param("speed", 1)} * ${age}`;
const orbitRadius = `${param("radius", 2.32)} * (0.92 + 0.16 * ${random(2)})`;
const orbitSize = scaled(`(0.035 + 0.039 * ${random(4)}) * ${param("size", 1)}`);
particle("orbit", {
    "minecraft:emitter_rate_instant": { num_particles: param("count", 10) },
    "minecraft:emitter_lifetime_once": { active_time: orbitLife },
    "minecraft:emitter_local_space": localSpace,
    "minecraft:emitter_shape_point": point,
    "minecraft:particle_motion_parametric": { relative_position: position(
        `math.cos(${orbitAngle}) * ${orbitRadius}`,
        `0.43 * math.sin(${orbitAngle}) + 0.18 * (2 * ${random(3)} - 1)`,
        `0.89 * math.sin(${orbitAngle}) * ${orbitRadius} * ${stageDepth}`) },
    "minecraft:particle_lifetime_expression": { max_lifetime: orbitLife },
    "minecraft:particle_appearance_billboard": {
        facing_camera_mode: "rotate_xyz", size: [orbitSize, orbitSize], uv: uv(tiles.glint),
    },
    "minecraft:particle_appearance_tinting": tint([0.83, 0.66, 0.99], fade(0.38, 0.6)),
});

console.log(check ? "VFX Lab: checked particles, RGBA atlas and emissive texture set" : "VFX Lab: built particles, RGBA atlas and emissive texture set");
