import * as THREE from "three";
import { mergeBufferGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { validatePluginManifest } from "@piano/vfx";
import { readStagePropAssets, type StagePropAssets, type StagePropClip, type StagePropGeometry } from "@piano/vfx/package";

const manifests = import.meta.glob<unknown>("../../../../plugins/*/plugin.json", { eager: true, import: "default" });
const documents = import.meta.glob<string>("../../../../plugins/*/stage_props/**/*.json", {
    eager: true, query: "?raw", import: "default",
});
const textures = import.meta.glob<string>("../../../../plugins/*/stage_props/**/*.png", {
    eager: true, query: "?url", import: "default",
});

type Triple = [number, number, number];
type Bone = StagePropGeometry["bones"][number];
type PolyMesh = NonNullable<Bone["poly_mesh"]>;
type Cube = NonNullable<Bone["cubes"]>[number];
type Channel = NonNullable<StagePropClip["bones"][string]["rotation"]>;
const SIDES = ["east", "west", "up", "down", "south", "north"];

function createPolyMesh(mesh: PolyMesh, width: number, height: number) {
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    for (const face of mesh.polys) {
        for (let i = 1; i < face.length - 1; i++) {
            const triangle = [face[0], face[i], face[i + 1]];
            if (new Set(triangle.map(vertex => vertex[0])).size < 3) continue;
            for (const [position, normal, uv] of triangle) {
                const [u, v] = mesh.uvs[uv];
                positions.push(...mesh.positions[position]);
                normals.push(...mesh.normals[normal]);
                uvs.push(mesh.normalized_uvs ? u : u / width, mesh.normalized_uvs ? v : v / height);
            }
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    return geometry;
}

function cubeFaces(cube: Cube) {
    if (!Array.isArray(cube.uv)) return cube.uv;
    const [u, v] = cube.uv;
    const [x, y, z] = cube.size;
    return {
        west: { uv: [u, v + z], uv_size: [z, y] },
        north: { uv: [u + z, v + z], uv_size: [x, y] },
        east: { uv: [u + z + x, v + z], uv_size: [z, y] },
        south: { uv: [u + 2 * z + x, v + z], uv_size: [x, y] },
        up: { uv: [u + z, v], uv_size: [x, z] },
        down: { uv: [u + z + x, v + z], uv_size: [x, -z] },
    } as Exclude<Cube["uv"], [number, number]>;
}

function createCube(cube: Cube, width: number, height: number) {
    const inflate = cube.inflate ?? 0;
    const size = cube.size.map(axis => axis + 2 * inflate) as Triple;
    const center = cube.origin.map((start, axis) => start + cube.size[axis] / 2) as Triple;
    const box = new THREE.BoxGeometry(...size);
    box.translate(...center);
    if (cube.rotation) {
        const [x, y, z] = cube.pivot ?? center;
        box.translate(-x, -y, -z);
        const [rx, ry, rz] = cube.rotation.map(THREE.MathUtils.degToRad);
        box.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz, "ZYX")));
        box.translate(x, y, z);
    }
    const faces = cubeFaces(cube);
    const uv = box.getAttribute("uv");
    const indices: number[] = [];
    for (const [side, name] of SIDES.entries()) {
        const face = faces[cube.mirror && side < 2 ? SIDES[1 - side] : name];
        if (!face) continue;
        const [u, v] = face.uv;
        const [x, y, z] = cube.size;
        const [w, h] = face.uv_size ?? (side < 2 ? [z, y] : side < 4 ? [x, z] : [x, y]);
        for (let i = side * 4; i < side * 4 + 4; i++) {
            const s = cube.mirror ? 1 - uv.getX(i) : uv.getX(i);
            uv.setXY(i, (u + w * s) / width, 1 - (v + h * (1 - uv.getY(i))) / height);
        }
        for (let i = side * 6; i < side * 6 + 6; i++) indices.push(box.index!.getX(i));
    }
    box.setIndex(indices);
    const geometry = box.toNonIndexed();
    box.dispose();
    return geometry;
}

function sampleChannel(channel: Channel, seconds: number, base: number): Triple {
    const vector = (value: number | Triple): Triple => typeof value === "number" ? [value, value, value] : value;
    if (typeof channel === "number" || Array.isArray(channel)) return vector(channel);
    let previousTime = 0;
    let previous: Triple = [base, base, base];
    for (const [time, value] of Object.entries(channel).sort(([a], [b]) => Number(a) - Number(b))) {
        const next = vector(value);
        const timestamp = Number(time);
        if (seconds < timestamp) {
            const blend = (seconds - previousTime) / (timestamp - previousTime);
            return previous.map((axis, index) => THREE.MathUtils.lerp(axis, next[index], blend)) as Triple;
        }
        previous = next;
        previousTime = timestamp;
    }
    return previous;
}

function clipLength(clip: StagePropClip) {
    if (clip.animation_length !== undefined) return clip.animation_length;
    let end = 0;
    for (const channels of Object.values(clip.bones)) {
        for (const value of Object.values(channels)) {
            if (typeof value === "object" && !Array.isArray(value)) end = Math.max(end, ...Object.keys(value).map(Number));
        }
    }
    return end;
}

function createGlowMap(color: THREE.Texture, mer: THREE.Texture) {
    const canvas = document.createElement("canvas");
    canvas.width = mer.image.width;
    canvas.height = mer.image.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(mer.image, 0, 0);
    const mask = context.getImageData(0, 0, canvas.width, canvas.height).data;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(color.image, 0, 0);
    const glow = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < glow.data.length; i += 4) {
        const gain = mask[i + 1] / 255;
        for (let channel = 0; channel < 3; channel++) glow.data[i + channel] *= gain;
    }
    context.putImageData(glow, 0, 0);
    const map = new THREE.CanvasTexture(canvas);
    map.encoding = THREE.sRGBEncoding;
    return map;
}

function mergeStaticProp(node: THREE.Group, material: THREE.Material) {
    node.updateMatrixWorld(true);
    const parts: THREE.BufferGeometry[] = [];
    node.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        parts.push(object.geometry.applyMatrix4(object.matrixWorld));
    });
    const geometry = parts.length === 1 ? parts[0] : mergeBufferGeometries(parts)!;
    if (parts.length > 1) parts.forEach(part => part.dispose());
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    node.clear().add(mesh);
}

async function createStageProp(assets: StagePropAssets, root: string) {
    const { declaration, geometry, clips } = assets;
    const { texture_width: width, texture_height: height } = geometry.description;
    const loader = new THREE.TextureLoader();
    const load = (path: string) => {
        const url = textures[root + path];
        if (!url) throw new Error("缺少道具贴图 " + path);
        return loader.loadAsync(url);
    };
    const map = await load(declaration.texture);
    map.encoding = THREE.sRGBEncoding;
    let emissiveMap: THREE.Texture | undefined;
    if (declaration.merTexture) {
        try {
            const mer = await load(declaration.merTexture);
            try {
                emissiveMap = declaration.preview?.fullGlow ? map : createGlowMap(map, mer);
            } finally {
                mer.dispose();
            }
        } catch (error) {
            map.dispose();
            throw error;
        }
    }
    const material = new THREE.MeshPhysicalMaterial({
        map, roughness: 0.28, metalness: 0,
        clearcoat: 0.75, clearcoatRoughness: 0.24,
        ...(emissiveMap ? { emissiveMap, emissive: declaration.preview?.fullGlow ? 0xbbeaff : 0xffffff, emissiveIntensity: 1.05 } : {}),
        ...(declaration.preview?.fullGlow ? { side: THREE.DoubleSide } : {}),
    });
    const node = new THREE.Group();
    const bones = new Map(geometry.bones.map(bone => [bone.name, new THREE.Group()]));
    const poses = geometry.bones.map(bone => {
        const group = bones.get(bone.name)!;
        const parent = bone.parent ? bones.get(bone.parent)! : node;
        const pivot = bone.pivot ?? [0, 0, 0];
        const parentPivot = geometry.bones.find(candidate => candidate.name === bone.parent)?.pivot ?? [0, 0, 0];
        const basePosition = pivot.map((value, index) => (value - parentPivot[index]) / 16) as Triple;
        const baseRotation = bone.rotation ?? [0, 0, 0];
        group.rotation.order = "ZYX";
        parent.add(group);
        const parts = (bone.cubes ?? []).map(cube => createCube(cube, width, height));
        if (bone.poly_mesh) parts.push(createPolyMesh(bone.poly_mesh, width, height));
        if (parts.length) {
            const meshGeometry = parts.length === 1 ? parts[0] : mergeBufferGeometries(parts)!;
            if (parts.length > 1) parts.forEach(part => part.dispose());
            meshGeometry.translate(-pivot[0], -pivot[1], -pivot[2]);
            meshGeometry.scale(1 / 16, 1 / 16, 1 / 16);
            const mesh = new THREE.Mesh(meshGeometry, material);
            mesh.castShadow = true;
            group.add(mesh);
        }
        return { name: bone.name, group, basePosition, baseRotation };
    });

    const lengths = new Map(Object.entries(clips).map(([name, clip]) => [name, clipLength(clip)]));
    function pose(animation: string | undefined, elapsed: number) {
        let clip = animation === undefined ? undefined : clips[animation];
        const length = animation === undefined ? 0 : lengths.get(animation) ?? 0;
        let seconds = Math.max(0, elapsed);
        if (clip && length > 0) {
            if (clip.loop === true) seconds %= length;
            else if (clip.loop === "hold_on_last_frame") seconds = Math.min(seconds, length);
            else if (seconds > length) clip = undefined;
        }
        for (const { name, group, basePosition, baseRotation } of poses) {
            const channels = clip?.bones[name];
            const position = channels?.position ? sampleChannel(channels.position, seconds, 0) : [0, 0, 0];
            const rotation = channels?.rotation ? sampleChannel(channels.rotation, seconds, 0) : [0, 0, 0];
            group.position.set(...basePosition.map((axis, index) => axis + position[index] / 16) as Triple);
            group.rotation.set(...baseRotation.map((axis, index) => THREE.MathUtils.degToRad(axis + rotation[index])) as Triple);
            group.scale.set(...(channels?.scale ? sampleChannel(channels.scale, seconds, 1) : [1, 1, 1]) as Triple);
        }
    }
    pose(undefined, 0);
    if (!lengths.size) mergeStaticProp(node, material);
    node.visible = false;
    return { node, pose: lengths.size ? pose : undefined, preview: declaration.preview, animations: lengths };
}

export async function loadStageProps() {
    const props = new Map<string, Awaited<ReturnType<typeof createStageProp>>>();
    await Promise.all(Object.entries(manifests).map(async ([path, raw]) => {
        const root = path.slice(0, -"plugin.json".length);
        try {
            const manifest = validatePluginManifest(raw);
            const assets = readStagePropAssets(manifest, file => JSON.parse(documents[root + file]));
            for (const prop of assets) {
                try {
                    props.set(prop.registration.id, await createStageProp(prop, root));
                } catch (error) {
                    console.warn("[piano-vfx] Web Lab 道具加载失败", prop.registration.id, error);
                }
            }
        } catch (error) {
            console.warn("[piano-vfx] Web Lab 道具声明无效", path, error);
        }
    }));
    return props;
}
