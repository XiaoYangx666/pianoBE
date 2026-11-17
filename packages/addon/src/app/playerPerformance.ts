import type { PianoRuntime } from "@app/PianoRuntime";
import { PIANO_BENCH_SEAT } from "@platform/benchSeat";
import { reportPianoError } from "@runtime/scope";
import { system } from "@minecraft/server";
import type { Player } from "@minecraft/server";

export const MIDI_PERFORMANCE_INTERVAL = 5;
const IDLE_TICKS = 30;
const CHECK_INTERVAL = 4;
const CONTROLLER = "pbe:performer";
const HAND_SPAN = 5.5;
const MIN_FACING_DOT = Math.cos(20 * Math.PI / 180);
const STANDING_FACING_DOT = Math.cos(16 * Math.PI / 180);
const STANDING_SIDE_LIMIT = 6.4;

interface Performance {
    player: Player;
    piano: PianoRuntime;
    stopAt: number;
    seated: boolean;
    checkRun?: number;
    detach?: () => void;
}

const performing = new Map<string, Performance>();

function facingPiano(yawDegrees: number, right: PianoRuntime["right"]) {
    const yaw = yawDegrees * Math.PI / 180;
    return -(Math.sin(yaw) * right.z + Math.cos(yaw) * right.x);
}

function playingPosition(player: Player, piano: PianoRuntime) {
    if (!player.isValid || player.dimension.id !== piano.location.dimension.id) return;
    const mount = player.getComponent("minecraft:riding")?.entityRidingOn;
    if (mount ? mount.typeId !== PIANO_BENCH_SEAT
        : !player.isOnGround || player.isSneaking || player.isSwimming || player.isGliding) return;

    const origin = mount?.location ?? player.location;
    const { center, right, hitModel } = piano;
    const dx = origin.x - center.x;
    const dz = origin.z - center.z;
    const localX = -16 * (right.x * dx + right.z * dz);
    const localZ = 16 * (right.z * dx - right.x * dz);
    const [leftEdge, , front, rightEdge] = hitModel.keyboard;
    const gap = (front - localZ) / 16;
    // The arm cycle is fitted at keyboard height and reaches about half a block.
    const minGap = mount ? .37 : .29;
    const maxGap = mount ? .54 : .56;
    if (gap < minGap || gap > maxGap || Math.abs(origin.y - center.y) > .06
        || localX < leftEdge + HAND_SPAN || localX > rightEdge - HAND_SPAN
        || (!mount && Math.abs(localX) > STANDING_SIDE_LIMIT)) return;

    if (facingPiano(player.getRotation().y, right) < (mount ? MIN_FACING_DOT : STANDING_FACING_DOT)) return;
    return { seated: mount !== undefined, distance: Math.hypot(dx, dz) };
}

function stop(id: string, performance: Performance) {
    if (performing.get(id) !== performance) return;
    performing.delete(id);
    performance.detach?.();
    if (performance.checkRun !== undefined) system.clearRun(performance.checkRun);
    try {
        if (performance.player.isValid) {
            performance.player.playAnimation("animation.pbe.performer.release", {
                controller: CONTROLLER,
                blendOutTime: .25,
                stopExpression: "query.all_animations_finished",
            });
        }
    } catch (error) {
        reportPianoError("playerPerformance.release", error);
    }
}

function scheduleCheck(id: string, performance: Performance, delay: number) {
    performance.checkRun = system.runTimeout(() => check(id, performance), delay);
}

function check(id: string, performance: Performance) {
    if (performing.get(id) !== performance) return;
    performance.checkRun = undefined;
    const { player, piano, stopAt } = performance;
    const remaining = stopAt - system.currentTick;
    try {
        const position = playingPosition(player, piano);
        if (remaining > 0 && position
            && piano.isAlive() && piano.verify(system.currentTick) === "complete"
            && position.seated === performance.seated) {
            scheduleCheck(id, performance, Math.min(remaining, CHECK_INTERVAL));
            return;
        }
    } catch (error) {
        reportPianoError("playerPerformance.check", error);
    }
    stop(id, performance);
}

function bindPiano(id: string, performance: Performance, piano: PianoRuntime) {
    performance.detach?.();
    performance.piano = piano;
    performance.detach = piano.onDispose(() => stop(id, performance));
}

function play(player: Player, ticks: number, piano: PianoRuntime, seated: boolean) {
    if (!player.isValid || !piano.isAlive()) return;
    const stopAt = system.currentTick + ticks;
    const current = performing.get(player.id);
    if (current && current.seated === seated) {
        // Refresh the deadline without restarting either arm.
        current.player = player;
        current.stopAt = current.piano === piano ? Math.max(current.stopAt, stopAt) : stopAt;
        if (current.piano !== piano) bindPiano(player.id, current, piano);
        return;
    }

    const animation = seated ? "animation.pbe.performer.midi" : "animation.pbe.performer.play";
    player.playAnimation(animation, {
        controller: CONTROLLER,
        blendOutTime: .25,
        stopExpression: "0.0",
    });
    if (current) {
        current.player = player;
        if (current.piano !== piano) bindPiano(player.id, current, piano);
        current.stopAt = stopAt;
        current.seated = seated;
        return;
    }
    const id = player.id;
    const performance: Performance = { player, piano, stopAt, seated };
    performing.set(id, performance);
    bindPiano(id, performance, piano);
    scheduleCheck(id, performance, CHECK_INTERVAL);
}

function signalNote(player: Player, mask: number) {
    if (!mask) return;
    // This animation writes press times and leaves the pose controller running.
    const left = mask & 2 ? 2 : mask & 1 ? 1 : 0;
    const right = mask & 8 ? 2 : mask & 4 ? 1 : 0;
    player.playAnimation(`animation.pbe.performer.note.${left}${right}`, {
        controller: "pbe:performer_notes",
        stopExpression: "query.all_animations_finished",
    });
}

export function animatePianoPress(player: Player, piano: PianoRuntime, hands: number) {
    try {
        const position = playingPosition(player, piano);
        if (!position) return;
        play(player, IDLE_TICKS, piano, position.seated);
        signalNote(player, hands);
    } catch (error) {
        reportPianoError("playerPerformance.manual", error);
    }
}

export function animateMidiPerformance(piano: PianoRuntime, hands: number) {
    try {
        const nearby = piano.location.dimension.getPlayers({ location: piano.center, maxDistance: 2 });
        let performer: { player: Player; seated: boolean; distance: number } | undefined;
        for (const player of nearby) {
            const position = playingPosition(player, piano);
            if (!position) continue;
            if (!performer || (position.seated && !performer.seated)
                || (position.seated === performer.seated && position.distance < performer.distance)) {
                performer = { player, ...position };
            }
        }
        if (!performer) return;
        play(performer.player, MIDI_PERFORMANCE_INTERVAL + 2, piano, performer.seated);
        signalNote(performer.player, hands);
    } catch (error) {
        reportPianoError("playerPerformance.midi", error);
    }
}
