import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PIANO_SAMPLE_KEYS, PIANO_SOUND_LAYERS, PIANO_TIMBRES, pianoSoundId } from "@piano/core";

interface SoundEntry {
    name: string;
    is3D?: boolean;
}

interface SoundDefinition {
    category?: string;
    sounds: SoundEntry[];
    min_distance?: number;
    max_distance?: number;
}

const rpRoot = fileURLToPath(new URL("../rp/", import.meta.url));
const definitions = JSON.parse(
    readFileSync(join(rpRoot, "sounds/sound_definitions.json"), "utf8")
).sound_definitions as Record<string, SoundDefinition>;

function expectedSoundIds() {
    const ids: string[] = [];
    for (const timbre of PIANO_TIMBRES) {
        for (const layer of PIANO_SOUND_LAYERS) {
            const dir = pianoSoundId(timbre.value, layer);
            const stereoDir = pianoSoundId(timbre.value, layer, true);
            for (const note of PIANO_SAMPLE_KEYS) {
                ids.push(`${dir}.${note}`, `${stereoDir}.${note}`);
            }
        }
    }
    return ids;
}

describe("piano timbre assets", () => {
    test("每个音色、档位、基础音都有 3D 与立体声音效定义和采样文件", () => {
        for (const timbre of PIANO_TIMBRES) {
            for (const layer of PIANO_SOUND_LAYERS) {
                const dir = pianoSoundId(timbre.value, layer);
                const stereoDir = pianoSoundId(timbre.value, layer, true);
                for (const note of PIANO_SAMPLE_KEYS) {
                    const path = `sounds/${dir}/${note}`;
                    const id = `${dir}.${note}`;
                    const stereoId = `${stereoDir}.${note}`;
                    const definition = definitions[id];
                    const stereoDefinition = definitions[stereoId];
                    expect(definition, `缺少音效定义 ${id}`).toBeDefined();
                    expect(stereoDefinition, `缺少音效定义 ${stereoId}`).toBeDefined();
                    expect(definition.sounds).toEqual([{ name: path, is3D: true }]);
                    expect(stereoDefinition.sounds).toEqual([{ name: path, is3D: false }]);
                    expect(definition.min_distance).toBe(8);
                    expect(definition.max_distance).toBe(32);
                    expect(stereoDefinition.min_distance).toBeUndefined();
                    expect(stereoDefinition.max_distance).toBeUndefined();
                    expect(existsSync(join(rpRoot, `${path}.ogg`)), `缺少采样 ${id}`).toBe(true);
                }
            }
        }
    });

    test("音效定义没有多余或遗漏条目", () => {
        expect(new Set(Object.keys(definitions))).toEqual(new Set(expectedSoundIds()));
    });
});
