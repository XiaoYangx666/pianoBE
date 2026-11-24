import {
    drawComet, drawGroundRing, drawPoints, drawStrokeSegments, mix, resolveSchemaParams,
    vfxPerformerDepth, vfxStageFrame,
    type Point3, type VfxEffectDefinition, type VfxInstrument,
} from "@piano/vfx";

const SHAPE = {
    aperture: { label: "水环展开", min: 0, max: 1, default: 0.78, step: 0.05 },
    height: { label: "光核高度", min: 2.5, max: 5.6, default: 4.6, step: 0.1 },
} as const;

function authorityDepth(instrument: VfxInstrument) {
    const stage = vfxStageFrame(instrument);
    return { center: (vfxPerformerDepth(instrument) * 0.48 - stage.centerZ) / stage.depth, unit: 1 / stage.depth };
}

export const authorityEffects: readonly VfxEffectDefinition[] = [
    {
        id: "sinner_authority", label: "古龙之大权 · 汇流", category: "stage", trigger: "continuous",
        interval: 10, priority: 8, parameters: SHAPE,
        emit({ params: { color, color2, intensity, scale, custom }, instrument, phase }) {
            const { aperture, height } = resolveSchemaParams(SHAPE, custom);
            const depth = authorityDepth(instrument);
            const radius = mix(1.6, 4.5, aperture) * scale;
            const core: Point3 = [0, height, depth.center];
            const angle = phase * Math.PI / 180;
            const coreSize = mix(0.19, 0.57, aperture) * scale;
            const emitters = [
                drawPoints({ group: "authority_core", count: 1, life: 0.9, lifeJitter: 0, brush: "star",
                    color: color2, opacity: 0.86 * intensity, offset: core, size: coreSize,
                    sizeJitter: 0, spin: phase / 12, fadeIn: 0.24, fadeOut: 0.38 }),
                drawPoints({ group: "authority_core", count: 1, life: 0.85, lifeJitter: 0, brush: "mote",
                    color, opacity: 0.55 * intensity, offset: core, size: coreSize * 2.45,
                    sizeJitter: 0, fadeIn: 0.22, fadeOut: 0.4 }),
                drawGroundRing({ group: "authority_rings", offset: [0, height - 0.3, depth.center],
                    life: 0.91, color, color2, opacity: 0.75 * intensity, radiusStart: radius * 0.62,
                    radiusEnd: radius * 0.7, spin: phase / 5, fadeIn: 0.28, fadeOut: 0.39 }),
                drawGroundRing({ group: "authority_rings", offset: [0, height + 0.66, depth.center],
                    life: 0.94, color: color2, color2: color, opacity: aperture * 0.67 * intensity,
                    radiusStart: radius * 0.98, radiusEnd: radius * 1.02, style: 1, spin: -phase / 6,
                    fadeIn: 0.25, fadeOut: 0.44 }),
                drawPoints({ group: "authority_beads", count: 9, life: 1.34, lifeJitter: 0.1, brush: "mote",
                    color, color2, colorRandom: 0.77, opacity: 0.83 * intensity,
                    offset: [0, height - 0.32, depth.center], radius: radius * 0.69, radiusEnd: radius * 0.77,
                    depthRatio: depth.unit, radialJitter: 0.17, size: 0.062 * scale, sizeJitter: 0.52,
                    phase, omega: 26, rise: 0.33, twinkle: 0.68, fadeIn: 0.19, fadeOut: 0.55 }),
            ];

            for (const side of [-1, 1]) {
                const stream = Array.from({ length: 13 }, (_, index): Point3 => {
                    const t = index / 12;
                    const bend = Math.sin(t * Math.PI);
                    return [
                        side * radius * (1 - t) * (1.02 - 0.3 * bend),
                        height - (1 - t) * mix(1.75, 0.72, aperture) + 0.61 * bend,
                        depth.center + depth.unit * (side * radius * 0.37 * Math.sin(Math.PI * t) + 0.24 * bend * Math.sin(angle)),
                    ];
                });
                emitters.push(...drawStrokeSegments(stream, {
                    group: "authority_streams", count: aperture > 0.48 ? 7 : 4, life: 0.83, brush: "silk",
                    color, color2, width: mix(0.13, 0.38, aperture) * scale, opacity: 0.71 * intensity,
                    overlap: 1.75, travel: 0.68, fadeIn: 0.21, fadeOut: 0.38,
                }));
            }
            for (let i = 0; i < 3; i++) {
                const a = angle + i * Math.PI * 2 / 3;
                emitters.push(drawComet({
                    offset: [Math.cos(a) * radius * 0.87, height - 1.15, depth.center + depth.unit * Math.sin(a) * radius * 0.87],
                    life: 1.17, direction: [0, 1, 0], velocity: [0, 1.5, 0], length: 0.92, lengthEnd: 1.38,
                    width: 0.042, color, color2, opacity: aperture * 0.8 * intensity, fadeIn: 0.21, fadeOut: 0.41,
                }));
            }
            return { priority: 8, emitters };
        },
    },
    {
        id: "sinner_authority_release", label: "古龙之大权 · 放流", category: "accent", trigger: "instant",
        interval: 20, priority: 10,
        emit({ params: { color, color2, intensity, scale }, instrument }) {
            const depth = authorityDepth(instrument);
            const core: Point3 = [0, 4.6, depth.center];
            return {
                priority: 10,
                emitters: [
                    drawPoints({ group: "authority_core", count: 1, life: 0.71, lifeJitter: 0, brush: "star",
                        color: color2, opacity: intensity, offset: core, size: 1.48, sizeEnd: 0.32,
                        sizeJitter: 0, scale, fadeIn: 0.025, fadeOut: 0.63 }),
                    drawPoints({ group: "authority_core", count: 1, life: 0.98, lifeJitter: 0, brush: "mote",
                        color, opacity: 0.77 * intensity, offset: core, size: 2.25, sizeEnd: 0.78,
                        scale, fadeIn: 0.03, fadeOut: 0.71 }),
                    ...[0, 0.88, -1.02].map((shift, index) => drawGroundRing({
                        group: "authority_rings", offset: [0, core[1] + shift, depth.center],
                        life: 1.43 + index * 0.26, color: index === 0 ? color2 : color, color2,
                        opacity: (0.91 - index * 0.17) * intensity, radiusStart: 0.28 + index * 0.6,
                        radiusEnd: 4.95 - index * 0.47, scale, curve: 0.57, vy: 0.24 * shift,
                        style: index === 1 ? 1 : 0, fadeIn: 0.047, fadeOut: 0.7,
                    })),
                    drawPoints({ group: "authority_beads", count: 22, life: 2.26, brush: "mote",
                        color, color2, colorRandom: 0.86, opacity: 0.95 * intensity, offset: core,
                        radius: 0.4, radiusEnd: 4.65, curve: 0.62, radialJitter: 0.78, depthRatio: depth.unit,
                        rise: 1.22, spread: [0.16, 0.72, 0.16], size: 0.075, sizeEnd: 0.037,
                        sizeJitter: 0.46, omega: 17, scale, twinkle: 0.73, fadeIn: 0.055, fadeOut: 0.82 }),
                ],
            };
        },
    },
];
