import { keyMaps } from "@domain/piano/keymap";
import { parseInput } from "@domain/input/parse";
import type { Player } from "@minecraft/server";
import type { PianoState } from "@app/ui/pianoState";
import type { PianoRuntime } from "@app/PianoRuntime";
import { playerSoundLayer } from "@app/playerSound";

export function handleInput(val: string, state: PianoState, piano: PianoRuntime, player: Player) {
    if (!val) return { keys: [], last: undefined, shouldClear: false };
    const comMode = state.mode.getData();
    const keyMap = keyMaps[state.keyMap.getData()].value;
    const octave = state.octave.getData();
    const { keys, notes } = parseInput(val, comMode, keyMap, octave);

    const layer = playerSoundLayer(player, piano);
    for (const note of notes) piano.playNote(note, layer, .15);

    return { keys, last: notes.at(-1), shouldClear: !comMode };
}
