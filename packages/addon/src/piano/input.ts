import { KeyMap, NoteInfo, PianoEnv } from "@types";
import { processNote } from "@utils/note";
import { summonParticle } from "@utils/particle";
import { keyMaps } from "./keymap";
import { PianoState } from "./ui";

export const soundTypes = [
    { name: "长音(4s)", id: "piano_long" },
    { name: "标准音(2s)", id: "piano" },
    { name: "短音(0.5s)", id: "piano_short" },
];

export function handleInput(val: string, state: PianoState, env: PianoEnv) {
    if (!val) return { keys: [], last: undefined, shouldClear: false };
    const comMode = state.mode.getData();
    const keyMap = keyMaps[state.keyMap.getData()].value;
    const octave = state.octave.getData();
    const { keys, notes } = parseInput(val, comMode, keyMap, octave);

    const sound = soundTypes[state.sound.getData()]?.id ?? "piano_long";
    playNotes(env, notes, sound);

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

/**播放钢琴音符 */
function playNotes(env: PianoEnv, notes: NoteInfo[], id: string) {
    for (const note of notes) {
        if (note.sample === "none") continue;

        env.dim.playSound(`${id}.${note.sample}`, env.pos, {
            pitch: note.pitch,
            volume: 2.0,
        });

        summonParticle(env.dim, env.pos, env.dir, note.midi);
    }
}
