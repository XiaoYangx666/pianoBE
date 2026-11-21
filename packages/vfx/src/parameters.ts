import {
    isValidPerformanceParamKey,
    isValidPerformanceSymbol,
    type PerformanceParams,
    type PerformanceParamValue,
} from "@piano/core";
import { mix } from "./music";
import type {
    ResolvedVfxCustomParams,
    VfxParameterSchema,
    VfxParamSpec,
} from "./types";

const MAX_CUSTOM_PARAMS = 16;

function clampNumber(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function resolveParamValue(spec: VfxParamSpec, raw: unknown): PerformanceParamValue {
    if (spec.type === "boolean") {
        return typeof raw === "boolean" ? raw : spec.default;
    }
    if (spec.type === "enum") {
        return typeof raw === "string" && spec.options.includes(raw) ? raw : spec.default;
    }
    return typeof raw === "number" && Number.isFinite(raw)
        ? clampNumber(raw, spec.min, spec.max)
        : spec.default;
}

/** 提取特效参数声明表的默认值对象。 */
export function defaultSchemaParams(schema?: VfxParameterSchema): Record<string, PerformanceParamValue> {
    if (!schema) return {};
    const resolved: Record<string, PerformanceParamValue> = {};
    for (const [key, spec] of Object.entries(schema)) {
        resolved[key] = spec.default;
    }
    return resolved;
}

/** 按参数声明表解析原始参数：填充默认值、钳制数值范围并忽略未知键。 */
export function resolveSchemaParams<TSchema extends VfxParameterSchema>(
    schema: TSchema,
    raw?: PerformanceParams,
): ResolvedVfxCustomParams<TSchema> {
    const resolved: Record<string, PerformanceParamValue> = {};
    for (const [key, spec] of Object.entries(schema)) {
        const value = raw && Object.hasOwn(raw, key) ? raw[key] : undefined;
        resolved[key] = resolveParamValue(spec, value);
    }
    return resolved as ResolvedVfxCustomParams<TSchema>;
}

/** 对参数声明表做时间轴插值：数值参数平滑过渡，布尔与枚举参数在到达时刻切换。 */
export function interpolateSchemaParams(
    schema: VfxParameterSchema | undefined,
    from: PerformanceParams | undefined,
    to: PerformanceParams | undefined,
    smooth: number,
): Record<string, PerformanceParamValue> {
    if (!schema) return {};
    const result: Record<string, PerformanceParamValue> = {};
    for (const [key, spec] of Object.entries(schema)) {
        if (spec.type === "boolean" || spec.type === "enum") {
            const target = to && Object.hasOwn(to, key) ? to[key] : undefined;
            result[key] = resolveParamValue(spec, target);
            continue;
        }
        const a = from && Object.hasOwn(from, key)
            ? Number(resolveParamValue(spec, from[key]))
            : spec.default;
        const b = to && Object.hasOwn(to, key)
            ? Number(resolveParamValue(spec, to[key]))
            : spec.default;
        result[key] = clampNumber(mix(a, b, smooth), spec.min, spec.max);
    }
    return result;
}

/** 严格校验自定义参数对象，用于主题校验、导出工具与调试指令。 */
export function validateSchemaParams(
    effectId: string,
    schema: VfxParameterSchema | undefined,
    raw: unknown,
): Record<string, PerformanceParamValue> | undefined {
    if (raw === undefined) return undefined;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error(`${effectId} 的 params 需要是 JSON 对象`);
    }
    const entries = Object.entries(raw as Record<string, unknown>);
    if (entries.length > MAX_CUSTOM_PARAMS) {
        throw new Error(`${effectId} 的 params 最多包含 ${MAX_CUSTOM_PARAMS} 个参数`);
    }
    if (!entries.length) return undefined;

    const validated: Record<string, PerformanceParamValue> = {};
    for (const [key, value] of entries) {
        if (!isValidPerformanceParamKey(key)) {
            throw new Error(`${effectId} 包含无效参数名 ${key}`);
        }
        const spec = schema && Object.hasOwn(schema, key) ? schema[key] : undefined;
        if (!spec) {
            throw new Error(`特效 ${effectId} 不支持参数 ${key}`);
        }
        if (spec.type === "boolean") {
            if (typeof value !== "boolean") {
                throw new Error(`${effectId}.${key} 需要是布尔值`);
            }
            validated[key] = value;
            continue;
        }
        if (spec.type === "enum") {
            if (typeof value !== "string" || !isValidPerformanceSymbol(value) || !spec.options.includes(value)) {
                throw new Error(`${effectId}.${key} 需为 ${spec.options.join(" / ")}`);
            }
            validated[key] = value;
            continue;
        }
        if (typeof value !== "number" || !Number.isFinite(value) || value < spec.min || value > spec.max) {
            throw new Error(`${effectId}.${key} 需要在 ${spec.min} 到 ${spec.max} 之间`);
        }
        validated[key] = value;
    }
    return validated;
}
