import { MolangVariableMap } from "@minecraft/server";
import { RightOffsets } from "@domain/geometry/offsets";
import type { VfxEmitter } from "@domain/piano/vfxLab";
import { placeVfxEmitter, vfxStageFrame } from "@domain/piano/vfxStage";
import { instrumentCenter } from "@platform/assembly";
import type { InstrumentLocation } from "@platform/instrumentLocation";

export function spawnVfxEmitter(location: InstrumentLocation, emitter: VfxEmitter, sceneAge: number) {
    const { position, variables } = placeVfxEmitter(instrumentCenter(location), RightOffsets[location.direction],
        vfxStageFrame(location.definition), emitter, sceneAge);
    const map = new MolangVariableMap();
    for (const [key, value] of Object.entries(variables)) {
        // Molang rejects NaN/Infinity with a hard scripting error; degrade to 0.
        map.setFloat(`variable.vfx_${key}`, Number.isFinite(value) ? value : 0);
    }
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y) || !Number.isFinite(position.z)) return;
    location.dimension.spawnParticle(`pbe:vfx_${emitter.particle ?? emitter.effect}`, position, map);
}
