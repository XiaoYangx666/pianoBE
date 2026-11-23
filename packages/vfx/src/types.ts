import type {
    PerformanceMotion, PerformanceParams, PerformanceParamValue, PerformanceZone,
} from "@piano/core";
import type { PointBrushId, StrokeBrushId } from "./spatial/brushes";
import type { VfxInstrument } from "./spatial/instrument";
import type { MusicFeatures, VfxKeyNote } from "./runtime/music";

export interface Vec3 {
    x: number;
    y: number;
    z: number;
}

/** Alias kept for the public API surface: instruments are selected by id, not by addon assembly. */
export type { VfxInstrument };

export type VfxBuiltinParticle =
    | "field"
    | "wave"
    | "beam"
    | "ripple"
    | "fountain"
    | "curtain"
    | "orbit"
    | "shaft"
    | "shaft_upright"
    | "shard"
    | "draw_point"
    | "draw_stroke"
    | "draw_plane"
    | "draw_cloud"
    | "draw_comet"
    | "key_stream"
    | "key_drift"
    | "key_blue_tears"
    | "magic_trail"
    | "dust"
    | "shock";

export type VfxParticle = VfxBuiltinParticle | (string & {});

export interface VfxTransform {
    x?: number;
    y?: number;
    z?: number;
    rotation?: number;
    scale?: number;
}

export interface VfxEmitter {
    particle: VfxParticle;
    /** 统计与预算汇总使用的逻辑分组名 */
    group: string;
    offset: Vec3;
    variables: Record<string, number>;
    /** 用于预算预留与诊断的粒子数量上限 */
    particles: number;
    lifetime: number;
    transform?: VfxTransform;
}

export interface VfxBatch {
    priority: number;
    emitters: VfxEmitter[];
}

export type VfxCategory = "atmosphere" | "curve" | "stage" | "keys" | "accent" | "control";
export type VfxTrigger = "continuous" | "note" | "instant" | "control";

export interface PianoParticleOverride {
    style?: string;
    colors?: readonly string[];
    glimmer?: boolean;
    intensity?: number;
    scale?: number;
}

export interface VfxNumberParamSpec {
    type?: "number";
    label?: string;
    default: number;
    min: number;
    max: number;
    step?: number;
}

export interface VfxBooleanParamSpec {
    type: "boolean";
    label?: string;
    default: boolean;
}

export interface VfxEnumParamSpec<TOption extends string = string> {
    type: "enum";
    label?: string;
    options: readonly TOption[];
    default: TOption;
}

export type VfxParamSpec = VfxNumberParamSpec | VfxBooleanParamSpec | VfxEnumParamSpec;
export type VfxParameterSchema = Readonly<Record<string, VfxParamSpec>>;

export type ResolvedVfxCustomParams<TSchema extends VfxParameterSchema = VfxParameterSchema> = {
    readonly [K in keyof TSchema]: TSchema[K] extends VfxBooleanParamSpec
        ? boolean
        : TSchema[K] extends VfxEnumParamSpec<infer O>
            ? O
            : TSchema[K] extends VfxNumberParamSpec
                ? number
                : PerformanceParamValue;
};

export interface VfxEffectParams {
    color: string;
    color2: string;
    intensity: number;
    scale: number;
    brush?: string;
    variant?: string;
    zone: PerformanceZone;
    motion: PerformanceMotion;
    /** 经特效参数定义解析、填充默认值并钳制范围后的专属参数 */
    custom?: PerformanceParams;
}

export interface VfxEmitContext<TState = unknown> {
    params: VfxEffectParams;
    music: Readonly<MusicFeatures>;
    recentNotes: readonly VfxKeyNote[];
    lastNoteTick: number;
    instrument: VfxInstrument;
    phase: number;
    solo: boolean;
    state: TState;
    nativeStageProp?: boolean;
}

export interface VfxStageProp {
    model: "porcelain_vase";
    offset: Vec3;
    size: number;
    turn: number;
}

export interface VfxEffectDefinition<TState = any> {
    id: string;
    label: string;
    category: VfxCategory;
    trigger: VfxTrigger;
    interval: number;
    priority: number;
    defaultBrush?: PointBrushId;
    defaultStroke?: StrokeBrushId;
    variants?: readonly string[];
    parameters?: VfxParameterSchema;
    tags?: readonly string[];
    yields?: { tag: string; ticks: number };
    createState?: () => TState;
    nextInterval?: (params: VfxEffectParams, state: TState) => number;
    emit?: (context: VfxEmitContext<TState>) => VfxBatch | null;
    resolveKeyParticle?: (params: VfxEffectParams) => PianoParticleOverride | undefined;
    resolveStageProp?: (params: VfxEffectParams) => VfxStageProp | undefined;
}

export const VFX_INPUTS = ["live", "phrase", "note", "chord", "dense", "solo"] as const;
export type VfxInput = (typeof VFX_INPUTS)[number];

export function parseVfxInput(value: string): VfxInput {
    const matched = VFX_INPUTS.find(item => item === value);
    if (!matched) throw new Error(`输入源需为 ${VFX_INPUTS.join(" / ")}`);
    return matched;
}
