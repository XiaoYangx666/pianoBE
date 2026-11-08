import type { MidiSongMeta } from "@piano/core";
import type { PlayMode } from "@midiPlayer/queue";

export interface PlaybackRecord {
    version: 1;
    songs: MidiSongMeta[];
    index: number;
    mode: PlayMode;
    state: "idle" | "paused" | "playing";
    seconds: number;
}

export function readPlaybackRecord(raw: unknown): PlaybackRecord | undefined {
    if (typeof raw !== "string") return;
    try {
        const data = JSON.parse(raw);
        if (data?.version !== 1 || !Array.isArray(data.songs) ||
            !Number.isInteger(data.index) || data.index < -1 || data.index > data.songs.length ||
            !["sequence", "loop", "single", "shuffle"].includes(data.mode) ||
            !["idle", "paused", "playing"].includes(data.state) ||
            !Number.isFinite(data.seconds) || data.seconds < 0 ||
            !data.songs.every((song: MidiSongMeta) => song && typeof song.id === "string" &&
                typeof song.name === "string" && Number.isFinite(song.duration) && song.duration >= 0)) return;
        return data;
    } catch {
        return;
    }
}
