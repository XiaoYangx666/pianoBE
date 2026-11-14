import { hostScope } from "@platform/host";
import { PianoScope } from "@runtime/scope";
import { ButtonState, InputButton, Player, Vector3, system, world } from "@minecraft/server";
import type { EntityLoadAfterEvent, PlayerButtonInputAfterEvent } from "@minecraft/server";
import { grandDefinition } from "@domain/instrument/definition";
import {
    destroyInstrument, inspectInstrument, instrumentDestroyed, instrumentKey, instrumentPlaced,
    type InstrumentLocation, resolveInstrument,
} from "@platform/assembly";
import { displayAnchor, PIANO_DISPLAY, pianoDisplayType, removeDormantDisplay, removePianoDisplay, SCORE_MOUNTED, SCORE_STAND_ENTITY } from "@platform/display";
import { hitsGrandPanel, pickScorePage, pickPianoKey, pickPianoMenu, pickPianoPanel, pianoEye, pianoRay } from "@domain/geometry/keyRay";
import { PianoRuntime, pianoCenter } from "@app/PianoRuntime";
import { playerSoundLayer } from "@app/playerSound";
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
            const isScore = entity.typeId === SCORE_STAND_ENTITY;
            if (!isScore && entity.typeId !== PIANO_DISPLAY && entity.typeId !== grandDefinition.displayId) return;
            system.run(() => {
                if (!entity.isValid) return;
                const pos = displayAnchor(entity);
                if (!pos || (isScore && entity.getProperty(SCORE_MOUNTED) !== true)) { removePianoDisplay(entity); return; }
                const dimension = entity.dimension;
                if (!dimension.isChunkLoaded(pos)) return;
                const block = dimension.getBlock(pos);
                const location = block && resolveInstrument(block);
                if (!location || (!isScore && pianoDisplayType(location) !== entity.typeId) ||
                    location.pos.x !== pos.x || location.pos.y !== pos.y || location.pos.z !== pos.z) {
                    removePianoDisplay(entity);
                    return;
                }
                const integrity = inspectInstrument(location);
                if (integrity === "incomplete") { removePianoDisplay(entity); return; }
                if (integrity === "unloaded" || !this.isNear(location)) return;
                const current = this.get(location);
                const activeId = isScore ? current?.scoreId : current?.displayId;
                if ((activeId || (isScore && current?.settings?.scoreMounted === false)) &&
                    activeId !== entity.id && entity.isValid) removePianoDisplay(entity);
            });
        };
        world.afterEvents.entityLoad.subscribe(onEntityLoad);
        this.scope.own("entityLoad", () => world.afterEvents.entityLoad.unsubscribe(onEntityLoad));
        const onScoreInput = ({ player, button, newButtonState }: PlayerButtonInputAfterEvent) => {
            if (button === InputButton.Sneak && newButtonState === ButtonState.Pressed) this.turnScoreFromView(player);
        };
        world.afterEvents.playerButtonInput.subscribe(onScoreInput);
        this.scope.own("scoreInput", () => world.afterEvents.playerButtonInput.unsubscribe(onScoreInput));
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
            piano.playKey(midi, playerSoundLayer(player, piano));
            return "key";
        }
        const grand = !piano.hasScreen;
        const page = piano.scoreId ? pickScorePage(ray, grand) : undefined;
        if (page) {
            piano.turnScore(page.spread);
            return "score";
        }
        if (grand) return hitsGrandPanel(ray) ? "panel" : undefined;
        const button = pickPianoMenu(ray, 4, piano.hitModel);
        if (button) return button;
        // 触屏玩家常点在模型空档上，完全没命中琴体盒时也开面板。
        return pickPianoPanel(ray, 4, piano.hitModel) === "case" ? undefined : "panel";
    }

    private turnScoreFromView(player: Player) {
        const dimension = player.dimension;
        const head = player.getHeadLocation();
        const view = player.getViewDirection();
        let target: { piano: PianoRuntime; spread: 0 | 1; distance: number } | undefined;
        for (const piano of this.pianos.values()) {
            if (piano.location.dimension.id !== dimension.id || Math.abs(head.x - piano.center.x) > 5 ||
                Math.abs(head.z - piano.center.z) > 5 || !piano.scoreId) continue;
            const ray = pianoRay(piano.center, piano.right, head, view);
            const page = pickScorePage(ray, !piano.hasScreen, target?.distance ?? 4);
            if (page) target = { piano, ...page };
        }
        if (!target || target.piano.verify(system.currentTick) !== "complete") return;
        // The zero-hitbox stand can be read against open air. Check world
        // occlusion independently of the cabinet's precise boxes above.
        const obstacle = dimension.getBlockFromRay(pianoEye(head), view, { maxDistance: target.distance });
        if (obstacle) {
            const owner = resolveInstrument(obstacle.block);
            const { location } = target.piano;
            if (!owner || instrumentKey(owner.dimension, owner.pos) !== instrumentKey(location.dimension, location.pos)) return;
        }
        if (this.beginInteraction(player)) target.piano.turnScore(target.spread);
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
                if (integrity === "incomplete") {
                    // 被外部破坏成残缺组合时，先把内置音乐/卡片退出来再清理显示实体。
                    try { destroyInstrument(piano.location, false); } catch { /* 稍后重试 */ }
                    this.unload(piano.location, true);
                } else if (integrity === "unloaded") this.unload(piano.location, false);
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
                if (integrity === "incomplete") {
                    try { destroyInstrument(piano.location, false); } catch { /* 稍后重试 */ }
                    this.unload(piano.location, true);
                }
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
