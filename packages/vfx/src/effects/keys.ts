import { POINT_BRUSH_INDEX } from "../brushes";
import { blendHex, colorVars, pitchGradientHex } from "../color";
import { motionFactors, pickRecentKeys, ZONE_Y_OFFSET, type Point3 } from "../geometry";
import { keyOriginFor, vfxStageFrame } from "../instrument";
import { keyParticleOverrideFromParams } from "../keyParticles";
import { drawPoints, resolvePointBrush, resolveStrokeBrush } from "../primitives";
import { KEY_PARTICLE_STYLE_IDS } from "../keyParticles";
import { type VfxEffectDefinition, type VfxEmitter } from "../types";

export const KEY_EFFECTS = {
    key_notes: {
        id: "key_notes",
        label: "琴键飞音符",
        category: "keys",
        trigger: "note",
        interval: 1,
        priority: 5,
        defaultBrush: "note",
        emit({ params, music, recentNotes, lastNoteTick, instrument, phase, solo }) {
            const { color, color2, intensity, scale, brush, zone, motion } = params;
            const m = motionFactors(motion);
            const targets = pickRecentKeys(recentNotes, lastNoteTick, phase, solo, 2);
            const resolvedBrush = resolvePointBrush(brush, "note");
            const yShift = ZONE_Y_OFFSET[zone] * 0.4;
            const emitters: VfxEmitter[] = [];
            for (const note of targets) {
                const origin = keyOriginFor(note.midi, instrument);
                if (!origin) continue;
                const pitch = (note.midi - 21) / 87;
                const keyColor = pitchGradientHex(color, color2, note.midi);
                const driftX = (pitch - 0.5) * (1.25 + 0.45 * music.sustain) * m.spread;
                const riseVy = (1.10 + 0.72 * pitch) * m.speed * m.dir;
                emitters.push(drawPoints({
                    count: 2,
                    life: 0.52 + pitch * 0.14,
                    lifeJitter: 0.12,
                    brush: resolvedBrush,
                    color: keyColor,
                    color2,
                    opacity: intensity * note.velocity * 0.90,
                    transform: { x: origin[0], y: origin[1] + yShift, z: origin[2], scale },
                    size: 0.085 + 0.025 * note.velocity,
                    sizeEnd: 0.048,
                    sizeJitter: 0.22,
                    velocity: [driftX, riseVy, 0.72 + pitch * 0.95],
                    accel: [0, -0.85 * m.dir, 0],
                    flutter: 0.05,
                    fadeIn: 0.05,
                    fadeOut: 0.26,
                }));
            }
            return { priority: 5, emitters };
        },
    } satisfies VfxEffectDefinition,

    key_fountain: {
        id: "key_fountain",
        label: "琴键音泉喷涌",
        category: "keys",
        trigger: "note",
        interval: 2,
        priority: 4,
        defaultBrush: "spark",
        emit({ params, recentNotes, lastNoteTick, instrument, phase, solo }) {
            const { color, color2, intensity, scale, brush, zone, motion } = params;
            const m = motionFactors(motion);
            const targets = pickRecentKeys(recentNotes, lastNoteTick, phase, solo, 2);
            const resolvedBrush = resolvePointBrush(brush, "spark");
            const yShift = ZONE_Y_OFFSET[zone] * 0.4;
            const emitters: VfxEmitter[] = [];
            for (const note of targets) {
                const origin = keyOriginFor(note.midi, instrument);
                if (!origin) continue;
                const pitch = (note.midi - 21) / 87;
                const keyColor = pitchGradientHex(color, color2, note.midi);
                emitters.push(drawPoints({
                    count: 4,
                    life: 0.68,
                    lifeJitter: 0.18,
                    brush: resolvedBrush,
                    color: keyColor,
                    color2,
                    opacity: intensity * (0.45 + 0.55 * note.velocity),
                    transform: { x: origin[0], y: origin[1] + yShift, z: origin[2], scale },
                    size: 0.072,
                    sizeEnd: 0.032,
                    sizeJitter: 0.30,
                    spinJitter: 60,
                    spinRate: 120 * m.dir,
                    spread: [0.06, 0.04, 0.04],
                    velocity: [(pitch - 0.5) * 0.9 * m.spread, (1.85 + 0.55 * note.velocity) * m.speed, 0.55],
                    accel: [0, -4.6 * m.energy, 0.18],
                    flutter: resolvedBrush === POINT_BRUSH_INDEX.petal || resolvedBrush === POINT_BRUSH_INDEX.snow ? 0.14 : 0.04,
                    fadeIn: 0.05,
                    fadeOut: 0.30,
                }));
            }
            return { priority: 4, emitters };
        },
    } satisfies VfxEffectDefinition,

    key_constellation: {
        id: "key_constellation",
        label: "琴键星座连线",
        category: "keys",
        trigger: "note",
        interval: 4,
        priority: 4,
        defaultBrush: "star",
        defaultStroke: "laser",
        emit({ params, recentNotes, lastNoteTick, instrument, phase, solo }) {
            const { color, color2, intensity, scale, brush, zone, motion } = params;
            const m = motionFactors(motion);
            const targets = pickRecentKeys(recentNotes, lastNoteTick, phase, solo, 4);
            if (!targets.length) return { priority: 4, emitters: [] };
            const yShift = ZONE_Y_OFFSET[zone] * 0.5;
            const resolvedBrush = resolvePointBrush(brush, "star");
            const strokeBrush = resolveStrokeBrush(brush, "laser");
            const lifted: Point3[] = [];
            const emitters: VfxEmitter[] = [];
            for (const note of targets) {
                const origin = keyOriginFor(note.midi, instrument);
                if (!origin) continue;
                const pitch = (note.midi - 21) / 87;
                const pt: Point3 = [origin[0], origin[1] + 0.42 + pitch * 0.72 + yShift, origin[2] + 0.18];
                lifted.push(pt);
                emitters.push(drawPoints({
                    count: 1,
                    life: 0.85,
                    lifeJitter: 0,
                    brush: resolvedBrush,
                    color: pitchGradientHex(color, color2, note.midi),
                    color2,
                    opacity: intensity * (0.55 + 0.45 * note.velocity),
                    transform: { x: pt[0], y: pt[1], z: pt[2], scale },
                    size: 0.095,
                    sizeEnd: 0.048,
                    velocity: [0, 0.18 * m.dir * m.speed, 0.08],
                    twinkle: 0.75,
                    fadeIn: 0.06,
                    fadeOut: 0.36,
                }));
            }
            if (lifted.length >= 2) {
                const stageDepth = vfxStageFrame(instrument).depth;
                const edges = lifted.length - 1;
                for (let i = 0; i < edges; i++) {
                    const a = lifted[i];
                    const b = lifted[i + 1];
                    const dx = b[0] - a[0];
                    const dy = b[1] - a[1];
                    const dz = b[2] - a[2];
                    const dist = Math.hypot(dx, dy, dz) || 0.01;
                    const edgeColor = blendHex(color, color2, edges > 1 ? i / edges : 0);
                    emitters.push({
                        particle: "draw_stroke",
                        group: "beam",
                        offset: { x: 0, y: 0, z: 0 },
                        particles: 1,
                        lifetime: 0.85,
                        transform: {
                            x: (a[0] + b[0]) * 0.5,
                            y: (a[1] + b[1]) * 0.5,
                            z: (a[2] + b[2]) * 0.5,
                            scale: 1,
                        },
                        variables: {
                            count: 1,
                            life: 0.85,
                            brush: strokeBrush,
                            length: dist * 1.04,
                            length_end: dist * 1.04,
                            width: 0.065 * scale,
                            vx: 0,
                            vy: 0.18 * m.dir * m.speed * scale,
                            vz: 0.08 * scale,
                            ax: 0, ay: 0, az: 0,
                            tx: dx / dist,
                            ty: dy / dist,
                            tz: (dz / dist) / stageDepth,
                            ...colorVars(edgeColor, color2, intensity * 0.72),
                            fade_in: 0.06,
                            fade_out: 0.36,
                        },
                    });
                }
            }
            return { priority: 4, emitters };
        },
    } satisfies VfxEffectDefinition,

    key_style: {
        id: "key_style",
        label: "弹奏粒子样式",
        category: "control",
        trigger: "control",
        interval: 20,
        priority: 0,
        variants: KEY_PARTICLE_STYLE_IDS,
        resolveKeyParticle: keyParticleOverrideFromParams,
    } satisfies VfxEffectDefinition,
};
