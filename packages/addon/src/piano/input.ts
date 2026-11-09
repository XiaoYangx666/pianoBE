import { KeyMap, NoteInfo } from "@types";
import type { PianoSoundLayer } from "@piano/core";
import { processNote } from "@utils/note";
import { keyMaps } from "./keymap";
import { PianoState } from "./ui";
import type { PianoRuntime } from "./world";

export const soundTypes: readonly { name: string; layer: PianoSoundLayer }[] = [
    { name: "长音(4s)", layer: "long" },
    { name: "标准音(2s)", layer: "standard" },
    { name: "短音(0.5s)", layer: "short" },
];

export function handleInput(val: string, state: PianoState, piano: PianoRuntime) {
    if (!val) return { keys: [], last: undefined, shouldClear: false };
    const comMode = state.mode.getData();
    const keyMap = keyMaps[state.keyMap.getData()].value;
    const octave = state.octave.getData();
    const { keys, notes } = parseInput(val, comMode, keyMap, octave);

    const layer = soundTypes[state.sound.getData()]?.layer ?? "long";
    for (const note of notes) piano.playNote(note, layer, .15);

    return { keys, last: notes.at(-1), shouldClear: !comMode };
}

function parseInput(
    val: string,
    comMode: boolean,
    keyMap: KeyMap,
    octave: boolean
): { keys: string[]; notes: NoteInfo[] } {
    const MAX_KEYS = comMode ? 1 : 3;

    const slice = val.slice(-MAX_KEYS);

    const keys: string[] = [];
    const notes: NoteInfo[] = [];

    for (const char of slice) {
        const lowKey = char.toLowerCase();
        keys.push(lowKey);

        const original = keyMap[lowKey];
        if (original !== undefined) {
            notes.push(processNote(original, octave));
        }
    }

    return { keys, notes };
}
