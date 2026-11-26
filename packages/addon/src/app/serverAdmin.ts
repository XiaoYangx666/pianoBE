import { midiManager } from "@app/midi";
import { INSTALLED_VFX_PLUGINS } from "@app/vfx";
import { DEPLOYMENT_INFO } from "@app/vfx/deploymentInfo";
import { getNetFetch } from "@platform/server/net";
import { RemoteMidiSource } from "@platform/server/admin/netSource";
import type { NetFetch } from "@platform/server/admin/netSource";
import { world } from "@minecraft/server";
import { secrets, variables } from "@minecraft/server-admin";
import { createLogger } from "@runtime/log";

const log = createLogger("server");

/** variables.json 键名：后端地址（可读） */
export const KEY_BACKEND_URL = "pianoBackendUrl";
/** secrets.json 键名：Bearer 令牌（SecretString，整体透传 HttpHeader） */
export const KEY_BACKEND_TOKEN = "pianoBackendToken";

/** 已配置的后端连接信息；服务器版可选功能复用它，避免各建一套 fetch/令牌。 */
export interface ServerBackend {
    baseUrl: string;
    fetch: NetFetch;
    extraHeaders?: () => Record<string, unknown>;
}

const LEGACY_CACHE_PREFIX = "midi_remote.";

let initialized = false;
let backend: ServerBackend | undefined;

function clearLegacyRemoteCache(): number {
    const ids = world
        .getDynamicPropertyIds()
        .filter((id) => id.startsWith(LEGACY_CACHE_PREFIX));
    for (const id of ids) {
        world.setDynamicProperty(id);
    }
    if (ids.length > 0) {
        log.info("已清除旧版远程曲目缓存", { count: ids.length, prefix: LEGACY_CACHE_PREFIX });
    }
    return ids.length;
}

export async function initServerAdmin(): Promise<ServerBackend | undefined> {
    if (initialized) return backend;

    clearLegacyRemoteCache();

    const url = variables.get(KEY_BACKEND_URL);
    if (typeof url !== "string" || !url) {
        log.warn("未配置后端地址，使用内嵌曲库", { key: KEY_BACKEND_URL });
        return undefined;
    }
    log.debug("读取后端配置", { url });

    const fetch = await getNetFetch();
    if (!fetch) {
        log.warn("@minecraft/server-net 不可用，使用内嵌曲库");
        return undefined;
    }

    const token = secrets.get(KEY_BACKEND_TOKEN);
    log.debug(token ? "已读取后端令牌" : "未配置后端令牌，请求将不带 Authorization");
    const extraHeaders = token ? () => ({ Authorization: token }) : undefined;
    backend = { baseUrl: url, fetch, extraHeaders };

    log.info("已切换到远程曲库", { url });
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
    }).catch(error => log.warn("上报加载状态失败", error, { url }));
    initialized = true;
    return backend;
}
