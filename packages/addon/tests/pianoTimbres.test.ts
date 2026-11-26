import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PIANO_SAMPLE_KEYS, PIANO_TIMBRES, pianoSoundLayers, pianoSoundId } from "@piano/core";

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
const timbreSamplesRoot = fileURLToPath(new URL("../timbre-samples/", import.meta.url));
const definitions = JSON.parse(
    readFileSync(join(rpRoot, "sounds/sound_definitions.json"), "utf8")
).sound_definitions as Record<string, SoundDefinition>;

function expectedBundledSoundIds() {
    const ids: string[] = [];
    const bundled = PIANO_TIMBRES[0];
    for (const layer of pianoSoundLayers(bundled.value)) {
        const dir = pianoSoundId(bundled.value, layer);
        const stereoDir = pianoSoundId(bundled.value, layer, true);
        for (const note of PIANO_SAMPLE_KEYS) {
            ids.push(`${dir}.${note}`, `${stereoDir}.${note}`);
        }
    }
    return ids;
}

describe("piano timbre assets", () => {
    test("底包仅内置标准钢琴音效定义与采样，其余可选音色存放在 timbre-samples", () => {
        const bundled = PIANO_TIMBRES[0];
        for (const layer of pianoSoundLayers(bundled.value)) {
            const dir = pianoSoundId(bundled.value, layer);
            const stereoDir = pianoSoundId(bundled.value, layer, true);
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

        for (const timbre of PIANO_TIMBRES.slice(1)) {
            for (const layer of pianoSoundLayers(timbre.value)) {
                const dir = pianoSoundId(timbre.value, layer);
                for (const note of PIANO_SAMPLE_KEYS) {
                    expect(
                        existsSync(join(timbreSamplesRoot, dir, `${note}.ogg`)),
                        `缺少可选音色采样 ${dir}/${note}.ogg`,
                    ).toBe(true);
                }
            }
        }
    });

    test("底包音效定义仅包含标准钢琴，没有多余或遗漏条目", () => {
        expect(new Set(Object.keys(definitions))).toEqual(new Set(expectedBundledSoundIds()));
    });
});
