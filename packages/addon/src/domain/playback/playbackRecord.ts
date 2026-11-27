import { toMusicSelection, type MusicSelection } from "@piano/core";
import type { PlayMode } from "./queue";

export interface PlaybackRecord {
    songs: MusicSelection[];
    index: number;
    mode: PlayMode;
    state: "idle" | "paused" | "playing";
    seconds: number;
}

interface PersistedPlayback extends PlaybackRecord {
    v: 1;
}

const RECORD_FIELDS = new Set(["v", "songs", "index", "mode", "state", "seconds"]);
const SELECTION_FIELDS = new Set([
    "id", "name", "duration", "source", "performanceId", "noteCount", "bytes", "checksum", "cardUid",
]);

function isNonemptyString(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
}

function isMusicSelection(value: unknown): value is MusicSelection {
    if (!value || typeof value !== "object") return false;
    const ref = value as Record<string, unknown>;
    return Object.keys(ref).every(key => SELECTION_FIELDS.has(key)) &&
        (ref.source === "library" || ref.source === "card") &&
        isNonemptyString(ref.id) && typeof ref.name === "string" &&
        typeof ref.duration === "number" && Number.isFinite(ref.duration) && ref.duration >= 0 &&
        isNonemptyString(ref.performanceId) &&
        (ref.noteCount === undefined || Number.isSafeInteger(ref.noteCount) && Number(ref.noteCount) >= 0) &&
        (ref.bytes === undefined || Number.isSafeInteger(ref.bytes) && Number(ref.bytes) > 0) &&
        (ref.checksum === undefined || typeof ref.checksum === "string" && /^[0-9a-f]{1,8}$/i.test(ref.checksum)) &&
        (ref.cardUid === undefined || ref.source === "card" && isNonemptyString(ref.cardUid));
}

function isPersistedPlayback(value: unknown): value is PersistedPlayback {
    if (!value || typeof value !== "object") return false;
    const data = value as Record<string, unknown>;
    return data.v === 1 && Object.keys(data).every(key => RECORD_FIELDS.has(key)) &&
        Array.isArray(data.songs) && data.songs.every(isMusicSelection) &&
        typeof data.index === "number" && Number.isInteger(data.index) &&
        data.index >= -1 && data.index <= data.songs.length &&
        (data.mode === "sequence" || data.mode === "loop" || data.mode === "single" || data.mode === "shuffle") &&
        (data.state === "idle" || data.state === "paused" || data.state === "playing") &&
        (data.state === "idle" || data.index >= 0 && data.index < data.songs.length) &&
        typeof data.seconds === "number" && Number.isFinite(data.seconds) && data.seconds >= 0;
}

export function readPlaybackRecord(raw: unknown): PlaybackRecord | undefined {
    if (typeof raw !== "string") return;
    try {
        const data: unknown = JSON.parse(raw);
        if (!isPersistedPlayback(data)) return;
        const { songs, index, mode, state, seconds } = data;
        return { songs, index, mode, state, seconds };
    } catch {
        return;
    }
}

export function serializePlaybackRecord(record: PlaybackRecord): string | undefined {
    const data: PersistedPlayback = {
        v: 1,
        songs: record.songs.map(song => toMusicSelection(song, song.performanceId)),
        index: record.index,
        mode: record.mode,
        state: record.state,
        seconds: record.seconds,
    };
    if (isPersistedPlayback(data)) return JSON.stringify(data);
}
