import { Block } from "@minecraft/server";
import { Cardinal_Direction } from "@domain/types";
import { PairOffsets, RightOffsets } from "@domain/geometry/offsets";

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
