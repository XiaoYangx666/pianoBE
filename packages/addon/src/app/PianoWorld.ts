import { hostScope } from "@platform/host";
import { PianoScope } from "@runtime/scope";
import { Player, Vector3, system, world } from "@minecraft/server";
import type { EntityLoadAfterEvent } from "@minecraft/server";
import { grandDefinition } from "@domain/instrument/definition";
import {
    destroyInstrument, inspectInstrument, instrumentDestroyed, instrumentKey, instrumentPlaced,
    type InstrumentLocation, resolveInstrument,
} from "@platform/assembly";
import { displayAnchor, PIANO_DISPLAY, pianoDisplayType, removeDormantDisplay, removePianoDisplay } from "@platform/display";
import { pickPianoKey, pickPianoMenu, pianoRay } from "@domain/geometry/keyRay";
import { PianoRuntime, pianoCenter } from "@app/PianoRuntime";
import { SWEEP_INTERVAL, UNLOAD_GRACE, VIEW_RANGE_SQUARED } from "@app/pianoConfig";

class PianoWorld {
    private readonly pianos = new Map<string, PianoRuntime>();
    private readonly active = new Set<PianoRuntime>();
    private nearby = new Map<string, Vector3[]>();
    private inputTick = -1;
    private readonly handled = new Set<string>();
    private readonly scope = new PianoScope(hostScope, "world");

    constructor() {
        this.scope.own("placed", instrumentPlaced.subscribe(location => this.get(location)));
        this.scope.own("destroyed", instrumentDestroyed.subscribe(location => this.unload(location, true)));
        this.scope.interval(SWEEP_INTERVAL, () => this.sweep());
        this.scope.interval(1, () => this.tick());
        const onEntityLoad = ({ entity }: EntityLoadAfterEvent) => {
            if (entity.typeId !== PIANO_DISPLAY && entity.typeId !== grandDefinition.displayId) return;
            system.run(() => {
                if (!entity.isValid) return;
                const pos = displayAnchor(entity);
                if (!pos) { removePianoDisplay(entity); return; }
                const dimension = entity.dimension;
                if (!dimension.isChunkLoaded(pos)) return;
                const block = dimension.getBlock(pos);
                const location = block && resolveInstrument(block);
                if (!location || pianoDisplayType(location) !== entity.typeId ||
                    location.pos.x !== pos.x || location.pos.y !== pos.y || location.pos.z !== pos.z) {
                    removePianoDisplay(entity);
                    return;
                }
                const integrity = inspectInstrument(location);
                if (integrity === "incomplete") { removePianoDisplay(entity); return; }
                if (integrity === "unloaded" || !this.isNear(location)) return;
                const current = this.get(location);
                if (current?.displayId && current.displayId !== entity.id && entity.isValid) removePianoDisplay(entity);
            });
        };
        world.afterEvents.entityLoad.subscribe(onEntityLoad);
        this.scope.own("entityLoad", () => world.afterEvents.entityLoad.unsubscribe(onEntityLoad));
    }

    get(location: InstrumentLocation): PianoRuntime | undefined {
        const key = instrumentKey(location.dimension, location.pos);
        let piano = this.pianos.get(key);
        if (piano && (!piano.isAlive() || piano.location.direction !== location.direction ||
            pianoDisplayType(piano.location) !== pianoDisplayType(location))) {
            this.unload(piano.location, true);
            piano = undefined;
        }
        const tick = system.currentTick;
        if (!piano) {
            const runtime = new PianoRuntime(location, () => this.active.add(runtime));
            if (runtime.verify(tick) !== "complete") {
                runtime.dispose(false);
                return;
            }
            this.pianos.set(key, runtime);
            piano = runtime;
        } else if (piano.verify(tick) !== "complete") {
            return;
        }
        piano.lastNearby = tick;
        piano.ensureVisual(tick);
        return piano;
    }

    blockTick(location: InstrumentLocation) {
        if (!this.isNear(location)) return;
        const piano = this.get(location);
        if (!piano && inspectInstrument(location) === "incomplete") destroyInstrument(location, false);
    }

    beginInteraction(player: Player) {
        if (this.inputTick !== system.currentTick) {
            this.inputTick = system.currentTick;
            this.handled.clear();
        }
        if (this.handled.has(player.id)) return false;
        this.handled.add(player.id);
        return true;
    }

    interactFromView(player: Player, piano: PianoRuntime) {
        const ray = pianoRay(piano.center, piano.right, player.getHeadLocation(), player.getViewDirection());
        const midi = pickPianoKey(ray, 4, midi => piano.isKeyDown(midi), piano.hitModel);
        if (midi !== undefined) {
            piano.playKey(midi);
            return "key";
        }
        return pickPianoMenu(ray, 4, piano.hitModel);
    }

    private isNear({ dimension, pos }: InstrumentLocation) {
        return this.nearby.get(dimension.id)?.some(player =>
            (player.x - pos.x) ** 2 + (player.y - pos.y) ** 2 + (player.z - pos.z) ** 2 <= VIEW_RANGE_SQUARED
        ) ?? false;
    }

    private unload(location: InstrumentLocation, removeVisual: boolean) {
        const { dimension, pos } = location;
        const key = instrumentKey(dimension, pos);
        const piano = this.pianos.get(key);
        if (!piano) {
            if (removeVisual) {
                try {
                    removeDormantDisplay(location, pianoCenter(location));
                } catch (error) {
                    console.warn("[piano] 清理显示实体失败", error);
                }
            }
            return;
        }
        this.pianos.delete(key);
        this.active.delete(piano);
        try {
            piano.dispose(removeVisual);
        } catch (error) {
            console.warn("[piano] 运行时卸载失败", error);
        }
    }

    private sweep() {
        const nearby = new Map<string, Vector3[]>();
        for (const player of world.getAllPlayers()) {
            const id = player.dimension.id;
            const group = nearby.get(id) ?? [];
            group.push(player.location);
            nearby.set(id, group);
        }
        this.nearby = nearby;
        const tick = system.currentTick;
        for (const piano of this.pianos.values()) {
            try {
                const integrity = piano.verify(tick);
                if (integrity === "incomplete") this.unload(piano.location, true);
                else if (integrity === "unloaded") this.unload(piano.location, false);
                else {
                    if (this.isNear(piano.location)) {
                        piano.lastNearby = tick;
                        piano.ensureVisual(tick);
                    } else if (tick - piano.lastNearby >= UNLOAD_GRACE) {
                        this.unload(piano.location, false);
                        continue;
                    }
                    piano.checkpoint();
                    piano.refreshScreen();
                }
            } catch (error) {
                console.warn("[piano] 钢琴运行时扫描失败", error);
                try {
                    this.unload(piano.location, false);
                } catch (cleanupError) {
                    console.warn("[piano] 运行时清理失败", cleanupError);
                }
            }
        }
    }

    private tick() {
        const tick = system.currentTick;
        const now = Date.now();
        for (const piano of this.active) {
            try {
                const integrity = piano.verify(tick);
                if (integrity === "incomplete") this.unload(piano.location, true);
                else if (integrity === "unloaded") piano.holdPlaybackClock(now);
                else if (!piano.tick(tick, now)) this.active.delete(piano);
            } catch (error) {
                console.warn("[piano] 钢琴运行时更新失败", error);
                // Rebuild from the assembly on the next interaction/sweep instead
                // of leaving a runtime that is loaded but no longer ticked.
                try {
                    this.unload(piano.location, false);
                } catch (cleanupError) {
                    console.warn("[piano] 运行时清理失败", cleanupError);
                }
            }
        }
    }

    debugDump() {
        return [`Piano runtime: ${this.pianos.size} loaded, ${this.active.size} active`,
            ...Array.from(this.pianos.values(), piano => piano.describe())].join("\n");
    }
}

export const pianoWorld = new PianoWorld();
