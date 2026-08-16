import { midis } from "@midis";
import { PlaylistStore } from "@piano/core";
import { DPDataBasePlaylistPort } from "@drivers/dpPlaylistPort";
import { EmbeddedMidiSource } from "@midiSource/embedded";
import { MidiManager } from "./midiManager";
import { MidiPlayerManager } from "./playerManager";

/**播放器管理 */
export const midiPlayerManager = new MidiPlayerManager();
/**播放列表存储（core 业务层 + 游戏内动态属性驱动） */
export const playListStore = new PlaylistStore(new DPDataBasePlaylistPort());
/**midi曲库管理（内嵌来源：懒加载，行为与历史一致） */
export const midiManager = new MidiManager(new EmbeddedMidiSource(midis));

export function initPlayer() {
    //初始化
    midiPlayerManager.init();
}