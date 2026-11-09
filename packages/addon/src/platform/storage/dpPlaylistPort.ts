import { DPDataBase } from "sapi-pro";
import type { PlaylistMeta, PlaylistPort } from "@piano/core";

interface ContentRecord {
    id: number;
    items: string[];
}

/**
 * 播放列表的游戏内存储驱动（世界动态属性）。
 * - 键名与历史 PlayListStore 完全一致（meta:N / content:N），旧世界数据可直接读取，无需迁移；
 * - owner_lists/public/计数器等旧索引键不再维护，由业务层派生视图取代（残留键无害）；
 * - 单记录 = 单键原子写；listAllMetas 全扫主记录，崩溃残留（孤儿 content）自然不可见。
 */
export class DPDataBasePlaylistPort implements PlaylistPort {
    private readonly db = new DPDataBase("playlist");

    private keyMeta(id: number) {
        return `meta:${id}`;
    }
    private keyContent(id: number) {
        return `content:${id}`;
    }

    /** max(现有 id)+1：崩溃后可恢复，顺序创建不碰撞 */
    nextId(): number {
        let max = 0;
        for (const m of this.listAllMetas()) {
            if (m.id > max) max = m.id;
        }
        return max + 1;
    }

    getMeta(id: number): PlaylistMeta | undefined {
        return this.db.getJSON<PlaylistMeta>(this.keyMeta(id));
    }

    listAllMetas(): PlaylistMeta[] {
        const result: PlaylistMeta[] = [];
        const seen = new Set<number>();
        for (const key of this.db.keys()) {
            if (!key.startsWith("meta:")) continue;
            const meta = this.db.getJSON<PlaylistMeta>(key);
            if (meta && !seen.has(meta.id)) {
                seen.add(meta.id);
                result.push(meta);
            }
        }
        return result;
    }

    setMeta(meta: PlaylistMeta): void {
        this.db.setJSON(this.keyMeta(meta.id), meta);
    }

    deleteMeta(id: number): void {
        this.db.rm(this.keyMeta(id));
    }

    getContent(id: number): string[] {
        const data = this.db.getJSON<ContentRecord>(this.keyContent(id));
        return data?.items ?? [];
    }

    setContent(id: number, items: string[]): void {
        this.db.setJSON(this.keyContent(id), { id, items });
    }

    deleteContent(id: number): void {
        this.db.rm(this.keyContent(id));
    }

    deletePlaylist(id: number): void {
        this.deleteMeta(id);
        this.deleteContent(id);
    }
}