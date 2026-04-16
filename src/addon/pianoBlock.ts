import {
    Block,
    BlockCustomComponent,
    BlockPermutation,
    GameMode,
    ItemStack,
    system,
    world,
} from "@minecraft/server";
import { openPiano } from "@piano/piano";
import { Cardinal_Direction } from "@types";
import { PairOffsets } from "@utils/block";
import { Vector3Utils } from "sapi-pro";

function getPairedBlockOffset(block: BlockPermutation) {
    const dir = block.getState(
        "minecraft:cardinal_direction"
    ) as Cardinal_Direction;
    if (!dir) return;

    return block.type.id === "xypiano:piano_left"
        ? PairOffsets[dir].left
        : PairOffsets[dir].right;
}

export const PianoBlockComponent: BlockCustomComponent = {
    onBreak(e) {
        const block = e.brokenBlockPermutation;
        const offset = getPairedBlockOffset(block);
        if (!offset) return;

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

export function regEvents() {
    world.beforeEvents.playerBreakBlock.subscribe((t) => {
        if (!t.block.typeId.startsWith("xypiano:piano")) return;

        t.cancel = true;

        system.run(() => {
            t.block.setType("air");
            //手动生成掉落物
            if (t.player?.getGameMode() !== GameMode.Creative) {
                const loot = new ItemStack("xypiano:piano_item");
                t.block.dimension.spawnItem(loot, t.block.center());
            }
        });
    });

    world.beforeEvents.explosion.subscribe((t) => {
        if (t.source?.typeId == "minecraft:wind_charge_projectile") return;

        const blocks = t.getImpactedBlocks();
        world.sendMessage(blocks.length.toString());
        if (blocks.length === 0) return;

        // 先快速检测：有没有钢琴方块
        let hasPiano = false;
        for (const block of blocks) {
            if (block.typeId.startsWith("xypiano")) {
                hasPiano = true;
                break;
            }
        }

        // 没有就直接退出
        if (!hasPiano) return;

        const visited = new Set<string>();
        const result: Block[] = [];

        for (const block of blocks) {
            if (!block.typeId.startsWith("xypiano")) {
                result.push(block);
                continue;
            }

            const key = `${block.location.x},${block.location.y},${block.location.z}`;
            if (visited.has(key)) continue;

            const offset = getPairedBlockOffset(block.permutation);
            if (offset) {
                const pairX = block.location.x + offset.x;
                const pairY = block.location.y + offset.y;
                const pairZ = block.location.z + offset.z;

                const pairKey = `${pairX},${pairY},${pairZ}`;
                visited.add(pairKey);
            }

            visited.add(key);
            result.push(block);
        }

        t.setImpactedBlocks(result);
    });
}
