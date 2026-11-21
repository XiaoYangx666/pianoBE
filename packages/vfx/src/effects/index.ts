import type { VfxCategory, VfxEffectDefinition } from "../types";
import { ACCENT_EFFECTS } from "./accents";
import { ATMOSPHERE_EFFECTS } from "./atmosphere";
import { CURVE_EFFECTS } from "./curves";
import { KEY_EFFECTS } from "./keys";
import { STAGE_EFFECTS } from "./stage";

export const VFX_EFFECTS = {
    ...ATMOSPHERE_EFFECTS,
    ...CURVE_EFFECTS,
    ...STAGE_EFFECTS,
    ...KEY_EFFECTS,
    ...ACCENT_EFFECTS,
} as const satisfies Readonly<Record<string, VfxEffectDefinition>>;

export type VfxEffectId = keyof typeof VFX_EFFECTS;

export const VFX_EFFECT_IDS = Object.keys(VFX_EFFECTS) as VfxEffectId[];

export function isVfxEffect(id: unknown): id is VfxEffectId {
    return typeof id === "string" && Object.hasOwn(VFX_EFFECTS, id);
}

export function getVfxEffect(id: string): VfxEffectDefinition | undefined {
    return isVfxEffect(id) ? VFX_EFFECTS[id] : undefined;
}

export function listVfxEffects(category?: VfxCategory): VfxEffectDefinition[] {
    const all = Object.values(VFX_EFFECTS);
    return category ? all.filter(effect => effect.category === category) : all;
}
