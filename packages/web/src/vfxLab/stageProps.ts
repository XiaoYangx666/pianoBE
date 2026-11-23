import * as THREE from "three";
import { mergeBufferGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import model from "../../../addon/rp/models/entity/vfx_porcelain_vase.geo.json?raw";
import colorUrl from "../../../addon/rp/textures/entity/pbe_vfx_porcelain.png";

type Triple = [number, number, number];
type Face = { uv: [number, number]; uv_size: [number, number] };
interface Bone {
    rotation?: Triple;
    cubes?: { origin: Triple; size: Triple; pivot?: Triple; rotation?: Triple; uv: Record<string, Face> }[];
}
const SIDES = ["east", "west", "up", "down", "south", "north"];

export async function createPorcelainProp() {
    const geometry = JSON.parse(model)["minecraft:geometry"][0] as {
        description: { texture_width: number; texture_height: number }; bones: Bone[];
    };
    const { texture_width: width, texture_height: height } = geometry.description;
    const parts = geometry.bones.flatMap(bone => (bone.cubes ?? []).map(cube => {
        const box = new THREE.BoxGeometry(...cube.size);
        const center = cube.origin.map((start, i) => start + cube.size[i] / 2) as Triple;
        box.translate(...center);
        if (cube.pivot && cube.rotation) {
            const [x, y, z] = cube.pivot;
            box.translate(-x, -y, -z);
            box.rotateX(THREE.MathUtils.degToRad(cube.rotation[0]));
            box.translate(x, y, z);
        }
        box.rotateY(THREE.MathUtils.degToRad(bone.rotation?.[1] ?? 0));
        box.scale(1 / 16, 1 / 16, 1 / 16);
        const uv = box.getAttribute("uv");
        const indices: number[] = [];
        for (const [side, name] of SIDES.entries()) {
            const face = cube.uv[name];
            if (!face) continue;
            const [u, v] = face.uv;
            const [w, h] = face.uv_size;
            for (let i = side * 4; i < side * 4 + 4; i++) {
                uv.setXY(i, (u + w * uv.getX(i)) / width, 1 - (v + h * (1 - uv.getY(i))) / height);
            }
            for (let i = side * 6; i < side * 6 + 6; i++) indices.push(box.index!.getX(i));
        }
        box.setIndex(indices);
        return box;
    }));
    const meshGeometry = mergeBufferGeometries(parts)!;
    parts.forEach(part => part.dispose());
    const textureLoader = new THREE.TextureLoader();
    // No bump map: the in-game entity material has no height/parallax input, so
    // the lab should not preview relief the shipped pack cannot produce.
    const map = await textureLoader.loadAsync(colorUrl);
    map.encoding = THREE.sRGBEncoding;
    const mesh = new THREE.Mesh(meshGeometry, new THREE.MeshPhysicalMaterial({
        map, roughness: 0.28, metalness: 0,
        clearcoat: 0.75, clearcoatRoughness: 0.24,
    }));
    mesh.visible = false;
    mesh.castShadow = true;
    return mesh;
}
