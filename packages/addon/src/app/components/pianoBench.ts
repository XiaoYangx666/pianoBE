import { createMinecraftSeats, type createBlockResourceEvents, type MinecraftSeatTarget } from "@begame/minecraft";
import { PianoScope, reportPianoError } from "@runtime/scope";
import { eventHost } from "@platform/host";
import { PIANO_BENCH_SIT_FORWARD } from "@data/pianoBench.generated";
import { RightOffsets } from "@domain/geometry/offsets";
import { PIANO_BENCH_SEAT as SEAT } from "@platform/benchSeat";
import {
    BENCH_CARDINAL, inspectP88Bench, P88_BENCH_BLOCKS, p88BenchSeatPoint, removeP88BenchRemainder,
    resolveP88Bench, type P88BenchLocation,
} from "@platform/p88Bench";
import { GameMode, system, world } from "@minecraft/server";
import type { Block, BlockCustomComponent, Dimension, PlayerBreakBlockBeforeEvent, Vector3 } from "@minecraft/server";

const BENCH = "pbe:piano_bench";
const CARDINAL = BENCH_CARDINAL;
const facingYaw = { north: 180, east: -90, south: 0, west: 90 };

const seats = createMinecraftSeats(eventHost, { entityType: SEAT, hideMountHealth: true });

function benchKey(dimension: Dimension, { x, y, z }: Vector3): string {
    return `${dimension.id}:${x},${y},${z}`;
}

function p88Key({ dimension, origin, direction }: P88BenchLocation): string {
    return `p88:${benchKey(dimension, origin)}:${direction}`;
}

function seatFor(block: Block): MinecraftSeatTarget | undefined {
    const { dimension, location } = block;
    if (block.typeId !== BENCH) {
        const p88 = resolveP88Bench(dimension, location, block.permutation);
        if (!p88) return;
        return {
            key: p88Key(p88),
            dimension,
            position: p88BenchSeatPoint(p88),
            yaw: facingYaw[p88.direction] > 0 ? facingYaw[p88.direction] - 180 : facingYaw[p88.direction] + 180,
            isIntact: () => inspectP88Bench(p88) === "intact",
        };
    }

    const direction = block.permutation.getState(CARDINAL) as keyof typeof facingYaw | undefined;
    if (!direction || !Object.hasOwn(facingYaw, direction)) return;
    const right = RightOffsets[direction];
    const forward = PIANO_BENCH_SIT_FORWARD / 16;
    return {
        key: benchKey(dimension, location),
        dimension,
        position: {
            x: location.x + .5 - right.z * forward,
            y: location.y,
            z: location.z + .5 + right.x * forward,
        },
        yaw: facingYaw[direction],
        isIntact: () => {
            const current = dimension.isChunkLoaded(location) ? dimension.getBlock(location) : undefined;
            return current?.typeId === BENCH && current.permutation.getState(CARDINAL) === direction;
        },
    };
}

export const PianoBenchComponent: BlockCustomComponent = {
    onPlayerInteract({ block, player }) {
        if (!player || player.isSneaking) return;
        try {
            const seat = seatFor(block);
            if (seat && seats.mount(player, seat)) {
                player.setRotation({ x: player.getRotation().x, y: seat.yaw });
            }
        } catch (error) {
            reportPianoError("pianoBench.interact", error);
        }
    },
    onBreak({ block, brokenBlockPermutation }) {
        const { dimension, location } = block;
        const p88 = resolveP88Bench(dimension, location, brokenBlockPermutation);
        if (p88) {
            seats.release(p88Key(p88));
            // Player breaks award the item first via the native after-event.
            system.run(() => removeP88BenchRemainder(p88, false));
        } else {
            seats.release(benchKey(dimension, location));
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

export function registerPianoBenchEvents(blockEvents: ReturnType<typeof createBlockResourceEvents>) {
    const scope = new PianoScope(eventHost.scope, "pianoBench");
    const onBreakBlock = (event: PlayerBreakBlockBeforeEvent) => {
        if (event.cancel) return;
        const { dimension, location, permutation } = event.block;
        const bench = resolveP88Bench(dimension, location, permutation);
        // Keep both halves intact until the neighboring chunk can be checked.
        if (bench && inspectP88Bench(bench) === "unknown") event.cancel = true;
    };
    world.beforeEvents.playerBreakBlock.subscribe(onBreakBlock);
    scope.own("playerBreakBlock", () => world.beforeEvents.playerBreakBlock.unsubscribe(onBreakBlock));

    blockEvents.register({
        blockTypes: P88_BENCH_BLOCKS,
        boundary: "p88Bench",
        broken: (event, suppressDrop) => {
            const bench = resolveP88Bench(event.dimension, event.block.location, event.brokenBlockPermutation);
            if (!bench) return;
            const mode = event.player.getGameMode();
            const drop = mode === GameMode.Survival || mode === GameMode.Adventure;
            if (drop && event.itemStackBeforeBreak?.getComponent("minecraft:enchantable")?.getEnchantment("silk_touch")) {
                suppressDrop();
            }
            removeP88BenchRemainder(bench, drop);
        },
    });
}
