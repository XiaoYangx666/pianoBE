import { BUILTIN_PLUGINS } from "@piano/plugins";
import { createLogger } from "@runtime/log";
import { orderVfxPlugins, registerVfxPlugin, vfxRegistry } from "./host";

const log = createLogger("vfx");

export const INSTALLED_VFX_PLUGINS: readonly string[] = BUILTIN_PLUGINS.map(plugin => plugin.manifest.id);

let registered = false;

/** 静态加载已装配的 VFX 插件。幂等且单个插件注册失败不影响其它插件或主流程。 */
export function registerVfxPlugins() {
    if (registered) return;
    registered = true;
    for (const plugin of orderVfxPlugins(BUILTIN_PLUGINS)) {
        if (vfxRegistry.hasPlugin(plugin.manifest.id)) continue;
        try {
            registerVfxPlugin(plugin, vfxRegistry);
        } catch (error) {
            log.warn("注册 VFX 插件失败", error, { plugin: plugin.manifest?.id ?? "unknown" });
        }
    }
}
