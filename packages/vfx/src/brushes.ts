import vfxAtlas from "./data/vfxAtlas.json";

export const VFX_ATLAS = vfxAtlas;

export const POINT_BRUSHES = vfxAtlas.pointBrushes;
export const STROKE_BRUSHES = vfxAtlas.strokeBrushes;

export type PointBrushId = (typeof vfxAtlas.pointBrushes)[number]["id"];
export type StrokeBrushId = (typeof vfxAtlas.strokeBrushes)[number]["id"];

export const POINT_BRUSH_IDS = POINT_BRUSHES.map(entry => entry.id) as readonly PointBrushId[];
export const STROKE_BRUSH_IDS = STROKE_BRUSHES.map(entry => entry.id) as readonly StrokeBrushId[];

export const POINT_BRUSH_INDEX: Readonly<Record<PointBrushId, number>> = Object.fromEntries(
    POINT_BRUSHES.map((entry, index) => [entry.id, index]),
) as Record<PointBrushId, number>;

export const STROKE_BRUSH_INDEX: Readonly<Record<StrokeBrushId, number>> = Object.fromEntries(
    STROKE_BRUSHES.map((entry, index) => [entry.id, index]),
) as Record<StrokeBrushId, number>;

export const POINT_BRUSH_LABELS: Readonly<Record<PointBrushId, string>> = Object.fromEntries(
    POINT_BRUSHES.map(entry => [entry.id, entry.label]),
) as Record<PointBrushId, string>;

export const STROKE_BRUSH_LABELS: Readonly<Record<StrokeBrushId, string>> = Object.fromEntries(
    STROKE_BRUSHES.map(entry => [entry.id, entry.label]),
) as Record<StrokeBrushId, string>;

const POINT_TO_STROKE: Readonly<Record<string, StrokeBrushId>> = Object.fromEntries(
    POINT_BRUSHES.map(entry => [entry.id, entry.stroke as StrokeBrushId]),
);

export function isPointBrush(value: unknown): value is PointBrushId {
    return typeof value === "string" && Object.hasOwn(POINT_BRUSH_INDEX, value);
}

export function isStrokeBrush(value: unknown): value is StrokeBrushId {
    return typeof value === "string" && Object.hasOwn(STROKE_BRUSH_INDEX, value);
}

export function isValidBrush(value: unknown): boolean {
    return isPointBrush(value) || isStrokeBrush(value);
}

/** 将画笔名称解析为点画笔图集索引；未指定或未知时回退到默认点画笔。 */
export function resolvePointBrush(brush: string | undefined, fallback: PointBrushId): number {
    if (isPointBrush(brush)) return POINT_BRUSH_INDEX[brush];
    return POINT_BRUSH_INDEX[fallback];
}

/** 将笔画名称或点画笔亲和映射解析为笔画图集索引；未知时回退到默认笔画。 */
export function resolveStrokeBrush(brush: string | undefined, fallback: StrokeBrushId): number {
    if (isStrokeBrush(brush)) return STROKE_BRUSH_INDEX[brush];
    if (typeof brush === "string" && Object.hasOwn(POINT_TO_STROKE, brush)) {
        return STROKE_BRUSH_INDEX[POINT_TO_STROKE[brush]];
    }
    return STROKE_BRUSH_INDEX[fallback];
}
