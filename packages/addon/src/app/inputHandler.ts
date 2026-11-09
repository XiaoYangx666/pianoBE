import { keyMaps } from "@domain/piano/keymap";
import { parseInput } from "@domain/input/parse";
import { soundTypes } from "@domain/piano/soundTypes";
import type { PianoState } from "@app/ui/pianoState";
import type { PianoRuntime } from "@app/PianoRuntime";

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
