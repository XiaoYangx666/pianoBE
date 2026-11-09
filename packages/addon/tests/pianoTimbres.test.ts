import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PIANO_SAMPLE_KEYS, PIANO_SOUND_LAYERS, PIANO_TIMBRES, pianoSoundId } from "@piano/core";

const rpRoot = fileURLToPath(new URL("../rp/", import.meta.url));
const definitions = JSON.parse(
    readFileSync(join(rpRoot, "sounds/sound_definitions.json"), "utf8")
).sound_definitions as Record<string, { sounds: string[] }>;

function expectedSoundIds() {
    const ids: string[] = [];
    for (const timbre of PIANO_TIMBRES) {
        for (const layer of PIANO_SOUND_LAYERS) {
            const dir = pianoSoundId(timbre.value, layer);
            for (const note of PIANO_SAMPLE_KEYS) ids.push(`${dir}.${note}`);
        }
    }
    return ids;
}

describe("piano timbre assets", () => {
    test("每个音色、档位、基础音都有音效定义和采样文件", () => {
        for (const timbre of PIANO_TIMBRES) {
            for (const layer of PIANO_SOUND_LAYERS) {
                const dir = pianoSoundId(timbre.value, layer);
                for (const note of PIANO_SAMPLE_KEYS) {
                    const id = `${dir}.${note}`;
                    const definition = definitions[id];
                    expect(definition, `缺少音效定义 ${id}`).toBeDefined();
                    expect(definition.sounds).toEqual([`sounds/${dir}/${note}`]);
                    expect(existsSync(join(rpRoot, `${definition.sounds[0]}.ogg`)), `缺少采样 ${id}`).toBe(true);
                }
            }
        }
    });

    test("音效定义没有多余或遗漏条目", () => {
        expect(new Set(Object.keys(definitions))).toEqual(new Set(expectedSoundIds()));
    });
});
