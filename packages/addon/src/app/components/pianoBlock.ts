import { createBlockResourceEvents, createNativeDropSuppression } from "@begame/tabletop/minecraft";
import { eventHost } from "@platform/host";
import { PianoScope } from "@runtime/scope";
import { BlockCustomComponent, ExplosionBeforeEvent, GameMode, system, world } from "@minecraft/server";
import type { PlayerBreakBlockBeforeEvent } from "@minecraft/server";
import { openMidiPlayer } from "@app/ui/midi/playerUI";
import { openPiano } from "@app/ui/piano";
import { openPianoSettings } from "@app/ui/settingsUI";
import { pianoWorld } from "@app/PianoWorld";
import { GRAND_INTERACTION_CELLS, GRAND_RETIRED_CELLS } from "@data/grand.generated";
import { grandDefinition, instrumentBlockTypes } from "@domain/instrument/definition";
import { destroyInstrument, instrumentDestroyed, instrumentKey, instrumentPlaced, inspectInstrument, InstrumentLocation, resolveInstrument, resolveInstrumentSnapshot } from "@platform/assembly";

const grandInteractionCells = new Set<string>(GRAND_INTERACTION_CELLS);
const grandRetiredCells = new Set<string>(GRAND_RETIRED_CELLS);

export const PianoBlockComponent: BlockCustomComponent = {
    onTick({ block }) {
        if (grandRetiredCells.has(block.typeId)) {
            block.setType("minecraft:air");
            return;
        }
        const location = resolveInstrument(block);
        if (location) pianoWorld.blockTick(location);
    },
    onBreak(e) {
        // Player breaks are handled by the native after-event. This also
        // catches pistons and destroy-mode commands without dropping a module.
        const location = resolveInstrumentSnapshot(e.block.dimension, e.block.location, e.brokenBlockPermutation);
        if (location) system.run(() => {
            if (inspectInstrument(location) === "incomplete") destroyInstrument(location, true);
        });
    },
    onPlayerInteract(e) {
        if (!e.player) return;
        const location = resolveInstrument(e.block);
        if (!location) return;
        if (location.definition === grandDefinition && !grandInteractionCells.has(e.block.typeId)) return;
        if (!pianoWorld.beginInteraction(e.player)) return;
        const piano = pianoWorld.get(location);
        if (!piano) return;
        const hit = pianoWorld.interactFromView(e.player, piano);
        if (hit === "midi") void openMidiPlayer(e.player, e.block);
        else if (hit === "settings") void openPianoSettings(e.player, piano);
        else if (hit === "menu" || hit === "panel") void openPiano(e.player, e.block);
    },
};

const suppressNativeDrop = createNativeDropSuppression(eventHost);

export function regEvents() {
    interface PendingBreak {
        blasts: ExplosionBeforeEvent[];
    }
    const pending = new Map<string, PendingBreak>();
    const scope = new PianoScope(eventHost.scope, "events");

    function queueBreak(location: InstrumentLocation): PendingBreak {
        const key = instrumentKey(location.dimension, location.pos);
        const existing = pending.get(key);
        if (existing) return existing;
        const request: PendingBreak = { blasts: [] };
        pending.set(key, request);
        system.run(() => {
            // Placement and destruction both invalidate work for the old assembly.
            if (pending.get(key) !== request) return;
            pending.delete(key);
            if (request.blasts.some(event => !event.cancel)) {
                destroyInstrument(location, true);
            }
        });
        return request;
    }

    scope.own("placed", instrumentPlaced.subscribe(({ dimension, pos }) => pending.delete(instrumentKey(dimension, pos))));
    scope.own("destroyed", instrumentDestroyed.subscribe(location => {
        const { dimension, pos } = location;
        pending.delete(instrumentKey(dimension, pos));
    }));
    const onBreakBlock = (e: PlayerBreakBlockBeforeEvent) => {
        if (e.cancel) return;
        const location = resolveInstrument(e.block);
        // Wait for the partner rather than committing a partial break at a chunk edge.
        if (location && inspectInstrument(location) === "unloaded") e.cancel = true;
    };
    world.beforeEvents.playerBreakBlock.subscribe(onBreakBlock);
    scope.own("playerBreakBlock", () => world.beforeEvents.playerBreakBlock.unsubscribe(onBreakBlock));
    const blockEvents = createBlockResourceEvents(eventHost, suppressNativeDrop);
    blockEvents.register({
        blockTypes: instrumentBlockTypes,
        boundary: "piano",
        broken: (e, suppressDrop) => {
            const location = resolveInstrumentSnapshot(e.dimension, e.block.location, e.brokenBlockPermutation);
            if (!location) return;
            const drop = e.player.getGameMode() === GameMode.Survival || e.player.getGameMode() === GameMode.Adventure;
            if (drop && e.itemStackBeforeBreak?.getComponent("minecraft:enchantable")?.getEnchantment("silk_touch")) suppressDrop();
            if (inspectInstrument(location) === "incomplete") destroyInstrument(location, drop);
        },
    });
    blockEvents.start();
    const onExplosion = (e: ExplosionBeforeEvent) => {
        if (e.cancel || e.source?.typeId === "minecraft:wind_charge_projectile") return;
        const assemblies = new Map<string, InstrumentLocation>();
        const rest = e.getImpactedBlocks().filter(block => {
            const location = resolveInstrument(block);
            if (!location) return true;
            assemblies.set(instrumentKey(location.dimension, location.pos), location);
            return false;
        });
        if (!assemblies.size) return;
        e.setImpactedBlocks(rest);
        for (const location of assemblies.values()) queueBreak(location).blasts.push(e);
    };
    world.beforeEvents.explosion.subscribe(onExplosion);
    scope.own("explosion", () => world.beforeEvents.explosion.unsubscribe(onExplosion));
}
