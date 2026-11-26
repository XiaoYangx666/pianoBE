import { createLogger } from "@runtime/log";
import { registerVfxCommands } from "./commands";
import * as vfxHost from "./host";
import { registerVfxPlugins } from "./plugins";
import { registerVfxRuntime } from "./runtime";

export { INSTALLED_VFX_PLUGINS } from "./plugins";

const log = createLogger("vfx");

export function registerVfx() {
    if (!Object.keys(vfxHost).length) {
        log.warn("Host API 不可用");
    }
    registerVfxPlugins();
    registerVfxRuntime();
    registerVfxCommands();
}
