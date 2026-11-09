import { KeyMap, NoteInfo } from "@domain/types";
import { processNote } from "@domain/util/note";

export function parseInput(
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
