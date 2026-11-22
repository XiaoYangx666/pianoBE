import { readFileSync } from "node:fs";
import { buildAtlasAssets } from "./vfx/atlas.mjs";
import { buildKeyDocument } from "./vfx/keys.mjs";
import { buildParticleDocuments } from "./vfx/particles.mjs";
import { writeOrCheck } from "./vfx/png.mjs";

const root = new URL("../../", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("../../packages/vfx/src/data/vfxAtlas.json", import.meta.url), "utf8"));
const check = process.argv.includes("--check");

const KEYS_PLUGIN_PARTICLES = new Set([
    "particles/pbe_vfx_key_stream.particle.json",
    "particles/pbe_vfx_key_drift.particle.json",
    "particles/pbe_vfx_key_blue_tears.particle.json",
    "particles/pbe_vfx_magic_trail.particle.json",
]);

function resolveOutputPath(path) {
    if (path.startsWith("packages/")) return path;
    if (KEYS_PLUGIN_PARTICLES.has(path)) return `plugins/keys/${path}`;
    return `packages/vfx/assets/${path}`;
}

for (const [path, contents] of [
    ["packages/vfx/src/data/keys.generated.ts", buildKeyDocument()],
    ...buildAtlasAssets(manifest),
    ...buildParticleDocuments(manifest),
]) {
    writeOrCheck(root, resolveOutputPath(path), contents, check);
}

console.log(check
    ? "VFX: checked keys, particles, RGBA atlas and emissive texture set"
    : "VFX: built keys, particles, RGBA atlas and emissive texture set");
