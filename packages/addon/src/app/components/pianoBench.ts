import { reportPianoError } from "@runtime/scope";
import { PIANO_BENCH_SIT_FORWARD } from "@data/pianoBench.generated";
import { RightOffsets } from "@domain/geometry/offsets";
import {
    BENCH_CARDINAL, PIANO_BENCH_SEAT, inspectP88Bench, p88BenchSeatPoint, removeP88BenchRemainder,
    resolveP88Bench, type P88BenchLocation,
} from "@platform/p88Bench";
import { EntityComponentTypes, system, world } from "@minecraft/server";
import type { Block, BlockCustomComponent, Dimension, Entity, Vector3 } from "@minecraft/server";

const BENCH = "pbe:piano_bench";
const SEAT = PIANO_BENCH_SEAT;
const CARDINAL = BENCH_CARDINAL;
const facingYaw = { north: 180, east: -90, south: 0, west: 90 };

interface OccupiedBench {
    entity: Entity;
    intact: () => boolean;
}

const occupied = new Map<string, OccupiedBench>();
let cleanupRun: number | undefined;

function benchKey(dimension: Dimension, { x, y, z }: Vector3): string {
    return `${dimension.id}:${x},${y},${z}`;
}

function p88Key({ dimension, origin, direction }: P88BenchLocation): string {
    return `p88:${benchKey(dimension, origin)}:${direction}`;
}

function seatFor(block: Block) {
    const { dimension, location } = block;
    if (block.typeId !== BENCH) {
        const p88 = resolveP88Bench(dimension, location, block.permutation);
        if (!p88) return;
        return {
            key: p88Key(p88),
            point: p88BenchSeatPoint(p88),
            yaw: facingYaw[p88.direction] > 0 ? facingYaw[p88.direction] - 180 : facingYaw[p88.direction] + 180,
            intact: () => inspectP88Bench(p88) === "intact",
        };
    }

    const direction = block.permutation.getState(CARDINAL) as keyof typeof facingYaw | undefined;
    if (!direction || !Object.hasOwn(facingYaw, direction)) return;
    const right = RightOffsets[direction];
    const forward = PIANO_BENCH_SIT_FORWARD / 16;
    return {
        key: benchKey(dimension, location),
        point: {
            x: location.x + .5 - right.z * forward,
            y: location.y,
            z: location.z + .5 + right.x * forward,
        },
        yaw: facingYaw[direction],
        intact: () => {
            const current = dimension.isChunkLoaded(location) ? dimension.getBlock(location) : undefined;
            return current?.typeId === BENCH && current.permutation.getState(CARDINAL) === direction;
        },
    };
}

function removeSeat(entity: Entity): boolean {
    try {
        if (entity.isValid) entity.remove();
        return true;
    } catch (error) {
        reportPianoError("pianoBench.removeSeat", error);
        return false;
    }
}

function releaseSeat(key: string) {
    const seat = occupied.get(key);
    if (seat && removeSeat(seat.entity)) occupied.delete(key);
}

function cleanup() {
    for (const [key, { entity, intact }] of occupied) {
        try {
            if (entity.isValid && entity.getComponent(EntityComponentTypes.Rideable)?.getRiders().length && intact()) continue;
        } catch (error) {
            reportPianoError("pianoBench.checkSeat", error);
        }
        if (removeSeat(entity)) occupied.delete(key);
    }
    if (!occupied.size && cleanupRun !== undefined) {
        system.clearRun(cleanupRun);
        cleanupRun = undefined;
    }
}

export const PianoBenchComponent: BlockCustomComponent = {
    onPlayerInteract({ block, player }) {
        if (!player || player.isSneaking || player.getComponent(EntityComponentTypes.Riding)) return;
        const seat = seatFor(block);
        if (!seat || occupied.has(seat.key) || !seat.intact()) return;
        const { key, point, yaw, intact } = seat;

        let entity: Entity | undefined;
        let mounted = false;
        try {
            entity = block.dimension.spawnEntity(SEAT, point, { initialRotation: yaw });
            // Claim the complete bench before mounting. A failed removal stays tracked for retry.
            occupied.set(key, { entity, intact });
            cleanupRun ??= system.runInterval(cleanup, 1);
            mounted = entity.getComponent(EntityComponentTypes.Rideable)?.addRider(player) === true;
            if (mounted) player.setRotation({ x: player.getRotation().x, y: yaw });
        } catch (error) {
            reportPianoError("pianoBench.mount", error);
        } finally {
            if (!mounted && entity && removeSeat(entity)) occupied.delete(key);
        }
    },
    onBreak({ block, brokenBlockPermutation }) {
        const { dimension, location } = block;
        const p88 = resolveP88Bench(dimension, location, brokenBlockPermutation);
        if (p88) {
            releaseSeat(p88Key(p88));
            // Player breaks award the item first via the native after-event.
            system.run(() => removeP88BenchRemainder(p88, false));
        } else {
            releaseSeat(benchKey(dimension, location));
        }
    },
};

export const P88BenchRecoveryComponent: BlockCustomComponent = {
    onTick({ block }) {
        // Repairs an orphan after an external block edit or a cross-chunk break.
        const p88 = resolveP88Bench(block.dimension, block.location, block.permutation);
        if (p88) removeP88BenchRemainder(p88, false);
    },
};

function removeUnownedSeat(entity: Entity) {
    // A P-88 carrier sits directly on a grid seam. Position alone cannot
    // identify the owning half, so check the id recorded at spawn.
    if (entity.isValid && !Array.from(occupied.values()).some(seat => seat.entity.id === entity.id)) removeSeat(entity);
}

// Transient seats disappear on chunk unload. Sweep any already-loaded seats
// on script restart, and reject carriers loaded without a matching session.
world.afterEvents.entityLoad.subscribe(({ entity }) => {
    if (entity.typeId === SEAT) system.run(() => removeUnownedSeat(entity));
});
world.afterEvents.worldLoad.subscribe(() => {
    const dimensions = new Set(["overworld", "nether", "the_end"].map(id => world.getDimension(id).id));
    for (const player of world.getAllPlayers()) dimensions.add(player.dimension.id);
    for (const id of dimensions) {
        for (const entity of world.getDimension(id).getEntities({ type: SEAT })) removeUnownedSeat(entity);
    }
});
