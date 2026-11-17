import { MolangVariableMap } from "@minecraft/server";
import { RightOffsets } from "@domain/geometry/offsets";
import type { VfxEmitter } from "@domain/piano/vfxLab";
import { vfxStageFrame } from "@domain/piano/vfxStage";
import { instrumentCenter } from "@platform/assembly";
import type { InstrumentLocation } from "@platform/instrumentLocation";

export function spawnVfxEmitter(location: InstrumentLocation, emitter: VfxEmitter, sceneAge: number) {
    const right = RightOffsets[location.direction];
    const center = instrumentCenter(location);
    const stage = vfxStageFrame(location.definition);
    const { offset, variables, transform = {} } = emitter;
    const scale = transform.scale ?? 1;
    const angle = (transform.rotation ?? 0) * Math.PI / 180;
    const axisX = right.x * Math.cos(angle) + right.z * Math.sin(angle);
    const axisZ = right.z * Math.cos(angle) - right.x * Math.sin(angle);
    // Model depth points from the keyboard toward the cabinet and grand tail.
    const position = {
        x: center.x + right.x * (transform.x ?? 0) + right.z * (stage.centerZ + (transform.z ?? 0))
            + scale * (axisX * offset.x + axisZ * offset.z * stage.depth),
        y: center.y + (transform.y ?? 0) + scale * offset.y,
        z: center.z + right.z * (transform.x ?? 0) - right.x * (stage.centerZ + (transform.z ?? 0))
            + scale * (axisZ * offset.x - axisX * offset.z * stage.depth),
    };
    const map = new MolangVariableMap();
    for (const [key, value] of Object.entries(variables)) map.setFloat(`variable.vfx_${key}`, value);
    map.setFloat("variable.vfx_right_x", axisX);
    map.setFloat("variable.vfx_right_z", axisZ);
    map.setFloat("variable.vfx_scale", scale);
    map.setFloat("variable.vfx_stage_depth", stage.depth);
    if (emitter.effect === "wave") map.setFloat("variable.vfx_phase", variables.phase - variables.angular_speed * sceneAge);
    if (emitter.effect === "beam") map.setFloat("variable.vfx_arc_phase", variables.arc_phase + 82 * sceneAge);
    location.dimension.spawnParticle(`pbe:vfx_${emitter.effect}`, position, map);
}
