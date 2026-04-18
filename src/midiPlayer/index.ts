import { midis } from "@midis";
import { MidiManager } from "./midiManager";
import { MidiPlayerManager } from "./playerManager";
import { PlayListStore } from "./playlist";

/**播放器管理 */
export const midiPlayerManager = new MidiPlayerManager();
/**播放列表存储 */
export const playListStore = new PlayListStore();
/**midi文件管理 */
export const midiManager = new MidiManager(midis);

export function initPlayer() {
    //初始化
    midiPlayerManager.init();
}
