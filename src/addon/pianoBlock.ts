import { BlockCustomComponent, system } from "@minecraft/server";
import { openPiano } from "@piano/piano";
import { RightOffsets } from "@utils/block";
import { Vector3Utils } from "@utils/vector";
import { Cardinal_Direction } from "@types";

export const PianoBlockComponent: BlockCustomComponent = {
    onBreak(e) {
        const block = e.brokenBlockPermutation;
        const cardinal_direction = block.getState(
            "minecraft:cardinal_direction"
        );
        if (!cardinal_direction) return;
        //获取配对的方块
        const offsetRight =
            RightOffsets[cardinal_direction as Cardinal_Direction];
        const offset =
            block.type.id == "xypiano:piano_left"
                ? offsetRight
                : Vector3Utils.scale(offsetRight, -1);
        const nearByBlock = e.block.offset(offset);
        //同时破坏旁边的
        if (
            nearByBlock?.isValid &&
            nearByBlock.typeId.startsWith("xypiano:piano")
        ) {
            nearByBlock.setType("air");
        }
    },
    onPlayerInteract(e) {
        if (!e.player) {
            return;
        }
        if (
            Vector3Utils.squaredDistance(e.player.location, e.block.location) >
            16
        ) {
            e.player.onScreenDisplay.setActionBar("距离钢琴过远");
            return;
        }
        openPiano(e.player, e.block);
    },
};
