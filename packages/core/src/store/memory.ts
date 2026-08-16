import type { MidiSong, MidiSongMeta, PlaylistMeta } from "../types.js";
import type { PlaylistPort, SongPort } from "./ports.js";

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

/** 内存播放列表驱动 */
export class MemoryPlaylistPort implements PlaylistPort {
    private metas = new Map<number, PlaylistMeta>();
    private contents = new Map<number, string[]>();

    /** max(现有 id)+1：崩溃后可重建，顺序创建不碰撞 */
    nextId(): number {
        let max = 0;
        for (const id of this.metas.keys()) {
            if (id > max) max = id;
        }
        return max + 1;
    }

    getMeta(id: number): PlaylistMeta | undefined {
        const m = this.metas.get(id);
        return m ? { ...m } : undefined;
    }

    listAllMetas(): PlaylistMeta[] {
        return [...this.metas.values()].map((m) => ({ ...m }));
    }

    setMeta(meta: PlaylistMeta): void {
        this.metas.set(meta.id, { ...meta });
    }

    deleteMeta(id: number): void {
        this.metas.delete(id);
    }

    getContent(id: number): string[] {
        return [...(this.contents.get(id) ?? [])];
    }

    setContent(id: number, items: string[]): void {
        this.contents.set(id, [...items]);
    }

    deleteContent(id: number): void {
        this.contents.delete(id);
    }

    deletePlaylist(id: number): void {
        this.deleteMeta(id);
        this.deleteContent(id);
    }
}