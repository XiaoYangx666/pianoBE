import { DPDataBase } from "sapi-pro";

export interface PlayListMeta {
    id: number;
    owner: string;
    name: string;
    public: boolean;
    playCount: number;
    createdAt: number;
    updatedAt: number;
}

export interface PlayListContent {
    id: number;
    items: string[];
}

export class PlayListStore {
    private readonly db = new DPDataBase("playlist");

    private readonly KEY_ID = "id";
    private readonly KEY_PUBLIC = "public";

    // ---------------------------
    // 内存记录：用于播放计数限制
    // ---------------------------
    // 存储格式: "playerId:listId"
    private playRecords = new Set<string>();
    private lastRecordDate = "";

    // ---------------------------
    // Keys
    // ---------------------------
    private keyMeta(id: number) {
        return `meta:${id}`;
    }
    private keyContent(id: number) {
        return `content:${id}`;
    }
    private keyOwnerIndex(owner: string) {
        return `owner_lists:${owner}`;
    }

    // ---------------------------
    // ID Generator
    // ---------------------------
    private nextId(): number {
        const id = this.db.getJSON<number>(this.KEY_ID) ?? 0;
        const next = id + 1;
        this.db.set(this.KEY_ID, next);
        return next;
    }

    // ---------------------------
    // Private Helpers
    // ---------------------------
    private getIndex(key: string): number[] {
        return this.db.getJSON<number[]>(key, Array.isArray) ?? [];
    }

    private saveIndex(key: string, ids: number[]) {
        this.db.setJSON(key, ids);
    }

    /**
     * 内部方法：检查并清理跨天记录
     */
    private checkDateAndClear() {
        const today = new Date().toDateString();
        if (this.lastRecordDate !== today) {
            this.playRecords.clear(); // 跨天了，清空内存记录
            this.lastRecordDate = today;
        }
    }

    // ---------------------------
    // Public API - CRUD
    // ---------------------------

    create(owner: string, name: string): PlayListMeta {
        const id = this.nextId();
        const now = Date.now();

        const meta: PlayListMeta = {
            id,
            owner,
            name,
            public: false,
            playCount: 0,
            createdAt: now,
            updatedAt: now,
        };

        this.db.setJSON(this.keyMeta(id), meta);
        this.db.setJSON(this.keyContent(id), { id, items: [] });

        const ownerIdx = this.getIndex(this.keyOwnerIndex(owner));
        ownerIdx.push(id);
        this.saveIndex(this.keyOwnerIndex(owner), ownerIdx);

        return meta;
    }

    getMeta(id: number): PlayListMeta | undefined {
        return this.db.getJSON<PlayListMeta>(this.keyMeta(id));
    }

    getContent(id: number): string[] {
        const data = this.db.getJSON<PlayListContent>(this.keyContent(id));
        return data ? data.items : [];
    }

    updateMeta(id: number, patch: Partial<Omit<PlayListMeta, "id" | "owner">>) {
        const meta = this.getMeta(id);
        if (!meta) return;

        const updated = { ...meta, ...patch, updatedAt: Date.now() };
        this.db.setJSON(this.keyMeta(id), updated);

        if (patch.public !== undefined) {
            const pubIdx = this.getIndex(this.KEY_PUBLIC);
            if (patch.public) {
                if (!pubIdx.includes(id)) pubIdx.push(id);
            } else {
                const i = pubIdx.indexOf(id);
                if (i > -1) pubIdx.splice(i, 1);
            }
            this.saveIndex(this.KEY_PUBLIC, pubIdx);
        }
    }

    setContent(id: number, items: string[]) {
        this.db.setJSON(this.keyContent(id), { id, items });
        this.updateMeta(id, {});
    }

    delete(id: number) {
        const meta = this.getMeta(id);
        if (!meta) return;

        this.db.rm(this.keyMeta(id));
        this.db.rm(this.keyContent(id));

        const ownerIdx = this.getIndex(this.keyOwnerIndex(meta.owner)).filter(
            (i) => i !== id
        );
        this.saveIndex(this.keyOwnerIndex(meta.owner), ownerIdx);

        if (meta.public) {
            const pubIdx = this.getIndex(this.KEY_PUBLIC).filter(
                (i) => i !== id
            );
            this.saveIndex(this.KEY_PUBLIC, pubIdx);
        }
    }

    /**
     * 增加播放次数（带频率限制）
     * @param id 播放列表ID
     * @param playerId 操作者ID
     */
    incPlayCount(id: number, playerId: string) {
        this.checkDateAndClear();

        const recordKey = `${playerId}:${id}`;
        if (this.playRecords.has(recordKey)) {
            // 该玩家今天已经为该列表贡献过播放量了
            return;
        }

        const meta = this.getMeta(id);
        if (!meta) return;

        // 1. 更新数据库
        meta.playCount++;
        this.db.setJSON(this.keyMeta(id), meta);

        // 2. 写入内存记录
        this.playRecords.add(recordKey);
    }

    // ---------------------------
    // Query APIs
    // ---------------------------

    getMetasByOwner(owner: string): PlayListMeta[] {
        const ids = this.getIndex(this.keyOwnerIndex(owner));
        const result: PlayListMeta[] = [];
        let changed = false;

        for (const id of ids) {
            const m = this.getMeta(id);
            if (m) result.push(m);
            else changed = true;
        }

        if (changed) {
            this.saveIndex(
                this.keyOwnerIndex(owner),
                result.map((r) => r.id)
            );
        }
        return result;
    }

    getPublicMetas(sortByPlayCount: boolean = false): PlayListMeta[] {
        const ids = this.getIndex(this.KEY_PUBLIC);
        const result: PlayListMeta[] = [];
        let changed = false;

        for (const id of ids) {
            const m = this.getMeta(id);
            if (m && m.public) result.push(m);
            else changed = true;
        }

        if (changed) {
            this.saveIndex(
                this.KEY_PUBLIC,
                result.map((r) => r.id)
            );
        }

        if (sortByPlayCount) {
            result.sort((a, b) => b.playCount - a.playCount);
        }
        return result;
    }
}
