import { stagePropId, type VfxPluginManifest, type VfxStagePropDeclaration } from "./plugin";

export interface StagePropRegistration {
    id: string;
    entityId: string;
    animations: readonly string[];
}

type Triple = [number, number, number];
type Pair = [number, number];
type AnimationValue = number | Triple;
type AnimationChannel = AnimationValue | Record<string, AnimationValue>;
type BoneAnimation = Partial<Record<"position" | "rotation" | "scale", AnimationChannel>>;

export interface StagePropClip {
    loop?: boolean | "hold_on_last_frame";
    animation_length?: number;
    bones: Record<string, BoneAnimation>;
}

export interface StagePropGeometry {
    description: { identifier: string; texture_width: number; texture_height: number; [key: string]: unknown };
    bones: {
        name: string;
        parent?: string;
        pivot?: Triple;
        rotation?: Triple;
        cubes?: {
            origin: Triple; size: Triple; pivot?: Triple; rotation?: Triple; inflate?: number; mirror?: boolean;
            uv: Pair | Record<string, { uv: Pair; uv_size?: Pair }>;
        }[];
        poly_mesh?: {
            normalized_uvs?: boolean;
            positions: Triple[];
            normals: Triple[];
            uvs: Pair[];
            polys: Triple[][];
        };
    }[];
}

export interface StagePropAssets {
    declaration: VfxStagePropDeclaration;
    registration: StagePropRegistration;
    geometry: StagePropGeometry;
    geometryVersion: string;
    clips: Record<string, StagePropClip>;
    animationVersion: string;
}

const ROOT_BONE = "pbe_stage_root";
const ID = /^[a-z][a-z0-9._-]{0,63}$/;
const BONE_ID = /^[a-z0-9_][a-z0-9_.-]*$/i;
const FORMAT_VERSION = /^\d+\.\d+\.\d+$/;
const SIDES = ["east", "west", "up", "down", "south", "north"];

export function stagePropStem(pluginId: string, localId: string): string {
    const encode = (id: string) => id.replace(/[._-]/g, char => char === "." ? "_d" : char === "-" ? "_h" : "_u");
    return `pbe_stage_prop_${encode(pluginId)}__${encode(localId)}`;
}

function object(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function tuple(value: unknown, length: number): value is number[] {
    return Array.isArray(value) && value.length === length && value.every(Number.isFinite);
}

function finite(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

function validPolyMesh(mesh: unknown): boolean {
    if (!object(mesh)) return false;
    const { positions, normals, uvs, polys, normalized_uvs } = mesh;
    return (normalized_uvs === undefined || typeof normalized_uvs === "boolean")
        && Array.isArray(positions) && positions.every(value => tuple(value, 3))
        && Array.isArray(normals) && normals.every(value => tuple(value, 3))
        && Array.isArray(uvs) && uvs.every(value => tuple(value, 2))
        && Array.isArray(polys) && polys.length > 0 && polys.every(face =>
            Array.isArray(face) && face.length >= 3 && face.every(vertex =>
                tuple(vertex, 3) && vertex.every((index, axis) =>
                    Number.isInteger(index) && index >= 0 && index < [positions.length, normals.length, uvs.length][axis])));
}

function validCube(cube: unknown): boolean {
    if (!object(cube) || !tuple(cube.origin, 3) || !tuple(cube.size, 3) || cube.size.some(size => size < 0)
        || (cube.pivot !== undefined && !tuple(cube.pivot, 3))
        || (cube.rotation !== undefined && !tuple(cube.rotation, 3))
        || (cube.inflate !== undefined && !finite(cube.inflate))
        || (cube.mirror !== undefined && typeof cube.mirror !== "boolean")) return false;
    return tuple(cube.uv, 2) || (object(cube.uv) && Object.entries(cube.uv).every(([side, face]) =>
        SIDES.includes(side) && object(face) && tuple(face.uv, 2)
        && (face.uv_size === undefined || tuple(face.uv_size, 2))));
}

function readGeometry(doc: unknown, fail: (reason: string) => never) {
    if (!object(doc) || typeof doc.format_version !== "string" || !FORMAT_VERSION.test(doc.format_version)) {
        fail("模型 format_version 无效");
    }
    const models = doc["minecraft:geometry"];
    if (!Array.isArray(models) || models.length !== 1 || !object(models[0])) fail("需要恰好一个 minecraft:geometry");
    const { description, bones } = models[0];
    if (!object(description) || typeof description.identifier !== "string" || !/^geometry\.[a-z0-9_.-]+$/i.test(description.identifier)
        || !Number.isInteger(description.texture_width) || !Number.isInteger(description.texture_height)
        || Number(description.texture_width) <= 0 || Number(description.texture_height) <= 0
        || !Array.isArray(bones) || !bones.length) fail("模型缺少标识符、纹理尺寸或骨骼");

    const names = new Set<string>();
    let hasMesh = false;
    for (const bone of bones) {
        if (!object(bone) || typeof bone.name !== "string" || !BONE_ID.test(bone.name)) fail("骨骼名称无效");
        const name = bone.name.toLowerCase();
        if (name === ROOT_BONE || names.has(name)) fail(`骨骼重复或使用了保留名称：${name}`);
        names.add(name);
        if (bone.pivot !== undefined && !tuple(bone.pivot, 3)) fail(`骨骼 ${name} pivot 无效`);
        if (bone.rotation !== undefined && !tuple(bone.rotation, 3)) fail(`骨骼 ${name} rotation 无效`);
        if (bone.cubes !== undefined && (!Array.isArray(bone.cubes) || !bone.cubes.every(validCube))) {
            fail(`骨骼 ${name} cubes 无效`);
        }
        if (bone.poly_mesh !== undefined && !validPolyMesh(bone.poly_mesh)) fail(`骨骼 ${name} poly_mesh 无效`);
        hasMesh ||= Boolean((Array.isArray(bone.cubes) && bone.cubes.length) || bone.poly_mesh);
    }
    if (!hasMesh) fail("模型缺少可渲染网格");
    const geometry = models[0] as unknown as StagePropGeometry;
    const parents = new Map(geometry.bones.map(bone => [bone.name, bone.parent]));
    for (const bone of geometry.bones) {
        const seen = new Set([bone.name]);
        for (let parent = bone.parent; parent !== undefined; parent = parents.get(parent)) {
            if (!parents.has(parent) || seen.has(parent)) fail(`骨骼 ${bone.name} 的父级无效：${parent}`);
            seen.add(parent);
        }
    }
    return { geometry, geometryVersion: doc.format_version };
}

function validAnimationChannel(value: unknown): boolean {
    const validValue = (item: unknown) => finite(item) || tuple(item, 3);
    return validValue(value) || (object(value) && Object.keys(value).length > 0
        && Object.entries(value).every(([time, item]) => /^\d+(\.\d+)?$/.test(time) && finite(Number(time)) && validValue(item))
        && new Set(Object.keys(value).map(Number)).size === Object.keys(value).length);
}

function readClips(doc: unknown, geometry: StagePropGeometry, fail: (reason: string) => never) {
    if (!object(doc) || typeof doc.format_version !== "string" || !FORMAT_VERSION.test(doc.format_version)
        || !object(doc.animations)) fail("动画文档缺少有效的 format_version 或 animations");
    const names = new Set(geometry.bones.map(bone => bone.name));
    const entries = Object.entries(doc.animations);
    if (!entries.length || entries.length > 32) fail("需要声明 1 至 32 个动画");
    for (const [key, clip] of entries) {
        if (!key.startsWith("animation.") || !ID.test(key.slice("animation.".length))
            || !object(clip) || !object(clip.bones)) fail(`动画 ${key} 无效`);
        if (Object.keys(clip).some(field => !["loop", "animation_length", "bones"].includes(field))
            || (clip.loop !== undefined && typeof clip.loop !== "boolean" && clip.loop !== "hold_on_last_frame")
            || (clip.animation_length !== undefined && (!finite(clip.animation_length) || clip.animation_length <= 0))) {
            fail(`动画 ${key} 使用了不支持的播放参数`);
        }
        for (const [bone, channels] of Object.entries(clip.bones)) {
            if (!names.has(bone) || !object(channels) || Object.entries(channels).some(([channel, value]) =>
                !["position", "rotation", "scale"].includes(channel) || !validAnimationChannel(value))) {
                fail(`动画 ${key} 的骨骼 ${bone} 或数值关键帧无效`);
            }
        }
    }
    return {
        clips: Object.fromEntries(entries.map(([key, clip]) => [key.slice("animation.".length), clip])) as Record<string, StagePropClip>,
        animationVersion: doc.format_version,
    };
}

export function readStagePropAssets(
    manifest: VfxPluginManifest,
    readJson: (path: string) => unknown,
): StagePropAssets[] {
    return (manifest.stageProps ?? []).map(declaration => {
        const id = stagePropId(manifest.id, declaration.id);
        const fail = (reason: string): never => { throw new Error(`舞台道具 ${id}：${reason}`); };
        const stem = stagePropStem(manifest.id, declaration.id);
        if (stem.length > 160) fail("生成的实体标识符过长，请缩短插件或道具 ID");
        const { geometry, geometryVersion } = readGeometry(readJson(declaration.geometry), fail);
        const { clips, animationVersion } = declaration.animations
            ? readClips(readJson(declaration.animations), geometry, fail)
            : { clips: {}, animationVersion: "1.8.0" };
        return {
            declaration, geometry, geometryVersion, clips, animationVersion,
            registration: { id, entityId: `pbe:${stem}`, animations: Object.keys(clips).sort() },
        };
    });
}

export const STAGE_PROP_BP_TREE = "entities/pbe_stage_props/";
export const STAGE_PROP_RP_TREES = [
    "entity/pbe_stage_props/", "models/entity/pbe_stage_props/", "animations/pbe_stage_props/", "textures/entity/pbe_stage_props/",
] as const;
export const STAGE_PROP_REGISTRY_SCRIPT = "scripts/vfx/stagePropCatalog.js";

export function assembleStageProp(
    assets: StagePropAssets,
    readTexture: (path: string) => Uint8Array,
) {
    const { registration, declaration, geometry, geometryVersion, clips, animationVersion } = assets;
    const stem = registration.entityId.slice("pbe:".length);
    const geometryId = `geometry.pbe.${stem}`;
    const transformId = `animation.pbe.${stem}.transform`;
    const texture = `${STAGE_PROP_RP_TREES[3]}${stem}`;
    const bp = new Map<string, string>();
    const rp = new Map<string, string | Uint8Array>();
    const json = (data: unknown) => `${JSON.stringify(data, null, 4)}\n`;

    // These properties and the transient, non-interactive entity are owned by the host.
    bp.set(`${STAGE_PROP_BP_TREE}${stem}.json`, json({
        format_version: "1.21.100",
        "minecraft:entity": {
            description: {
                identifier: registration.entityId, is_spawnable: false, is_summonable: true,
                properties: {
                    "pbe:vfx_size": { type: "float", range: [0.05, 2.05], default: 0.05, client_sync: true },
                    "pbe:vfx_turn": { type: "int", range: [-180, 180], default: 0, client_sync: true },
                    "pbe:vfx_animation": {
                        type: "int", range: [0, Math.max(1, registration.animations.length)], default: 0, client_sync: true,
                    },
                },
            },
            components: {
                "minecraft:collision_box": { width: 0, height: 0 },
                "minecraft:physics": { has_gravity: false, has_collision: false },
                "minecraft:pushable": { is_pushable: false, is_pushable_by_piston: false },
                "minecraft:damage_sensor": { triggers: [{ cause: "all", deals_damage: "no" }] },
                "minecraft:fire_immune": {},
                "minecraft:transient": {},
            },
        },
    }));

    const animations: Record<string, string> = { transform: transformId };
    const animate: (string | Record<string, string>)[] = ["transform"];
    const documents: Record<string, unknown> = {
        [transformId]: {
            loop: true,
            bones: { [ROOT_BONE]: { scale: "q.property('pbe:vfx_size')", rotation: [0, "q.property('pbe:vfx_turn')", 0] } },
        },
    };
    registration.animations.forEach((clip, index) => {
        const alias = `clip_${index + 1}`;
        const id = `animation.pbe.${stem}.${alias}`;
        animations[alias] = id;
        animate.push({ [alias]: `q.property('pbe:vfx_animation') == ${index + 1}` });
        documents[id] = clips[clip];
    });
    rp.set(`${STAGE_PROP_RP_TREES[0]}${stem}.entity.json`, json({
        format_version: "1.10.0",
        "minecraft:client_entity": {
            description: {
                identifier: registration.entityId,
                materials: { default: "entity" },
                textures: { default: texture },
                geometry: { default: geometryId },
                animations,
                scripts: { animate },
                render_controllers: ["controller.render.default"],
            },
        },
    }));
    rp.set(`${STAGE_PROP_RP_TREES[1]}${stem}.geo.json`, json({
        format_version: geometryVersion,
        "minecraft:geometry": [{
            ...geometry,
            description: { ...geometry.description, identifier: geometryId },
            bones: [{ name: ROOT_BONE, pivot: [0, 0, 0] }, ...geometry.bones.map(bone => ({ ...bone, parent: bone.parent ?? ROOT_BONE }))],
        }],
    }));
    rp.set(`${STAGE_PROP_RP_TREES[2]}${stem}.animation.json`, json({ format_version: animationVersion, animations: documents }));
    rp.set(`${texture}.png`, readTexture(declaration.texture));
    if (declaration.merTexture) {
        rp.set(`${texture}_mer.png`, readTexture(declaration.merTexture));
        rp.set(`${texture}.texture_set.json`, json({
            format_version: "1.21.30",
            "minecraft:texture_set": { color: stem, metalness_emissive_roughness: `${stem}_mer` },
        }));
    }
    return { bp, rp };
}

export function serializeStagePropCatalog(registrations: readonly StagePropRegistration[]): string {
    return `export const STAGE_PROP_REGISTRATIONS = ${JSON.stringify(registrations)};\n`;
}
