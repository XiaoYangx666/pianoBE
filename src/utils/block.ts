import { Block, Vector3 } from "@minecraft/server";
import { Cardinal_Direction } from "@types";

export const RightOffsets: Record<Cardinal_Direction, Vector3> = {
    north: { x: -1, y: 0, z: 0 },
    south: { x: 1, y: 0, z: 0 },
    east: { x: 0, y: 0, z: -1 },
    west: { x: 0, y: 0, z: 1 },
};

export const PairOffsets: Record<
    Cardinal_Direction,
    { left: Vector3; right: Vector3 }
> = {
    north: {
        left: RightOffsets.north,
        right: {
            x: -RightOffsets.north.x,
            y: -RightOffsets.north.y,
            z: -RightOffsets.north.z,
        },
    },
    south: {
        left: RightOffsets.south,
        right: {
            x: -RightOffsets.south.x,
            y: -RightOffsets.south.y,
            z: -RightOffsets.south.z,
        },
    },
    west: {
        left: RightOffsets.west,
        right: {
            x: -RightOffsets.west.x,
            y: -RightOffsets.west.y,
            z: -RightOffsets.west.z,
        },
    },
    east: {
        left: RightOffsets.east,
        right: {
            x: -RightOffsets.east.x,
            y: -RightOffsets.east.y,
            z: -RightOffsets.east.z,
        },
    },
};

export function getLeftPianoBlock(block: Block) {
    if (!block?.isValid) return;

    const leftBlock =
        block.typeId == "xypiano:piano_left"
            ? block
            : getAdjacentPianoBlock(block);

    if (leftBlock?.typeId !== "xypiano:piano_left") {
        return;
    }

    return leftBlock;
}

/** 根据朝向获取右侧方块 */
export function getRightBlock(block: Block, direction: Cardinal_Direction) {
    if (!block?.isValid) return;

    const offset = RightOffsets[direction];
    if (!offset) return;

    return block.offset(offset);
}

/** 获取与当前钢琴块配对的另一半（左/右） */
export function getAdjacentPianoBlock(block: Block) {
    if (!block?.isValid || !block.typeId.startsWith("xypiano:piano")) {
        return;
    }

    const direction = block.permutation.getState(
        "minecraft:cardinal_direction"
    ) as Cardinal_Direction | undefined;
    if (!direction) return;

    const isLeft = block.typeId === "xypiano:piano_left";
    const offset = isLeft
        ? PairOffsets[direction].left
        : PairOffsets[direction].right;

    return block.offset(offset);
}
