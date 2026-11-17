import { MolangVariableMap } from "@minecraft/server";
import { RightOffsets } from "@domain/geometry/offsets";
import type { VfxEmitter } from "@domain/piano/vfxLab";
import { instrumentCenter } from "@platform/assembly";
import type { InstrumentLocation } from "@platform/instrumentLocation";

export function spawnVfxEmitter(location: InstrumentLocation, emitter: VfxEmitter, sceneAge: number) {
    const right = RightOffsets[location.direction];
    const center = instrumentCenter(location);
    const { offset, variables } = emitter;
    // Model depth points from the keyboard toward the cabinet and grand tail.
    const position = {
        x: center.x + right.x * offset.x + right.z * offset.z,
        y: center.y + offset.y,
        z: center.z + right.z * offset.x - right.x * offset.z,
    };
    const map = new MolangVariableMap();
    for (const [key, value] of Object.entries(variables)) map.setFloat(`variable.vfx_${key}`, value);
    map.setFloat("variable.vfx_right_x", right.x);
    map.setFloat("variable.vfx_right_z", right.z);
    if (emitter.effect === "wave") map.setFloat("variable.vfx_phase", variables.phase - variables.angular_speed * sceneAge);
    location.dimension.spawnParticle(`pbe:vfx_${emitter.effect}`, position, map);
}
