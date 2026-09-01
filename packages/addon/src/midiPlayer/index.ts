import { midis } from "@midis";
import { EmbeddedMidiSource } from "@midiSource/embedded";
import { MidiManager } from "./midiManager";
import { MidiPlayerManager } from "./playerManager";
import {
    createLocalPlaylistFacade,
    type PlaylistFacade,
} from "./playlistFacade";

/**播放器管理 */
export const midiPlayerManager = new MidiPlayerManager();

/**
 * 播放列表门面（UI 唯一入口）：
 * - client/模板包：默认本地实现（世界动态属性）
 * - server 包：initServerAdmin 时经 useRemotePlaylist 切换为纯后端前端（零存储）
 */
export let playlist: PlaylistFacade = createLocalPlaylistFacade();

/** server 构建专用：切换到远程播放列表实现 */
export function useRemotePlaylist(facade: PlaylistFacade): void {
    playlist = facade;
}

/**midi曲库管理（内嵌来源：懒加载，行为与历史一致） */
export const midiManager = new MidiManager(new EmbeddedMidiSource(midis));

export function initPlayer() {
    //初始化
    midiPlayerManager.init();
}