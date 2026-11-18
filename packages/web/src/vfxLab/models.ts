import * as THREE from "three";
import { mergeBufferGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import grand from "../../../../assets/grand/grand_full.bbmodel?raw";
import p88 from "../../../addon/rp/models/blocks/piano_full.bbmodel?raw";
import grandTexture from "../../../addon/rp/textures/blocks/grand.png";
import p88Texture from "../../../addon/rp/textures/blocks/piano.png";

export type PianoModel = "grand" | "p88";
type Triple = [number, number, number];
interface Model {
    resolution: { width: number; height: number };
    elements: {
        from: Triple;
        to: Triple;
        name: string;
        faces: Partial<Record<string, { uv: [number, number, number, number]; texture: number | null }>>;
        type: string;
    }[];
}
const faces = ["east", "west", "up", "down", "south", "north"];
const loader = new THREE.TextureLoader();

async function pianoMesh(kind: PianoModel) {
    const source: Model = JSON.parse(kind === "grand" ? grand : p88);
    const texture = await loader.loadAsync(kind === "grand" ? grandTexture : p88Texture);
    texture.magFilter = THREE.NearestFilter;
    texture.encoding = THREE.sRGBEncoding;
    const { width, height } = source.resolution;
    const boxes = source.elements.filter(element => element.type === "cube").map(({ from, to, name, faces: uvFaces }) => {
        const size = to.map((edge, index) => (edge - from[index]) / 16) as Triple;
        const center = to.map((edge, index) => (edge + from[index]) / 32) as Triple;
        const box = new THREE.BoxGeometry(...size);
        box.translate(...center);
        const uv = box.getAttribute("uv");
        const normal = box.getAttribute("normal");
        const lidBand = kind === "grand" && name.startsWith("Raised lid / band ");
        const triangles: number[] = [];
        for (const [side, face] of faces.entries()) {
            const definition = uvFaces[face];
            if (!definition || definition.texture === null) continue;
            const [left, top, right, bottom] = definition.uv;
            for (let i = side * 4; i < side * 4 + 4; i++) {
                uv.setXY(i, THREE.MathUtils.lerp(left, right, uv.getX(i)) / width,
                    1 - THREE.MathUtils.lerp(bottom, top, uv.getY(i)) / height);
                // Shade the stepped lid bands as one surface while preserving their Bedrock silhouette.
                if (lidBand && side < 4) {
                    const sign = side % 2 ? -1 : 1;
                    normal.setXYZ(i, sign * 0.675, sign * 0.738, 0);
                }
            }
            for (let i = side * 6; i < side * 6 + 6; i++) triangles.push(box.index!.getX(i));
        }
        box.setIndex(triangles);
        return box;
    });
    const geometry = mergeBufferGeometries(boxes)!;
    boxes.forEach(box => box.dispose());
    const material = new THREE.MeshStandardMaterial({
        map: texture, color: 0xffffff, roughness: 0.5, metalness: 0.12,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.scale.z = -1;
    mesh.castShadow = true;
    return mesh;
}

function performer(kind: PianoModel) {
    const group = new THREE.Group();
    const seatY = kind === "grand" ? 0.49 : 0.40625;
    const keyY = kind === "grand" ? 0.96 : 0.93;
    const seatZ = kind === "grand" ? 0.96 : 0.79;

    function material(color: number) { return new THREE.MeshStandardMaterial({ color, roughness: 0.8 }); }
    const cloth = material(0x292d45);
    const cuff = material(0x8a90ad);
    const skin = material(0xd6a383);
    const hair = material(0x392821);
    const leather = material(0x12131a);
    const wood = material(0x332722);
    function box(size: Triple, at: Triple, finish: THREE.Material, parent: THREE.Object3D = group) {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), finish);
        mesh.position.set(...at);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        parent.add(mesh);
        return mesh;
    }
    box([0.92, 0.105, 0.43], [0, seatY - 0.0525, seatZ], leather);
    for (const x of [-0.36, 0.36]) {
        box([0.075, seatY - 0.08, 0.32], [x, (seatY - 0.08) / 2, seatZ], wood);
    }
    box([0.47, 0.59, 0.235], [0, seatY + 0.30, seatZ - 0.04], cloth);
    const head = new THREE.Group();
    head.position.set(0, seatY + 0.83, seatZ - 0.085);
    group.add(head);
    box([0.42, 0.40, 0.405], [0, 0, 0], skin, head);
    box([0.438, 0.126, 0.421], [0, 0.16, 0], hair, head);
    box([0.438, 0.26, 0.107], [0, 0.0, 0.163], hair, head);
    for (const side of [-1, 1]) {
        const x = 0.123 * side;
        box([0.225, 0.17, 0.44], [x, seatY + 0.087, seatZ - 0.16], cloth);
        box([0.222, seatY - 0.08, 0.191], [x, seatY / 2 + 0.01, seatZ - 0.30], cloth);
        box([0.236, 0.115, 0.27], [x, 0.059, seatZ - 0.37], leather);
        box([0.044, 0.033, 0.008], [side * 0.103, 0.024, -0.204], hair, head);
    }
    const arms = [-1, 1].map(side => {
        const upper = box([0.145, 1, 0.15], [0, 0, 0], cloth);
        const lower = box([0.134, 1, 0.135], [0, 0, 0], cloth);
        const hand = box([0.128, 0.10, 0.16], [0, 0, 0], skin);
        const sleeve = box([0.141, 0.03, 0.139], [0, 0, 0], cuff, lower);
        sleeve.position.y = 0.47;
        return { side, upper, lower, hand };
    });
    const yAxis = new THREE.Vector3(0, 1, 0);
    const vector = new THREE.Vector3();
    function connect(limb: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3) {
        limb.position.copy(a).lerp(b, 0.5);
        vector.subVectors(b, a);
        limb.scale.y = vector.length();
        limb.quaternion.setFromUnitVectors(yAxis, vector.normalize());
    }
    return {
        group,
        pose(time: number, activity: number, pitch: number) {
            head.rotation.set(0.085 + 0.11 * activity, (pitch - 0.5) * 0.30, 0);
            for (const { side, upper, lower, hand } of arms) {
                const x = side * 0.24 + (pitch - 0.5) * 0.6;
                const shoulder = new THREE.Vector3(side * 0.264, seatY + 0.50, seatZ - 0.075);
                const elbow = new THREE.Vector3(side * 0.32 + x * 0.22, keyY - 0.06, seatZ - 0.29);
                hand.position.set(x, keyY + 0.088 + activity * 0.027 * Math.sin(time * 9 + side),
                    kind === "grand" ? 0.34 : 0.21);
                connect(upper, shoulder, elbow);
                connect(lower, elbow, hand.position);
            }
        },
    };
}

export async function createCast() {
    const entries = await Promise.all((["grand", "p88"] as const).map(async kind => {
        const ensemble = performer(kind);
        ensemble.group.add(await pianoMesh(kind));
        return [kind, ensemble] as const;
    }));
    return Object.fromEntries(entries) as Record<PianoModel, ReturnType<typeof performer>>;
}
