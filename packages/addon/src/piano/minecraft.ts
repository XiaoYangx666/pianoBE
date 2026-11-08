import { RuntimeScope } from "@begame/tabletop";
import { createMinecraftRuntime, createMinecraftPlatform, createMinecraftTextPort, type MinecraftEventHost } from "@begame/tabletop/minecraft";
import { system, world, TextPrimitive } from "@minecraft/server";

const clock = createMinecraftRuntime(system);
export const hostScope = new RuntimeScope(clock);
const platform = createMinecraftPlatform(hostScope, world, clock);
export const textPort = createMinecraftTextPort(hostScope, {
    create: (at, value) => new TextPrimitive(at, value),
    add: (text, anchor) => world.primitiveShapesManager.addText(text, anchor.dimension),
}, error => console.warn("[piano] 文字清理失败", error));
export const eventHost: MinecraftEventHost = {
    scope: hostScope, system, world,
    report: (boundary, error) => console.warn(`[piano] ${boundary}`, error),
    read: platform.read,
};
