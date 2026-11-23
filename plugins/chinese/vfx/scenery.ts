import {
    catmullRom, drawGroundRing, drawPoints, mix, resolveSchemaParams,
    type Point3, type VfxEffectDefinition,
} from "@piano/vfx";
import { inkStroke, samplePath } from "./porcelain";

const MOUNTAINS: readonly (readonly Point3[])[] = [
    [[-6, 1.05, 4], [-4.65, 1.85, 4.1], [-3.75, 3.48, 4.35], [-3.16, 2.69, 4.3], [-2.34, 2.78, 4.35], [-0.76, 1.03, 4.65]],
    [[-4.6, 1.65, 5.12], [-2.36, 2.65, 5.26], [-1.26, 4.26, 5.45], [-0.44, 3.4, 5.43], [0.47, 4.05, 5.61], [2.65, 1.48, 5.71]],
    [[1.9, 1.09, 4.1], [3.22, 1.67, 4.28], [4.23, 2.94, 4.32], [4.95, 2.46, 4.46], [6.05, 1.02, 4.68]],
];
const RIDGES = MOUNTAINS.map(path => catmullRom(path, 3));
const GATE = {
    opening: { label: "月洞门开合", default: 1, min: 0.15, max: 1, step: 0.05 },
};

export const CHINESE_SCENERY: readonly VfxEffectDefinition[] = [
    {
        id: "chinese_landscape",
        label: "烟雨远山",
        category: "stage",
        trigger: "continuous",
        interval: 39,
        priority: 3,
        emit({ params }) {
            return {
                priority: 3,
                emitters: RIDGES.flatMap(path => inkStroke(path, {
                    life: 2.63, color: params.color2,
                    opacity: params.intensity * 0.76, width: 0.31,
                    scale: params.scale, overlap: 1.46, fadeIn: 0.66, fadeOut: 0.74,
                })),
            };
        },
    },
    {
        id: "chinese_moon_gate",
        label: "月洞门",
        category: "stage",
        trigger: "continuous",
        interval: 33,
        priority: 4,
        parameters: GATE,
        emit({ params }) {
            const { opening } = resolveSchemaParams(GATE, params.custom);
            const paths = [-1, 1].map(side => samplePath(11, t => {
                const angle = Math.PI * (0.5 + side * t * opening * 0.77);
                return [3.02 * Math.cos(angle), 2.28 + 2.65 * Math.sin(angle), 3.65 + side * t * 0.62];
            }));
            return {
                priority: 4,
                emitters: paths.flatMap((path, i) => {
                    const side = i === 0 ? -1 : 1;
                    const lattice: Point3[] = [
                        [side * 2.83, 1.06, 3.64], [side * 3.62, 1.06, 3.64],
                        [side * 3.62, 1.76, 3.64], [side * 3.15, 1.76, 3.64],
                        [side * 3.15, 1.35, 3.64], [side * 3.39, 1.35, 3.64],
                    ];
                    return [
                        ...inkStroke(path, {
                            life: 2.15, color: params.color, color2: params.color2, glow: true,
                            opacity: 0.66 * params.intensity, scale: params.scale, width: 0.2,
                            overlap: 1.38, fadeIn: 0.4, fadeOut: 0.55,
                        }),
                        ...inkStroke(path.map(([x, y, z]): Point3 => [x * 0.93, 2.28 + (y - 2.28) * 0.92, z + 0.1]), {
                            count: 9, life: 2.15, color: params.color2, color2: params.color,
                            opacity: (i === 0 ? 0.47 : 0.39) * params.intensity,
                            scale: params.scale, width: 0.12, overlap: 1.64, fadeIn: 0.55, fadeOut: 0.65,
                        }),
                        ...(opening > .72 ? inkStroke(lattice, {
                            life: 2.15, color: params.color2, color2: params.color, opacity: .67 * params.intensity,
                            width: .14, overlap: 1.2, scale: params.scale, fadeIn: .55, fadeOut: .65,
                        }) : []),
                    ];
                }),
            };
        },
    },
    {
        id: "chinese_lotus_bloom",
        label: "水上莲开",
        category: "accent",
        trigger: "instant",
        interval: 40,
        priority: 5,
        variants: ["left", "right", "pair"],
        emit({ params }) {
            const sides = params.variant === "pair" ? [-1, 1] : [params.variant === "right" ? 1 : -1];
            return {
                priority: 5,
                emitters: sides.flatMap(side => {
                    const origin: Point3 = [side * 3.15, 0.16, 0.8];
                    const petals = drawPoints({
                        offset: origin, count: 10, life: 2.48, radius: 0.16, radiusEnd: 1.22, curve: .68,
                        rise: 0.75, depthRatio: 0.72, brush: "petal", color: params.color, color2: params.color2,
                        colorRandom: 0.8, opacity: .68 * params.intensity, scale: params.scale,
                        size: .15, sizeEnd: .078, flutter: .095, omega: 27,
                        spinJitter: 180, spinRate: 48, fadeIn: .36, fadeOut: .95,
                    });
                    return [
                        drawGroundRing({
                            offset: origin, radiusStart: .11, radiusEnd: 1.6, life: 2.7, fadeOut: 1.3,
                            opacity: .59 * params.intensity, color: params.color, color2: params.color2,
                        }),
                        petals,
                        ...Array.from({ length: 5 }, (_, i) => {
                            const angle = i / 5 * Math.PI * 2;
                            const leaf = samplePath(12, t => {
                                const s = Math.sin(Math.PI * t);
                                const theta = angle + .43 * Math.sin(t * Math.PI * 2);
                                return [
                                    origin[0] + Math.cos(theta) * .78 * s,
                                    origin[1] + .36 * s * s,
                                    origin[2] + Math.sin(theta) * .66 * s,
                                ];
                            });
                            return inkStroke(leaf, {
                                count: 3, life: 2.05, drawTime: .58, color: params.color, color2: params.color2,
                                opacity: .81 * params.intensity, width: .14, scale: params.scale,
                                glow: true, fadeIn: .23, fadeOut: .86, overlap: 1.62,
                            });
                        }).flat(),
                    ];
                }),
            };
        },
    },
    {
        id: "chinese_glaze_spray",
        label: "釉光飞白",
        category: "accent",
        trigger: "instant",
        interval: 36,
        priority: 7,
        emit({ params }) {
            const { intensity, color, color2, scale } = params;
            const ribbons = [-1, 1].map(side => catmullRom([
                [1.32, 1.65, 2.45], [1.32 + side * .82, 2.25, 2.05],
                [1.32 + side * 1.22, 3.75, 2.65], [1.32 + side * .6, 4.88, 2.9],
                [1.32 + side * .09, 5.35, 2.57],
            ], 8));
            return {
                priority: 7,
                emitters: ribbons.flatMap((path, i) => inkStroke(path, {
                    count: 13, life: 2.16, drawTime: mix(.62, .93, i), color, color2,
                    opacity: .88 * intensity, width: .205, scale, overlap: 1.56,
                    travel: .11, velocity: [i === 0 ? -.075 : .075, .13, 0], fadeIn: .2, fadeOut: .77,
                })),
            };
        },
    },
];
