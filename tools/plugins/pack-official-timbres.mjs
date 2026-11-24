/**
 * Pack optional official piano timbres as standalone .pbeplugin archives into build/plugins/:
 * - pianobe.timbre.classic_grand
 * - pianobe.timbre.bright_grand
 * - pianobe.timbre.upright
 * - pianobe.timbre.electric_piano
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PIANO_SAMPLE_KEYS, PIANO_TIMBRES, pianoSoundId, pianoSoundLayers } from "@piano/core";
import { writePbePluginArchive } from "@piano/vfx/package";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SOUNDS_DIR = join(ROOT, "packages/addon/rp/sounds");
const OUT_DIR = join(ROOT, "build/plugins");

const TIMBRE_PLUGIN_META = {
    classic_grand: {
        name: "经典三角钢琴",
        author: "PianoBE (VCSL Steinway B)",
        license: "CC0-1.0",
    },
    bright_grand: {
        name: "明亮三角钢琴",
        author: "PianoBE (Salamander Grand V3)",
        license: "CC-BY-3.0",
    },
    upright: {
        name: "原声立式钢琴",
        author: "PianoBE (FreePats Kawai Upright)",
        license: "CC0-1.0",
    },
    electric_piano: {
        name: "复古电钢",
        author: "PianoBE (FreePats FM #1)",
        license: "CC0-1.0",
    },
};

export function packOfficialTimbres() {
    mkdirSync(OUT_DIR, { recursive: true });
    const outputs = [];

    for (const timbre of PIANO_TIMBRES) {
        if (timbre.id === "piano") continue;
        const meta = TIMBRE_PLUGIN_META[timbre.id] ?? {
            name: timbre.label,
            author: "PianoBE",
            license: "CC0-1.0",
        };
        const layers = pianoSoundLayers(timbre.value);
        const dirs = Object.fromEntries(
            layers.map((layer) => [`v${layer + 1}`, pianoSoundId(timbre.value, layer)]),
        );
        const files = {};
        const soundDefinitions = {};

        for (const layer of layers) {
            const dir = dirs[`v${layer + 1}`];
            const stereoDir = pianoSoundId(timbre.value, layer, true);
            for (const note of PIANO_SAMPLE_KEYS) {
                const file = join(SOUNDS_DIR, dir, `${note}.ogg`);
                if (!existsSync(file)) {
                    throw new Error(`缺少音色 ${timbre.id} 采样文件：${file}`);
                }
                const data = new Uint8Array(readFileSync(file));
                files[`sounds/${dir}/${note}.ogg`] = data;
                const sound = `sounds/${dir}/${note}`;
                soundDefinitions[`${dir}.${note}`] = {
                    category: "record",
                    sounds: [{ name: sound, is3D: true }],
                    min_distance: 8,
                    max_distance: 32,
                };
                soundDefinitions[`${stereoDir}.${note}`] = {
                    category: "record",
                    sounds: [{ name: sound, is3D: false }],
                };
            }
        }

        const pluginId = `pianobe.timbre.${timbre.id}`;
        const manifest = {
            id: pluginId,
            name: meta.name,
            version: "1.0.0",
            apiVersion: "1.0.0",
            minPianoBeVersion: "1.3.0",
            capabilities: ["audio.timbres"],
            visibility: "public",
            author: meta.author,
            license: meta.license,
            provides: {
                timbres: [timbre.id],
            },
            preview: {
                description: timbre.description,
            },
        };

        files["plugin.json"] = JSON.stringify(manifest, null, 2);
        files[`timbres/${timbre.id}.json`] = JSON.stringify(
            {
                id: timbre.id,
                value: timbre.value,
                label: timbre.label,
                description: timbre.description,
                dirs,
                notes: [...PIANO_SAMPLE_KEYS],
                layers: layers.map((layer) => `v${layer + 1}`),
                soundDefinitions,
            },
            null,
            2,
        );

        const archiveBytes = writePbePluginArchive(files);
        const outPath = join(OUT_DIR, `${pluginId}.pbeplugin`);
        writeFileSync(outPath, archiveBytes);
        outputs.push({ id: pluginId, timbreId: timbre.id, outPath, size: archiveBytes.byteLength });
        console.log(
            `[pack-timbres] ${pluginId} v${manifest.version} -> ${outPath} (${(archiveBytes.byteLength / 1024 / 1024).toFixed(2)} MB, ${Object.keys(dirs).length} layers)`,
        );
    }

    return outputs;
}

if (import.meta.main) {
    packOfficialTimbres();
}
