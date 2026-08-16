import type { NetFetch } from "../serverAdmin/netSource";
import type { HttpRequestMethod } from "@minecraft/server-net";
import type { SecretString } from "@minecraft/server-admin";

let cached: NetFetch | null = null;

/**
 * 探测并缓存 server-net 适配器。
 * 客户端环境（无 @minecraft/server-net）动态 import 失败 → 返回 null，调用方降级。
 * 注意：HttpResponse 无 json() 方法，body 为字符串，此处统一 JSON.parse。
 */
export async function getNetFetch(): Promise<NetFetch | null> {
    if (cached) return cached;

    try {
        const mod = await import("@minecraft/server-net");
        const { http, HttpRequest, HttpHeader } = mod;

        cached = async (url, init) => {
            const req = new HttpRequest(url);
            req.method = (init.method ?? "GET") as HttpRequestMethod;
            req.timeout = 10; // 秒
            if (init.headers) {
                req.headers = Object.entries(init.headers).map(
                    ([key, value]) => new HttpHeader(key, value as string | SecretString)
                );
            }
            const res = await http.request(req);
            return {
                status: res.status,
                json: () => Promise.resolve(JSON.parse(res.body)),
            };
        };
        return cached;
    } catch (e) {
        console.warn("[serverAdmin] @minecraft/server-net 不可用，使用内嵌曲库", e);
        return null;
    }
}