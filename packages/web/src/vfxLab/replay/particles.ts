import Molang from "molangjs";

/** A Molang expression or a literal number, as stored in Bedrock particle JSON. */
type Expr = string | number;

export interface ParticleEffect {
    id: string;
    lifetime: Expr;
    position: [Expr, Expr, Expr];
    size: [Expr, Expr];
    color: [Expr, Expr, Expr, Expr];
    axis: [Expr, Expr, Expr] | null;
    uv: { width: number; height: number; origin: [Expr, Expr]; size: [number, number] };
    texture: string;
}

const parser = new Molang();

export function evaluate(expr: Expr | undefined, scope: Record<string, number>, fallback = 0) {
    if (expr === undefined) return fallback;
    if (typeof expr === "number") return expr;
    return parser.parse(expr, scope);
}

/** Read the components the Secret staging uses; anything else is ignored on purpose. */
export function parseEffect(document: any): ParticleEffect {
    const components = document?.particle_effect?.components;
    const description = document?.particle_effect?.description;
    const motion = components?.["minecraft:particle_motion_parametric"];
    const billboard = components?.["minecraft:particle_appearance_billboard"];
    if (!motion || !billboard) throw new Error(`不支持的粒子结构：${description?.identifier ?? "未知"}`);
    const tint = components["minecraft:particle_appearance_tinting"];
    const uv = billboard.uv;
    if (!uv) throw new Error(`粒子缺少 UV：${description.identifier}`);
    const direction = billboard.direction;
    return {
        id: description.identifier,
        lifetime: components["minecraft:particle_lifetime_expression"]?.max_lifetime ?? 1,
        position: motion.relative_position,
        size: billboard.size,
        color: tint?.color ?? [1, 1, 1, 1],
        axis: billboard.facing_camera_mode === "direction_x" && direction?.custom_direction
            ? direction.custom_direction : null,
        uv: {
            width: uv.texture_width,
            height: uv.texture_height,
            origin: uv.uv,
            size: uv.uv_size,
        },
        texture: description?.basic_render_parameters?.texture ?? "",
    };
}
