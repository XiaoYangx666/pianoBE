import { midis } from "@data/midis";
import { EmbeddedMidiSource } from "@data/midiSource/embedded";
import { MidiManager } from "@domain/playback/midiManager";

/** 内嵌曲库管理器；不依赖播放列表或 UI，播放器只注入它需要的 load 能力。 */
export const midiManager = new MidiManager(new EmbeddedMidiSource(midis));
