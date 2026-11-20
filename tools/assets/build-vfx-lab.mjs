import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const root = new URL("../../packages/addon/rp/", import.meta.url);
const check = process.argv.includes("--check");
const width = 1024;
const height = 1024;
const texture = "textures/particle/vfx_lab";
const tiles = {
    mote: [0, 0, 32, 32],
    glint: [32, 0, 32, 32],
    silk: [64, 0, 32, 32],
    curtain: [96, 0, 32, 48],
    spark: [128, 0, 32, 32],
    beam: [0, 48, 256, 48],
    // Ground ring gets a dedicated 256² cell: it is stretched over several blocks.
    ripple: [0, 512, 256, 256],
    shaft: [128, 109, 128, 64],
    haze: [128, 225, 128, 30],
    flow: [128, 175, 128, 48],
    aurora: [256, 0, 256, 112],
    drape: [256, 112, 256, 92],
    bar: [256, 204, 256, 48],
    upright: [164, 2, 48, 44],
    shard: [212, 0, 44, 48],
    // 8 x 128² brush cells in a strip, then 4 x 256x96 stroke cells.
    brush_mote: [0, 768, 128, 128],
    brush_star: [128, 768, 128, 128],
    brush_petal: [256, 768, 128, 128],
    brush_snow: [384, 768, 128, 128],
    brush_note: [512, 768, 128, 128],
    brush_shard: [640, 768, 128, 128],
    brush_spark: [768, 768, 128, 128],
    brush_ring: [896, 768, 128, 128],
    stroke_silk: [0, 896, 256, 96],
    stroke_laser: [256, 896, 256, 96],
    stroke_comet: [512, 896, 256, 96],
    stroke_calligraphy: [768, 896, 256, 96],
};
const brushCell = tiles.brush_star[0] - tiles.brush_mote[0];
const strokeCell = tiles.stroke_laser[0] - tiles.stroke_silk[0];

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
            const channels = Array.isArray(light) ? light : [light, light, light];
            for (const [channel, value] of channels.entries()) pixels[index + channel] = Math.round(clamp(value) * 255);
            pixels[index + 3] = Math.round(clamp(alpha) * 255);
            const green = (top + y) * (width * 3 + 1) + (left + x) * 3 + 2;
            merPixels[green] = Math.round(255 * emissive * clamp(alpha) * Math.max(...channels.map(clamp)));
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
    return [0.81 + 0.19 * gaussian(radius - 0.78, 0.024),
        grooves * (0.78 * gaussian(radius - 0.78, 0.026) + 0.27 * gaussian(radius - 0.71, 0.040))
        * smooth((0.92 - radius) / 0.12)];
});
paint(tiles.shaft, 0.46, (x, y) => {
    const reach = (x + 1) / 2;
    const falloff = smooth(reach / 0.065) * smooth((1 - reach) / 0.42);
    const cross = y / (0.48 + 0.42 * reach);
    const core = gaussian(cross, 0.10);
    const air = gaussian(cross, 0.38) * smooth((0.94 - Math.abs(y)) / 0.28);
    return [0.79 + 0.21 * core, falloff * (0.67 * core + 0.48 * air) * (1 - reach * 0.55)];
});
paint(tiles.haze, 0.31, (x, y) => {
    const reach = (x + 1) / 2;
    const falloff = smooth(reach / 0.10) * smooth((1 - reach) / 0.60);
    const cross = y / (0.38 + 0.53 * reach);
    const core = gaussian(cross, 0.17);
    const air = gaussian(cross, 0.43) * smooth((0.94 - Math.abs(y)) / 0.33);
    return [0.85 + 0.15 * core, falloff * (0.26 * core + 0.61 * air) * (1 - reach * 0.38)];
});
paint(tiles.flow, 0.30, (x, y) => {
    const end = smooth((1 - Math.abs(x)) / 0.57);
    const ribbon = y - 0.17 * Math.sin((x + 0.2) * 3.0);
    const fold = gaussian(ribbon + 0.12, 0.11);
    const rim = gaussian(ribbon - 0.20, 0.057);
    const air = gaussian(ribbon, 0.34);
    return [0.85 + 0.15 * fold, end * (0.45 * fold + 0.29 * rim + 0.29 * air)];
});
paint(tiles.aurora, 0.25, (x, y) => {
    const sweep = -0.09 + 0.26 * Math.sin(3.05 * x - 0.37) + 0.13 * Math.sin(6.4 * x + 1.45);
    const v = y - sweep;
    const shelf = 0.20 * Math.sin(4.0 * x + 0.75);
    const mask = smooth((0.97 - Math.abs(x)) / 0.31) * smooth((0.93 - Math.abs(y)) / 0.40);
    const folds = 0.76 + 0.14 * Math.sin(59 * x + 9 * v) + 0.10 * Math.sin(133 * x - 14 * v);
    const arc = gaussian(v + 0.02, 0.052);
    const echo = gaussian(v + 0.24 + shelf, 0.070);
    const mist = gaussian(v - 0.12, 0.29) * folds;
    const stream = gaussian(v - 0.40 - shelf * 0.33, 0.13) * (0.60 + 0.40 * Math.cos(8 * x));
    const violet = smooth((x + 0.76 + 0.75 * v) / 1.52);
    return [[0.38 + 0.39 * violet, 0.94 - 0.23 * violet, 0.88 + 0.12 * violet],
        mask * (0.40 * arc + 0.27 * echo + 0.30 * mist + 0.19 * stream)];
});
paint(tiles.drape, 0.37, (x, y) => {
    const elevation = (1 - y) / 2;
    const folds = x - 0.11 * Math.sin(4.0 * y) + 0.08 * y;
    const opening = 0.26 + 0.44 * elevation;
    const filigree = gaussian(folds - opening, 0.045) + 0.77 * gaussian(folds + opening, 0.061);
    const vertical = 0.62 + 0.25 * Math.cos(58 * folds + 5 * y) + 0.13 * Math.sin(127 * x + 11 * y);
    const plume = gaussian(Math.abs(folds) - opening, 0.25) * vertical;
    const gate = smooth(elevation / 0.105) * smooth((1 - elevation) / 0.42) * smooth((0.95 - Math.abs(x)) / 0.30);
    return [[1, 0.67 + 0.25 * (1 - elevation), 0.58 + 0.33 * (1 - elevation)],
        gate * (0.42 * filigree + 0.53 * plume)];
});
paint(tiles.bar, 0.55, (x, y) => {
    const end = smooth((0.99 - Math.abs(x)) / 0.03);
    const core = gaussian(y, 0.10);
    const aura = gaussian(y, 0.34);
    return [0.80 + 0.20 * core, end * (0.79 * core + 0.33 * aura)];
});
paint(tiles.upright, 0.14, (x, y) => {
    const along = (1 - y) * 0.5;
    const core = gaussian(x, 0.17);
    const halo = gaussian(x, 0.37);
    const ends = smooth(along / 0.09) * smooth((1 - along) / 0.22);
    return [0.72 + 0.24 * core, ends * (0.72 * core + 0.21 * halo) * (1 - 0.20 * along)];
});

// Uneven facets with a bright cut edge, a translucent face and a thin split in the glass.
const glassOutline = [[-0.53, 0.67], [-0.21, -0.46], [0.55, -0.82], [0.43, -0.13], [0.09, 0.3]];
paint(tiles.shard, 0.72, (x, y) => {
    let edge = Infinity;
    for (const [index, [ax, ay]] of glassOutline.entries()) {
        const [bx, by] = glassOutline[(index + 1) % glassOutline.length];
        edge = Math.min(edge, ((bx - ax) * (y - ay) - (by - ay) * (x - ax)) / Math.hypot(bx - ax, by - ay));
    }
    const interior = smooth((edge + 0.025) / 0.065);
    const cut = interior * gaussian(edge, 0.088);
    const seam = gaussian(x - (0.13 - 0.61 * y), 0.05) * interior;
    const glow = 0.28 * gaussian(Math.min(0, edge), 0.084);
    const facet = x > 0.13 - 0.61 * y ? 0.16 : 0.40;
    const light = 0.62 + 0.38 * Math.max(cut, seam);
    return [[light * 0.88, light * 0.96, light], facet * interior + 0.67 * cut + 0.74 * seam + glow];
});

// 8 brushes (64x64 at y=256) for generic draw_point primitives
paint(tiles.brush_mote, 0.62, (x, y) => {
    const r = Math.hypot(x, y);
    const core = gaussian(r, 0.15);
    const halo = gaussian(r, 0.37);
    const rim = 0.12 * gaussian(r - 0.48, 0.08);
    return [0.70 + 0.30 * core, (0.76 * core + 0.28 * halo + rim) * smooth((0.90 - r) / 0.28)];
});
paint(tiles.brush_star, 0.85, (x, y) => {
    const r = Math.hypot(x, y);
    const core = gaussian(r, 0.11);
    const axis = gaussian(x, 0.052) * gaussian(y, 0.46) + gaussian(y, 0.052) * gaussian(x, 0.46);
    const dx = (x + y) * 0.7071;
    const dy = (x - y) * 0.7071;
    const diag = 0.45 * (gaussian(dx, 0.045) * gaussian(dy, 0.28) + gaussian(dy, 0.045) * gaussian(dx, 0.28));
    const halo = 0.24 * gaussian(r, 0.27);
    return [0.76 + 0.24 * core, clamp(core + 0.78 * axis + diag + halo) * smooth((0.92 - r) / 0.22)];
});
paint(tiles.brush_petal, 0.48, (x, y) => {
    const rx = x * 0.96 + y * 0.24;
    const ry = -x * 0.24 + y * 0.96;
    const widthCurve = 0.42 + 0.18 * smooth((0.4 - ry) / 0.9) - 0.28 * smooth((ry - 0.15) / 0.7);
    const notch = ry < -0.25 ? 0.14 * gaussian(rx, 0.16) * smooth((-0.25 - ry) / 0.45) : 0;
    const dist = Math.hypot(rx / Math.max(0.14, widthCurve), (ry + 0.05) / 0.72) + notch * 1.8;
    const body = smooth((0.86 - dist) / 0.22);
    const vein = 0.32 * gaussian(rx, 0.07) * smooth((0.68 - Math.abs(ry)) / 0.4);
    const edgeGlow = 0.22 * gaussian(dist - 0.72, 0.09);
    return [[0.94 + 0.06 * vein, 0.82 + 0.16 * body, 0.90 + 0.10 * vein], clamp(body * 0.78 + vein + edgeGlow)];
});
paint(tiles.brush_snow, 0.68, (x, y) => {
    const r = Math.hypot(x, y);
    const a = Math.atan2(y, x);
    const sector = Math.PI / 3;
    const folded = Math.abs((((a + Math.PI) % sector) + sector) % sector - sector / 2);
    const axial = r * Math.cos(folded);
    const perp = r * Math.sin(folded);
    const arm = gaussian(perp, 0.042) * smooth((0.82 - axial) / 0.16);
    const branch1 = gaussian(Math.abs(axial - 0.42 - perp * 1.45), 0.036) * smooth((0.55 - perp) / 0.22) * smooth((axial - 0.22) / 0.12);
    const branch2 = gaussian(Math.abs(axial - 0.63 - perp * 1.45), 0.030) * smooth((0.36 - perp) / 0.18) * smooth((axial - 0.48) / 0.10);
    const center = 0.62 * gaussian(r, 0.12);
    const halo = 0.18 * gaussian(r, 0.42);
    return [0.78 + 0.22 * clamp(center + arm), clamp(arm * 0.86 + branch1 * 0.75 + branch2 * 0.68 + center + halo) * smooth((0.92 - r) / 0.16)];
});
paint(tiles.brush_note, 0.78, (x, y) => {
    // Glowing eighth-note silhouette
    const hx = (x + 0.18) * 0.86 - (y - 0.32) * 0.50;
    const hy = (x + 0.18) * 0.50 + (y - 0.32) * 0.86;
    const headDist = Math.hypot(hx / 0.26, hy / 0.19);
    const head = smooth((1.05 - headDist) / 0.26);
    const stem = smooth((0.068 - Math.abs(x - 0.03)) / 0.036) * smooth((y + 0.52) / 0.06) * smooth((0.35 - y) / 0.06);
    const flagT = clamp((y + 0.52) / 0.48);
    const flagX = 0.03 + 0.36 * Math.sin(flagT * 1.7) * (1 - 0.25 * flagT);
    const flag = gaussian(x - flagX, 0.052 * (1.1 - 0.55 * flagT)) * smooth((y + 0.54) / 0.06) * smooth((0.02 - y) / 0.12);
    const shape = clamp(Math.max(head, stem, flag));
    const aura = 0.35 * gaussian(Math.hypot(x, y), 0.46);
    return [0.76 + 0.24 * shape, clamp(shape * 0.92 + aura) * smooth((0.95 - Math.hypot(x, y)) / 0.16)];
});
paint(tiles.brush_shard, 0.74, (x, y) => {
    let edge = Infinity;
    for (const [index, [ax, ay]] of glassOutline.entries()) {
        const [bx, by] = glassOutline[(index + 1) % glassOutline.length];
        edge = Math.min(edge, ((bx - ax) * (y - ay) - (by - ay) * (x - ax)) / Math.hypot(bx - ax, by - ay));
    }
    const interior = smooth((edge + 0.03) / 0.07);
    const cut = interior * gaussian(edge, 0.09);
    const seam = gaussian(x - (0.12 - 0.60 * y), 0.05) * interior;
    const glow = 0.30 * gaussian(Math.min(0, edge), 0.09);
    const facet = x > 0.12 - 0.60 * y ? 0.20 : 0.44;
    const light = 0.66 + 0.34 * Math.max(cut, seam);
    return [[light * 0.90, light * 0.97, light], clamp(facet * interior + 0.68 * cut + 0.72 * seam + glow)];
});
paint(tiles.brush_spark, 0.80, (x, y) => {
    const r = 1.48 * Math.abs(x) + 0.66 * Math.abs(y);
    const core = gaussian(r, 0.16);
    const flare = gaussian(r, 0.30);
    return [0.76 + 0.24 * core, clamp(0.84 * core + 0.46 * flare) * smooth((0.92 - r) / 0.28)];
});
paint(tiles.brush_ring, 0.64, (x, y) => {
    const r = Math.hypot(x, y);
    const angle = Math.atan2(y, x);
    const shimmer = 0.88 + 0.12 * Math.cos(angle * 8);
    const outer = gaussian(r - 0.72, 0.042);
    const inner = 0.48 * gaussian(r - 0.54, 0.055);
    return [0.78 + 0.22 * outer, shimmer * (outer + inner) * smooth((0.92 - r) / 0.14)];
});

// 4 strokes (128x48 at y=320) for generic draw_stroke primitives
paint(tiles.stroke_silk, 0.48, (x, y) => {
    const end = smooth((0.97 - Math.abs(x)) / 0.46);
    const core = gaussian(y, 0.15);
    const side = 0.24 * (gaussian(y - 0.26, 0.06) + gaussian(y + 0.26, 0.06));
    const halo = 0.22 * gaussian(y, 0.42);
    return [0.78 + 0.22 * core, end * smooth((0.92 - Math.abs(y)) / 0.22) * (0.76 * core + side + halo)];
});
paint(tiles.stroke_laser, 0.82, (x, y) => {
    const end = smooth((0.98 - Math.abs(x)) / 0.20);
    const core = gaussian(y, 0.085);
    const aura = 0.34 * gaussian(y, 0.26);
    return [0.84 + 0.16 * core, end * smooth((0.92 - Math.abs(y)) / 0.20) * (0.92 * core + aura)];
});
paint(tiles.stroke_comet, 0.70, (x, y) => {
    const t = (x + 1) / 2;
    const env = smooth((t - 0.02) / 0.55) * smooth((0.98 - t) / 0.16);
    const cross = y / (0.34 + 0.62 * smooth((t - 0.15) / 0.85));
    const core = gaussian(cross, 0.12);
    const wake = 0.32 * gaussian(cross, 0.36);
    const head = 0.72 + 0.28 * gaussian(x - 0.48, 0.26);
    return [0.78 + 0.22 * core, env * head * smooth((0.90 - Math.abs(y)) / 0.22) * (0.82 * core + wake)];
});
paint(tiles.stroke_calligraphy, 0.54, (x, y) => {
    const end = smooth((0.97 - Math.abs(x)) / 0.44);
    const curve = y - 0.12 * Math.sin(x * 3.1);
    const primary = gaussian(curve + 0.08, 0.10);
    const echo = 0.52 * gaussian(curve - 0.16, 0.065);
    const mist = 0.24 * gaussian(curve, 0.32);
    return [0.82 + 0.18 * primary, end * smooth((0.92 - Math.abs(y)) / 0.22) * (0.76 * primary + echo + mist)];
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
function alternateUv(base, alternate, name) {
    const coordinate = index => base[index] === alternate[index] ? base[index]
        : `${param(name, 0)} > 0.5 ? ${alternate[index]} : ${base[index]}`;
    return { ...uv(base), uv: [coordinate(0), coordinate(1)], uv_size: [coordinate(2), coordinate(3)] };
}
function thirdUv(base, middle, last, name) {
    const coordinate = index => base[index] === middle[index] && middle[index] === last[index] ? base[index]
        : `${param(name, 0)} > 1.5 ? ${last[index]} : (${param(name, 0)} > 0.5 ? ${middle[index]} : ${base[index]})`;
    return { ...uv(base), uv: [coordinate(0), coordinate(1)], uv_size: [coordinate(2), coordinate(3)] };
}
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
            mode: "custom",
            custom_direction: rotate(
                arcOrLine(`-(${arcSign}) * math.sin(${arcAngle})`, `${dirX} - (${crossSlope}) * ${dirZ}`),
                arcOrLine(`(${arcSign}) * 0.59 * ${bend} * math.cos(${arcAngle} - 24) / ${arcRadius}`, lineSlopeY),
                arcOrLine(`(${arcSign}) * math.cos(${arcAngle}) * ${arcDepth}`, `${dirZ} + (${crossSlope}) * ${dirX}`)),
        },
        uv: alternateUv(tiles.beam, tiles.flow, "silk"),
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

const shardLife = `(1.3 + 0.53 * ${random(3)}) / ${param("speed", 1)}`;
const shardProgress = `math.pow(${saturate(`${age} / (${shardLife})`)}, 0.76)`;
const shardFlow = param("flow", 1);
const shardDistance = `math.lerp(1 - (${shardProgress}), ${shardProgress}, 0.5 + 0.5 * ${shardFlow})`;
const shardSpread = `(0.35 + 0.65 * ${random(1)}) * (${shardDistance}) * ${extent}`;
const shardWidth = scaled(`(0.092 + 0.115 * ${random(4)}) * ${param("size", 1)}`);
particle("shard", {
    "minecraft:emitter_rate_instant": { num_particles: param("count", 5) },
    "minecraft:emitter_lifetime_once": { active_time: 0.06 },
    "minecraft:emitter_local_space": localSpace,
    "minecraft:emitter_shape_point": point,
    "minecraft:particle_initial_spin": {
        rotation: `-30 + 60 * ${random(2)}`,
        rotation_rate: `${param("side", 1)} * (29 + 95 * ${random(3)}) * ${shardFlow}`,
    },
    "minecraft:particle_motion_parametric": { relative_position: position(
        `${param("side", 1)} * (1.33 * ${shardSpread} + 0.23 * ${random(4)})`,
        `0.13 + 0.31 * ${random(2)} + (0.25 + 0.74 * ${random(4)}) * math.sin(105 * (${shardDistance}))`,
        `(0.33 * (2 * ${random(1)} - 1) + (0.46 + 0.81 * ${random(2)}) * ${shardSpread}) * ${stageDepth}`) },
    "minecraft:particle_lifetime_expression": { max_lifetime: shardLife },
    "minecraft:particle_appearance_billboard": {
        facing_camera_mode: "rotate_xyz",
        size: [`(${shardWidth}) * (0.72 + 0.28 * math.abs(math.cos(210 * ${age} + 270 * ${random(1)})))`,
            `(1.63 + 0.7 * ${random(1)}) * (${shardWidth})`],
        uv: uv(tiles.shard),
    },
    "minecraft:particle_appearance_tinting": tint([0.55, 0.82, 1],
        `${fade(0.15, 0.52)} * (0.48 + 0.52 * math.abs(math.cos(143 * ${age} + 360 * ${random(4)})))`),
});

const curtainLife = param("life", 1.38);
const curtainPhase = `${param("phase", 0)} + 130 * ${param("speed", 1)} * ${age}`;
const sheet = param("sheet", 0);
const curtainLength = param("length", 1.4);
const sheetHeight = `math.lerp(${param("previous_length", 1.4)}, ${curtainLength}, ${saturate(`${age} / 0.86`)})`;
const curtainY = `${sheet} > 1.5 ? (0.5 * ${sheetHeight} + 0.08 * math.sin(${curtainPhase})) : (${sheet} > 0.5 ? 0.16 * math.sin(${curtainPhase}) : 0.16 * math.sin(${curtainPhase}) - 0.32 * ${age})`;
const curtainX = `${sheet} > 0.5 ? 0.18 * math.cos(${curtainPhase}) : 0`;
particle("curtain", {
    "minecraft:emitter_rate_instant": { num_particles: 1 },
    "minecraft:emitter_lifetime_once": { active_time: curtainLife },
    "minecraft:emitter_local_space": localSpace,
    "minecraft:emitter_shape_point": point,
    "minecraft:particle_initial_spin": { rotation: param("roll", 0) },
    "minecraft:particle_motion_parametric": { relative_position: position(curtainX, curtainY,
        `(${sheet} > 0.5 ? 0.14 : 0.21) * math.cos(${curtainPhase})`) },
    "minecraft:particle_lifetime_expression": { max_lifetime: curtainLife },
    "minecraft:particle_appearance_billboard": {
        facing_camera_mode: "lookat_y",
        size: [scaled(`0.5 * ${param("width", 0.14)}`), scaled(`0.5 * (${sheet} > 0.5 ? ${sheetHeight} : ${curtainLength})`)],
        uv: thirdUv(tiles.curtain, tiles.aurora, tiles.drape, "sheet"),
    },
    "minecraft:particle_appearance_tinting": tint([0.55, 0.62, 0.94],
        `(${sheet} > 0.5 ? ${fade(0.89, 0.89)} * (0.79 + 0.14 * math.sin(${curtainPhase})) : ${fade(0.34, 0.52)})`),
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

const shaftLife = param("life", 1.6);
const shaftLength = `math.lerp(${param("previous_length", 2)}, ${param("length", 2)}, ${saturate(`${age} / 0.8`)})`;
const shaftDirection = [param("dir_x", 0), param("dir_y", 1), param("dir_z", 0)];
particle("shaft_upright", {
    "minecraft:emitter_rate_instant": { num_particles: 1 },
    "minecraft:emitter_lifetime_once": { active_time: shaftLife },
    "minecraft:emitter_local_space": localSpace,
    "minecraft:emitter_shape_point": point,
    "minecraft:particle_motion_parametric": { relative_position: position(0, `0.5 * (${shaftLength})`, 0) },
    "minecraft:particle_lifetime_expression": { max_lifetime: shaftLife },
    "minecraft:particle_appearance_billboard": {
        facing_camera_mode: "lookat_y",
        size: [scaled(`0.5 * ${param("width", 0.15)}`), scaled(`0.5 * (${shaftLength})`)],
        uv: uv(tiles.upright),
    },
    "minecraft:particle_appearance_tinting": tint([0.66, 0.87, 1], fade(0.8, 0.8)),
});
particle("shaft", {
    "minecraft:emitter_rate_instant": { num_particles: 1 },
    "minecraft:emitter_lifetime_once": { active_time: shaftLife },
    "minecraft:emitter_local_space": localSpace,
    "minecraft:emitter_shape_point": point,
    "minecraft:particle_motion_parametric": {
        relative_position: position(...shaftDirection.map(axis => `0.5 * (${shaftLength}) * (${axis})`)),
    },
    "minecraft:particle_lifetime_expression": { max_lifetime: shaftLife },
    "minecraft:particle_appearance_billboard": {
        facing_camera_mode: "lookat_direction",
        size: [scaled(`0.5 * (${shaftLength})`), scaled(`0.5 * ${param("width", 0.15)}`)],
        direction: { mode: "custom", custom_direction: rotate(...shaftDirection) },
        uv: thirdUv(tiles.shaft, tiles.haze, tiles.bar, "shaft_style"),
    },
    "minecraft:particle_appearance_tinting": tint([0.66, 0.87, 1], fade(0.8, 0.8)),
});

// 3 generic parameterized drawing primitives
const drawAge = "math.clamp(variable.particle_age / math.max(0.01, variable.particle_lifetime), 0, 1)";
const drawCurve = `math.pow(${drawAge}, ${param("curve", 1)})`;
const drawFade = `${fade(`math.max(0.01, ${param("fade_in", 0.16)})`, `math.max(0.01, ${param("fade_out", 0.35)})`)}`;
const drawTint = {
    color: [
        `math.lerp(${param("red", 1)}, ${param("red2", param("red", 1))}, ${drawAge})`,
        `math.lerp(${param("green", 1)}, ${param("green2", param("green", 1))}, ${drawAge})`,
        `math.lerp(${param("blue", 1)}, ${param("blue2", param("blue", 1))}, ${drawAge})`,
        `${param("opacity", 0.8)} * ${drawFade}`,
    ],
};

const ptAngle = `${param("phase", 0)} + ${param("phase_spread", 360)} * ${random(1)} + ${param("omega", 0)} * ${age}`;
const ptRadius = `math.lerp(${param("radius", 0)}, ${param("radius_end", 0)}, ${drawCurve}) + ${param("radial_jitter", 0)} * (2 * ${random(3)} - 1)`;
const ptFlutter = param("flutter", 0);
const ptX = `${param("spread_x", 0)} * (2 * ${random(2)} - 1) + (${ptRadius}) * math.cos(${ptAngle}) + ${param("vx", 0)} * ${age} + 0.5 * ${param("ax", 0)} * ${age} * ${age} + (${ptFlutter}) * math.sin(170 * ${age} + 360 * ${random(2)})`;
const ptY = `${param("spread_y", 0)} * (2 * ${random(3)} - 1) + ${param("tilt", 0)} * math.sin(${ptAngle}) + ${param("rise", 0)} * ${drawCurve} + ${param("vy", 0)} * ${age} + 0.5 * ${param("ay", 0)} * ${age} * ${age}`;
const ptZ = `(${param("spread_z", 0)} * (2 * ${random(4)} - 1) + (${ptRadius}) * ${param("depth_ratio", 0.9)} * math.sin(${ptAngle}) + ${param("vz", 0)} * ${age} + 0.5 * ${param("az", 0)} * ${age} * ${age} + (${ptFlutter}) * math.cos(145 * ${age} + 360 * ${random(3)})) * ${stageDepth}`;
const ptSize = scaled(`math.lerp(${param("size", 0.08)}, ${param("size_end", 0.08)}, ${drawAge}) * (1 + ${param("size_jitter", 0.25)} * (2 * ${random(4)} - 1))`);
const ptTwinkle = `((1 - ${param("twinkle", 0)}) + ${param("twinkle", 0)} * (0.45 + 0.55 * math.sin(260 * ${age} + 360 * ${random(4)})))`;

particle("draw_point", {
    "minecraft:emitter_rate_instant": { num_particles: param("count", 1) },
    "minecraft:emitter_lifetime_once": { active_time: 0.05 },
    "minecraft:emitter_local_space": localSpace,
    "minecraft:emitter_shape_point": point,
    "minecraft:particle_initial_spin": {
        rotation: `${param("spin", 0)} + ${param("spin_jitter", 0)} * (2 * ${random(2)} - 1)`,
        rotation_rate: param("spin_rate", 0),
    },
    "minecraft:particle_motion_parametric": {
        relative_position: position(ptX, ptY, ptZ),
    },
    "minecraft:particle_lifetime_expression": {
        max_lifetime: `math.max(0.1, ${param("life", 1.5)} * (1 + ${param("life_jitter", 0.2)} * (2 * ${random(1)} - 1)))`,
    },
    "minecraft:particle_appearance_billboard": {
        facing_camera_mode: "rotate_xyz",
        size: [ptSize, ptSize],
        uv: {
            texture_width: width,
            texture_height: height,
            uv: [`math.floor(math.clamp(${param("brush", 0)}, 0, 7)) * ${brushCell}`, tiles.brush_mote[1]],
            uv_size: [brushCell, brushCell],
        },
    },
    "minecraft:particle_appearance_tinting": {
        color: [drawTint.color[0], drawTint.color[1], drawTint.color[2], `${drawTint.color[3]} * ${ptTwinkle}`],
    },
});

const strokeLen = scaled(`math.lerp(${param("length", 0.3)}, ${param("length_end", 0.3)}, ${drawAge})`);
particle("draw_stroke", {
    "minecraft:emitter_rate_instant": { num_particles: param("count", 1) },
    "minecraft:emitter_lifetime_once": { active_time: 0.05 },
    "minecraft:emitter_local_space": localSpace,
    "minecraft:emitter_shape_point": point,
    "minecraft:particle_motion_parametric": {
        relative_position: position(
            `${param("vx", 0)} * ${age} + 0.5 * ${param("ax", 0)} * ${age} * ${age}`,
            `${param("vy", 0)} * ${age} + 0.5 * ${param("ay", 0)} * ${age} * ${age}`,
            `(${param("vz", 0)} * ${age} + 0.5 * ${param("az", 0)} * ${age} * ${age}) * ${stageDepth}`,
        ),
    },
    "minecraft:particle_lifetime_expression": { max_lifetime: `math.max(0.1, ${param("life", 1.4)})` },
    "minecraft:particle_appearance_billboard": {
        facing_camera_mode: "direction_x",
        size: [`0.5 * (${strokeLen})`, scaled(`0.5 * ${param("width", 0.08)}`)],
        direction: {
            mode: "custom",
            custom_direction: rotate(param("tx", 1), param("ty", 0), `${param("tz", 0)} * ${stageDepth}`),
        },
        uv: {
            texture_width: width,
            texture_height: height,
            uv: [`math.floor(math.clamp(${param("brush", 0)}, 0, 3)) * ${strokeCell}`, tiles.stroke_silk[1]],
            uv_size: [strokeCell, tiles.stroke_silk[3]],
        },
    },
    "minecraft:particle_appearance_tinting": drawTint,
});

const planeR = scaled(`math.lerp(${param("radius_start", 0.4)}, ${param("radius_end", 2.4)}, math.pow(${drawAge}, ${param("curve", 0.7)})) * ${stageDepth}`);
particle("draw_plane", {
    "minecraft:emitter_rate_instant": { num_particles: 1 },
    "minecraft:emitter_lifetime_once": { active_time: 0.05 },
    "minecraft:emitter_local_space": localSpace,
    "minecraft:emitter_shape_point": point,
    "minecraft:particle_initial_spin": {
        rotation: param("spin", 0),
        rotation_rate: param("spin_rate", 0),
    },
    "minecraft:particle_motion_parametric": {
        relative_position: position(0, `${param("vy", 0)} * ${age}`, 0),
    },
    "minecraft:particle_lifetime_expression": { max_lifetime: `math.max(0.1, ${param("life", 1.2)})` },
    "minecraft:particle_appearance_billboard": {
        facing_camera_mode: "emitter_transform_xz",
        size: [planeR, planeR],
        uv: alternateUv(tiles.ripple, tiles.brush_ring, "style"),
    },
    "minecraft:particle_appearance_tinting": drawTint,
});

console.log(check ? "VFX Lab: checked particles, RGBA atlas and emissive texture set" : "VFX Lab: built particles, RGBA atlas and emissive texture set");
