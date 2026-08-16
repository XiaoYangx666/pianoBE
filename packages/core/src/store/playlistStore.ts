import type { PlaylistMeta } from "../types.js";
import type { PlaylistPort } from "./ports.js";

/**
 * 播放列表业务层：在 PlaylistPort 之上实现 CRUD、派生视图与播放计数。
 * 一致性策略：
 * - 写路径只保证"主记录先写"（meta 先于/伴随 content），不维护跨记录索引；
 * - owner/public 视图通过 listAllMetas() 派生，读取即修复，无需启动重建；
 * - 崩溃残留（如只有 content 没有 meta）不会出现在任何视图里，属可接受垃圾。
 */
export class PlaylistStore {
    /** 播放计数去重：`playerId:listId`，跨天清空 */
    private playRecords = new Set<string>();
    private lastRecordDate = "";

    constructor(private readonly port: PlaylistPort) {}

    /* ================== CRUD ================== */

    create(owner: string, name: string): PlaylistMeta {
        const id = this.port.nextId();
        const now = Date.now();
        const meta: PlaylistMeta = {
            id,
            owner,
            name,
            public: false,
            playCount: 0,
            createdAt: now,
            updatedAt: now,
        };
        // 主记录先写；content 紧随。中途崩溃只会留下孤儿 content，无解锁问题。
        this.port.setMeta(meta);
        this.port.setContent(id, []);
        return meta;
    }

    getMeta(id: number): PlaylistMeta | undefined {
        return this.port.getMeta(id);
    }

    getContent(id: number): string[] {
        return this.port.getContent(id);
    }

    updateMeta(
        id: number,
        patch: Partial<Omit<PlaylistMeta, "id" | "owner">>
    ): PlaylistMeta | undefined {
        const meta = this.port.getMeta(id);
        if (!meta) return;
        const updated = { ...meta, ...patch, updatedAt: Date.now() };
        this.port.setMeta(updated);
        return updated;
    }

    /** 整体替换列表内容（原子），并刷新 updatedAt */
    setContent(id: number, items: string[]): void {
        this.port.setContent(id, items);
        const meta = this.port.getMeta(id);
        if (meta) this.port.setMeta({ ...meta, updatedAt: Date.now() });
    }

    delete(id: number): void {
        this.port.deletePlaylist(id);
    }

    /* ================== 派生视图 ================== */

    getMetasByOwner(owner: string): PlaylistMeta[] {
        return this.port.listAllMetas().filter((m) => m.owner === owner);
    }

    getPublicMetas(sortByPlayCount = false): PlaylistMeta[] {
        const result = this.port.listAllMetas().filter((m) => m.public);
        if (sortByPlayCount) {
            result.sort((a, b) => b.playCount - a.playCount);
        }
        return result;
    }

    /* ================== 播放计数（内存去重，跨天清空） ================== */

    incPlayCount(id: number, playerId: string): void {
        this.checkDateAndClear();

        const recordKey = `${playerId}:${id}`;
        if (this.playRecords.has(recordKey)) return;

        const meta = this.port.getMeta(id);
        if (!meta) return;

        meta.playCount++;
        this.port.setMeta(meta);
        this.playRecords.add(recordKey);
    }

    private checkDateAndClear() {
        const today = new Date().toDateString();
        if (this.lastRecordDate !== today) {
            this.playRecords.clear();
            this.lastRecordDate = today;
        }
    }
}