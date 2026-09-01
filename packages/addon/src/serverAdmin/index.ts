import { midiManager, useRemotePlaylist } from "@midiPlayer";
import { getNetFetch } from "@serverNet";
import { CachedRemoteSource } from "./netSource";
import { RemotePlaylistFacade } from "./remotePlaylist";
import { world } from "@minecraft/server";
import { secrets, variables } from "@minecraft/server-admin";

/** variables.json 键名：后端地址（可读） */
export const KEY_BACKEND_URL = "pianoBackendUrl";
/** secrets.json 键名：Bearer 令牌（SecretString，整体透传 HttpHeader） */
export const KEY_BACKEND_TOKEN = "pianoBackendToken";

/** 旧版远程曲目缓存的世界动态属性键前缀（现已改为纯内存缓存） */
const LEGACY_CACHE_PREFIX = "midi_remote.";

let initialized = false;

/** 清除旧版遗留的动态属性曲目缓存键（midi_remote.*），避免永久占用世界存档 */
function clearLegacyRemoteCache(): number {
    const ids = world
        .getDynamicPropertyIds()
        .filter((id) => id.startsWith(LEGACY_CACHE_PREFIX));
    for (const id of ids) {
        world.setDynamicProperty(id); // 置 undefined 即删除
    }
    if (ids.length > 0) {
        console.log(`[serverAdmin] 已清除旧版动态属性曲目缓存 ${ids.length} 条（${LEGACY_CACHE_PREFIX}*）`);
    }
    return ids.length;
}

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

    // 旧版曾往世界动态属性写曲目缓存，现改为纯内存缓存：启动即清理遗留键
    clearLegacyRemoteCache();

    const url = variables.get(KEY_BACKEND_URL);
    console.log(`[serverAdmin] step1 读取配置 ${KEY_BACKEND_URL} = ${typeof url === "string" && url ? `"${url}"` : "(未配置)"}`);
    if (typeof url !== "string" || !url) {
        console.warn(
            `[serverAdmin] 未配置 ${KEY_BACKEND_URL}（BDS config/default/variables.json），使用内嵌曲库`
        );
        return false;
    }

    console.log("[serverAdmin] step2 获取 @minecraft/server-net 适配器");
    const fetch = await getNetFetch();
    if (!fetch) {
        console.warn("[serverAdmin] @minecraft/server-net 不可用（getNetFetch 返回 null），使用内嵌曲库");
        return false;
    }
    console.log("[serverAdmin] @minecraft/server-net 适配器就绪");

    // SecretString 仅透传（作为 HttpHeader 值执行时解析），绝不读取/打印
    const token = secrets.get(KEY_BACKEND_TOKEN);
    console.log(
        token
            ? "[serverAdmin] step3 已读取 secrets 令牌（SecretString，透传不输出值）"
            : "[serverAdmin] step3 未读取到 secrets 令牌（请求将不带 Authorization 头）"
    );
    const extraHeaders = token ? () => ({ Authorization: token }) : undefined;

    console.log(`[serverAdmin] step4 切换到远程曲库: ${url}`);
    midiManager.setSource(
        new CachedRemoteSource({
            baseUrl: url,
            fetch,
            extraHeaders,
        })
    );

    // server 构建：播放列表切换为后端纯前端（零本地存储）
    useRemotePlaylist(new RemotePlaylistFacade(url, fetch, extraHeaders));
    console.log("[serverAdmin] 播放列表已切换为后端远程实现（零本地存储）");
    console.log(`[serverAdmin] 远程曲库已启用: ${url}`);
    initialized = true;
    return true;
}