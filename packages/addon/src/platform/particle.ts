import { MolangVariableMap, type Dimension, type Vector3 } from "@minecraft/server";
import { keyParticleOrigin, resolveKeyParticle, type PianoParticleOverride, type VfxInstrument } from "@piano/vfx";
import type { PianoSettings } from "@domain/piano/settings";

export function summonParticle(
    dim: Dimension,
    center: Vector3,
    right: Vector3,
    midi: number,
    settings: PianoSettings,
    instrument: VfxInstrument,
    override?: PianoParticleOverride,
) {
    const resolved = resolveKeyParticle(midi, settings, right, override);
    for (const emitter of resolved.emitters) {
        const origin = keyParticleOrigin(center, right, midi, emitter.onKey, instrument);
        if (!origin) continue;
        const variables = new MolangVariableMap();
        for (const [name, value] of Object.entries(emitter.variables)) {
            // Molang rejects NaN/Infinity with a hard scripting error; degrade to 0.
            variables.setFloat(`variable.vfx_${name}`, Number.isFinite(value) ? value : 0);
        }
        dim.spawnParticle(`pbe:vfx_${emitter.particle}`, origin, variables);
    }
}
