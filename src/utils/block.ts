import { Cardinal_Direction } from "@types";
import { Block, Vector3 } from "@minecraft/server";
import { Vector3Utils } from "./vector";

export const RightOffsets: Record<Cardinal_Direction, Vector3> = {
    north: { x: -1, y: 0, z: 0 },
    south: { x: 1, y: 0, z: 0 },
    east: { x: 0, y: 0, z: -1 },
    west: { x: 0, y: 0, z: 1 },
};

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
    );
    if (!direction) return;

    const rightOffset = RightOffsets[direction as Cardinal_Direction];

    const isLeft = block.typeId === "xypiano:piano_left";
    const offset = isLeft ? rightOffset : Vector3Utils.scale(rightOffset, -1);

    return block.offset(offset);
}
