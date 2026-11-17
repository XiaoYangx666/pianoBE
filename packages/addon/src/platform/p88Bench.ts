import { clearOwnedAssembly, inspectAssembly, writeAssembly } from "@begame/tabletop/minecraft";
import { P88_BENCH_FORWARD, PIANO_BENCH_SIT_FORWARD } from "@data/pianoBench.generated";
import { BlockPermutation, ItemStack } from "@minecraft/server";
import type { Block, Dimension, Vector3 } from "@minecraft/server";
import { RightOffsets } from "@domain/geometry/offsets";
import type { Cardinal_Direction } from "@domain/types";
import { reportPianoError } from "@runtime/scope";

export const P88_BENCH_ITEM = "pbe:p88_bench_item";
export const P88_BENCH_BLOCKS = ["pbe:p88_bench_left", "pbe:p88_bench_right"] as const;
export const BENCH_CARDINAL = "minecraft:cardinal_direction";

export interface P88BenchLocation {
    dimension: Dimension;
    origin: Vector3;
    direction: Cardinal_Direction;
}

export function p88BenchMembers({ origin, direction }: P88BenchLocation) {
    const right = RightOffsets[direction];
    return [
        { ...origin, typeId: P88_BENCH_BLOCKS[0] },
        { x: origin.x + right.x, y: origin.y, z: origin.z + right.z, typeId: P88_BENCH_BLOCKS[1] },
    ];
}

export function resolveP88Bench(
    dimension: Dimension, position: Vector3, permutation: BlockPermutation
): P88BenchLocation | undefined {
    const type = permutation.type.id;
    if (type !== P88_BENCH_BLOCKS[0] && type !== P88_BENCH_BLOCKS[1]) return;
    const direction = permutation.getState(BENCH_CARDINAL) as Cardinal_Direction | undefined;
    if (!direction || !Object.hasOwn(RightOffsets, direction)) return;

    const right = RightOffsets[direction];
    const origin = type === P88_BENCH_BLOCKS[0] ? position
        : { x: position.x - right.x, y: position.y, z: position.z - right.z };
    return { dimension, origin, direction };
}

export function p88BenchSeatPoint({ origin, direction }: P88BenchLocation): Vector3 {
    const right = RightOffsets[direction];
    const towardKeys = (P88_BENCH_FORWARD + PIANO_BENCH_SIT_FORWARD) / 16;
    return {
        x: origin.x + .5 + right.x * .5 + right.z * towardKeys,
        y: origin.y,
        z: origin.z + .5 + right.z * .5 - right.x * towardKeys,
    };
}

function owns(block: Block | undefined, typeId: string, direction: Cardinal_Direction): boolean {
    return block?.typeId === typeId && block.permutation.getState(BENCH_CARDINAL) === direction;
}

export function inspectP88Bench(location: P88BenchLocation) {
    const { dimension, direction } = location;
    return inspectAssembly(p88BenchMembers(location), p => dimension.isChunkLoaded(p), member => {
        const block = dimension.getBlock(member);
        if (!block?.isValid) return "unknown";
        return owns(block, member.typeId, direction) ? "intact" : "damaged";
    });
}

export function placeP88Bench(location: P88BenchLocation): (() => void) | undefined {
    const { dimension, direction } = location;
    try {
        const members = p88BenchMembers(location);
        const targets = members.map(member => {
            const block = dimension.isChunkLoaded(member) ? dimension.getBlock(member) : undefined;
            return { block, permutation: BlockPermutation.resolve(member.typeId, { [BENCH_CARDINAL]: direction }) };
        });
        const writable = targets.flatMap(({ block, permutation }) =>
            block?.isValid && block.isAir ? [{ block, permutation }] : []
        );
        if (writable.length !== members.length) return;
        return writeAssembly(writable, ({ block }) => block.permutation,
            ({ block, permutation }) => block.setPermutation(permutation),
            ({ block }, original) => block.setPermutation(original),
            error => reportPianoError("p88Bench.rollback", error));
    } catch (error) {
        reportPianoError("p88Bench.place", error);
        return undefined;
    }
}

export function removeP88BenchRemainder(location: P88BenchLocation, drop: boolean) {
    if (inspectP88Bench(location) !== "damaged") return;
    const { dimension, direction } = location;
    const removed = clearOwnedAssembly(p88BenchMembers(location), p => dimension.isChunkLoaded(p), member => {
        const block = dimension.getBlock(member);
        if (!block?.isValid) return "unknown";
        return owns(block, member.typeId, direction) ? "owned" : "foreign";
    }, member => dimension.setBlockType(member, "minecraft:air"),
    error => reportPianoError("p88Bench.remove", error));
    if (removed && drop) {
        const point = p88BenchSeatPoint(location);
        dimension.spawnItem(new ItemStack(P88_BENCH_ITEM), { ...point, y: point.y + .5 });
    }
}
