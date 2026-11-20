import type { InstrumentDefinition } from "@domain/instrument/definition";
import type { Vec3 } from "@domain/geometry/offsets";
import type { VfxEmitter } from "./vfxLab";

/**
 * Positive model depth points away from the pianist. Assembly "forward"
 * points the other way, so the grand's tail extends in negative forward.
 */
export function vfxStageFrame(definition?: InstrumentDefinition) {
    let tail = 0;
    for (const part of definition?.parts ?? []) tail = Math.max(tail, -(part.forward ?? 0));
    const playerEdge = -1.4;
    const cabinetEdge = 0.45 + tail;
    return {
        centerZ: (playerEdge + cabinetEdge) / 2,
        depth: 1 + tail / 4.4,
    };
}

/** Resolve the position and Molang inputs once for both runtime hosts. */
export function placeVfxEmitter(
    center: Vec3, right: Vec3, stage: ReturnType<typeof vfxStageFrame>, emitter: VfxEmitter, sceneAge: number,
) {
    const { offset, variables, transform = {} } = emitter;
    const scale = transform.scale ?? 1;
    const angle = (transform.rotation ?? 0) * Math.PI / 180;
    const axisX = right.x * Math.cos(angle) + right.z * Math.sin(angle);
    const axisZ = right.z * Math.cos(angle) - right.x * Math.sin(angle);
    const depth = stage.centerZ + (transform.z ?? 0);
    // Draw-brush emitters reuse the beam/wave effects without their motion
    // variables; only advance the phase when the emitter actually carries it.
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
            ...(emitter.effect === "wave" ? { phase: phase - angularSpeed * sceneAge } : {}),
            ...(emitter.effect === "beam" && arcPhase !== undefined ? { arc_phase: arcPhase + 82 * sceneAge } : {}),
        },
    };
}
