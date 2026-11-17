import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const root = new URL("../../packages/addon/rp/", import.meta.url);
const check = process.argv.includes("--check");
const width = 256;
const height = 128;
const texture = "textures/particle/vfx_lab";
const tiles = {
    mote: [0, 0, 32, 32],
    glint: [32, 0, 32, 32],
    silk: [64, 0, 128, 32],
    beam: [0, 48, 256, 48],
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

function paint([left, top, w, h], profile) {
    for (let y = 2; y < h - 2; y++) {
        for (let x = 2; x < w - 2; x++) {
            const u = (x + 0.5) / w * 2 - 1;
            const v = (y + 0.5) / h * 2 - 1;
            const [light, alpha] = profile(u, v);
            const index = (top + y) * (width * 4 + 1) + (left + x) * 4 + 1;
            pixels.fill(Math.round(clamp(light) * 255), index, index + 3);
            pixels[index + 3] = Math.round(clamp(alpha) * 255);
        }
    }
}

paint(tiles.mote, (x, y) => {
    const r = Math.hypot(x, y);
    return [0.66 + 0.34 * gaussian(r, 0.16), (0.77 * gaussian(r, 0.16) + 0.23 * gaussian(r, 0.36)) * smooth((0.86 - r) / 0.3)];
});
paint(tiles.glint, (x, y) => {
    const r = Math.hypot(x, y);
    const halo = 0.28 * gaussian(r, 0.29);
    const flare = 0.34 * gaussian(x, 0.075) * gaussian(y, 0.37)
        + 0.23 * gaussian(x, 0.33) * gaussian(y, 0.068);
    return [0.77 + 0.23 * gaussian(r, 0.15), (halo + flare + 0.45 * gaussian(r, 0.115)) * smooth((0.86 - r) / 0.25)];
});
paint(tiles.silk, (x, y) => {
    const envelope = smooth((0.94 - Math.abs(x)) / 0.33) * smooth((0.86 - Math.abs(y)) / 0.26);
    const filament = gaussian(y, 0.12);
    const sheath = gaussian(y, 0.35);
    return [0.62 + 0.38 * filament, envelope * (0.64 * filament + 0.29 * sheath)];
});
paint(tiles.beam, (x, y) => {
    // Taper cross-section along the beam and extend a softer, asymmetric wake.
    const progress = (x + 1) / 2;
    const end = smooth((progress - 0.015) / 0.34) * smooth((0.986 - progress) / 0.19);
    const profile = 0.36 + 0.64 * end;
    const cross = y / profile;
    const core = gaussian(cross, 0.077);
    const halo = gaussian(cross, 0.37);
    const shoulder = gaussian(cross, 0.18);
    const filaments = gaussian(cross - 0.21, 0.056) + gaussian(cross + 0.21, 0.056);
    const head = 0.77 + 0.23 * gaussian(x - 0.48, 0.32);
    return [0.58 + 0.42 * Math.max(core, 0.5 * shoulder),
        end * head * smooth((0.89 - Math.abs(y)) / 0.24) * (0.67 * core + 0.22 * shoulder + 0.22 * halo + 0.07 * filaments)];
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

const header = Buffer.alloc(13);
header.writeUInt32BE(width);
header.writeUInt32BE(height, 4);
header[8] = 8;
header[9] = 6;
write(`${texture}.png`, Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0)),
]));

const param = (name, fallback) => `(variable.vfx_${name} ?? ${fallback})`;
const age = "variable.particle_age";
const random = (index) => `variable.particle_random_${index}`;
const saturate = (expr) => `math.clamp(${expr}, 0, 1)`;
const fade = (inTime, outTime, time = age, life = "variable.particle_lifetime") =>
    `${saturate(`(${time}) / ${inTime}`)} * ${saturate(`(${life} - (${time})) / ${outTime}`)}`;
const rightX = param("right_x", 1);
const rightZ = param("right_z", 0);
const rotate = (x, y, z) => [`(${x}) * ${rightX} + (${z}) * ${rightZ}`, y, `(${x}) * ${rightZ} - (${z}) * ${rightX}`];
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
const moteSize = `${param("size", 1)} * (0.042 + 0.105 * math.pow(${random(4)}, 2.6))`;
const drift = (scale, seed) => `${random(4)} < 0.32 ? 0 : ${scale} * ${param("speed", 1)} * (2 * ${random(seed)} - 1)`;
particle("field", {
    "minecraft:emitter_rate_steady": { spawn_rate: param("rate", 12), max_particles: param("max_particles", 38) },
    "minecraft:emitter_lifetime_once": { active_time: param("active", 2.1) },
    "minecraft:emitter_shape_custom": {
        // The symmetric power distribution concentrates particles in the interior of the volume.
        offset: rotate(`2.9 * ${extent} * (${random(1)} < 0.5 ? -1 : 1) * math.pow(math.abs(2 * ${random(1)} - 1), 1.35)`,
            `1.57 + ${param("height", 0)} + 2.15 * (${random(2)} - 0.5)`,
            `0.5 + 2.1 * ${extent} * (2 * ${random(3)} - 1)`),
        direction: [0, 1, 0],
    },
    "minecraft:particle_initial_speed": rotate(drift(0.22, 3), drift(0.13, 1), drift(0.17, 2)),
    "minecraft:particle_motion_dynamic": { linear_drag_coefficient: 0.38 },
    "minecraft:particle_lifetime_expression": { max_lifetime: `1.2 + 2.0 * ${random(1)}` },
    "minecraft:particle_appearance_billboard": {
        facing_camera_mode: "lookat_xyz", size: [moteSize, moteSize],
        uv: { ...uv(tiles.mote), uv: [`${random(4)} > 0.82 ? ${tiles.glint[0]} : 0`, 0] },
    },
    "minecraft:particle_appearance_tinting": tint([0.44, 0.66, 0.97],
        `${fade(0.78, 0.86)} * (0.22 + 0.52 * ${random(4)}) * (0.81 + 0.19 * math.sin(${age} * 180 + ${random(2)} * 360))`),
});

const phase = `${param("phase", 0)} - ${param("angular_speed", 124)} * ${age}`;
const waveLife = param("life", 4.7);
const harmonic = `math.sin(${phase}) + 0.23 * math.sin(2 * (${phase}) + 30)`;
const waveSlope = `${param("amplitude_slope", 0)} * (${harmonic}) + 0.0174533 * ${param("frequency", 65.45)} * ${param("amplitude", 0.5)} * (math.cos(${phase}) + 0.46 * math.cos(2 * (${phase}) + 30))`;
particle("wave", {
    "minecraft:emitter_rate_instant": { num_particles: 1 },
    "minecraft:emitter_lifetime_once": { active_time: waveLife },
    "minecraft:emitter_local_space": localSpace,
    "minecraft:emitter_shape_point": point,
    "minecraft:particle_motion_parametric": { relative_position: [0, `${param("amplitude", 0.5)} * (${harmonic})`, 0] },
    "minecraft:particle_lifetime_expression": { max_lifetime: waveLife },
    "minecraft:particle_appearance_billboard": {
        facing_camera_mode: "direction_x",
        size: [`0.72 * ${param("step", 0.275)} * math.sqrt(1 + math.pow(${waveSlope}, 2) + math.pow(${param("depth_slope", 0)}, 2))`, param("width", 0.095)],
        direction: { mode: "custom_direction", custom_direction: rotate(1, waveSlope, param("depth_slope", 0)) },
        uv: uv(tiles.silk),
    },
    "minecraft:particle_appearance_tinting": tint([0.51, 0.91, 0.97],
        `${fade(0.66, 0.86)} * (0.77 + 0.23 * math.sin((${phase}) - 60))`),
});

const delay = param("delay", 0);
const life = param("life", 2.7);
const beamLife = `${life} + ${delay}`;
const elapsed = `${age} - ${delay}`;
const progress = saturate(`(${elapsed}) / ${life}`);
const bend = param("bend", 0.64);
const track = `${param("start", -3.25)} + ${param("span", 6.5)} * ${progress}`;
const lateral = `${bend} * math.sin(180 * ${progress})`;
const dirX = param("dir_x", 1);
const dirZ = param("dir_z", 0);
const crossSlope = `3.141593 * ${bend} * math.cos(180 * ${progress}) / ${param("span", 6.5)}`;
particle("beam", {
    "minecraft:emitter_rate_instant": { num_particles: 1 },
    "minecraft:emitter_lifetime_once": { active_time: beamLife },
    "minecraft:emitter_local_space": localSpace,
    "minecraft:emitter_shape_point": point,
    "minecraft:particle_motion_parametric": {
        relative_position: rotate(`(${track}) * ${dirX} - (${lateral}) * ${dirZ}`,
            `0.53 * math.abs(${bend}) * math.sin(180 * ${progress} - 24)`,
            `(${track}) * ${dirZ} + (${lateral}) * ${dirX}`),
    },
    "minecraft:particle_lifetime_expression": { max_lifetime: beamLife },
    "minecraft:particle_appearance_billboard": {
        facing_camera_mode: "direction_x",
        size: [`0.5 * ${param("length", 1.22)} * (0.64 + 0.36 * math.sin(180 * ${progress}))`, `0.5 * ${param("width", 0.1)}`],
        direction: {
            mode: "custom_direction",
            custom_direction: rotate(`${dirX} - (${crossSlope}) * ${dirZ}`,
                `1.665044 * math.abs(${bend}) * math.cos(180 * ${progress} - 24) / ${param("span", 6.5)}`,
                `${dirZ} + (${crossSlope}) * ${dirX}`),
        },
        uv: uv(tiles.beam),
    },
    "minecraft:particle_appearance_tinting": tint([1, 0.77, 0.61], fade(0.22, 0.53, elapsed, life)),
});

console.log(check ? "VFX Lab: checked three particle documents and original RGBA atlas" : "VFX Lab: built three particle documents and original RGBA atlas");
