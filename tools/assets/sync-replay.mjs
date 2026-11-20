import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Copies the Bedrock particle documents and atlas used by the Secret staging
 * into the web app so the replay page can evaluate the same files the game
 * loads. Run with --check to fail when the copies drifted.
 */
const root = fileURLToPath(new URL("../../", import.meta.url));
const source = join(root, "packages/addon/rp");
const target = join(root, "packages/web/public/replay");
const check = process.argv.includes("--check");

const files = [
    ...["dust", "filament", "sweep", "note", "shock"]
        .map(name => [`particles/pbe_vfx_cinema_${name}.particle.json`, `particles/pbe_vfx_cinema_${name}.particle.json`]),
    ["textures/particle/secret_cinema.png", "secret_cinema.png"],
];

const drifted = [];
for (const [from, to] of files) {
    const input = readFileSync(join(source, from));
    const output = join(target, to);
    if (check) {
        let current;
        try {
            current = readFileSync(output);
        } catch {
            drifted.push(to);
            continue;
        }
        if (!current.equals(input)) drifted.push(to);
        continue;
    }
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, input);
}

if (check) {
    if (drifted.length) throw new Error(`Replay assets are stale: ${drifted.join(", ")}. Run npm run sync:replay.`);
    console.log("Replay particle assets verified");
} else {
    console.log(`Synced ${files.length} replay particle assets`);
}
