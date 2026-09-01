import { http, HttpRequest, HttpHeader } from "@minecraft/server-net";
import { HttpRequestMethod } from "./httpMethod";
import type { SecretString } from "@minecraft/server-admin";
import type { NetFetch } from "../serverAdmin/netSource";

/**
 * 构建并缓存 server-net 适配器。
 * 本模块仅在 server 构建中引用（client 构建被 compile.define 常量折叠 +
 * 死代码消除裁剪），静态导入 @minecraft/server-net 无副作用。
 * 注意：HttpResponse 无 json() 方法，body 为字符串，此处统一 JSON.parse。
 *
 * method 全链路使用本地同形枚举（./httpMethod，值与官方 1.26.44 成员一致：
 * Get/Post/Put/Patch/Delete/Head = 'Get'/'Post'/...）。原生层按值校验
 * 枚举成员，直接赋值即可，无需二次归一化。
 */
let cached: NetFetch | null = null;

export async function getNetFetch(): Promise<NetFetch | null> {
    if (cached) return cached;

    cached = async (url, init) => {
        const req = new HttpRequest(url);
        req.method = init.method ?? HttpRequestMethod.Get;
        req.timeout = 10; // 秒
        if (init.headers) {
            req.headers = Object.entries(init.headers).map(
                ([key, value]) => new HttpHeader(key, value as string | SecretString)
            );
        }
        if (init.body) {
            req.body = init.body;
        }
        console.log(`[serverNet] 请求发出: ${req.method} ${url}`);
        let res;
        try {
            res = await http.request(req);
        } catch (e) {
            console.warn(`[serverNet] 请求失败（网络/超时/连接被拒）: ${(e as Error)?.message ?? e}`);
            throw e;
        }
        if (res.status >= 400) {
            console.warn(`[serverNet] ${url} 返回非成功状态码: ${res.status}`);
        }
        return {
            status: res.status,
            json: () => Promise.resolve(JSON.parse(res.body)),
        };
    };
    return cached;
}