import { utf8ByteLength, type MusicSelection } from "@piano/core";

export const PLAYBACK_BUDGET_BYTES = 24 * 1024;
// 给歌曲数组外的 v1 字段留空间，包括播放中变化的 index 和 seconds。
const PLAYBACK_ENVELOPE_BYTES = 128;

export function fitsPlaybackBudget(songs: readonly MusicSelection[]): boolean {
    return utf8ByteLength(JSON.stringify(songs)) + PLAYBACK_ENVELOPE_BYTES <= PLAYBACK_BUDGET_BYTES;
}
