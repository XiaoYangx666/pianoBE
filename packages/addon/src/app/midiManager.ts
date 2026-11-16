import { midis } from "../midis/index.js";
import { EmbeddedMidiSource } from "@data/midiSource/embedded";
import { MidiManager } from "@domain/playback/midiManager";

/**
 * 公共曲库管理器；不依赖播放列表或 UI，播放器只注入它需要的 acquire 能力。
 * 本地导入曲库已移除，所有曲目统一来自内嵌/远程公共曲库。
 */
export const midiManager = new MidiManager(new EmbeddedMidiSource(midis));
