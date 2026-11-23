import { vfxRegistry, type VfxPluginModule, type VfxRegistry } from "@piano/vfx";
import { accentsPlugin } from "./accents/vfx";
import { atmospherePlugin } from "./atmosphere/vfx";
import { chinesePlugin } from "./chinese/vfx";
import { curvesPlugin } from "./curves/vfx";
import { keysPlugin } from "./keys/vfx";
import { stagePlugin } from "./stage/vfx";
import { themesPlugin } from "./themes/vfx";

export {
    accentsPlugin,
    atmospherePlugin,
    chinesePlugin,
    curvesPlugin,
    keysPlugin,
    stagePlugin,
    themesPlugin,
};

export const BUILTIN_PLUGINS: readonly VfxPluginModule[] = [
    atmospherePlugin,
    curvesPlugin,
    stagePlugin,
    keysPlugin,
    accentsPlugin,
    themesPlugin,
    chinesePlugin,
];

/** Idempotently registers all built-in plugins into the provided (or global) registry. */
export function registerBuiltinVfxPlugins(registry: VfxRegistry = vfxRegistry): void {
    for (const plugin of BUILTIN_PLUGINS) {
        if (!registry.hasPlugin(plugin.manifest.id)) {
            registry.registerPlugin(plugin);
        }
    }
}
