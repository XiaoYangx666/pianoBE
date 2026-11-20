import type { Vec3 } from "@domain/geometry/offsets";
import { quietFeatures, type MusicFeatures } from "./vfxMusic";
import { stageLights, stageVeils, VFX_LIGHT_LAYOUTS, VFX_VEIL_LAYOUTS, type VfxLayout } from "./vfxLighting";

export const VFX_SCENES = ["field", "wave", "beam", "mix", "burst", "demo"] as const;
export type VfxScene = typeof VFX_SCENES[number];
export type VfxEffect = "field" | "wave" | "beam" | "ripple" | "fountain" | "curtain" | "orbit" | "shaft" | "shard";
export type VfxParticle = VfxEffect | "shaft_upright" | "draw_point" | "draw_stroke" | "draw_plane" | `cinema_${"dust" | "filament" | "sweep" | "note" | "shock"}`;

export const VFX_LIMITS = {
    range: [0.65, 1.6],
    height: [-0.5, 2],
    opacity: [0.1, 1],
    density: [0.4, 1.4],
    size: [0.6, 1.6],
    speed: [0.5, 1.8],
    amplitude: [0.08, 1.1],
    period: [1.2, 6],
    wavelength: [2.5, 9],
    phase: [-360, 360],
    length: [0.35, 2.4],
    width: [0.025, 0.26],
    heading: [-180, 180],
    bend: [0, 1.4],
    flow: [-1, 1],
    lanes: [1, 6],
    segments: [1, 3],
    x: [-5, 5],
    y: [-3, 4],
    z: [-5, 7],
    rotation: [-180, 180],
    scale: [0.5, 1.7],
    intensity: [0, 1],
} as const;

export type NumericParameter = keyof typeof VFX_LIMITS;
export type VfxOptions = Partial<Record<NumericParameter, number> & Record<`${VfxEffect}Color`, string>>;
export interface VfxEmitter {
    effect: VfxEffect;
    particle?: VfxParticle;
    offset: Vec3;
    variables: Record<string, number>;
    /** Upper bounds used only for reservations and diagnostics. */
    particles: number;
    lifetime: number;
    transform?: Pick<VfxOptions, "x" | "y" | "z" | "rotation" | "scale">;
}
export interface VfxCue {
    tick: number;
    emitters: VfxEmitter[];
}

export const VFX_COLORS: Readonly<Record<VfxEffect, string>> = {
    field: "#A6B7FB", wave: "#79BCDD", beam: "#FFD8B2", ripple: "#8AE4DB",
    fountain: "#FFDDA8", curtain: "#8C9EEF", orbit: "#D4A9FE", shaft: "#A8DFFF", shard: "#95DCFF",
};
const origin = { x: 0, y: 0, z: 0 };
const ticksPerSecond = 20;
export const VFX_EMITTERS_PER_TICK = 6;

export function parseVfxOptions(input: string): VfxOptions {
    return input ? validateVfxOptions(JSON.parse(input)) : {};
}

export function validateVfxOptions(options: unknown): VfxOptions {
    if (!options || typeof options !== "object" || Array.isArray(options)) {
        throw new Error("参数需要是 JSON 对象");
    }
    for (const [key, value] of Object.entries(options)) {
        if (Object.hasOwn(VFX_LIMITS, key)) {
            const [min, max] = VFX_LIMITS[key as NumericParameter];
            if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
                throw new Error(`${key} 需要在 ${min} 到 ${max} 之间`);
            }
            if ((key === "lanes" || key === "segments") && !Number.isInteger(value)) {
                throw new Error(`${key} 需要是整数`);
            }
        } else if (!key.endsWith("Color") || !Object.hasOwn(VFX_COLORS, key.slice(0, -5)) ||
            typeof value !== "string" || !/^#[a-f\d]{6}$/i.test(value)) {
            throw new Error(`无效参数 ${key}，颜色格式为 #RRGGBB`);
        }
    }
    return options as VfxOptions;
}

function tint(effect: VfxEffect, options: VfxOptions, opacity: number) {
    const code = options[`${effect}Color`] ?? VFX_COLORS[effect];
    return {
        red: parseInt(code.slice(1, 3), 16) / 255,
        green: parseInt(code.slice(3, 5), 16) / 255,
        blue: parseInt(code.slice(5, 7), 16) / 255,
        opacity: opacity * (options.opacity ?? 1) * (options.intensity ?? 1),
    };
}

function field(options: VfxOptions, opacity: number, rate: number, seconds: number): VfxEmitter {
    const spawnRate = Math.round(rate * (options.density ?? 1));
    const maxParticles = Math.min(40, Math.ceil(spawnRate * 3.2));
    return {
        effect: "field", offset: origin, particles: maxParticles, lifetime: seconds + 3.2,
        variables: {
            ...tint("field", options, opacity),
            range: options.range ?? 1, size: options.size ?? 1,
            speed: options.speed ?? 1, height: options.height ?? 0,
            rate: spawnRate, max_particles: maxParticles, active: seconds,
        },
    };
}

function wave(options: VfxOptions, opacity: number, amplitude: number, life: number, previous = options): VfxEmitter[] {
    const range = options.range ?? 1;
    const columns = 2 * Math.round(18 * Math.max(0.76, options.density ?? 1));
    const circumference = 12.8 * range;
    const cycles = Math.max(1, Math.round(circumference / (options.wavelength ?? 5.2)));
    const step = circumference / columns;
    const angularSpeed = 360 / (options.period ?? 2.9) * (options.speed ?? 1);
    const layers = [-1, 0, 1];
    const emitters: VfxEmitter[] = [];
    for (let column = 0; column < columns; column++) {
        const azimuth = column / columns * 2 * Math.PI;
        const innerSample = column % 3 === 0;
        for (const layer of innerSample ? layers : [0]) {
            const angle = 360 * cycles * column / columns + layer * 37 + (options.phase ?? 0);
            const radius = (2.21 + 0.23 * layer) * range;
            emitters.push({
                effect: "wave",
                offset: { x: radius * Math.cos(azimuth), y: 1.19 + (options.height ?? 0) + layer * 0.18,
                    z: 0.88 * radius * Math.sin(azimuth) },
                lifetime: life, particles: 1,
                variables: {
                    ...tint("wave", options, opacity * (layer === 0 ? 0.51 : layer === -1 ? 0.19 : 0.15)),
                    phase: angle, angular_speed: angularSpeed,
                    amplitude: (options.amplitude ?? 0.37) * amplitude,
                    previous_amplitude: (previous.amplitude ?? 0.37) * amplitude,
                    radius: Math.min(0.16, step * (layer === 0 ? 0.53 : 0.43)) * (options.size ?? 1), life,
                },
            });
        }
    }
    return emitters;
}

function beam(options: VfxOptions, opacity: number, defaultLanes: number, burst: boolean, previous = options, silk = false): VfxEmitter[] {
    const range = options.range ?? 1;
    const life = 2.7 / (options.speed ?? 1);
    const lanes = options.lanes ?? defaultLanes;
    const around = options.heading === undefined && options.bend !== 0;
    const emitters: VfxEmitter[] = [];
    for (let lane = 0; lane < lanes; lane++) {
        const side = lane - (lanes - 1) / 2;
        const heading = ((options.heading ?? (burst ? 90 : 0)) + side * (burst ? 24 : 7)) * Math.PI / 180;
        const reverse = !burst && lane % 2 === 1 ? -1 : 1;
        for (let segment = 0; segment < (options.segments ?? 3); segment++) {
            const delay = Math.round((lane * (burst ? 0.05 : 0.18) + segment * 0.105) * ticksPerSecond);
            emitters.push({
                effect: "beam",
                offset: { x: 0, y: 1.65 + (options.height ?? 0) + side * 0.15, z: 0 },
                lifetime: life + delay / ticksPerSecond, particles: 1,
                variables: {
                    ...tint("beam", options, opacity * [1, 0.52, 0.24][segment]),
                    dir_x: reverse * Math.cos(heading), dir_z: reverse * Math.sin(heading),
                    span: (burst ? 2.75 : 4.8) * range, start: burst ? 0 : -2.4 * range,
                    bend: (options.bend ?? 0.56) * reverse,
                    length: (options.length ?? 1.36) * [1, 0.8, 0.55][segment],
                    width: (options.width ?? 0.16) * (options.size ?? 1) * (silk ? 2.2 : 1),
                    silk: Number(silk),
                    life, delay: delay / ticksPerSecond, height_delta: (previous.height ?? 0) - (options.height ?? 0),
                    around: around ? 1 : 0, arc_phase: 35 + 360 / lanes * lane,
                    arc_sweep: (burst ? 136 : 212) * reverse,
                    arc_radius: (2.48 + side * 0.09) * range,
                },
            });
        }
    }
    return emitters;
}

function ripple(options: VfxOptions, music: Readonly<MusicFeatures>): VfxEmitter[] {
    const layers = music.chord > 0.45 ? 3 : music.chord ? 2 : 1;
    return Array.from({ length: layers }, (_, index) => {
        const life = (1.1 + index * 0.17) / (options.speed ?? 1);
        return {
            effect: "ripple", offset: { x: 0, y: 0.23 + index * 0.065 + (options.height ?? 0), z: 0 },
            lifetime: life, particles: 1,
            variables: {
                ...tint("ripple", options, 0.56 / (1 + index * 0.48)),
                life, radius: (2.15 + 0.45 * index) * (options.range ?? 1),
                size: options.size ?? 1,
            },
        };
    });
}

function fountain(options: VfxOptions): VfxEmitter[] {
    const life = 1.15;
    const count = Math.round(8 * (options.density ?? 1));
    return [-1, 1].map(side => ({
        effect: "fountain", offset: {
            x: side * 1.88 * (options.range ?? 1), y: 0.32 + (options.height ?? 0), z: -0.18,
        },
        lifetime: life + 0.25, particles: count,
        variables: { ...tint("fountain", options, 0.63), count, life,
            side, speed: options.speed ?? 1, size: options.size ?? 1 },
    }));
}

function shards(options: VfxOptions): VfxEmitter[] {
    const count = Math.round(5 * (options.density ?? 1));
    const speed = options.speed ?? 1;
    return [-1, 1].flatMap(side => [
        { x: 1.25, y: 1.35, z: -0.72 },
        { x: 1.68, y: 0.82, z: 0.30 },
        { x: 1.05, y: 1.91, z: 1.22 },
    ].map(({ x, y, z }, index) => ({
        effect: "shard",
        offset: { x: side * x, y: y + (options.height ?? 0), z: z + 0.20 * side },
        particles: count,
        lifetime: 0.10 + 1.83 / speed,
        variables: {
            ...tint("shard", options, [0.76, 1, 0.92][index]),
            side, count, speed, flow: options.flow ?? 1, range: options.range ?? 1, size: options.size ?? 1,
        },
    })));
}

function curtain(options: VfxOptions, context: VfxEffectContext): VfxEmitter[] {
    const range = options.range ?? 1;
    const layout = context.layout;
    if (layout === "aurora" || layout === "wings") {
        const length = options.length ?? 1.4;
        const previous = context.previous.length ?? length;
        const life = layout === "aurora" ? 2.4 : 1.8;
        return stageVeils[layout].map(anchor => ({
            effect: "curtain",
            offset: { x: anchor.origin.x * range, y: anchor.origin.y + (options.height ?? 0), z: anchor.origin.z * range },
            particles: 1,
            lifetime: life,
            variables: {
                ...tint("curtain", options, anchor.gain),
                life, phase: anchor.phase + (options.phase ?? 0), speed: options.speed ?? 1,
                length: length * anchor.rise, previous_length: previous * anchor.rise,
                width: (options.width ?? 0.22) * (options.size ?? 1) * anchor.span,
                sheet: layout === "aurora" ? 1 : 2, roll: anchor.roll,
            },
        }));
    }
    const life = 1.38;
    const columns = Math.max(2, Math.round(4 * (options.density ?? 1)));
    return Array.from({ length: 2 * columns }, (_, index) => {
        const z = (index % columns / (columns - 1) - 0.5) * 3.05;
        const side = index < columns ? -1 : 1;
        return {
            effect: "curtain", offset: { x: side * (2.05 + 0.22 * Math.cos(z)) * range,
                y: 1.58 + (options.height ?? 0), z: z * range },
            lifetime: life, particles: 1,
            variables: {
                ...tint("curtain", options, 0.19 + 0.14 * Math.cos(z * 0.6)), life,
                phase: index * 44 + (options.phase ?? 0), speed: options.speed ?? 1,
                length: (options.length ?? 1.4) * (0.68 + 0.32 * Math.cos(z * 0.8)),
                width: (options.width ?? 0.14) * (options.size ?? 1),
                previous_length: 1.4,
                sheet: 0,
                roll: 0,
            },
        };
    });
}

function orbit(options: VfxOptions): VfxEmitter[] {
    const life = 2.45;
    const count = Math.round(10 * (options.density ?? 1));
    return [{
        effect: "orbit", offset: { x: 0, y: 1.17 + (options.height ?? 0), z: 0 },
        lifetime: life, particles: count,
        variables: {
            ...tint("orbit", options, 0.53), life, count, radius: 2.32 * (options.range ?? 1),
            speed: options.speed ?? 1, size: options.size ?? 1, phase: options.phase ?? 0,
        },
    }];
}

function shaft(options: VfxOptions, context: VfxEffectContext): VfxEmitter[] {
    const range = options.range ?? 1;
    const length = options.length ?? 1.45;
    const previousLength = context.previous.length ?? length;
    const life = 1.6;
    const layout = context.layout === "aurora" || context.layout === "wings" ? "rails" : context.layout ?? "rails";
    const upright = layout === "neon-sides" || layout === "neon-rear";
    return stageLights[layout].map(anchor => {
        const { x, y, z } = anchor.direction;
        const magnitude = Math.hypot(x, y, z);
        const haze = layout === "fan";
        return {
            effect: "shaft",
            ...(upright ? { particle: "shaft_upright" as const } : {}),
            offset: {
                x: anchor.origin.x * range,
                y: anchor.origin.y + (options.height ?? 0),
                z: anchor.origin.z * range,
            },
            particles: 1,
            lifetime: life,
            variables: {
                ...tint("shaft", options, anchor.gain),
                life, length: length * anchor.length, previous_length: previousLength * anchor.length,
                width: (options.width ?? 0.15) * (options.size ?? 1) * anchor.width *
                    (haze ? 2.65 : layout === "rails" ? 1.4 : 1),
                shaft_style: layout === "truss" ? 2 : Number(haze),
                dir_x: x / magnitude, dir_y: y / magnitude, dir_z: z / magnitude,
            },
        };
    });
}

export type VfxMode = "autonomous" | "trigger" | "continuous";
export type VfxCategory = "atmosphere" | "line" | "surface" | "stage" | "geometry";
export interface VfxEffectContext {
    music: Readonly<MusicFeatures>;
    previous: VfxOptions;
    layout?: VfxLayout;
    profile?: "silk";
}
interface VfxDefinition {
    category: VfxCategory;
    mode: VfxMode;
    interval: number;
    options: readonly NumericParameter[];
    layouts?: readonly VfxLayout[];
    emit(options: VfxOptions, context: VfxEffectContext): VfxEmitter[];
}
const stageOptions = ["range", "height", "opacity", "size", "speed", "density"] as const;

/** Effect factories are pure. Scheduling and transports only consume this catalog. */
export const VFX_EFFECTS: Record<VfxEffect, VfxDefinition> = {
    field: { category: "atmosphere", mode: "autonomous", interval: 32, options: stageOptions,
        emit: o => [field(o, 0.68, 10, 1.7)] },
    wave: { category: "surface", mode: "continuous", interval: 30,
        options: [...stageOptions, "amplitude", "wavelength", "period", "phase"],
        emit: (o, c) => wave(o, 1, 1, 2.35, c.previous) },
    beam: { category: "line", mode: "continuous", interval: 24,
        options: [...stageOptions, "heading", "length", "width", "bend", "lanes", "segments"],
        emit: (o, c) => beam({ lanes: 2, segments: 2, ...o }, 0.73, 2, false, c.previous, c.profile === "silk") },
    ripple: { category: "geometry", mode: "trigger", interval: 16, options: stageOptions,
        emit: (o, c) => ripple(o, c.music) },
    fountain: { category: "stage", mode: "continuous", interval: 18, options: stageOptions,
        emit: fountain },
    shard: { category: "geometry", mode: "trigger", interval: 40,
        options: [...stageOptions, "flow"], emit: shards },
    curtain: { category: "surface", mode: "continuous", interval: 18,
        options: [...stageOptions, "length", "width", "phase"], layouts: VFX_VEIL_LAYOUTS, emit: curtain },
    orbit: { category: "geometry", mode: "autonomous", interval: 35,
        options: [...stageOptions, "phase"], emit: orbit },
    shaft: { category: "stage", mode: "continuous", interval: 16,
        options: ["range", "height", "opacity", "size", "length", "width"], layouts: VFX_LIGHT_LAYOUTS, emit: shaft },
};

export function effectEmitters(effect: VfxEffect, options: VfxOptions, context: VfxEffectContext = {
    music: quietFeatures, previous: options,
}): VfxEmitter[] {
    return applyTransform(options, VFX_EFFECTS[effect].emit(options, context));
}

function applyTransform(options: VfxOptions, emitters: VfxEmitter[]): VfxEmitter[] {
    const { x, y, z, rotation, scale } = options;
    return emitters.map(emitter => ({ ...emitter, transform: { x, y, z, rotation, scale } }));
}

/** Cues are relative to the scene start. Wave phase is corrected at dispatch. */
export function planVfxScene(scene: VfxScene, options: VfxOptions = {}): VfxCue[] {
    const cues: VfxCue[] = [];
    const add = (seconds: number, emitters: VfxEmitter[]) => {
        // Allocate no more than one scene's packet share on a tick.
        const start = Math.round(seconds * ticksPerSecond);
        for (let index = 0; index < emitters.length; index += VFX_EMITTERS_PER_TICK) {
            const batch = applyTransform(options, emitters.slice(index, index + VFX_EMITTERS_PER_TICK));
            const requested = start + index / VFX_EMITTERS_PER_TICK;
            const tick = Math.max(requested, (cues.at(-1)?.tick ?? -1) + 1);
            cues.push({ tick, emitters: batch });
        }
    };
    const addField = (t: number, opacity: number, rate: number, active = 2.1) => add(t, [field(options, opacity, rate, active)]);
    const addWave = (t: number, opacity: number, amplitude = 1, life = 4.7) =>
        add(t, wave(options, opacity, amplitude, life));
    const addBeam = (t: number, opacity: number, lanes: number, burst = false) =>
        add(t, beam(options, opacity, lanes, burst));

    switch (scene) {
        case "field":
            for (let t = 0; t < 12; t += 2) addField(t, 0.8, 12);
            break;
        case "wave":
            for (const t of [0, 3.8, 7.6]) addWave(t, 1);
            break;
        case "beam":
            addBeam(0, 1, 4);
            addBeam(4, 1, 4);
            break;
        case "mix":
            addField(0, 0.62, 11);
            addWave(0.5, 0.8);
            addField(2, 0.57, 10);
            addBeam(2.5, 0.9, 4);
            addWave(4.3, 0.72);
            break;
        case "burst":
            addField(0, 0.75, 16, 0.8);
            addWave(0.15, 1, 1.25, 3);
            addBeam(1.15, 1, 6, true);
            break;
        case "demo":
            addField(0.8, 0.62, 8);
            addField(2.45, 0.74, 10);
            addWave(3.4, 0.7, 0.72);
            addField(4.5, 0.61, 10);
            addWave(7.1, 0.86, 0.9);
            addBeam(7.9, 0.82, 3);
            addField(9.5, 0.65, 11);
            addWave(10.8, 1, 1.16);
            addBeam(11.8, 1, 6, true);
            addBeam(13.4, 0.56, 3);
            addWave(14.6, 0.54, 1.16, 3.3);
            addField(15.4, 0.43, 6);
            addField(17.3, 0.34, 4, 1.15);
            break;
    }
    return cues;
}
