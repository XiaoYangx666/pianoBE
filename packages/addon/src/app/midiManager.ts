import { midis } from "../midis/index.js";
import { EmbeddedMidiSource } from "@data/midiSource/embedded";
import { MidiManager } from "@domain/playback/midiManager";
import { PUBLIC_LIBRARY_CACHE_BYTES } from "@app/pianoConfig";

/**
 * 公共曲库管理器；不依赖播放列表或 UI，播放器只注入它需要的 acquire 能力。
 * 内嵌/远程公共曲库 + 世界级全局曲库均通过同一个 SongCache 共享事件流。
 */
export const midiManager = new MidiManager(
    new EmbeddedMidiSource(midis),
    PUBLIC_LIBRARY_CACHE_BYTES
);
