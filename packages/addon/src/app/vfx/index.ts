import { registerVfxCommands } from "./commands";
import { registerVfxRuntime } from "./runtime";

export function registerVfx() {
    registerVfxRuntime();
    registerVfxCommands();
}
