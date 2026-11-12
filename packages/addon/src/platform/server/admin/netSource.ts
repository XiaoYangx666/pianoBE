import { decodeBase64Url, type MidiSongMeta } from "@piano/core";
import type { HttpRequestMethod } from "@platform/server/net/httpMethod";

/** 网络响应（适配 server-net HttpResponse / 测试 mock） */
export interface NetResponse {
    status: number;
    json(): Promise<unknown>;
}

/**
 * 网络请求。headers 值可为普通字符串或 server-admin 的 SecretString
 * （脚本环境不可读，由底层 HttpHeader 在请求执行时解析）。
 * method 为 @minecraft/server-net 枚举类型（type-only 导入、运行时擦除，
 * bun 测试环境无需真实模块；脚本运行时的真实枚举成员由 serverNet 适配器归一化）。
 * body 为 JSON 字符串（POST/PUT/PATCH 用）。
 */
export type NetFetch = (
    url: string,
    init: {
        method?: HttpRequestMethod;
        headers?: Record<string, unknown>;
        body?: string;
    }
) => Promise<NetResponse>;

export interface RemoteSourceOptions {
    baseUrl: string;
    fetch: NetFetch;
    /** 附加请求头构造器（值可为 SecretString，透传不读取） */
    extraHeaders?: () => Record<string, unknown>;
}

/** 后端单曲 PBE2 响应 */
interface RemoteSongPayload {
    id?: string;
    name?: string;
    duration?: number;
    /** Base64URL(PBE2) */
    data?: string;
}

/**
 * 远程曲库来源：通过 server-net 从后端 API 拉取 PBE2 曲目。
 * - 列表 UI：page() 服务端分页按需取页（q 走服务端搜索），不下载全量
 * - 批量操作（一键添加）：metaAll(q) 分页取全
 * - 单曲：get() 每次返回 PBE2 数据；缓存与淘汰统一由 SongCache 负责
 * - list()：远程源不提供全量列表，返回空数组
 * - 网络错误：列表返回空数组并告警；单曲返回 undefined
 */
export class RemoteMidiSource {
    private readonly opts: RemoteSourceOptions;

    constructor(options: RemoteSourceOptions) {
        this.opts = options;
    }

    private headers(): Record<string, unknown> {
        return this.opts.extraHeaders?.() ?? {};
    }

    private base(path: string): string {
        return `${this.opts.baseUrl.replace(/\/+$/, "")}${path}`;
    }

    /**
     * 远程源不提供全量列表：返回空数组（不发起网络请求）。
     * 需要列表走 page()（UI 分页）或 metaAll()（批量操作）。
     */
    async list(): Promise<MidiSongMeta[]> {
        return [];
    }

    /** 服务端分页查询：只向后端要第 page 页（pageSize 条），q 为服务端名称搜索 */
    async page(
        page: number,
        pageSize: number,
        q?: string
    ): Promise<{ items: MidiSongMeta[]; total: number }> {
        // 手拼 query：游戏脚本运行时没有 URLSearchParams（QuickJS 受限全局）
        const query = [`pageSize=${pageSize}`, `page=${page}`];
        if (q) query.push(`q=${encodeURIComponent(q)}`);
        const url = this.base(`/api/songs?${query.join("&")}`);
        console.log(`[netSource] 拉取曲目第 ${page} 页: GET ${url}`);
        const res = await this.opts.fetch(url, { headers: this.headers() });
        console.log(`[netSource] 第 ${page} 页响应状态: ${res.status}`);
        if (res.status !== 200) throw new Error(`songs 接口返回 ${res.status}`);
        const data = (await res.json()) as { items?: MidiSongMeta[]; total?: number };
        const items = data.items ?? [];
        const total = typeof data.total === "number" ? data.total : items.length;
        console.log(`[netSource] 第 ${page} 页 ${items.length} 首（共 ${total} 首）`);
        return { items, total };
    }

    /** 按 q 取全部元信息：循环分页合并（"一键添加"等批量操作用） */
    async metaAll(q?: string): Promise<MidiSongMeta[]> {
        const pageSize = 100;
        const all: MidiSongMeta[] = [];
        let page = 1;
        for (;;) {
            const { items, total } = await this.page(page, pageSize, q);
            all.push(...items);
            if (all.length >= total) break;
            if (items.length < pageSize) break; // 最后一页不足一页
            if (page >= 20) break; // 安全上限
            page++;
        }
        console.log(`[netSource] metaAll${q ? `(q=${q})` : ""} 共 ${all.length} 首`);
        return all;
    }

    /** 获取 PBE2 数据；远程源不做单曲缓存，交给统一 SongCache */
    async get(id: string): Promise<Uint8Array | undefined> {
        try {
            const url = this.base(`/api/songs/${encodeURIComponent(id)}`);
            console.log(`[netSource] 拉取单曲: GET ${url}`);
            const res = await this.opts.fetch(url, { headers: this.headers() });
            console.log(`[netSource] 单曲 ${id} 响应状态: ${res.status}`);
            if (res.status !== 200) return undefined;
            const payload = (await res.json()) as RemoteSongPayload;
            if (!payload.data) return undefined;
            const bytes = decodeBase64Url(payload.data);
            console.log(`[netSource] 单曲 ${id} 拉取成功（${payload.name ?? ""}，${bytes.length}B）`);
            return bytes;
        } catch (e) {
            console.warn(`[netSource] 单曲 ${id} 拉取失败: ${(e as Error)?.message ?? e}`);
            return undefined;
        }
    }
}
