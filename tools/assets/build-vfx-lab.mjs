import { readFileSync } from "node:fs";
import { buildAtlasAssets } from "./vfx/atlas.mjs";
import { buildKeyDocument } from "./vfx/keys.mjs";
import { buildParticleDocuments } from "./vfx/particles.mjs";
import { writeOrCheck } from "./vfx/png.mjs";

const root = new URL("../../", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("../../packages/vfx/src/data/vfxAtlas.json", import.meta.url), "utf8"));
const check = process.argv.includes("--check");

for (const [path, contents] of [
    ["packages/vfx/src/data/keys.generated.ts", buildKeyDocument()],
    ...buildAtlasAssets(manifest),
    ...buildParticleDocuments(manifest),
]) {
    const target = path.startsWith("packages/") ? path : `packages/vfx/assets/${path}`;
    writeOrCheck(root, target, contents, check);
}

console.log(check
    ? "VFX: checked keys, particles, RGBA atlas and emissive texture set"
    : "VFX: built keys, particles, RGBA atlas and emissive texture set");
