import { PlaylistStore } from "@piano/core";
import type { PlaylistMeta } from "@piano/core";
import { DPDataBasePlaylistPort } from "@drivers/dpPlaylistPort";

/**
 * 播放列表门面：游戏内播放列表 UI 的唯一入口。
 * - 本地实现（client/模板包）：包一层同步 PlaylistStore（世界动态属性）
 * - 远程实现（server 包）：纯后端 API 前端，零本地存储
 * 所有方法异步返回，UI 统一 await。
 */
export interface PlaylistFacade {
    /** 我的列表（本地按 owner 过滤；远程按 owner 过滤后端列表） */
    listMy(playerId: string): Promise<PlaylistMeta[]>;
    /** 公开列表（按播放数排序） */
    listPublic(): Promise<PlaylistMeta[]>;
    getMeta(id: number): Promise<PlaylistMeta | undefined>;
    /** 列表曲目 id 数组（保持顺序） */
    getContent(id: number): Promise<string[]>;
    /** 创建列表（远程时 owner 由后端令牌确定） */
    create(owner: string, name: string): Promise<PlaylistMeta | undefined>;
    update(
        id: number,
        patch: { name?: string; public?: boolean }
    ): Promise<PlaylistMeta | undefined>;
    setContent(id: number, items: string[]): Promise<void>;
    remove(id: number): Promise<void>;
    /** 播放计数（远程上报后端） */
    incPlayCount(id: number, playerId: string): Promise<void>;
}

/** 本地实现：core PlaylistStore + 世界动态属性（client/模板包） */
export class LocalPlaylistFacade implements PlaylistFacade {
    constructor(private readonly store: PlaylistStore) {}

    async listMy(playerId: string): Promise<PlaylistMeta[]> {
        return this.store.getMetasByOwner(playerId);
    }

    async listPublic(): Promise<PlaylistMeta[]> {
        return this.store.getPublicMetas(true);
    }

    async getMeta(id: number): Promise<PlaylistMeta | undefined> {
        return this.store.getMeta(id);
    }

    async getContent(id: number): Promise<string[]> {
        return this.store.getContent(id);
    }

    async create(owner: string, name: string): Promise<PlaylistMeta | undefined> {
        return this.store.create(owner, name);
    }

    async update(
        id: number,
        patch: { name?: string; public?: boolean }
    ): Promise<PlaylistMeta | undefined> {
        return this.store.updateMeta(id, patch);
    }

    async setContent(id: number, items: string[]): Promise<void> {
        this.store.setContent(id, items);
    }

    async remove(id: number): Promise<void> {
        this.store.delete(id);
    }

    async incPlayCount(id: number, playerId: string): Promise<void> {
        this.store.incPlayCount(id, playerId);
    }
}

/** 默认实例（client/模板包）：本地存储 */
export function createLocalPlaylistFacade(): PlaylistFacade {
    return new LocalPlaylistFacade(new PlaylistStore(new DPDataBasePlaylistPort()));
}