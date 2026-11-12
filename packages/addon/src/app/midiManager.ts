import { midis } from "../midis/index.js";
import { EmbeddedMidiSource } from "@data/midiSource/embedded";
import { MidiManager } from "@domain/playback/midiManager";
import { importedSongs } from "@platform/storage/importedSongs";

/**
 * 内嵌曲库管理器；不依赖播放列表或 UI，播放器只注入它需要的 acquire 能力。
 * 本地导入曲库作为附加来源注册，所有来源最终共用同一 SongCache。
 */
export const midiManager = new MidiManager(new EmbeddedMidiSource(midis));
midiManager.addSource(importedSongs);

/** 仅用于本地导入曲库列表的元信息管理器（播放仍走统一 midiManager/SongCache）。 */
export const importedMidiManager = new MidiManager(importedSongs);

export { importedSongs };
