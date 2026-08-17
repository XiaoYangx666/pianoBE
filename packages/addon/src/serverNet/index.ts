import { http, HttpRequest, HttpHeader } from "@minecraft/server-net";
import type { HttpRequestMethod } from "@minecraft/server-net";
import type { SecretString } from "@minecraft/server-admin";
import type { NetFetch } from "../serverAdmin/netSource";

let cached: NetFetch | null = null;

/**
 * 构建并缓存 server-net 适配器。
 * 本模块仅在 server 构建中引用（client 构建被 compile.define 常量折叠 +
 * 死代码消除裁剪），静态导入 @minecraft/server-net 无副作用。
 * 注意：HttpResponse 无 json() 方法，body 为字符串，此处统一 JSON.parse。
 */
export async function getNetFetch(): Promise<NetFetch | null> {
    if (cached) return cached;

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
}