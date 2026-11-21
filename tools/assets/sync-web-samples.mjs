import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Mirrors the Bedrock resource-pack piano samples into the web public folder.
 *
 * The two trees are byte-identical; the only difference is that "#" is illegal
 * in a URL path, so the web copy renames D#1/F#1 to Dsharp1/Fsharp1. Keeping a
 * second committed copy doubled 11 MB of binary history, so the web tree is now
 * generated from packages/addon/rp/sounds and ignored by git.
 *
 * Run with --check to fail when the generated tree drifted.
 */
const root = fileURLToPath(new URL("../../", import.meta.url));
const source = join(root, "packages/addon/rp/sounds");
const target = join(root, "packages/web/public/piano");
const check = process.argv.includes("--check");

const webName = (file) => file.replace(/#/g, "sharp");

const packs = readdirSync(source, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((pack) => readdirSync(join(source, pack)).some((file) => file.endsWith(".ogg")));

if (!packs.length) throw new Error(`No sample packs found in ${source}`);

/** @type {Map<string, string>} relative target path -> absolute source path */
const expected = new Map();
let bytes = 0;
for (const pack of packs) {
    for (const file of readdirSync(join(source, pack))) {
        if (!file.endsWith(".ogg")) continue;
        const from = join(source, pack, file);
        expected.set(`${pack}/${webName(file)}`, from);
        bytes += readFileSync(from).length;
    }
}

function listOgg(dir, prefix = "") {
    const out = [];
    let entries;
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    } catch {
        return out;
    }
    for (const entry of entries) {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) out.push(...listOgg(join(dir, entry.name), relative));
        else if (entry.name.endsWith(".ogg")) out.push(relative);
    }
    return out;
}

if (check) {
    const actual = new Set(listOgg(target));
    const problems = [];
    for (const [relative, from] of expected) {
        if (!actual.has(relative)) {
            problems.push(`missing ${relative}`);
            continue;
        }
        if (!readFileSync(join(target, relative)).equals(readFileSync(from))) {
            problems.push(`stale ${relative}`);
        }
    }
    for (const relative of actual) {
        if (!expected.has(relative)) problems.push(`unexpected ${relative}`);
    }
    if (problems.length) {
        const preview = problems.slice(0, 10).join(", ");
        throw new Error(`Web samples are stale (${problems.length}): ${preview}. Run npm run sync:samples.`);
    }
    console.log(`Web samples verified: ${packs.length} packs, ${expected.size} files`);
} else {
    for (const [relative, from] of expected) {
        const output = join(target, relative);
        mkdirSync(dirname(output), { recursive: true });
        writeFileSync(output, readFileSync(from));
    }
    for (const relative of listOgg(target)) {
        if (!expected.has(relative)) rmSync(join(target, relative), { force: true });
    }
    for (const pack of readdirSync(target, { withFileTypes: true })) {
        if (pack.isDirectory() && !packs.includes(pack.name)) rmSync(join(target, pack.name), { recursive: true, force: true });
    }
    console.log(`Synced ${expected.size} web samples (${packs.length} packs, ${(bytes / 1024 / 1024).toFixed(1)} MB)`);
}
