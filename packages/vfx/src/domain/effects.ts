import type { PerformanceParams, PerformanceParamValue } from "@piano/core";
import {
    defaultSchemaParams,
    resolveSchemaParams,
    validateSchemaParams,
} from "../plugin/parameters";
import { vfxRegistry, type VfxRegistry } from "../plugin/registry";
import type { ListVisibilityOptions, VfxCategory, VfxEffectDefinition } from "../types";

export type VfxEffectId = string;

export function isVfxEffect(id: unknown, registry: VfxRegistry = vfxRegistry): id is VfxEffectId {
    return typeof id === "string" && registry.hasEffect(id);
}

export function getVfxEffect(id: string, registry: VfxRegistry = vfxRegistry): VfxEffectDefinition | undefined {
    return registry.getEffect(id);
}

export function getVfxEffectIds(
    registry: VfxRegistry = vfxRegistry,
    options?: ListVisibilityOptions,
): VfxEffectId[] {
    return registry.getEffectIds(options);
}

export function listVfxEffects(
    category?: VfxCategory,
    registry: VfxRegistry = vfxRegistry,
    options?: ListVisibilityOptions,
): VfxEffectDefinition[] {
    return registry.listEffects(category, options);
}

export function defaultEffectCustomParams(
    effectId: string,
    registry: VfxRegistry = vfxRegistry,
): Record<string, PerformanceParamValue> {
    return defaultSchemaParams(getVfxEffect(effectId, registry)?.parameters);
}

export function resolveEffectCustomParams(
    effectOrDef: string | VfxEffectDefinition | undefined,
    raw?: PerformanceParams,
    registry: VfxRegistry = vfxRegistry,
): Record<string, PerformanceParamValue> {
    const def = typeof effectOrDef === "string" ? getVfxEffect(effectOrDef, registry) : effectOrDef;
    if (!def?.parameters) return {};
    return resolveSchemaParams(def.parameters, raw);
}

export function validateEffectCustomParams(
    effectId: string,
    raw: unknown,
    registry: VfxRegistry = vfxRegistry,
): Record<string, PerformanceParamValue> | undefined {
    const def = getVfxEffect(effectId, registry);
    if (!def) throw new Error(`未知特效 ${effectId}`);
    return validateSchemaParams(effectId, def.parameters, raw);
}
