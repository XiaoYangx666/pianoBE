import { registerVfxPlugin, vfxRegistry, type VfxPluginModule } from "./host";

/** 零插件底包占位列表；装配插件时由 @piano/assembly 覆写本模块以静态加载已装配插件。 */
const ASSEMBLED_PLUGINS: readonly VfxPluginModule[] = [];

export const INSTALLED_VFX_PLUGINS: readonly string[] = [];

let registered = false;

/** 静态加载已装配的 VFX 插件。幂等且单个插件注册失败不影响其它插件或主流程。 */
export function registerVfxPlugins(): void {
    if (registered) return;
    registered = true;
    for (const plugin of ASSEMBLED_PLUGINS) {
        if (!vfxRegistry.hasPlugin(plugin.manifest.id)) {
            registerVfxPlugin(plugin, vfxRegistry);
        }
    }
}
