import { midiManager } from "@app/midi";
import { INSTALLED_VFX_PLUGINS } from "@app/vfx";
import { DEPLOYMENT_INFO } from "@app/vfx/deploymentInfo";
import { getNetFetch } from "@platform/server/net";
import { RemoteMidiSource } from "@platform/server/admin/netSource";
import { OnlineTranscribeClient } from "@platform/server/admin/transcribeClient";
import { world } from "@minecraft/server";
import { secrets, variables } from "@minecraft/server-admin";

/** variables.json 键名：后端地址（可读） */
export const KEY_BACKEND_URL = "pianoBackendUrl";
/** secrets.json 键名：Bearer 令牌（SecretString，整体透传 HttpHeader） */
export const KEY_BACKEND_TOKEN = "pianoBackendToken";

const LEGACY_CACHE_PREFIX = "midi_remote.";

let initialized = false;
let onlineTranscribe: OnlineTranscribeClient | undefined;

/** 游戏内点歌/转录导入用；后端未配置时返回 undefined。 */
export function getOnlineTranscribe(): OnlineTranscribeClient | undefined {
    return onlineTranscribe;
}

function clearLegacyRemoteCache(): number {
    const ids = world
        .getDynamicPropertyIds()
        .filter((id) => id.startsWith(LEGACY_CACHE_PREFIX));
    for (const id of ids) {
        world.setDynamicProperty(id);
    }
    if (ids.length > 0) {
        console.log(`[serverAdmin] 已清除旧版动态属性曲目缓存 ${ids.length} 条（${LEGACY_CACHE_PREFIX}*）`);
    }
    return ids.length;
}

export async function initServerAdmin(): Promise<boolean> {
    if (initialized) return true;

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

    const token = secrets.get(KEY_BACKEND_TOKEN);
    console.log(
        token
            ? "[serverAdmin] step3 已读取 secrets 令牌（SecretString，透传不输出值）"
            : "[serverAdmin] step3 未读取到 secrets 令牌（请求将不带 Authorization 头）"
    );
    const extraHeaders = token ? () => ({ Authorization: token }) : undefined;
    onlineTranscribe = new OnlineTranscribeClient({ baseUrl: url, fetch, extraHeaders });

    console.log(`[serverAdmin] step4 切换到远程曲库: ${url}`);
    const remote = new RemoteMidiSource({
        baseUrl: url,
        fetch,
        extraHeaders,
        onCatalogVersionChange: () => {
            midiManager.invalidateCache();
        },
    });
    midiManager.setSource(remote);
    void remote.reportLoaded({
        configHash: DEPLOYMENT_INFO.configHash,
        installedPlugins: INSTALLED_VFX_PLUGINS,
    }).catch(() => {});
    console.log(`[serverAdmin] 远程曲库已启用: ${url}`);
    initialized = true;
    return true;
}
