export { midiBufferToSong } from "./midi/convert.js";
export {
    MAX_SUSTAIN_EXTENSION_SECONDS,
    collectSustainSegments,
    sustainExtensionSeconds,
    type ControlChangeLike,
    type SustainSegment,
    type SustainTrackLike,
} from "./midi/pedal.js";
export type { MidiSong, MidiSongMeta, MidiTrack, MidiTrackInstrument } from "./types.js";