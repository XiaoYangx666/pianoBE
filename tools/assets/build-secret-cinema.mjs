import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const pack = new URL("../../packages/addon/rp/", import.meta.url);
const check = process.argv.includes("--check");
const texture = "textures/particle/secret_cinema";
const width = 512;
const height = 128;
const tiles = {
    dust: [0, 0, 64, 64],
    cluster: [64, 0, 128, 128],
    flecks: [192, 0, 128, 128],
    pearl: [320, 0, 96, 96],
    ribbon: [416, 0, 96, 96],
};

function write(relative, data) {
    const path = fileURLToPath(new URL(relative, pack));
    if (check) {
        const actual = readFileSync(path);
        const expected = typeof data === "string" ? Buffer.from(actual.toString().replaceAll("\r\n", "\n")) : actual;
        if (!expected.equals(Buffer.from(data))) throw new Error(`Refresh ${relative}`);
        return;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, data);
}

const clamp = value => Math.min(1, Math.max(0, value));
const ease = value => clamp(value) ** 2 * (3 - 2 * clamp(value));
const bell = (x, spread) => Math.exp(-0.5 * (x / spread) ** 2);
const rgba = Buffer.alloc((width * 4 + 1) * height);
const mer = Buffer.alloc((width * 3 + 1) * height);
for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) mer[y * (width * 3 + 1) + 3 * x + 3] = 255;
}

function paint(tile, emission, profile) {
    const [ox, oy, w, h] = tiles[tile];
    for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
        const [value, alpha] = profile((x + 0.5) / w * 2 - 1, (y + 0.5) / h * 2 - 1);
        const index = (oy + y) * (width * 4 + 1) + (ox + x) * 4 + 1;
        rgba.fill(Math.round(clamp(value) * 255), index, index + 3);
        rgba[index + 3] = Math.round(clamp(alpha) * 255);
        mer[(oy + y) * (width * 3 + 1) + (ox + x) * 3 + 2] = Math.round(255 * emission * clamp(alpha));
    }
}

paint("dust", 0.52, (x, y) => {
    const r = Math.hypot(x, y);
    const halo = 0.25 * bell(r, 0.31);
    return [0.67 + 0.28 * bell(r, 0.13), (0.55 * bell(r, 0.16) + halo) * ease((0.91 - r) / 0.26)];
});
paint("pearl", 0.73, (x, y) => {
    const r = Math.hypot(x, y);
    const glint = bell(r, 0.12);
    return [0.68 + 0.32 * glint, (0.73 * glint + 0.26 * bell(r, 0.29)) * ease((0.89 - r) / 0.25)];
});
paint("ribbon", 0.58, (x, y) => {
    const tip = ease((0.96 - Math.abs(x)) / 0.45);
    const core = bell(y, 0.18);
    const glow = bell(y, 0.44);
    return [0.84 + 0.16 * core, tip * (0.73 * core + 0.24 * glow) * ease((0.96 - Math.abs(y)) / 0.23)];
});

const speckles = [
    [0.02, 0.06, 0.057, 0.86], [-0.15, -0.19, 0.035, 0.62], [0.24, -0.14, 0.032, 0.64],
    [-0.36, 0.07, 0.025, 0.51], [0.32, 0.19, 0.035, 0.45], [-0.13, 0.34, 0.03, 0.53],
    [0.05, -0.37, 0.037, 0.41], [0.52, -0.07, 0.022, 0.40], [0.05, 0.53, 0.025, 0.39],
    [-0.43, -0.22, 0.024, 0.32], [-0.32, 0.44, 0.019, 0.34],
];
const otherSpeckles = [
    [-0.18, 0.17, 0.046, 0.79], [0.14, -0.09, 0.037, 0.72], [0.25, 0.28, 0.028, 0.57],
    [-0.38, -0.14, 0.035, 0.47], [0.41, -0.34, 0.027, 0.47], [-0.03, -0.49, 0.022, 0.44],
    [0.14, 0.48, 0.028, 0.39], [-0.46, 0.37, 0.022, 0.34], [0.57, 0.03, 0.022, 0.37],
];
function grainProfile(grains, mist) {
    return (x, y) => {
        let detail = 0;
        let scattered = 0;
        for (const [cx, cy, size, brightness] of grains) {
            const r = Math.hypot(x - cx, y - cy);
            detail += brightness * bell(r, size);
            scattered += 0.16 * brightness * bell(r, size * 2.7);
        }
        const drift = mist * bell(Math.hypot(x, y), 0.39);
        return [0.66 + 0.34 * clamp(detail), (detail + scattered + drift) * ease((0.93 - Math.hypot(x, y)) / 0.27)];
    };
}
paint("cluster", 0.63, grainProfile(speckles, 0.083));
paint("flecks", 0.69, grainProfile(otherSpeckles, 0.022));

function chunk(label, payload) {
    const body = Buffer.concat([Buffer.from(label, "ascii"), payload]);
    let crc = 0xffffffff;
    for (const byte of body) {
        crc ^= byte;
        for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    const begin = Buffer.alloc(4);
    begin.writeUInt32BE(payload.length);
    const end = Buffer.alloc(4);
    end.writeUInt32BE(~crc >>> 0);
    return Buffer.concat([begin, body, end]);
}

function png(pixels, color) {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = 8;
    header[9] = color;
    return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", header),
        chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
}

write(`${texture}.png`, png(rgba, 6));
write(`${texture}_mer.png`, png(mer, 2));
write(`${texture}.texture_set.json`, JSON.stringify({
    format_version: "1.21.30",
    "minecraft:texture_set": { color: "secret_cinema", metalness_emissive_roughness: "secret_cinema_mer" },
}, null, 2) + "\n");

const p = (name, value) => `(variable.vfx_${name} ?? ${value})`;
const age = "variable.particle_age";
const random = i => `variable.particle_random_${i}`;
const progress = "math.clamp(variable.particle_age / variable.particle_lifetime, 0, 1)";
const life = p("life", 1.3);
const fade = (enter, exit) => `math.clamp(${age} / ${enter}, 0, 1) * math.clamp((variable.particle_lifetime - ${age}) / ${exit}, 0, 1)`;
const scale = p("scale", 1);
const stageDepth = p("stage_depth", 1);
const rightX = p("right_x", 1);
const rightZ = p("right_z", 0);
const world = (x, y, z) => [`((${x}) * ${rightX} + (${z}) * ${rightZ}) * ${scale}`,
    `(${y}) * ${scale}`, `((${x}) * ${rightZ} - (${z}) * ${rightX}) * ${scale}`];
const uv = tile => {
    const [x, y, w, h] = tiles[tile];
    return { texture_width: width, texture_height: height, uv: [x, y], uv_size: [w, h] };
};
function particle(name, tile, options) {
    const { position, size, alpha, tangent } = options;
    const components = {
        "minecraft:emitter_rate_instant": { num_particles: p("count", 1) },
        "minecraft:emitter_lifetime_once": { active_time: 0.05 },
        "minecraft:emitter_local_space": { position: true, rotation: true },
        "minecraft:emitter_shape_point": { offset: [0, 0, 0] },
        "minecraft:particle_lifetime_expression": { max_lifetime: life },
        "minecraft:particle_motion_parametric": { relative_position: position },
        "minecraft:particle_appearance_billboard": {
            size: Array.isArray(size) ? size : [size, size],
            facing_camera_mode: tangent ? "direction_x" : "rotate_xyz",
            ...(tangent ? { direction: { mode: "custom", custom_direction: tangent } } : {}),
            uv: tile === "cluster"
                ? { ...uv(tile), uv: [`${random(3)} < 0.48 ? ${tiles.flecks[0]} : ${tiles.cluster[0]}`, 0] }
                : uv(tile),
        },
        "minecraft:particle_appearance_tinting": {
            color: [p("red", 1), p("green", 0.78), p("blue", 0.49), `(${alpha}) * ${p("opacity", 0.7)}`],
        },
    };
    write(`particles/pbe_vfx_cinema_${name}.particle.json`, JSON.stringify({
        format_version: "1.10.0", particle_effect: {
            description: { identifier: `pbe:vfx_cinema_${name}`, basic_render_parameters: { material: "particles_add", texture } },
            components,
        },
    }, null, 2) + "\n");
}

const interp = (prefix, initial) => {
    const start = [initial, ...[1, 2, 3].map(i => p(`${prefix}${i}`, 0))];
    return start[0] + start.slice(1).map((value, i) =>
        ` + (${value} - ${start[i]}) * math.clamp(3 * (${progress}) - ${i}, 0, 1)`).join("");
};
particle("filament", "ribbon", {
    position: world(interp("x", 0), interp("y", 0), `(${interp("z", 0)}) * ${stageDepth}`),
    tangent: world(p("tx0", 1), p("ty0", 0), p("tz0", 0)),
    size: [`${p("length", 0.24)} * ${scale}`, `${p("width", 0.10)} * ${scale}`],
    alpha: `${p("light", 0.6)} * (${fade(0.14, 0.32)})`,
});

// The burst arcs every few seconds: a second ribbon laid flat across the floor.
particle("sweep", "ribbon", {
    position: world(interp("x", 0), interp("y", 0), `(${interp("z", 0)}) * ${stageDepth}`),
    tangent: world(p("tx0", 1), p("ty0", 0), p("tz0", 0)),
    size: [`${p("length", 0.34)} * ${scale}`, `${p("width", 0.10)} * ${scale}`],
    alpha: `${p("light", 0.6)} * (${fade(0.12, 0.30)})`,
});

const driftAngle = `360 * ${random(1)} + ${p("phase", 0)} + (15 + 22 * ${random(2)}) * ${age}`;
const dustRadius = `math.lerp(1.72 + 3.15 * ${random(3)}, ${p("radius", 2.8)} * (0.73 + 0.46 * ${random(3)}), ${p("coherence", 0)}) + ${p("release", 0)} * ${age} * (0.5 + ${random(4)})`;
const dustSize = `(0.034 + 0.071 * math.pow(${random(4)}, 2.2)) * ${scale}`;
particle("dust", "dust", {
    position: world(`(${dustRadius}) * math.sin(${driftAngle})`,
        `0.18 + 2.7 * math.pow(${random(2)}, 1.8) + 0.15 * math.sin(130 * ${age} + ${random(3)} * 360)`,
        `(${dustRadius}) * 0.87 * math.cos(${driftAngle}) * ${stageDepth}`),
    size: dustSize,
    alpha: `(${fade(0.51, 0.56)}) * (0.30 + 0.63 * ${random(4)}) * (0.45 + 0.55 * ${p("bright", 0.4)})`,
});

const sweep = `math.pow(${progress}, 0.77) * (0.58 + 0.46 * ${random(1)})`;
particle("note", "pearl", {
    position: world(`${p("drift", 0.3)} * (${sweep})`,
        `${p("height", 0.6)} * (1.28 * (${sweep}) - 0.35 * (${progress}) * (${progress}))`,
        `${p("depth", 0.9)} * (0.81 + 0.19 * ${p("sustain", 0.4)}) * (${sweep})`),
    size: `(0.035 + 0.045 * ${random(4)}) * (1 - 0.37 * ${progress}) * ${scale}`,
    alpha: `${fade(0.055, 0.30)} * 0.82`,
});

const strength = p("strength", 0.89);
const shockAngle = `360 * ${random(1)} + ${p("phase", 0)} - (24 + 15 * ${random(4)}) * ${age}`;
const front = `math.pow(${progress}, 0.69)`;
const shockRadius = `(0.85 + 0.87 * ${random(2)} + (1.92 + 1.83 * ${strength} + ${random(3)}) * (${front}))`;
particle("shock", "cluster", {
    position: world(`${shockRadius} * math.sin(${shockAngle})`,
        `0.16 + (0.20 + 1.20 * ${random(4)} * ${random(4)}) * math.sin(135 * (${front})) * ${strength}`,
        `0.91 * ${shockRadius} * math.cos(${shockAngle}) * ${stageDepth}`),
    size: `(0.15 + 0.20 * ${random(3)}) * (1 - 0.29 * (${front})) * ${scale}`,
    alpha: `(${fade(0.07, 0.78)}) * (0.54 + 0.46 * ${random(2)})`,
});

console.log(check ? "Secret cinema particle assets verified" : "Built Secret cinema dust clusters, key motes, burst and emissive atlas");
