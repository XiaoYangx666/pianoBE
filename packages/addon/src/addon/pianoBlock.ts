import { createBlockResourceEvents, createNativeDropSuppression } from "@begame/tabletop/minecraft";
import { eventHost } from "@piano/minecraft";
import { BlockCustomComponent, ExplosionBeforeEvent, GameMode, system, world } from "@minecraft/server";
import { openMidiPlayer } from "@midiPlayer/ui/playerUIManager";
import { openPiano } from "@piano/piano";
import { openPianoSettings } from "@piano/settingsUI";
import { pianoWorld } from "@piano/world";
import { GRAND_INTERACTION_CELLS, GRAND_RETIRED_CELLS } from "@instrument/grand.generated";
import { destroyInstrument, grandDefinition, instrumentBlockTypes, instrumentDestroyed, instrumentKey, instrumentPlaced, inspectInstrument, InstrumentLocation, resolveInstrument, resolveInstrumentSnapshot } from "@instrument/runtime";

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
        if (hit === "menu") void openPiano(e.player, e.block);
        else if (hit === "midi") void openMidiPlayer(e.player, e.block);
        else if (hit === "settings") void openPianoSettings(e.player, piano);
    },
};

const suppressNativeDrop = createNativeDropSuppression(eventHost);

export function regEvents() {
    interface PendingBreak {
        blasts: ExplosionBeforeEvent[];
    }
    const pending = new Map<string, PendingBreak>();

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

    instrumentPlaced.subscribe(({ dimension, pos }) => pending.delete(instrumentKey(dimension, pos)));
    instrumentDestroyed.subscribe(location => {
        const { dimension, pos } = location;
        pending.delete(instrumentKey(dimension, pos));
    });
    world.beforeEvents.playerBreakBlock.subscribe(e => {
        if (e.cancel) return;
        const location = resolveInstrument(e.block);
        // Wait for the partner rather than committing a partial break at a chunk edge.
        if (location && inspectInstrument(location) === "unloaded") e.cancel = true;
    });
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
    world.beforeEvents.explosion.subscribe(e => {
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
    });
}
