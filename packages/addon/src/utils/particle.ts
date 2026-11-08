import { MolangVariableMap, type Dimension, type Vector3 } from "@minecraft/server";
import { pianoParticleOrigin } from "@piano/keyRay";
import { pianoTextColor, PIANO_PARTICLE_PALETTES, PIANO_PARTICLE_STYLES, type PianoSettings } from "@piano/settings";

const palettes = PIANO_PARTICLE_PALETTES.map(({ value, colors }) => ({
    value, colors: colors.map(pianoTextColor),
}));

export function summonParticle(dim: Dimension, center: Vector3, right: Vector3, midi: number, settings: PianoSettings) {
    const origin = pianoParticleOrigin(center, right, midi);
    if (!origin) return;
    const effect = PIANO_PARTICLE_STYLES.find(option => option.value === settings.particleStyle) ?? PIANO_PARTICLE_STYLES[0];
    const { colors } = palettes.find(option => option.value === settings.particlePalette) ?? palettes[0];
    const position = (midi - 21) / 87 * (colors.length - 1);
    const index = Math.min(Math.floor(position), colors.length - 2);
    const low = colors[index];
    const high = colors[index + 1];
    const pitch = position - index;
    const variables = new MolangVariableMap();
    variables.setFloat("variable.piano_red", low.red + (high.red - low.red) * pitch);
    variables.setFloat("variable.piano_green", low.green + (high.green - low.green) * pitch);
    variables.setFloat("variable.piano_blue", low.blue + (high.blue - low.blue) * pitch);
    dim.spawnParticle(effect.effect, origin, variables);
    const key = pianoParticleOrigin(center, right, midi, true);
    if (key) {
        variables.setFloat("variable.piano_key_axis_x", Math.abs(right.x));
        dim.spawnParticle("xypiano:key_glimmer", key, variables);
    }
}
