import { DPDataBase } from "sapi-pro";

export interface PlayList {
    id: number;
    owner: string;
    name: string;
    items: string[];
    public: boolean;
    playCount: number;
    createdAt: number;
    updatedAt: number;
}

class PlayListStore {
    private readonly db = new DPDataBase("playlist");

    private readonly KEY_ID = "id";
    private readonly KEY_PUBLIC = "public";

    // ---------------------------
    // key helpers
    // ---------------------------
    private keyItem(id: number) {
        return `item:${id}`;
    }

    private keyPlayer(playerId: string) {
        return `player:${playerId}`;
    }

    // ---------------------------
    // id 生成
    // ---------------------------
    private nextId(): number {
        const id = this.db.getJSON<number>(this.KEY_ID) ?? 0;
        const next = id + 1;
        this.db.set(this.KEY_ID, next);
        return next;
    }

    // ---------------------------
    // item 操作
    // ---------------------------
    private getItem(id: number): PlayList | undefined {
        return this.db.getJSON<PlayList>(
            this.keyItem(id),
            (v: any): v is PlayList => {
                return v && typeof v.id === "number";
            }
        );
    }

    private saveItem(item: PlayList) {
        this.db.setJSON(this.keyItem(item.id), item);
    }

    private deleteItem(id: number) {
        this.db.rm(this.keyItem(id));
    }

    // ---------------------------
    // index 操作
    // ---------------------------
    private getIndex(key: string): number[] {
        return this.db.getJSON<number[]>(key, Array.isArray) ?? [];
    }

    private saveIndex(key: string, ids: number[]) {
        this.db.setJSON(key, ids);
    }

    private addToIndex(key: string, id: number) {
        const arr = this.getIndex(key);
        if (!arr.includes(id)) {
            arr.push(id);
            this.saveIndex(key, arr);
        }
    }

    private removeFromIndex(key: string, id: number) {
        const arr = this.getIndex(key).filter((x) => x !== id);
        this.saveIndex(key, arr);
    }

    // ---------------------------
    // 清理脏指针
    // ---------------------------
    private cleanIndex(key: string): number[] {
        const ids = this.getIndex(key);
        const valid: number[] = [];

        for (const id of ids) {
            const item = this.getItem(id);
            if (item) valid.push(id);
        }

        if (valid.length !== ids.length) {
            this.saveIndex(key, valid);
        }

        return valid;
    }

    // ---------------------------
    // 创建列表
    // ---------------------------
    createList(playerId: string, name: string): PlayList {
        const id = this.nextId();

        const item: PlayList = {
            id,
            owner: playerId,
            name,
            items: [],
            public: false,
            playCount: 0,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };

        this.saveItem(item);
        this.addToIndex(this.keyPlayer(playerId), id);

        return item;
    }

    // ---------------------------
    // 删除列表
    // ---------------------------
    deleteList(playerId: string, listId: number) {
        const item = this.getItem(listId);
        if (!item) return;

        if (item.owner !== playerId) {
            throw new Error("permission denied");
        }

        this.removeFromIndex(this.keyPlayer(playerId), listId);

        if (item.public) {
            this.removeFromIndex(this.KEY_PUBLIC, listId);
        }

        this.deleteItem(listId);
    }

    // ---------------------------
    // 设置 items
    // ---------------------------
    setListItems(playerId: string, listId: number, items: string[]) {
        const item = this.getItem(listId);
        if (!item) throw new Error("list not found");

        if (item.owner !== playerId) {
            throw new Error("permission denied");
        }

        item.items = items;
        item.updatedAt = Date.now();

        this.saveItem(item);
    }

    // ---------------------------
    // 设置 public
    // ---------------------------
    setPublic(playerId: string, listId: number, isPublic: boolean) {
        const item = this.getItem(listId);
        if (!item) throw new Error("list not found");

        if (item.owner !== playerId) {
            throw new Error("permission denied");
        }

        if (item.public === isPublic) return;

        item.public = isPublic;
        item.updatedAt = Date.now();

        this.saveItem(item);

        if (isPublic) {
            this.addToIndex(this.KEY_PUBLIC, listId);
        } else {
            this.removeFromIndex(this.KEY_PUBLIC, listId);
        }
    }

    // ---------------------------
    // 播放计数 +1
    // ---------------------------
    incPlayCount(listId: number) {
        const item = this.getItem(listId);
        if (!item) return;

        item.playCount++;
        this.saveItem(item);
    }

    // ---------------------------
    // 获取玩家列表
    // ---------------------------
    getPlayerLists(playerId: string): PlayList[] {
        const ids = this.cleanIndex(this.keyPlayer(playerId));
        const result: PlayList[] = [];

        for (const id of ids) {
            const item = this.getItem(id);
            if (item) result.push(item);
        }

        return result;
    }

    // ---------------------------
    // 获取 public（按播放量排序）
    // ---------------------------
    getPublicLists(order?: "play"): PlayList[] {
        const ids = this.cleanIndex(this.KEY_PUBLIC);
        const result: PlayList[] = [];

        for (const id of ids) {
            const item = this.getItem(id);
            if (item && item.public) {
                result.push(item);
            }
        }

        if (order == "play") {
            // 🔥 按播放量排序
            result.sort((a, b) => b.playCount - a.playCount);
        }

        return result;
    }

    // ---------------------------
    // 获取单个
    // ---------------------------
    getList(listId: number): PlayList | undefined {
        return this.getItem(listId);
    }
}

export const playListStore = new PlayListStore();
