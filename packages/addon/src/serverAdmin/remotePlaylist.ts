import type { PlaylistMeta } from "@piano/core";
import type { NetFetch } from "./netSource";
import type { PlaylistFacade } from "@midiPlayer/playlistFacade";
import { HttpRequestMethod } from "@serverNet/httpMethod";

/**
 * 远程播放列表实现：后端 /api/playlists 的纯前端，**零本地存储**。
 * - 每次方法调用 = 一次后端 HTTP 请求（token 经适配器透传）
 * - 网络/权限失败静默降级（undefined / []），由 UI 兜底提示
 */
export class RemotePlaylistFacade implements PlaylistFacade {
    constructor(
        private readonly baseUrl: string,
        private readonly fetch: NetFetch,
        private readonly extraHeaders?: () => Record<string, unknown>
    ) {}

    private base(path: string): string {
        return `${this.baseUrl.replace(/\/+$/, "")}${path}`;
    }

    private async request<T>(
        method: HttpRequestMethod,
        path: string,
        body?: unknown
    ): Promise<{ status: number; data: T | undefined }> {
        const url = this.base(path);
        const headers: Record<string, unknown> = {
            ...this.extraHeaders?.(),
        };
        if (body !== undefined) headers["Content-Type"] = "application/json";
        try {
            const res = await this.fetch(url, {
                method,
                headers,
                ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
            });
            if (res.status !== 200 && res.status !== 201 && res.status !== 204) {
                console.warn(`[playlist] ${method} ${url} 返回 ${res.status}`);
                return { status: res.status, data: undefined };
            }
            const data =
                res.status === 204 ? undefined : ((await res.json()) as T);
            return { status: res.status, data };
        } catch (e) {
            console.warn(`[playlist] ${method} ${url} 失败: ${(e as Error)?.message ?? e}`);
            return { status: 0, data: undefined };
        }
    }

    private get<T>(path: string) {
        return this.request<T>(HttpRequestMethod.Get, path);
    }
    private post<T>(path: string, body?: unknown) {
        return this.request<T>(HttpRequestMethod.Post, path, body);
    }
    private put<T>(path: string, body?: unknown) {
        return this.request<T>(HttpRequestMethod.Put, path, body);
    }
    private patch<T>(path: string, body?: unknown) {
        return this.request<T>(HttpRequestMethod.Patch, path, body);
    }
    private del(path: string) {
        return this.request<void>(HttpRequestMethod.Delete, path);
    }

    /**
     * 我的列表：按 owner=玩家临时 id（player.id，视为永久）过滤。
     * 游戏内创建时把 player.id 作为 owner 传给后端（POST owner），
     * 与后端令牌 label 互不冲突：web 创建的归令牌 label，游戏创建的归玩家。
     */
    async listMy(playerId: string): Promise<PlaylistMeta[]> {
        const { status, data } = await this.get<{ items: PlaylistMeta[] }>(
            `/api/playlists?owner=${encodeURIComponent(playerId)}`
        );
        return status === 200 && data ? data.items ?? [] : [];
    }

    async listPublic(): Promise<PlaylistMeta[]> {
        const { status, data } = await this.get<{ items: PlaylistMeta[] }>(
            "/api/playlists?public=1"
        );
        if (status !== 200 || !data) return [];
        return (data.items ?? []).slice().sort((a, b) => b.playCount - a.playCount);
    }

    private async detail(
        id: number
    ): Promise<(PlaylistMeta & { items: string[] }) | undefined> {
        const { status, data } = await this.get<PlaylistMeta & { items: string[] }>(
            `/api/playlists/${id}`
        );
        return status === 200 ? data : undefined;
    }

    async getMeta(id: number): Promise<PlaylistMeta | undefined> {
        const d = await this.detail(id);
        if (!d) return undefined;
        return {
            id: d.id,
            owner: d.owner,
            name: d.name,
            public: d.public,
            playCount: d.playCount,
            createdAt: d.createdAt,
            updatedAt: d.updatedAt,
        };
    }

    async getContent(id: number): Promise<string[]> {
        const d = await this.detail(id);
        return d?.items ?? [];
    }

    async create(owner: string, name: string): Promise<PlaylistMeta | undefined> {
        const { status, data } = await this.post<PlaylistMeta>("/api/playlists", {
            name,
            owner,
        });
        return status === 201 ? data : undefined;
    }

    async update(
        id: number,
        patch: { name?: string; public?: boolean }
    ): Promise<PlaylistMeta | undefined> {
        const { status, data } = await this.patch<PlaylistMeta>(
            `/api/playlists/${id}`,
            patch
        );
        return status === 200 ? data : undefined;
    }

    async setContent(id: number, items: string[]): Promise<void> {
        if (items.length > 1000) {
            console.warn(`[playlist] 列表 ${id} 超后端上限 1000 首，拒绝提交`);
            return;
        }
        await this.put(`/api/playlists/${id}/items`, { items });
    }

    async remove(id: number): Promise<void> {
        await this.del(`/api/playlists/${id}`);
    }

    async incPlayCount(id: number, playerId: string): Promise<void> {
        await this.post(`/api/playlists/${id}/play`, { playerId });
    }
}