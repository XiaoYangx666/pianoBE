import {
    catmullRom, drawCloud, drawGroundRing, drawPoints, keyOriginFor, mix, motionFactors,
    pickRecentKeys, resolveSchemaParams, zoneBaseY,
    type Point3, type VfxEffectDefinition, type VfxPluginManifest, type VfxPluginModule,
} from "@piano/vfx";
import rawManifest from "../plugin.json";
import {
    inkStroke, lotusScroll, porcelainProfile, porcelainRing, porcelainWash, porcelainPoint, samplePath,
    PORCELAIN_PROP_OFFSET,
} from "./porcelain";
import { CHINESE_SCENERY } from "./scenery";

const COBALT = "#274F9B";
const BLUE = "#6D9BD0";
const CELADON = "#8BB9BA";
const WHITE = "#E9F1E1";
const TURN = { label: "转角", default: 0, min: -35, max: 35, step: 1 };
const VASE = {
    outline: { label: "器身显形", default: 1, min: 0, max: 1, step: 0.05 },
    wash: { label: "瓷胎明度", default: 0.75, min: 0, max: 1, step: 0.05 },
    solid: { label: "实体瓷胎", type: "boolean", default: true } as const,
    turn: TURN,
};
const SCROLL = {
    growth: { label: "缠枝生长", default: 1, min: 0, max: 1, step: 0.05 },
    turn: TURN,
};
const TRACE = {
    reach: { label: "笔迹长度", default: 1, min: 0.1, max: 1, step: 0.05 },
};
const GLAZE = {
    sweep: { label: "釉光位置", default: 0.5, min: 0, max: 1, step: 0.05 },
};
const RIPPLE = {
    linger: { label: "水纹时长", default: 2.5, min: 1, max: 5, step: 0.1 },
};

// The opening brush and its coda share the same curve. The silent remainder is a short wash.
const BRUSH_CURVE: readonly Point3[] = [
    [0, 0, 0], [0.24, 0.44, 0.38], [0.75, 0.96, 0.91],
    [0.96, 1.18, 1.65], [0.49, 1.03, 2.16], [-0.27, 0.79, 2.58],
];

function brushPath(origin: Point3, reverse = false): Point3[] {
    const points = BRUSH_CURVE.map(([x, y, z]): Point3 => [origin[0] + x, origin[1] + y, origin[2] + z]);
    return catmullRom(reverse ? points.reverse() : points, 8);
}

function porcelainStageSize(scale: number, wash: number): number {
    return scale * mix(0.58, 1, Math.min(1, (wash - 0.11) / 0.65));
}

const EFFECTS: readonly VfxEffectDefinition[] = [
    {
        id: "chinese_brush",
        label: "青花落笔",
        category: "accent",
        trigger: "instant",
        interval: 24,
        priority: 6,
        emit({ instrument, params }) {
            const origin = keyOriginFor(76, instrument) ?? [0.35, 1, -0.9];
            return {
                priority: 6,
                emitters: inkStroke(brushPath(origin, params.motion === "reverse"), {
                    count: 15, life: 2.65, color: params.color, color2: params.color2,
                    opacity: 0.94 * params.intensity, width: 0.21, scale: params.scale,
                    travel: 0.06, velocity: [0, 0.035, 0], drawTime: 0.82, glow: true, fadeIn: 0.16, fadeOut: 1.2,
                }),
            };
        },
    },
    {
        id: "chinese_ink_trace",
        label: "釉下笔迹",
        category: "curve",
        trigger: "continuous",
        interval: 29,
        priority: 3,
        parameters: TRACE,
        emit({ params, instrument, music }) {
            const { reach } = resolveSchemaParams(TRACE, params.custom);
            const origin = keyOriginFor(76, instrument) ?? [0.35, 1, -0.9];
            const path = brushPath(origin, params.motion === "reverse");
            return {
                priority: 3,
                emitters: inkStroke(path.slice(0, Math.max(2, Math.ceil(path.length * reach))), {
                    count: Math.max(3, Math.ceil(reach * 12)), life: 1.84, color: params.color, color2: params.color2,
                    opacity: (0.6 + music.sustain * 0.3) * params.intensity,
                    width: 0.12 + music.sustain * 0.045, scale: params.scale, fadeIn: 0.3, fadeOut: 0.45,
                }),
            };
        },
    },
    {
        id: "chinese_porcelain",
        label: "青花梅瓶",
        category: "stage",
        trigger: "continuous",
        interval: 30,
        priority: 5,
        parameters: VASE,
        resolveStageProp(params) {
            const { solid, wash, turn } = resolveSchemaParams(VASE, params.custom);
            if (!solid || wash < 0.11) return undefined;
            return {
                id: "pianobe.chinese:porcelain_vase",
                offset: PORCELAIN_PROP_OFFSET,
                size: porcelainStageSize(params.scale, wash),
                turn,
            };
        },
        emit({ params, nativeStageProp }) {
            if (nativeStageProp) return null;
            const { outline, turn, wash } = resolveSchemaParams(VASE, params.custom);
            const angle = turn * Math.PI / 180;
            const stroke = {
                life: 1.94, color: params.color, opacity: params.intensity * mix(0.78, 0.36, wash),
                width: 0.145, scale: params.scale, overlap: 1.55, fadeIn: 0.34, fadeOut: 0.42,
            };
            const emitters = inkStroke(porcelainRing(1, mix(0.65, 1, outline), angle), stroke);
            if (outline > 0.04) {
                emitters.push(...inkStroke(porcelainProfile(angle, outline), stroke));
            }
            if (outline > 0.34) {
                emitters.push(...inkStroke(porcelainProfile(Math.PI + angle, outline), stroke));
            }
            if (outline > 0.69) {
                emitters.push(...inkStroke(porcelainRing(0.035, mix(0.6, 1, outline), angle), stroke));
            }
            if (wash > 0.01) {
                emitters.push(porcelainWash(params.color, wash * params.intensity, params.scale, 1.97));
            }
            return { priority: 5, emitters };
        },
    },
    {
        id: "chinese_lotus_scroll",
        label: "缠枝莲",
        category: "curve",
        trigger: "continuous",
        interval: 32,
        priority: 4,
        parameters: SCROLL,
        emit({ params }) {
            const { growth, turn } = resolveSchemaParams(SCROLL, params.custom);
            return {
                priority: 4,
                emitters: lotusScroll(growth, turn * Math.PI / 180, {
                    life: 2.1, color: params.color, color2: params.color2, opacity: 0.94 * params.intensity,
                    width: 0.185, scale: params.scale, overlap: 1.62, fadeIn: 0.33, fadeOut: 0.5,
                }),
            };
        },
    },
    {
        id: "chinese_glaze",
        label: "青瓷釉光",
        category: "curve",
        trigger: "continuous",
        interval: 9,
        priority: 6,
        parameters: GLAZE,
        emit({ params }) {
            const { sweep } = resolveSchemaParams(GLAZE, params.custom);
            const angle = mix(-0.18, 0.18 - Math.PI, sweep);
            const points = samplePath(8, t => porcelainPoint(0.93 - t * 0.62, angle, 0.025));
            return {
                priority: 6,
                emitters: inkStroke(points, {
                    life: 0.65, color: params.color, color2: params.color2,
                    opacity: 0.78 * params.intensity, width: 0.145, scale: params.scale,
                    fadeIn: 0.15, fadeOut: 0.34,
                }),
            };
        },
    },
    {
        id: "chinese_mist",
        label: "天青远雾",
        category: "atmosphere",
        trigger: "continuous",
        interval: 24,
        priority: 1,
        emit({ params }) {
            const { color, color2, intensity, scale, zone } = params;
            return {
                priority: 1,
                emitters: [-1, 1].map(side => drawCloud({
                    count: 2, life: 4.1, color, color2, opacity: 0.105 * intensity, scale,
                    offset: [side * 3.5, zoneBaseY(zone, 0.65), 3.25], spread: [0.65, 0.18, 0.55],
                    velocity: [side * 0.25 * motionFactors(params.motion).dir, 0.04, 0.08],
                    size: 1.8, sizeEnd: 2.9,
                })),
            };
        },
    },
    {
        id: "chinese_rain",
        label: "疏雨",
        category: "atmosphere",
        trigger: "continuous",
        interval: 13,
        priority: 2,
        variants: ["back", "wings"],
        emit({ params, music, phase }) {
            const { color, color2, intensity, scale, variant } = params;
            const wings = variant === "wings";
            const wind = motionFactors(params.motion);
            return {
                priority: 2,
                emitters: [-1, 1].map(side => drawPoints({
                    count: Math.max(2, Math.round(7 * intensity)), life: 1.4, lifeJitter: 0.18,
                    group: "curtain", brush: "mote", color, color2, colorRandom: 1, opacity: 0.88 * intensity,
                    scale, size: 0.061, sizeEnd: 0.04, aspect: 6.8,
                    offset: [side * (wings ? 3.7 : 1.9), 3.85 + 0.32 * music.sustain, 3.6],
                    spread: [wings ? 0.85 : 1.55, 1, 0.85],
                    spin: -13 * wind.dir, spinJitter: 2.4,
                    velocity: [0.44 * wind.dir, -1.94 * wind.speed, 0.12 * Math.sin(phase * Math.PI / 180)],
                    fadeIn: 0.17, fadeOut: 0.35,
                })),
            };
        },
    },
    {
        id: "chinese_ripple",
        label: "雨落水纹",
        category: "accent",
        trigger: "instant",
        interval: 32,
        priority: 5,
        variants: ["single", "sides", "front"],
        parameters: RIPPLE,
        emit({ params }) {
            const { color, color2, intensity, scale, variant } = params;
            const { linger } = resolveSchemaParams(RIPPLE, params.custom);
            const centers = variant === "sides" ? [-2.25, 2.25] : [0];
            return {
                priority: 5,
                emitters: centers.map((x, i) => drawGroundRing({
                    color, color2, opacity: 0.91 * intensity, scale,
                    offset: [x, 0.085 + i * 0.014, (variant === "front" ? -1.75 : 0.7) + i * 0.65], life: linger + i * 0.26,
                    radiusStart: 0.07, radiusEnd: 2.45 - i * 0.48, fadeOut: linger * 0.58, curve: 0.72,
                })),
            };
        },
    },
    {
        id: "chinese_key_light",
        label: "瓷白琴光",
        category: "keys",
        trigger: "note",
        interval: 9,
        priority: 2,
        emit({ params, instrument, recentNotes, lastNoteTick, phase, solo }) {
            const note = pickRecentKeys(recentNotes, lastNoteTick, phase, solo, 2).at(-1);
            if (!note || (note.midi < 72 && !solo)) return null;
            const offset = keyOriginFor(note.midi, instrument);
            if (!offset) return null;
            return {
                priority: 2,
                emitters: [drawPoints({
                    count: 2, life: 0.7, brush: "mote", color: params.color, color2: params.color2,
                    opacity: params.intensity * 0.9, offset, size: 0.097, sizeEnd: 0.047,
                    velocity: [0, 0.37, 0], spread: [0.045, 0.025, 0.02], fadeOut: 0.36,
                })],
            };
        },
    },
    ...CHINESE_SCENERY,
];

export const chinesePlugin: VfxPluginModule = {
    manifest: rawManifest as VfxPluginManifest,
    register(api) {
        for (const effect of EFFECTS) api.registerEffect(effect);
        api.registerTheme("chinese_misty_rain", {
            label: "烟雨",
            layers: [
                { effect: "chinese_mist", color: CELADON, color2: WHITE, level: { input: "activity", from: 25, to: 65 } },
                { effect: "chinese_rain", color: CELADON, color2: BLUE, variant: "wings", level: { input: "sustain", from: 13, to: 37 } },
                { effect: "chinese_key_light", color: WHITE, color2: COBALT, level: 42 },
            ],
        });
    },
};

export default chinesePlugin;
