import type { MidiSong, MidiSongMeta } from "../types.js";
import type { SongPort } from "./ports.js";

/** 内存曲库驱动（测试/单机场景） */
export class MemorySongPort implements SongPort {
    private songs = new Map<string, MidiSong>();

    add(song: MidiSong): void {
        this.songs.set(song.id, song); // 内容寻址，幂等
    }

    getMeta(id: string): MidiSongMeta | undefined {
        const s = this.songs.get(id);
        return s ? { id: s.id, name: s.name, duration: s.duration } : undefined;
    }

    getSong(id: string): MidiSong | undefined {
        return this.songs.get(id);
    }

    has(id: string): boolean {
        return this.songs.has(id);
    }

    listMetas(): MidiSongMeta[] {
        return [...this.songs.values()].map((s) => ({
            id: s.id,
            name: s.name,
            duration: s.duration,
        }));
    }

    remove(id: string): void {
        this.songs.delete(id);
    }
}
