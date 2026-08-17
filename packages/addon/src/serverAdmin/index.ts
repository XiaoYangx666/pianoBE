import { midiManager } from "@midiPlayer";
import { getNetFetch } from "@serverNet";
import { CachedRemoteSource } from "./netSource";
import { DPDataBase } from "sapi-pro";
import { secrets, variables } from "@minecraft/server-admin";

/** variables.json 键名：后端地址（可读） */
export const KEY_BACKEND_URL = "pianoBackendUrl";
/** secrets.json 键名：Bearer 令牌（SecretString，整体透传 HttpHeader） */
export const KEY_BACKEND_TOKEN = "pianoBackendToken";

let initialized = false;

/**
 * 初始化远程曲库（server-admin 读配置 → server-net 拉取）。
 * 任一环节不可用（未配置）→ 保持内嵌曲库，返回 false。
 * 本模块整体仅在 server 构建中被引用（client 构建被 compile.define 常量
 * 折叠 + 死代码消除裁剪，故静态导入 @minecraft/server-admin 无副作用）。
 *
 * BDS 配置文件示例：
 *   config/default/variables.json  → { "pianoBackendUrl": "http://192.168.1.10:3000" }
 *   config/default/secrets.json    → { "pianoBackendToken": "Bearer xxxxx" }
 * （token 为 SecretString，脚本环境读不到值，请求时由 HttpHeader 解析；
 *   因无法拼接前缀，secrets 中需保存完整的 "Bearer <token>"）
 */
export async function initServerAdmin(): Promise<boolean> {
    if (initialized) return true;

    const url = variables.get(KEY_BACKEND_URL);
    if (typeof url !== "string" || !url) {
        console.warn(
            `[serverAdmin] 未配置 ${KEY_BACKEND_URL}（BDS config/default/variables.json），使用内嵌曲库`
        );
        return false;
    }

    const fetch = await getNetFetch();
    if (!fetch) return false;

    // SecretString 仅透传（作为 HttpHeader 值执行时解析），绝不读取/打印
    const token = secrets.get(KEY_BACKEND_TOKEN);
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