import { normalizeMusicRef, type MusicRef } from "@piano/core";
import type { PlayMode } from "@domain/playback/queue";

/**
 * 播放快照。
 *
 * v2 = 带来源的 MusicRef（钢琴/存储卡/曲库）；
 * v1 旧世界只有 id/name/duration，读取时按“曲库来源”兼容，不丢队列。
 */
export interface PlaybackRecord {
    version: 2;
    songs: MusicRef[];
    index: number;
    mode: PlayMode;
    state: "idle" | "paused" | "playing";
    seconds: number;
}

export function readPlaybackRecord(raw: unknown): PlaybackRecord | undefined {
    if (typeof raw !== "string") return;
    try {
        const data = JSON.parse(raw);
        if (!Array.isArray(data?.songs) ||
            !Number.isInteger(data.index) || data.index < -1 || data.index > data.songs.length ||
            !["sequence", "loop", "single", "shuffle"].includes(data.mode) ||
            !["idle", "paused", "playing"].includes(data.state) ||
            !Number.isFinite(data.seconds) || data.seconds < 0) return;
        const songs: MusicRef[] = [];
        for (const song of data.songs) {
            const ref = normalizeMusicRef(song);
            // 任一曲目无法识别就放弃整份快照，避免恢复到“半份队列”。
            if (!ref) return;
            songs.push(ref);
        }
        const state = data.index < 0 && songs.length > 0 ? "idle" : data.state;
        return {
            version: 2,
            songs,
            index: data.index,
            mode: data.mode,
            state,
            seconds: data.seconds,
        };
    } catch {
        return;
    }
}
