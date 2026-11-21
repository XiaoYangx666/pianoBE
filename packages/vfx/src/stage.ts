import type { VfxEmitter, Vec3 } from "./types";
import { vfxStageFrame } from "./instrument";

export type VfxFacing = "north" | "south" | "east" | "west";

/** Model-space `right` axis for every cardinal facing; shared by both renderers. */
export const VFX_RIGHT_OFFSETS: Record<VfxFacing, Vec3> = {
    north: { x: -1, y: 0, z: 0 },
    south: { x: 1, y: 0, z: 0 },
    east: { x: 0, y: 0, z: -1 },
    west: { x: 0, y: 0, z: 1 },
};

export const VFX_LIGHT_LAYOUTS = ["rails", "backline", "fan", "truss", "neon-sides", "neon-rear"] as const;export const VFX_VEIL_LAYOUTS = ["aurora", "wings"] as const;
export type VfxLightLayout = typeof VFX_LIGHT_LAYOUTS[number];
export type VfxVeilLayout = typeof VFX_VEIL_LAYOUTS[number];
export type VfxLayout = VfxLightLayout | VfxVeilLayout;

export interface LightAnchor {
    origin: Vec3;
    direction: Vec3;
    length: number;
    width: number;
    gain: number;
}

/** 模型空间：+z 指向琴尾，远离琴键与演奏者。 */
export const stageLights: Record<VfxLightLayout, readonly LightAnchor[]> = {
    "neon-sides": [-1, 1].flatMap(side => [
        { origin: { x: side * 2.03, y: 0.12, z: 1.10 }, direction: { x: 0, y: 1, z: 0 }, length: 1.53, width: 1.25, gain: 1 },
        { origin: { x: side * 2.77, y: 0.12, z: 0.72 }, direction: { x: 0, y: 1, z: 0 }, length: 1.10, width: 1, gain: 0.76 },
    ]),
    "neon-rear": [-1, 1].map(side => ({
        origin: { x: side * 2.52, y: 0.12, z: 1.90 }, direction: { x: 0, y: 1, z: 0 }, length: 1.75, width: 0.83, gain: 1,
    })),
    rails: [-1, 1].flatMap(side => [
        { origin: { x: side * 2.10, y: 0.10, z: 1.26 }, direction: { x: side * 0.04, y: 1, z: 0.05 }, length: 1.54, width: 1.12, gain: 0.9 },
        { origin: { x: side * 2.86, y: 0.10, z: 0.69 }, direction: { x: side * 0.23, y: 1, z: 0.30 }, length: 1.18, width: 1.16, gain: 0.66 },
        { origin: { x: side * 2.33, y: 0.09, z: -0.86 }, direction: { x: side * 0.11, y: 0.17, z: 1.0 }, length: 1.48, width: 0.72, gain: 0.44 },
    ]),
    backline: [-1, 1].flatMap(side => [
        { origin: { x: side * 1.73, y: 0.12, z: 1.64 }, direction: { x: side * 0.06, y: 1, z: 0.08 }, length: 1.76, width: 1.30, gain: 1.0 },
        { origin: { x: side * 2.57, y: 0.12, z: 1.46 }, direction: { x: side * 0.14, y: 1, z: 0.17 }, length: 1.41, width: 1.01, gain: 0.78 },
    ]),
    fan: [-1, 1].flatMap(side => [
        { origin: { x: side * 1.95, y: 0.14, z: 1.12 }, direction: { x: side * 0.35, y: 1, z: 0.25 }, length: 2.21, width: 1.30, gain: 1.0 },
        { origin: { x: side * 2.12, y: 0.14, z: 0.92 }, direction: { x: side * 0.69, y: 1, z: 0.10 }, length: 2.26, width: 1.38, gain: 0.86 },
        { origin: { x: side * 2.43, y: 0.13, z: 0.55 }, direction: { x: side * 1.2, y: 1, z: -0.18 }, length: 1.88, width: 1.24, gain: 0.72 },
    ]),
    truss: [-1, 1].flatMap(side => [
        { origin: { x: side * 3.19, y: 0.12, z: 1.24 }, direction: { x: 0, y: 1, z: 0 }, length: 1.81, width: 0.70, gain: 0.89 },
        { origin: { x: side * 3.19, y: 3.51, z: 1.24 }, direction: { x: -side, y: 0, z: 0 }, length: 0.93, width: 0.64, gain: 0.76 },
        { origin: { x: side * 3.19, y: 0.12, z: 1.24 }, direction: { x: 0, y: 0, z: -1 }, length: 1.80, width: 0.54, gain: 0.55 },
        { origin: { x: side * 3.19, y: 0.53, z: 1.24 }, direction: { x: 0, y: 0, z: -1 }, length: 0.42, width: 0.74, gain: 0.66 },
    ]),
};

export const stageVeils: Record<VfxVeilLayout, readonly {
    origin: Vec3; span: number; rise: number; gain: number; phase: number; roll: number;
}[]> = {
    aurora: [
        { origin: { x: -1.31, y: 2.96, z: 1.92 }, span: 25.5, rise: 1.85, gain: 1, phase: 28, roll: 6 },
        { origin: { x: 2.01, y: 1.32, z: 0.68 }, span: 14.4, rise: 0.97, gain: 0.70, phase: 188, roll: -11 },
        { origin: { x: 0.90, y: 4.15, z: 2.35 }, span: 21.0, rise: 1.08, gain: 0.46, phase: 136, roll: 12 },
    ],
    wings: [-1, 1].map(side => ({
        origin: { x: side * 2.79, y: 0.12, z: 1.72 },
        span: 12.7, rise: 2.28, gain: side === -1 ? 0.91 : 1, phase: side * 40, roll: side * 4,
    })),
};

/** 统一解析发射器的世界坐标与 Molang 输入（Web 与 Bedrock 共用）。 */
export function placeVfxEmitter(
    center: Vec3, right: Vec3, stage: ReturnType<typeof vfxStageFrame>, emitter: VfxEmitter, sceneAge: number,
) {
    const { offset, variables, transform = {} } = emitter;
    const scale = transform.scale ?? 1;
    const angle = (transform.rotation ?? 0) * Math.PI / 180;
    const axisX = right.x * Math.cos(angle) + right.z * Math.sin(angle);
    const axisZ = right.z * Math.cos(angle) - right.x * Math.sin(angle);
    const depth = stage.centerZ + (transform.z ?? 0);
    const phase = variables.phase ?? 0;
    const angularSpeed = variables.angular_speed ?? 0;
    const arcPhase = variables.arc_phase;
    return {
        position: {
            x: center.x + right.x * (transform.x ?? 0) + right.z * depth
                + scale * (axisX * offset.x + axisZ * offset.z * stage.depth),
            y: center.y + (transform.y ?? 0) + scale * offset.y,
            z: center.z + right.z * (transform.x ?? 0) - right.x * depth
                + scale * (axisZ * offset.x - axisX * offset.z * stage.depth),
        },
        variables: {
            ...variables,
            right_x: axisX, right_z: axisZ, scale, stage_depth: stage.depth,
            ...(emitter.particle === "wave" ? { phase: phase - angularSpeed * sceneAge } : {}),
            ...(emitter.particle === "beam" && arcPhase !== undefined ? { arc_phase: arcPhase + 82 * sceneAge } : {}),
        },
    };
}
