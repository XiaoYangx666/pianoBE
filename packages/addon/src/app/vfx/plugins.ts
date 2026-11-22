import { BUILTIN_PLUGINS } from "@piano/plugins";
import { registerVfxPlugin, vfxRegistry } from "./host";

export const INSTALLED_VFX_PLUGINS: readonly string[] = BUILTIN_PLUGINS.map(plugin => plugin.manifest.id);

let registered = false;

/** 静态加载已装配的 VFX 插件。幂等且单个插件注册失败不影响其它插件或主流程。 */
export function registerVfxPlugins() {
    if (registered) return;
    registered = true;
    for (const plugin of BUILTIN_PLUGINS) {
        if (vfxRegistry.hasPlugin(plugin.manifest.id)) continue;
        try {
            registerVfxPlugin(plugin, vfxRegistry);
        } catch (error) {
            console.warn(`[piano-vfx] 注册插件 ${plugin.manifest?.id ?? "unknown"} 失败`, error);
        }
    }
}
