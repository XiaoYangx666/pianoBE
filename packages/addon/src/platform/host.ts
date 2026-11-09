import { RuntimeScope } from "@begame/tabletop";
import { createMinecraftRuntime, createMinecraftPlatform, createMinecraftTextPort, type MinecraftEventHost } from "@begame/tabletop/minecraft";
import { system, world, TextPrimitive } from "@minecraft/server";
import { reportPianoError } from "@runtime/scope";

const clock = createMinecraftRuntime(system);
export const hostScope = new RuntimeScope(clock, undefined, undefined,
    error => reportPianoError("host", error));
const platform = createMinecraftPlatform(hostScope, world, clock);
export const textPort = createMinecraftTextPort(hostScope, {
    create: (at, value) => new TextPrimitive(at, value),
    add: (text, anchor) => world.primitiveShapesManager.addText(text, anchor.dimension),
}, error => reportPianoError("text", error));
export const eventHost: MinecraftEventHost = {
    scope: hostScope, system, world,
    report: reportPianoError,
    read: platform.read,
};
