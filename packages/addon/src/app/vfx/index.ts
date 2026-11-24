import { registerVfxCommands } from "./commands";
import * as vfxHost from "./host";
import { registerVfxPlugins } from "./plugins";
import { registerVfxRuntime } from "./runtime";

export { INSTALLED_VFX_PLUGINS } from "./plugins";

export function registerVfx() {
    if (!Object.keys(vfxHost).length) {
        console.warn("[piano-vfx] Host API 不可用");
    }
    registerVfxPlugins();
    registerVfxRuntime();
    registerVfxCommands();
}
