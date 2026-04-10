import {
    Block,
    BlockPermutation,
    Direction,
    EntityComponentTypes,
    EquipmentSlot,
    GameMode,
    ItemCustomComponent,
    ItemStack,
    Player,
    Vector3,
    world,
} from "@minecraft/server";
import { Cardinal_Direction, RightOffsets } from "./func";

const FaceOffsets: Record<Direction, Vector3> = {
    Up: { x: 0, y: 1, z: 0 },
    Down: { x: 0, y: -1, z: 0 },
    North: { x: 0, y: 0, z: -1 },
    South: { x: 0, y: 0, z: 1 },
    East: { x: 1, y: 0, z: 0 },
    West: { x: -1, y: 0, z: 0 },
};

export const blockPlacerComponent: ItemCustomComponent = {
    onUseOn(t) {
        if (t.source?.typeId !== "minecraft:player") return;
        const player = t.source as Player;
        //获取左侧方块
        const leftBlock = t.block.offset(FaceOffsets[t.blockFace]);
        if (!leftBlock || !canPlace(leftBlock)) {
            return;
        }

        // world.sendMessage(JSON.stringify(leftBlock.location));
        //获取角度
        const rot = t.source.getRotation();
        const direction = getDirectionByRot(rot.y);
        //获取右侧方块
        const rightBlock = leftBlock.offset(RightOffsets[direction]);
        // world.sendMessage(JSON.stringify(rightBlock));
        if (!rightBlock || !canPlace(rightBlock)) {
            return;
        }
        //放置方块
        const left = BlockPermutation.resolve("xypiano:piano_left", {
            "minecraft:cardinal_direction": direction,
        });
        const right = BlockPermutation.resolve("xypiano:piano_right", {
            "minecraft:cardinal_direction": direction,
        });
        leftBlock.setPermutation(left);
        rightBlock.setPermutation(right);
        //消耗物品
        if (player.getGameMode() !== GameMode.Creative) {
            consumeItem(player, t.itemStack);
        }
    },
};

/**根据旋转角度获取方块方向(和面向的方向相反) */
function getDirectionByRot(rot: number): Cardinal_Direction {
    if (rot >= -45 && rot < 45) {
        return "north"; // 0°
    } else if (rot >= 45 && rot < 135) {
        return "east"; // 90°
    } else if (rot >= -135 && rot < -45) {
        return "west"; // -90°
    } else {
        return "south"; // 180 / -180
    }
}

function canPlace(block: Block): boolean {
    return block?.isValid && (block.isAir || block.isLiquid);
}

/**消耗物品 */
function consumeItem(player: Player, item: ItemStack) {
    const Mainhand = player
        .getComponent(EntityComponentTypes.Equippable)
        ?.getEquipmentSlot(EquipmentSlot.Mainhand);
    if (!Mainhand) return;

    if (item.amount == 1) {
        Mainhand.setItem(undefined);
    } else {
        item.amount -= 1;
        Mainhand.setItem(item);
    }
}
