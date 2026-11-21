import { clamp, createAtlasBuffers, encodePng, gaussian, paintTile, smooth } from "./png.mjs";

const glassOutline = [[-0.53, 0.67], [-0.21, -0.46], [0.55, -0.82], [0.43, -0.13], [0.09, 0.3]];

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
            detail += brightness * gaussian(r, size);
            scattered += 0.16 * brightness * gaussian(r, size * 2.7);
        }
        const drift = mist * gaussian(Math.hypot(x, y), 0.39);
        return [0.66 + 0.34 * clamp(detail), (detail + scattered + drift) * smooth((0.93 - Math.hypot(x, y)) / 0.27)];
    };
}

const TILE_PAINTERS = {
    mote: [0.56, (x, y) => {
        const r = Math.hypot(x, y);
        return [0.66 + 0.34 * gaussian(r, 0.16), (0.77 * gaussian(r, 0.16) + 0.23 * gaussian(r, 0.36)) * smooth((0.86 - r) / 0.3)];
    }],
    glint: [0.81, (x, y) => {
        const r = Math.hypot(x, y);
        const halo = 0.28 * gaussian(r, 0.29);
        const flare = 0.34 * gaussian(x, 0.075) * gaussian(y, 0.37) + 0.23 * gaussian(x, 0.33) * gaussian(y, 0.068);
        return [0.77 + 0.23 * gaussian(r, 0.15), (halo + flare + 0.45 * gaussian(r, 0.115)) * smooth((0.86 - r) / 0.25)];
    }],
    silk: [0.23, (x, y) => {
        const radius = Math.hypot(x, y);
        const core = gaussian(radius, 0.24);
        const halo = gaussian(radius, 0.49);
        return [0.72 + 0.28 * core, smooth((0.93 - radius) / 0.29) * (0.76 * core + 0.16 * halo)];
    }],
    beam: [0.59, (x, y) => {
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
    }],
    curtain: [0.26, (x, y) => {
        const edges = smooth((0.85 - Math.abs(x)) / 0.47) * smooth((0.9 - Math.abs(y)) / 0.45);
        const threads = 0.54 * gaussian(x, 0.17) + 0.16 * gaussian(x - 0.36, 0.09) + 0.14 * gaussian(x + 0.3, 0.12);
        return [0.76 + 0.24 * gaussian(x, 0.19), edges * threads * (0.86 + 0.14 * Math.cos(y * 10))];
    }],
    spark: [0.53, (x, y) => {
        const radius = Math.abs(x) + 0.71 * Math.abs(y);
        return [0.71 + 0.29 * gaussian(radius, 0.21), gaussian(radius, 0.32) * smooth((0.9 - radius) / 0.32)];
    }],
    ripple: [0.35, (x, y) => {
        const radius = Math.hypot(x, y);
        const angle = Math.atan2(y, x);
        const grooves = 0.84 + 0.16 * Math.cos(angle * 9 + 0.35 * Math.sin(angle * 4));
        return [0.81 + 0.19 * gaussian(radius - 0.78, 0.024),
            grooves * (0.78 * gaussian(radius - 0.78, 0.026) + 0.27 * gaussian(radius - 0.71, 0.040)) * smooth((0.92 - radius) / 0.12)];
    }],
    shaft: [0.46, (x, y) => {
        const reach = (x + 1) / 2;
        const falloff = smooth(reach / 0.065) * smooth((1 - reach) / 0.42);
        const cross = y / (0.48 + 0.42 * reach);
        const core = gaussian(cross, 0.10);
        const air = gaussian(cross, 0.38) * smooth((0.94 - Math.abs(y)) / 0.28);
        return [0.79 + 0.21 * core, falloff * (0.67 * core + 0.48 * air) * (1 - reach * 0.55)];
    }],
    haze: [0.31, (x, y) => {
        const reach = (x + 1) / 2;
        const falloff = smooth(reach / 0.10) * smooth((1 - reach) / 0.60);
        const cross = y / (0.38 + 0.53 * reach);
        const core = gaussian(cross, 0.17);
        const air = gaussian(cross, 0.43) * smooth((0.94 - Math.abs(y)) / 0.33);
        return [0.85 + 0.15 * core, falloff * (0.26 * core + 0.61 * air) * (1 - reach * 0.38)];
    }],
    flow: [0.30, (x, y) => {
        const end = smooth((1 - Math.abs(x)) / 0.57);
        const ribbon = y - 0.17 * Math.sin((x + 0.2) * 3.0);
        const fold = gaussian(ribbon + 0.12, 0.11);
        const rim = gaussian(ribbon - 0.20, 0.057);
        const air = gaussian(ribbon, 0.34);
        return [0.85 + 0.15 * fold, end * (0.45 * fold + 0.29 * rim + 0.29 * air)];
    }],
    aurora: [0.25, (x, y) => {
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
    }],
    drape: [0.37, (x, y) => {
        const elevation = (1 - y) / 2;
        const folds = x - 0.11 * Math.sin(4.0 * y) + 0.08 * y;
        const opening = 0.26 + 0.44 * elevation;
        const filigree = gaussian(folds - opening, 0.045) + 0.77 * gaussian(folds + opening, 0.061);
        const vertical = 0.62 + 0.25 * Math.cos(58 * folds + 5 * y) + 0.13 * Math.sin(127 * x + 11 * y);
        const plume = gaussian(Math.abs(folds) - opening, 0.25) * vertical;
        const gate = smooth(elevation / 0.105) * smooth((1 - elevation) / 0.42) * smooth((0.95 - Math.abs(x)) / 0.30);
        return [[1, 0.67 + 0.25 * (1 - elevation), 0.58 + 0.33 * (1 - elevation)],
            gate * (0.42 * filigree + 0.53 * plume)];
    }],
    bar: [0.55, (x, y) => {
        const end = smooth((0.99 - Math.abs(x)) / 0.03);
        const core = gaussian(y, 0.10);
        const aura = gaussian(y, 0.34);
        return [0.80 + 0.20 * core, end * (0.79 * core + 0.33 * aura)];
    }],
    upright: [0.14, (x, y) => {
        const along = (1 - y) * 0.5;
        const core = gaussian(x, 0.17);
        const halo = gaussian(x, 0.37);
        const ends = smooth(along / 0.09) * smooth((1 - along) / 0.22);
        return [0.72 + 0.24 * core, ends * (0.72 * core + 0.21 * halo) * (1 - 0.20 * along)];
    }],
    shard: [0.72, (x, y) => {
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
    }],
    cloud_puff: [0.34, (x, y) => {
        const lobes = [
            [0.0, 0.05, 0.44, 0.30, 0.72],
            [-0.32, 0.14, 0.32, 0.24, 0.54],
            [0.34, 0.12, 0.34, 0.25, 0.56],
            [-0.14, -0.14, 0.30, 0.22, 0.52],
            [0.20, -0.12, 0.28, 0.21, 0.48],
        ];
        let density = 0;
        for (const [cx, cy, rx, ry, w] of lobes) {
            density += w * gaussian(Math.hypot((x - cx) / rx, (y - cy) / ry), 0.72);
        }
        const edgeFade = smooth((0.96 - Math.hypot(x, y)) / 0.32);
        const alpha = clamp(density * 0.62) * edgeFade;
        const rim = smooth((0.35 - y) / 0.85);
        const light = 0.76 + 0.24 * rim;
        return [[light, light * (0.94 + 0.06 * rim), light * (0.92 + 0.08 * rim)], alpha];
    }],
    comet_body: [0.90, (x, y) => {
        const hx = x - 0.80;
        const hr = Math.hypot(hx * 3.1, y);
        const nucleus = gaussian(hr, 0.11);
        const innerGlow = 0.55 * gaussian(hr, 0.28);
        const glint = 0.82 * gaussian(hx * 3.1, 0.045) * gaussian(y, 0.54)
            + 0.48 * gaussian(y, 0.048) * gaussian(hx * 3.1, 0.36);
        const u = clamp((x + 0.96) / 1.76);
        const inTail = smooth((0.84 - x) / 0.06) * smooth((x + 0.98) / 0.34);
        const widthProfile = 0.055 + 0.28 * (1 - u) ** 0.85;
        const spine = gaussian(y, widthProfile * 0.34) * (0.20 + 0.80 * u ** 1.15);
        const upperWisp = 0.42 * gaussian(y - widthProfile * 0.58, widthProfile * 0.26) * (0.35 + 0.65 * u) * (1 - 0.35 * u);
        const lowerWisp = 0.42 * gaussian(y + widthProfile * 0.58, widthProfile * 0.26) * (0.35 + 0.65 * u) * (1 - 0.35 * u);
        const mistHalo = 0.28 * gaussian(y, widthProfile * 1.25) * smooth((0.92 - Math.abs(y)) / 0.26) * (0.25 + 0.75 * u ** 0.7);
        const tail = inTail * (spine + upperWisp + lowerWisp + mistHalo) * (0.10 + 0.90 * u ** 0.85);
        const alpha = clamp(nucleus + innerGlow + glint + tail) * smooth((0.96 - Math.abs(y)) / 0.14);
        const hot = clamp(nucleus + 0.75 * glint + 0.55 * spine * inTail);
        const outer = clamp((upperWisp + lowerWisp + mistHalo) * inTail * (1 - hot));
        return [[clamp(0.76 + 0.24 * hot + 0.16 * outer), clamp(0.88 + 0.12 * hot - 0.08 * outer), clamp(0.96 + 0.04 * hot)], alpha];
    }],
    cinema_dust: [0.52, (x, y) => {
        const r = Math.hypot(x, y);
        const halo = 0.25 * gaussian(r, 0.31);
        return [0.67 + 0.28 * gaussian(r, 0.13), (0.55 * gaussian(r, 0.16) + halo) * smooth((0.91 - r) / 0.26)];
    }],
    cinema_cluster: [0.63, grainProfile(speckles, 0.083)],
    cinema_flecks: [0.69, grainProfile(otherSpeckles, 0.022)],
};

const POINT_BRUSH_PAINTERS = {
    mote: [0.62, (x, y) => {
        const r = Math.hypot(x, y);
        const core = gaussian(r, 0.15);
        const halo = gaussian(r, 0.37);
        const rim = 0.12 * gaussian(r - 0.48, 0.08);
        return [0.70 + 0.30 * core, (0.76 * core + 0.28 * halo + rim) * smooth((0.90 - r) / 0.28)];
    }],
    star: [0.85, (x, y) => {
        const r = Math.hypot(x, y);
        const core = gaussian(r, 0.11);
        const axis = gaussian(x, 0.052) * gaussian(y, 0.46) + gaussian(y, 0.052) * gaussian(x, 0.46);
        const dx = (x + y) * 0.7071;
        const dy = (x - y) * 0.7071;
        const diag = 0.45 * (gaussian(dx, 0.045) * gaussian(dy, 0.28) + gaussian(dy, 0.045) * gaussian(dx, 0.28));
        const halo = 0.24 * gaussian(r, 0.27);
        return [0.76 + 0.24 * core, clamp(core + 0.78 * axis + diag + halo) * smooth((0.92 - r) / 0.22)];
    }],
    petal: [0.48, (x, y) => {
        const rx = x * 0.96 + y * 0.24;
        const ry = -x * 0.24 + y * 0.96;
        const widthCurve = 0.42 + 0.18 * smooth((0.4 - ry) / 0.9) - 0.28 * smooth((ry - 0.15) / 0.7);
        const notch = ry < -0.25 ? 0.14 * gaussian(rx, 0.16) * smooth((-0.25 - ry) / 0.45) : 0;
        const dist = Math.hypot(rx / Math.max(0.14, widthCurve), (ry + 0.05) / 0.72) + notch * 1.8;
        const body = smooth((0.86 - dist) / 0.22);
        const vein = 0.32 * gaussian(rx, 0.07) * smooth((0.68 - Math.abs(ry)) / 0.4);
        const edgeGlow = 0.22 * gaussian(dist - 0.72, 0.09);
        return [[0.94 + 0.06 * vein, 0.82 + 0.16 * body, 0.90 + 0.10 * vein], clamp(body * 0.78 + vein + edgeGlow)];
    }],
    snow: [0.68, (x, y) => {
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
    }],
    note: [0.78, (x, y) => {
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
    }],
    shard: [0.74, (x, y) => {
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
    }],
    spark: [0.80, (x, y) => {
        const r = 1.48 * Math.abs(x) + 0.66 * Math.abs(y);
        const core = gaussian(r, 0.16);
        const flare = gaussian(r, 0.30);
        return [0.76 + 0.24 * core, clamp(0.84 * core + 0.46 * flare) * smooth((0.92 - r) / 0.28)];
    }],
    ring: [0.64, (x, y) => {
        const r = Math.hypot(x, y);
        const angle = Math.atan2(y, x);
        const shimmer = 0.88 + 0.12 * Math.cos(angle * 8);
        const outer = gaussian(r - 0.72, 0.042);
        const inner = 0.48 * gaussian(r - 0.54, 0.055);
        return [0.78 + 0.22 * outer, shimmer * (outer + inner) * smooth((0.92 - r) / 0.14)];
    }],
    blossom: [0.56, (x, y) => {
        const r = Math.hypot(x, y);
        const a = Math.atan2(y, x);
        const sector = (Math.PI * 2) / 5;
        const folded = Math.abs((((a + Math.PI) % sector) + sector) % sector - sector / 2);
        const px = r * Math.cos(folded);
        const py = r * Math.sin(folded);
        const petalDist = Math.hypot((px - 0.42) / 0.36, py / 0.25);
        const dimple = px > 0.66 ? 0.14 * gaussian(py, 0.09) * smooth((px - 0.66) / 0.14) : 0;
        const petal = smooth((0.96 - (petalDist + dimple)) / 0.24);
        const vein = 0.22 * gaussian(py, 0.042) * smooth((px - 0.12) / 0.16) * smooth((0.72 - px) / 0.18);
        const rim = 0.18 * gaussian(petalDist - 0.82, 0.09) * smooth((px - 0.14) / 0.16);
        const stamen = gaussian(r, 0.13);
        const aura = 0.18 * gaussian(r, 0.48) * smooth((0.94 - r) / 0.22);
        const alpha = clamp(petal * 0.86 + vein + rim + stamen * 0.92 + aura) * smooth((0.95 - r) / 0.16);
        return [[0.94 + 0.06 * stamen, 0.93 + 0.05 * stamen, 0.96 - 0.14 * stamen + 0.04 * petal], alpha];
    }],
};

const STROKE_BRUSH_PAINTERS = {
    silk: [0.48, (x, y) => {
        const end = smooth((0.97 - Math.abs(x)) / 0.46);
        const core = gaussian(y, 0.15);
        const side = 0.24 * (gaussian(y - 0.26, 0.06) + gaussian(y + 0.26, 0.06));
        const halo = 0.22 * gaussian(y, 0.42);
        return [0.78 + 0.22 * core, end * smooth((0.92 - Math.abs(y)) / 0.22) * (0.76 * core + side + halo)];
    }],
    laser: [0.82, (x, y) => {
        const end = smooth((0.98 - Math.abs(x)) / 0.20);
        const core = gaussian(y, 0.085);
        const aura = 0.34 * gaussian(y, 0.26);
        return [0.84 + 0.16 * core, end * smooth((0.92 - Math.abs(y)) / 0.20) * (0.92 * core + aura)];
    }],
    comet: [0.70, (x, y) => {
        const t = (x + 1) / 2;
        const env = smooth((t - 0.02) / 0.55) * smooth((0.98 - t) / 0.16);
        const cross = y / (0.34 + 0.62 * smooth((t - 0.15) / 0.85));
        const core = gaussian(cross, 0.12);
        const wake = 0.32 * gaussian(cross, 0.36);
        const head = 0.72 + 0.28 * gaussian(x - 0.48, 0.26);
        return [0.78 + 0.22 * core, env * head * smooth((0.90 - Math.abs(y)) / 0.22) * (0.82 * core + wake)];
    }],
    calligraphy: [0.54, (x, y) => {
        const end = smooth((0.97 - Math.abs(x)) / 0.44);
        const curve = y - 0.12 * Math.sin(x * 3.1);
        const primary = gaussian(curve + 0.08, 0.10);
        const echo = 0.52 * gaussian(curve - 0.16, 0.065);
        const mist = 0.24 * gaussian(curve, 0.32);
        return [0.82 + 0.18 * primary, end * smooth((0.92 - Math.abs(y)) / 0.22) * (0.76 * primary + echo + mist)];
    }],
};

export function pointBrushRect(manifest, index) {
    const { originX, originY, cellSize, cols } = manifest.pointBrushGrid;
    return [originX + (index % cols) * cellSize, originY + Math.floor(index / cols) * cellSize, cellSize, cellSize];
}

export function strokeBrushRect(manifest, index) {
    const { originX, originY, cellWidth, cellHeight } = manifest.strokeBrushStrip;
    return [originX + index * cellWidth, originY, cellWidth, cellHeight];
}

export function buildAtlasAssets(manifest) {
    const { width, height, texture } = manifest;
    const buffers = createAtlasBuffers(width, height);

    for (const [name, rect] of Object.entries(manifest.tiles)) {
        const entry = TILE_PAINTERS[name];
        if (!entry) throw new Error(`Missing tile painter for ${name}`);
        paintTile(buffers, rect, entry[0], entry[1]);
    }

    for (const [index, brush] of manifest.pointBrushes.entries()) {
        const entry = POINT_BRUSH_PAINTERS[brush.id];
        if (!entry) throw new Error(`Missing point brush painter for ${brush.id}`);
        paintTile(buffers, pointBrushRect(manifest, index), entry[0], entry[1]);
    }

    for (const [index, stroke] of manifest.strokeBrushes.entries()) {
        const entry = STROKE_BRUSH_PAINTERS[stroke.id];
        if (!entry) throw new Error(`Missing stroke brush painter for ${stroke.id}`);
        paintTile(buffers, strokeBrushRect(manifest, index), entry[0], entry[1]);
    }

    return [
        [`${texture}.png`, encodePng(width, height, buffers.pixels, 6)],
        [`${texture}_mer.png`, encodePng(width, height, buffers.merPixels, 2)],
        [`${texture}.texture_set.json`, JSON.stringify({
            format_version: "1.21.30",
            "minecraft:texture_set": { color: "vfx_lab", metalness_emissive_roughness: "vfx_lab_mer" },
        }, null, 2) + "\n"],
    ];
}
