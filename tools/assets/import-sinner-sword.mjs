import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Matrix3, Texture, TextureLoader, Vector3 } from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";

const fbx = process.argv[2];
if (!fbx) throw new Error("Usage: node tools/assets/import-sinner-sword.mjs <ChuXingJian.fbx>");
const root = fileURLToPath(new URL("../../", import.meta.url));
const bytes = readFileSync(fbx);
// Decode geometry and UVs. The stage uses its own emissive texture atlas.
globalThis.window = { URL };
TextureLoader.prototype.load = () => new Texture();
const source = new FBXLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
source.updateMatrixWorld(true);

// Keep the textured hilt, the crystals, the two swept edges and the inner blade.
// The other FBX meshes are baked-in spark/VFX cards replaced by the stage particles.
const tiles = new Map([["mesh_85", 0], ["mesh_170", 1], ["mesh_171", 1], ["mesh_173", 2], ["mesh_176", 3]]);
const meshes = [...tiles.keys()].map(name => {
    const mesh = source.getObjectByName(name);
    if (!mesh?.isMesh) throw new Error(`Missing sword mesh: ${name}`);
    return mesh;
});
const position = new Vector3();
let bottom = Infinity;
let top = -Infinity;
for (const mesh of meshes) {
    const attribute = mesh.geometry.attributes.position;
    for (let i = 0; i < attribute.count; i++) {
        const y = position.fromBufferAttribute(attribute, i).applyMatrix4(mesh.matrixWorld).y;
        bottom = Math.min(bottom, y);
        top = Math.max(top, y);
    }
}
const scale = 70 / (top - bottom);

function indexedList(precision) {
    const entries = [];
    const indices = new Map();
    return {
        entries,
        add(values) {
            const rounded = values.map(value => Math.round(value * precision) / precision);
            const key = rounded.join(",");
            const existing = indices.get(key);
            if (existing !== undefined) return existing;
            const index = entries.push(rounded) - 1;
            indices.set(key, index);
            return index;
        },
    };
}

const positions = indexedList(10000);
const normals = indexedList(10000);
const uvs = indexedList(100000);
const polys = [];
const faces = new Set();
const normal = new Vector3();
const clamp = value => Math.min(1, Math.max(0, value));
for (const mesh of meshes) {
    const tile = tiles.get(mesh.name);
    const normalMatrix = new Matrix3().getNormalMatrix(mesh.matrixWorld);
    const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
    const { position: pos, normal: norm, uv } = geometry.attributes;
    for (let first = 0; first < pos.count; first += 3) {
        const poly = [];
        for (let i = first; i < first + 3; i++) {
            position.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
            normal.fromBufferAttribute(norm, i).applyMatrix3(normalMatrix).normalize();
            if (tile === 3) {
                // The source energy cylinder has a flat bottom and obscures the
                // swept blade edges. Pinch its lower section and end it inside the hooks.
                const taper = Math.min(1, Math.max(0, (position.y - bottom) / 440));
                const side = 0.13 + 0.87 * taper;
                position.x *= side;
                position.z *= side;
                position.y += (1 - taper) ** 2 * 176;
            }
            const u = ((tile % 2) * 256 + 2 + 252 * clamp(uv.getX(i))) / 512;
            // Bedrock poly_mesh UVs, like the FBX UVs, count V from the bottom.
            const v = ((1 - Math.floor(tile / 2)) * 256 + 2 + 252 * clamp(uv.getY(i))) / 512;
            poly.push([
                positions.add([position.x * scale, (position.y - bottom) * scale, position.z * scale]),
                normals.add(normal.toArray()),
                uvs.add([u, v]),
            ]);
        }
        const vertices = new Set(poly.map(point => point[0]));
        if (vertices.size !== 3) continue;
        const faceKey = [...vertices].sort((a, b) => a - b).join(",");
        if (faces.has(faceKey)) continue;
        faces.add(faceKey);
        // Use the same padded triangle layout as Meshy Bedrock exports.
        polys.push([...poly, poly[0]]);
    }
}

const meshPath = join(root, "plugins/sinner/stage_props/sinner_sword.geo.json");
const geometry = {
    format_version: "1.12.0",
    "minecraft:geometry": [{
        description: {
            identifier: "geometry.pbe.vfx_sinner_sword",
            texture_width: 512, texture_height: 512,
            visible_bounds_width: 6, visible_bounds_height: 16,
            visible_bounds_offset: [0, 6, 0],
        },
        bones: [{
            name: "sword",
            pivot: [0, 0, 0],
            poly_mesh: {
                normalized_uvs: true,
                positions: positions.entries, normals: normals.entries, uvs: uvs.entries, polys,
            },
        }],
    }],
};
writeFileSync(meshPath, JSON.stringify(geometry) + "\n");
execFileSync("python", [
    join(root, "tools/assets/build-sinner-stage.py"), "--sword",
], { stdio: "inherit" });
console.log(`Sword mesh: ${positions.entries.length} vertices, ${polys.length} triangles`);
