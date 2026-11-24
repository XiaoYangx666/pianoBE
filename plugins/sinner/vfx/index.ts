import {
    colorVars, drawGroundRing, drawPoints, drawStrokeSegments, mix, resolveSchemaParams, vfxPerformerDepth, vfxStageFrame,
    type Point3, type VfxEffectDefinition, type VfxEffectParams, type VfxEmitter,
    type VfxInstrument, type VfxPluginManifest, type VfxPluginModule,
} from "@piano/vfx";
import manifest from "../plugin.json";
import { authorityEffects } from "./authority";

const SWORD_SCALE = 1.75;
const TAU = Math.PI * 2;
const SWORD = {
    height: { label: "剑尖高度", min: 0.08, max: 4.5, default: 3.5, step: 0.05 },
    turn: { label: "剑身转角", min: -180, max: 180, default: -12, step: 1 },
    fall: { label: "落剑进度", min: 0, max: 1, default: 0, step: 0.01 },
} as const;
const LIGHT = {
    width: { label: "光池宽度", min: 0.8, max: 4.6, default: 2.62, step: 0.05 },
    side: { label: "两侧补光", min: 0, max: 1, default: 0.36, step: 0.05 },
    cone: { label: "空气光束", min: 0, max: 1, default: 0.55, step: 0.05 },
    key: { label: "舞台主追光", min: 0, max: 1, default: 0, step: 0.05 },
} as const;
const WATER = {
    reach: { label: "回流水柱高度", min: 1.2, max: 6.5, default: 4.6, step: 0.1 },
    radius: { label: "两侧水流间距", min: 0.9, max: 4.6, default: 3.05, step: 0.05 },
} as const;

function performerStageDepth(instrument: VfxInstrument, fraction = 1) {
    const stage = vfxStageFrame(instrument);
    return (vfxPerformerDepth(instrument) * fraction - stage.centerZ) / stage.depth;
}

function swordProp(params: VfxEffectParams, instrument: VfxInstrument) {
    const { height, turn, fall } = resolveSchemaParams(SWORD, params.custom);
    return {
        id: "pianobe.sinner:sinner_sword" as const,
        offset: { x: 0, y: mix(height, 0.12, fall * fall), z: performerStageDepth(instrument) },
        size: Math.max(0.05, Math.min(2, SWORD_SCALE * params.scale * Math.sqrt(params.intensity))),
        turn,
    };
}

function lightSprite(particle: string, offset: Point3, width: number, depth: number, color: string, opacity: number): VfxEmitter {
    const life = 1.08;
    return {
        particle, group: "spotlight", particles: 1, lifetime: life,
        offset: { x: offset[0], y: offset[1], z: offset[2] },
        variables: { life, width, depth, ...colorVars(color, color, opacity) },
    };
}

function bubble(offset: Point3, size: number, life: number, speed: number, phase: number, color: string, opacity: number): VfxEmitter {
    return {
        particle: "sinner_bubble", group: "bubbles", particles: 1, lifetime: life,
        offset: { x: offset[0], y: offset[1], z: offset[2] },
        variables: { life, size, speed, phase, ...colorVars(color, color, opacity) },
    };
}

const effects: readonly VfxEffectDefinition[] = [
    {
        id: "sinner_sword", label: "终幕悬剑", category: "stage", trigger: "continuous", interval: 5, priority: 9,
        parameters: SWORD,
        resolveStageProp: swordProp,
        emit({ params, nativeStageProp, instrument, phase }) {
            const { offset: { x, y, z }, size, turn } = swordProp(params, instrument);
            const angle = turn * Math.PI / 180;
            const local = (side: number, height: number): Point3 =>
                [x + side * size * Math.cos(angle), y + height * size, z + side * size * Math.sin(angle)];
            const edge = { count: 4, life: 0.46, brush: "laser" as const, width: 0.12, color: params.color,
                color2: params.color2, opacity: params.intensity * 0.89, fadeIn: 0.05, fadeOut: 0.12 };
            const glow = [
                drawPoints({
                    count: 1, life: 0.51, lifeJitter: 0, brush: "mote", color: params.color, opacity: 0.14 * params.intensity,
                    offset: local(0, 1.53), size: 0.58 * size, aspect: 2.8, fadeIn: 0.14, fadeOut: 0.22,
                }),
                drawPoints({
                    count: 1, life: 0.96, brush: "star", color: params.color2, opacity: 0.65 * params.intensity,
                    offset: local(0.38 * Math.sin(phase * Math.PI / 180), 1.8 + 1.21 * Math.cos(phase * Math.PI / 180)),
                    size: 0.06 * size, velocity: [0, 0.27, 0], twinkle: 0.55,
                }),
            ];
            if (nativeStageProp) return { priority: 9, emitters: glow };
            return {
                priority: 9,
                emitters: [
                    ...glow,
                    ...drawStrokeSegments([local(0, 0), local(-0.23, 0.57), local(-0.20, 2.65), local(0, 2.91),
                        local(0.20, 2.65), local(0.23, 0.57), local(0, 0)], { ...edge, count: 8 }),
                    ...drawStrokeSegments([local(-0.74, 3.49), local(-0.43, 3.02), local(0, 3.08),
                        local(0.43, 3.02), local(0.74, 3.49)], edge),
                    ...drawStrokeSegments([local(0, 3.05), local(0, 4.27)], { ...edge, count: 2 }),
                ],
            };
        },
    },
    {
        id: "sinner_spotlight", label: "终幕追光", category: "stage", trigger: "continuous", interval: 9, priority: 8,
        parameters: LIGHT,
        emit({ params: { color, color2, intensity, scale, custom }, instrument }) {
            const { width, side, cone, key } = resolveSchemaParams(LIGHT, custom);
            const reach = width * scale;
            const centerZ = performerStageDepth(instrument, 0.48);
            const keyGain = key * intensity;
            const washGain = (1 - key) * intensity;
            const keyLight = keyGain > 0.01 ? [
                lightSprite("sinner_spot_pool", [0, 0.054, centerZ], reach, reach * 0.91, color, 0.48 * keyGain),
                lightSprite("sinner_spot_beam", [0, 2.83, centerZ], reach * 1.05, 2.80, color, 0.43 * cone * keyGain),
            ] : [];
            const wash = washGain > 0.01 ? [
                lightSprite("sinner_pool", [0, 0.033, centerZ], reach, reach * 0.82, color, 0.48 * washGain),
                lightSprite("sinner_cone", [0, 2.75, centerZ], reach * 1.16, 2.85, color, 0.42 * cone * washGain),
            ] : [];
            return {
                priority: 8,
                emitters: [
                    ...keyLight,
                    ...wash,
                    ...[-1, 1].map(sign => lightSprite("sinner_pool", [sign * 2.12, 0.045, 0.5],
                        reach * 0.88, reach * 0.67, color2, 0.44 * intensity * side)),
                ],
            };
        },
    },
    {
        id: "sinner_bubbles", label: "水下气泡", category: "atmosphere", trigger: "continuous", interval: 11, priority: 4,
        emit({ params: { color, color2, intensity, scale }, phase }) {
            const angle = phase * Math.PI / 180;
            const opacity = 0.84 * Math.sqrt(intensity);
            return {
                priority: 4,
                emitters: Array.from({ length: Math.ceil(intensity * 3) }, (_, i) => {
                    const a = angle + i * TAU / 3;
                    const wide = 0.5 + 0.5 * Math.sin(angle * 2 + i * 4.1);
                    const radius = (2.12 + 0.91 * wide) * scale;
                    return bubble([radius * Math.cos(a), 0.22 + wide * 0.62, 0.8 * radius * Math.sin(a)],
                        scale * mix(0.10, 0.44, wide ** 3), 2.65 + 1.48 * wide, 0.40 + 0.61 * wide,
                        phase + i * 119, i === 1 ? color2 : color, opacity);
                }),
            };
        },
    },
    {
        id: "sinner_upwelling", label: "逆流回天", category: "curve", trigger: "continuous", interval: 9, priority: 7,
        parameters: WATER,
        emit({ params: { color, color2, intensity, scale, custom }, phase }) {
            const { reach, radius } = resolveSchemaParams(WATER, custom);
            const angle = phase * Math.PI / 180;
            const lift = reach * (0.86 + 0.14 * intensity) * scale;
            const emitters = [-1, 1].flatMap(side => {
                const lane = side * 0.9 + Math.sin(angle) * 0.21;
                const stream = (t: number, phaseOffset: number): Point3 => {
                    const swirl = lane + phaseOffset + t * 9.2;
                    const bend = Math.sin(Math.PI * t);
                    const x = mix(radius, 0.74, t ** 1.45) - 1.07 * bend + (0.29 + 0.44 * bend) * Math.sin(swirl);
                    const z = mix(-1.28, 0.72, t) + (0.39 + 0.44 * bend) * Math.cos(swirl);
                    return [side * x * scale, 0.12 + lift * t ** 1.46, z * scale];
                };
                const path = Array.from({ length: 15 }, (_, i) => stream(i / 14, 0));
                const wake = Array.from({ length: 9 }, (_, i) => stream(0.14 + i * 0.082, Math.PI * 0.58));
                return [
                    ...drawStrokeSegments(path, {
                        count: 10, life: 0.81, brush: "silk", width: (0.29 + 0.19 * intensity) * scale,
                        color, color2, opacity: 0.78 * intensity, overlap: 1.72,
                        fadeIn: 0.19, fadeOut: 0.37, travel: 0.74, taperEnds: false,
                    }),
                    ...drawStrokeSegments(wake, {
                        count: 5, life: 0.68, brush: "calligraphy", width: 0.20 * scale,
                        color: color2, color2: color, opacity: 0.36 * intensity, overlap: 1.38,
                        fadeIn: 0.17, fadeOut: 0.28, travel: 1.11,
                    }),
                    drawPoints({
                        count: 4, life: 1.72, brush: "mote", color, color2, colorRandom: 1, opacity: 0.70 * intensity,
                        offset: path[0], size: 0.066 * scale, spread: [0.36, 0.16, 0.39],
                        velocity: [-side * 0.5, 1.32 + lift * 0.26, 0.35], accel: [0, 0.65, 0],
                        fadeIn: 0.14, fadeOut: 0.54, sizeJitter: 0.45, aspect: 1.8,
                    }),
                ];
            });
            emitters.push(drawGroundRing({ offset: [0, 0.061, 0.15], color, color2, opacity: intensity * 0.31,
                life: 0.86, radiusStart: radius * 1.24, radiusEnd: radius * 0.65, curve: 1.3, scale, fadeOut: 0.38 }));
            return { priority: 7, emitters };
        },
    },
    {
        id: "sinner_impact", label: "断幕水击", category: "accent", trigger: "instant", interval: 20, priority: 10,
        emit({ params: { color, color2, intensity, scale }, instrument }) {
            const z = performerStageDepth(instrument);
            const strike: Point3 = [0, 0.13, z];
            return {
                priority: 10,
                emitters: [
                    drawPoints({
                        count: 1, life: 0.34, lifeJitter: 0, brush: "star", opacity: intensity,
                        color: color2, offset: strike, size: 1.0, sizeEnd: 0.24, scale, fadeIn: 0.01, fadeOut: 0.30,
                    }),
                    drawGroundRing({ offset: strike, color: color2, color2: color, opacity: 0.86 * intensity,
                        life: 1.25, radiusStart: 0.16, radiusEnd: 4.05, scale, fadeIn: 0.04 }),
                    drawGroundRing({ offset: [0, 0.055, z], color, color2, opacity: 0.75 * intensity,
                        life: 1.65, radiusStart: 0.46, radiusEnd: 3.42, scale, style: 1 }),
                    drawPoints({
                        count: 20, life: 1.45, brush: "shard", color, color2, colorRandom: 1, opacity: 0.86 * intensity,
                        offset: strike, scale, size: 0.075, sizeEnd: 0.035, aspect: 1.55, radius: 0.36, radiusEnd: 3.24,
                        radialJitter: 0.65, rise: 1.85, omega: 22, accel: [0, -1.3, 0], fadeIn: 0.04, fadeOut: 0.48,
                    }),
                ],
            };
        },
    },
];

export const sinnerPlugin: VfxPluginModule = {
    manifest: manifest as VfxPluginManifest,
    register(api) {
        for (const effect of effects) api.registerEffect(effect);
        for (const effect of authorityEffects) api.registerEffect(effect);
    },
};

export default sinnerPlugin;
