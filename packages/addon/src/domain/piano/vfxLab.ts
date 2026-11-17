import type { Vec3 } from "@domain/geometry/offsets";

export const VFX_SCENES = ["field", "wave", "beam", "mix", "burst", "demo"] as const;
export type VfxScene = typeof VFX_SCENES[number];
export type VfxEffect = "field" | "wave" | "beam";

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
    lanes: [1, 6],
    segments: [1, 3],
} as const;

type NumericParameter = keyof typeof VFX_LIMITS;
export type VfxOptions = Partial<Record<NumericParameter, number> & Record<`${VfxEffect}Color`, string>>;
export interface VfxEmitter {
    effect: VfxEffect;
    offset: Vec3;
    variables: Record<string, number>;
    /** Upper bounds used only for reservations and diagnostics. */
    particles: number;
    lifetime: number;
}
export interface VfxCue {
    tick: number;
    emitters: VfxEmitter[];
}

const colorKeys = ["fieldColor", "waveColor", "beamColor"];
const palette = { field: "#A6B7FB", wave: "#93E6FF", beam: "#FFD8B2" };
const origin = { x: 0, y: 0, z: 0 };
const ticksPerSecond = 20;
export const VFX_EMITTERS_PER_TICK = 6;

export function parseVfxOptions(input: string): VfxOptions {
    if (!input) return {};
    const options: unknown = JSON.parse(input);
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
        } else if (!colorKeys.includes(key) || typeof value !== "string" || !/^#[a-f\d]{6}$/i.test(value)) {
            throw new Error(`无效参数 ${key}，颜色格式为 #RRGGBB`);
        }
    }
    return options as VfxOptions;
}

function tint(effect: VfxEffect, options: VfxOptions, opacity: number) {
    const code = options[`${effect}Color`] ?? palette[effect];
    return {
        red: parseInt(code.slice(1, 3), 16) / 255,
        green: parseInt(code.slice(3, 5), 16) / 255,
        blue: parseInt(code.slice(5, 7), 16) / 255,
        opacity: opacity * (options.opacity ?? 1),
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

function wave(options: VfxOptions, opacity: number, amplitude: number, life: number): VfxEmitter[] {
    const span = 4.6 * (options.range ?? 1);
    const columns = 2 * Math.round(16 * Math.max(0.75, options.density ?? 1)) + 1;
    const step = span / (columns - 1);
    const frequency = 360 / (options.wavelength ?? 4.6);
    const angularSpeed = 360 / (options.period ?? 2.9) * (options.speed ?? 1);
    const layers = [-1, 0, 1];
    const emitters: VfxEmitter[] = [];
    for (let column = 0; column < columns; column++) {
        const u = column / (columns - 1);
        const x = (u - 0.5) * span;
        const innerSample = column % 2 === 0 && Math.abs(x) <= span * 0.4;
        for (const layer of innerSample ? layers : [0]) {
            const angle = frequency * x + layer * 37 + (options.phase ?? 0);
            const spacing = 0.45 * (options.range ?? 1);
            const depthCurve = 0.25 * Math.sin(Math.PI * u);
            emitters.push({
                effect: "wave",
                offset: { x, y: 1.56 + (options.height ?? 0) + layer * 0.19, z: 1.59 + layer * spacing + depthCurve },
                lifetime: life, particles: 1,
                variables: {
                    ...tint("wave", options, opacity * (layer === 0 ? 0.84 : layer === -1 ? 0.31 : 0.24)
                        * (0.28 + 0.72 * Math.sin(Math.PI * u) ** 0.55)),
                    phase: angle, angular_speed: angularSpeed,
                    amplitude: (options.amplitude ?? 0.37) * amplitude * (0.48 + 0.52 * Math.sin(Math.PI * u)),
                    radius: step * (layer === 0 ? 0.99 : 1.72) * (options.size ?? 1), life,
                },
            });
        }
    }
    return emitters;
}

function beam(options: VfxOptions, opacity: number, defaultLanes: number, burst: boolean): VfxEmitter[] {
    const range = options.range ?? 1;
    const life = 2.7 / (options.speed ?? 1);
    const lanes = options.lanes ?? defaultLanes;
    const emitters: VfxEmitter[] = [];
    for (let lane = 0; lane < lanes; lane++) {
        const side = lane - (lanes - 1) / 2;
        const heading = ((options.heading ?? (burst ? 90 : 0)) + side * (burst ? 24 : 7)) * Math.PI / 180;
        const reverse = !burst && lane % 2 === 1 ? -1 : 1;
        for (let segment = 0; segment < (options.segments ?? 3); segment++) {
            const delay = Math.round((lane * (burst ? 0.05 : 0.18) + segment * 0.105) * ticksPerSecond);
            emitters.push({
                effect: "beam",
                offset: { x: 0, y: 2.12 + (options.height ?? 0) + side * 0.15, z: 1.72 + side * 0.14 },
                lifetime: life + delay / ticksPerSecond, particles: 1,
                variables: {
                    ...tint("beam", options, opacity * [1, 0.52, 0.24][segment]),
                    dir_x: reverse * Math.cos(heading), dir_z: reverse * Math.sin(heading),
                    span: (burst ? 2.75 : 4.8) * range, start: burst ? 0 : -2.4 * range,
                    bend: (options.bend ?? 0.56) * reverse,
                    length: (options.length ?? 1.36) * [1, 0.8, 0.55][segment],
                    width: (options.width ?? 0.16) * (options.size ?? 1),
                    life, delay: delay / ticksPerSecond,
                },
            });
        }
    }
    return emitters;
}

/** Cues are relative to the scene start. Wave phase is corrected at dispatch. */
export function planVfxScene(scene: VfxScene, options: VfxOptions = {}): VfxCue[] {
    const cues: VfxCue[] = [];
    const add = (seconds: number, emitters: VfxEmitter[]) => {
        // Allocate no more than one scene's packet share on a tick.
        const start = Math.round(seconds * ticksPerSecond);
        for (let index = 0; index < emitters.length; index += VFX_EMITTERS_PER_TICK) {
            const batch = emitters.slice(index, index + VFX_EMITTERS_PER_TICK);
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
