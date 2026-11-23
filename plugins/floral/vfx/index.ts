import {
    blendHex,
    drawPoints,
    keyOriginFor,
    resolveSchemaParams,
    type KeyParticleRenderStyle,
    type Point3,
    type VfxEffectDefinition,
    type VfxPluginManifest,
    type VfxPluginModule,
} from "@piano/vfx";
import manifest from "../plugin.json";

const KEY_TOUCH = {
    label: "花海 · 指尖碎瓣",
    render: "point",
    brush: "petal",
    alpha: 0.78,
    color: { mode: "fixed", colors: ["#FFC7BC", "#FFF0D5"] },
    draw: {
        count: 2, life: 0.69, lifeJitter: 0.16, size: 0.055, sizeEnd: 0.028, aspect: 1.35,
        spread: [0.045, 0.045, 0.065], velocity: [0.14, 0.65, 0.18], accel: [0, -1.28, 0],
        flutter: 0.036, spinJitter: 125, spinRate: 88, fadeIn: 0.07, fadeOut: 0.34,
    },
} as const satisfies KeyParticleRenderStyle;

// Stable, staggered patches leave the pianist and the audience's sightline open.
const PATCHES = [
    { x: -4.55, z: 2.35, phase: 0.08, tint: 0.18 },
    { x: -2.85, z: 2.82, phase: 0.18, tint: 0.68 },
    { x: 0.10, z: 3.55, phase: 0.27, tint: 0.56 },
    { x: 3.05, z: 3.10, phase: 0.39, tint: 0.36 },
    { x: -3.92, z: 0.18, phase: 0.43, tint: 0.42 },
    { x: 4.73, z: 1.46, phase: 0.58, tint: 0.66 },
    { x: -3.13, z: -1.49, phase: 0.67, tint: 0.74 },
    { x: 3.62, z: -0.35, phase: 0.82, tint: 0.12 },
    { x: 4.85, z: -1.76, phase: 0.94, tint: 0.83 },
] as const;

const MEADOW = {
    coverage: { label: "花野展开", default: 1, min: 0.08, max: 1, step: 0.01 },
} as const;

const TIDE = {
    front: { label: "潮锋位置", default: 0.53, min: -0.24, max: 1.24, step: 0.01 },
    crest: { label: "浪头高度", default: 0.55, min: 0.15, max: 1.3, step: 0.01 },
    span: { label: "潮锋宽度", default: 0.3, min: 0.14, max: 0.72, step: 0.01 },
} as const;

const EFFECTS: readonly VfxEffectDefinition[] = [
    {
        id: "floral_meadow",
        label: "暮色花野",
        category: "stage",
        trigger: "continuous",
        interval: 22,
        priority: 3,
        defaultBrush: "blossom",
        parameters: MEADOW,
        emit({ params }) {
            const { color, color2, intensity, scale } = params;
            const { coverage } = resolveSchemaParams(MEADOW, params.custom);
            const emitters = PATCHES.flatMap((patch, i) => {
                const visible = Math.max(0, Math.min(1, (coverage - i * 0.095) * 5));
                if (visible <= 0) return [];
                return [{
                    particle: "floral_ground",
                    group: "floral_ground",
                    offset: { x: patch.x, y: 0.035, z: patch.z },
                    particles: 1,
                    lifetime: 1.65,
                    transform: { scale },
                    variables: {
                        life: 1.65,
                        opacity: intensity * visible * 0.94,
                        width: 0.96 + patch.tint * 0.41,
                        depth: 0.66 + patch.tint * 0.23,
                        spin: (i % 3 - 1) * 22 + i * 90,
                    },
                }, drawPoints({
                    group: "floral_meadow",
                    count: i === 2 || i === 3 ? 5 : 4,
                    life: 1.65, lifeJitter: 0.08,
                    brush: "blossom", color: blendHex(color, color2, patch.tint), color2,
                    colorRandom: 0.85, opacity: intensity * visible * (i < 4 ? 0.58 : 0.73),
                    offset: [patch.x, 0.22, patch.z], scale,
                    size: i < 4 ? 0.081 : 0.11, sizeEnd: i < 4 ? 0.09 : 0.12, sizeJitter: 0.43,
                    spread: [0.86, 0.15, 0.54], flutter: 0.022, spinJitter: 80, spinRate: 8,
                    fadeIn: 0.47, fadeOut: 0.52,
                })];
            });
            return { priority: 3, emitters };
        },
    },
    {
        id: "floral_tide",
        label: "逐风花潮",
        category: "stage",
        trigger: "continuous",
        interval: 10,
        priority: 6,
        defaultBrush: "blossom",
        parameters: TIDE,
        emit({ params }) {
            const { color, color2, intensity, scale } = params;
            const { front, crest, span } = resolveSchemaParams(TIDE, params.custom);
            const emitters = PATCHES.flatMap(patch => {
                const distance = Math.abs(patch.phase - front) / span;
                if (distance >= 1) return [];
                const weight = Math.cos(distance * Math.PI * 0.5) ** 2;
                if (weight < 0.08) return [];
                const lift = crest * (0.23 + 0.77 * weight);
                return [drawPoints({
                    group: "floral_tide",
                    count: 5, life: 1.05, lifeJitter: 0,
                    brush: "blossom", color: blendHex(color, color2, patch.tint * 0.66), color2,
                    colorRandom: 0.88, opacity: intensity * weight * 0.91,
                    offset: [patch.x - 0.34, 0.24, patch.z + 0.15], scale,
                    size: 0.13 + weight * 0.036, sizeEnd: 0.068, sizeJitter: 0.38, aspect: 0.86,
                    spread: [0.93, 0.14, 0.46], velocity: [0.55, 3.15 * lift, -0.65],
                    accel: [0, -5.6 * lift, 0], flutter: 0.085, spinJitter: 125, spinRate: 37,
                    fadeIn: 0.16, fadeOut: 0.49,
                })];
            });
            return { priority: 6, emitters };
        },
    },
    {
        id: "floral_petal_phrase",
        label: "随句翻瓣",
        category: "accent",
        trigger: "instant",
        interval: 20,
        priority: 7,
        defaultBrush: "petal",
        variants: ["left", "right", "crown", "orbit", "farewell"],
        emit({ params, instrument }) {
            const { color, color2, intensity, scale, variant } = params;
            if (variant === "orbit") {
                return {
                    priority: 7,
                    emitters: Array.from({ length: 6 }, (_, index) => {
                        const outer = index >= 3;
                        const lane = index % 3;
                        const life = outer ? 2.75 : 3.35;
                        return drawPoints({
                            group: "floral_petal_phrase",
                            count: outer ? 7 : 10, life, lifeJitter: 0.09,
                            brush: "petal", color: outer ? color : color2, color2: outer ? color2 : color,
                            colorRandom: 0.82, opacity: intensity * (outer ? 0.79 : 0.96),
                            offset: [0, (outer ? 0.65 : 0.89) + lane * 0.19, 0.53], scale,
                            radius: (outer ? 3.02 : 2.73) + lane * 0.14,
                            radiusEnd: (outer ? 4.38 : 3.72) + lane * 0.23,
                            curve: 1.65, depthRatio: 0.8, radialJitter: 0.23,
                            phase: (outer ? 30 : 190) + lane * 15, phaseSpread: 33,
                            omega: outer ? 103 : 120, tilt: outer ? 0.29 : 0.43,
                            rise: outer ? 0.72 : 2.12, flutter: 0.11, spread: [0.15, 0.12, 0.15],
                            size: outer ? 0.129 : 0.135, sizeEnd: 0.057, sizeJitter: 0.4, aspect: 1.27,
                            spinJitter: 170, spinRate: outer ? 126 : 91, fadeIn: 0.18, fadeOut: outer ? 0.72 : 1.06,
                        });
                    }),
                };
            }
            if (variant === "farewell") {
                const origin = keyOriginFor(64, instrument);
                if (!origin) return null;
                return {
                    priority: 7,
                    emitters: [drawPoints({
                        group: "floral_petal_phrase",
                        count: 1, life: 5.8, lifeJitter: 0,
                        brush: "petal", color, color2, opacity: 0.95 * intensity,
                        transform: { x: origin[0], y: origin[1] + 0.07, z: origin[2], scale },
                        size: 0.103, sizeEnd: 0.06, sizeJitter: 0, aspect: 1.22,
                        velocity: [0.17, 0.21, 0.18], accel: [0, -0.076, 0],
                        flutter: 0.085, spin: -15, spinRate: 39, fadeIn: 0.28, fadeOut: 2.45,
                    })],
                };
            }
            const crown = variant === "crown";
            const sides = crown ? [-1, 1] : [variant === "right" ? 1 : -1];
            return {
                priority: 7,
                emitters: sides.flatMap(side => [0, 1, 2].map(lane => {
                    const origin: Point3 = [side * (2.85 + lane * 0.76), 0.45 + lane * 0.11, 0.70 + lane * 0.66];
                    const lift = (crown ? 2.58 : 1.26) - lane * 0.19 + side * 0.12;
                    return drawPoints({
                        group: "floral_petal_phrase",
                        count: crown ? 7 : 5, life: crown ? 2.65 : 1.76, lifeJitter: 0.12,
                        brush: "petal", color, color2, colorRandom: 0.91, opacity: intensity * 0.87,
                        offset: origin, scale, size: crown ? 0.143 : 0.108, sizeEnd: 0.064,
                        sizeJitter: 0.47, spread: [0.40, 0.15, 0.60], aspect: 1.25,
                        velocity: [0.40 + lane * 0.22, lift, -0.48 - lane * 0.13],
                        accel: [0, crown ? -1.63 : -1.15, 0], flutter: 0.19,
                        radius: 0.08, radiusEnd: crown ? 0.52 : 0.31, omega: 73,
                        spinJitter: 160, spinRate: 84 + lane * 17, fadeIn: 0.19, fadeOut: 0.69,
                    });
                })),
            };
        },
    },
    {
        id: "floral_key_style",
        label: "花海琴键",
        category: "control",
        trigger: "control",
        interval: 20,
        priority: 0,
        variants: ["petal", "glimmer"],
        resolveKeyParticle({ color, color2, intensity, scale, variant }) {
            return {
                style: variant === "glimmer" ? "glimmer" : "floral_touch",
                colors: [color, color2], glimmer: true, intensity, scale,
            };
        },
    },
];

export const floralPlugin: VfxPluginModule = {
    manifest: manifest as VfxPluginManifest,
    register(api) {
        api.registerKeyStyle("floral_touch", KEY_TOUCH);
        for (const effect of EFFECTS) api.registerEffect(effect);
    },
};

export default floralPlugin;
