import { midiManager } from "@midiPlayer";
import { getNetFetch } from "@serverNet";
import { CachedRemoteSource } from "./netSource";
import { DPDataBase } from "sapi-pro";

/** @minecraft/server-admin 模块的最小形状（BDS 专属，客户端缺失） */
interface ServerAdminModule {
    /** 非敏感配置（config/default/variables.json），可读字符串 */
    variables: { get(name: string): unknown };
    /** 敏感配置（config/default/secrets.json），返回 SecretString（脚本不可读） */
    secrets: { get(name: string): { value?: never } | undefined };
}

/** variables.json 键名：后端地址（可读） */
export const KEY_BACKEND_URL = "pianoBackendUrl";
/** secrets.json 键名：Bearer 令牌（SecretString，整体透传 HttpHeader） */
export const KEY_BACKEND_TOKEN = "pianoBackendToken";

let initialized = false;

/**
 * 初始化远程曲库（server-admin 读配置 → server-net 拉取）。
 * 任一环节不可用（客户端环境 / 未配置 / 网络模块缺失）→ 保持内嵌曲库，返回 false。
 *
 * BDS 配置文件示例：
 *   config/default/variables.json  → { "pianoBackendUrl": "http://192.168.1.10:3000" }
 *   config/default/secrets.json    → { "pianoBackendToken": "Bearer xxxxx" }
 * （token 为 SecretString，脚本环境读不到值，请求时由 HttpHeader 解析；
 *   因无法拼接前缀，secrets 中需保存完整的 "Bearer <token>"）
 */
export async function initServerAdmin(): Promise<boolean> {
    if (initialized) return true;

    let mod: ServerAdminModule;
    try {
        mod = (await import("@minecraft/server-admin")) as ServerAdminModule;
    } catch (e) {
        console.warn("[serverAdmin] @minecraft/server-admin 不可用，使用内嵌曲库", e);
        return false;
    }

    const url = mod.variables.get(KEY_BACKEND_URL);
    if (typeof url !== "string" || !url) {
        console.warn(
            `[serverAdmin] 未配置 ${KEY_BACKEND_URL}（BDS config/default/variables.json），使用内嵌曲库`
        );
        return false;
    }

    const fetch = await getNetFetch();
    if (!fetch) return false;

    // SecretString 仅透传（作为 HttpHeader 值执行时解析），绝不读取/打印
    const token = mod.secrets.get(KEY_BACKEND_TOKEN);
    const extraHeaders = token ? () => ({ Authorization: token }) : undefined;

    midiManager.setSource(
        new CachedRemoteSource({
            baseUrl: url,
            fetch,
            storage: new DPDataBase("midi_remote"),
            extraHeaders,
        })
    );
    console.log(`[serverAdmin] 远程曲库已启用: ${url}`);
    initialized = true;
    return true;
}