import {
    createLocalPlaylistFacade,
    type PlaylistFacade,
} from "@platform/storage/playlistFacade";
import { midiManager } from "./midiManager";

export { midiManager } from "./midiManager";

/**
 * 播放列表门面（UI 唯一入口）：
 * - client/模板包默认本地实现（动态属性）；
 * - server 构建由 initServerAdmin 时通过 useRemotePlaylist 切换为远程后端，存本地存储。
 */
export let playlist: PlaylistFacade = createLocalPlaylistFacade();

/** server 构建专用：切换为远程播放列表实现。 */
export function useRemotePlaylist(facade: PlaylistFacade): void {
    playlist = facade;
}
