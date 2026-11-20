import { MolangVariableMap, type Dimension, type Vector3 } from "@minecraft/server";
import { pianoParticleOrigin } from "@domain/geometry/keyRay";
import { resolveKeyParticle, type PianoParticleOverride } from "@domain/piano/particleOverride";
import type { PianoSettings } from "@domain/piano/settings";

export function summonParticle(
    dim: Dimension,
    center: Vector3,
    right: Vector3,
    midi: number,
    settings: PianoSettings,
    model?: Parameters<typeof pianoParticleOrigin>[4],
    override?: PianoParticleOverride,
) {
    const resolved = resolveKeyParticle(midi, settings, right, override);
    if (resolved.mainParticle) {
        const origin = pianoParticleOrigin(center, right, midi, false, model);
        if (origin) {
            const variables = new MolangVariableMap();
            if (resolved.drawPointVars) {
                for (const [name, value] of Object.entries(resolved.drawPointVars)) {
                    variables.setFloat(`variable.vfx_${name}`, Number.isFinite(value) ? value : 0);
                }
            } else {
                variables.setFloat("variable.piano_red", resolved.color.red);
                variables.setFloat("variable.piano_green", resolved.color.green);
                variables.setFloat("variable.piano_blue", resolved.color.blue);
            }
            dim.spawnParticle(resolved.mainParticle, origin, variables);
        }
    }
    if (resolved.glimmer) {
        const key = pianoParticleOrigin(center, right, midi, true, model);
        if (key) {
            const variables = new MolangVariableMap();
            variables.setFloat("variable.piano_red", resolved.color.red);
            variables.setFloat("variable.piano_green", resolved.color.green);
            variables.setFloat("variable.piano_blue", resolved.color.blue);
            variables.setFloat("variable.piano_key_axis_x", Math.abs(right.x));
            dim.spawnParticle("pbe:key_glimmer", key, variables);
        }
    }
}
