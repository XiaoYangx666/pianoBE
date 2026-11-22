import type { VfxEmitter, Vec3 } from "../types";
import { vfxStageFrame } from "./instrument";
import { vfxRegistry, type VfxRegistry } from "../plugin/registry";

export type VfxFacing = "north" | "south" | "east" | "west";

/** Model-space `right` axis for every cardinal facing; shared by both renderers. */
export const VFX_RIGHT_OFFSETS: Record<VfxFacing, Vec3> = {
    north: { x: -1, y: 0, z: 0 },
    south: { x: 1, y: 0, z: 0 },
    east: { x: 0, y: 0, z: -1 },
    west: { x: 0, y: 0, z: 1 },
};

export type VfxLightLayout = string;
export type VfxVeilLayout = string;

export interface LightAnchor {
    origin: Vec3;
    direction: Vec3;
    length: number;
    width: number;
    gain: number;
}

export interface StageVeilAnchor {
    origin: Vec3;
    span: number;
    rise: number;
    gain: number;
    phase: number;
    roll: number;
}

export function getStageLightLayout(id: VfxLightLayout, registry: VfxRegistry = vfxRegistry): readonly LightAnchor[] {
    return registry.getLightLayout(id) ?? [];
}

export function getStageVeilLayout(id: VfxVeilLayout, registry: VfxRegistry = vfxRegistry): readonly StageVeilAnchor[] {
    return registry.getVeilLayout(id) ?? [];
}

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
