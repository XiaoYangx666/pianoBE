export { processNote, getSoundIdByVelocity, midiToNoteName, noteNameToMidi } from "@piano/core";
export type { NoteInfo } from "@piano/core";

/** The outer zone takes precedence when one hand plays across both zones. */
export function pianoHandZoneBit(midi: number) {
    if (midi < 60) return midi < 48 ? 2 : 1;
    return midi >= 72 ? 8 : 4;
}
