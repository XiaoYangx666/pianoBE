import {
    findFreeSongId, readSongHeader, reidentifySong, sameSongMusic, sameSongPerformance,
} from "@piano/core";
import type { SongEntry } from "../types";

/** 只保留一份音符。第一份 PBE3 的默认演奏方式与名称保持不变。 */
export function mergeSongEntries<T extends SongEntry>(current: readonly T[], incoming: readonly T[]) {
    const rows = [...current];
    const changes = new Map<string, T>();
    for (const song of incoming) {
        const data = song.data;
        const index = rows.findIndex(row => data && row.data && row.duration === song.duration
            && row.noteCount === song.noteCount && sameSongMusic(row.data, data));
        if (index >= 0 && data) {
            const row = rows[index];
            const base = row.data!;
            const primary = readSongHeader(base).performance;
            const extra = [...(row.performances ?? [])];
            const known = primary ? [primary, ...extra] : extra.slice();
            for (const cues of songPerformances(song)) {
                if (known.some(existing => sameSongPerformance(base, existing, cues))) continue;
                extra.push(cues);
                known.push(cues);
            }
            if (extra.length !== (row.performances?.length ?? 0)) {
                rows[index] = { ...row, performances: extra };
                changes.set(row.id, rows[index]);
            }
            continue;
        }
        let row = song;
        if (rows.some(existing => existing.id === row.id)) {
            if (!data) throw new Error(`无法合并同 ID 的曲目：${row.id}`);
            const id = findFreeSongId(data, candidate => rows.some(existing => existing.id === candidate));
            row = { ...song, id, data: reidentifySong(data, id), moduleText: undefined, isOriginal: false };
        }
        rows.push(row);
        changes.set(row.id, row);
    }
    return { rows, changed: [...changes.values()] };
}

export function songPerformances(song: SongEntry) {
    const primary = song.data && readSongHeader(song.data).performance;
    return [...(primary ? [primary] : []), ...(song.performances ?? [])];
}
