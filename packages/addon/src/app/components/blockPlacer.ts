import { Direction, EntityComponentTypes, EquipmentSlot, GameMode, ItemCustomComponent, Player, Vector3 } from "@minecraft/server";
import { Cardinal_Direction } from "@domain/types";
import { grandDefinition, pianoDefinition } from "@domain/instrument/definition";
import { instrumentCenter, placeInstrument } from "@platform/assembly";
import { pianoDisplayEntity } from "@platform/display";
import { adoptPianoPayload, clearPianoPayloadFromItem } from "@platform/storage/pianoItem";
import { pianoWorld } from "@app/PianoWorld";

const FaceOffsets: Record<Direction, Vector3> = {
    Up: { x: 0, y: 1, z: 0 }, Down: { x: 0, y: -1, z: 0 },
    North: { x: 0, y: 0, z: -1 }, South: { x: 0, y: 0, z: 1 },
    East: { x: 1, y: 0, z: 0 }, West: { x: -1, y: 0, z: 0 },
};
export const blockPlacerComponent: ItemCustomComponent = {
    onUseOn(e) {
        if (e.source?.typeId !== "minecraft:player") return;
        const player = e.source as Player;
        const block = e.block.offset(FaceOffsets[e.blockFace]);
        if (!block) return;
        const rot = player.getRotation().y;
        const direction: Cardinal_Direction = rot >= -45 && rot < 45 ? "north" : rot >= 45 && rot < 135 ? "east" : rot >= -135 && rot < -45 ? "west" : "south";
        // The same placer component is shared by both instruments; the held
        // item decides which assembly is built.
        const definition = e.itemStack?.typeId === grandDefinition.itemId ? grandDefinition : pianoDefinition;
        const location = { dimension: block.dimension, pos: block.location, direction, definition };
        if (!placeInstrument(location)) return;

        // 放置后把物品里携带的内置音乐回灌到新钢琴；只有确认写入成功，
        // 才会在消耗物品时清空物品上的副本，避免复制。
        let adopted = 0;
        const item = e.itemStack;
        if (item) {
            const runtime = pianoWorld.get(location);
            const display = runtime?.displayEntity ?? pianoDisplayEntity(location, instrumentCenter(location));
            if (display) adopted = adoptPianoPayload(display, item);
        }

        if (player.getGameMode() === GameMode.Creative) return;
        const slot = player.getComponent(EntityComponentTypes.Equippable)?.getEquipmentSlot(EquipmentSlot.Mainhand);
        if (!slot) return;
        if (item.amount <= 1) {
            if (adopted > 0) clearPianoPayloadFromItem(item);
            slot.setItem(undefined);
        } else {
            item.amount--;
            if (adopted > 0) clearPianoPayloadFromItem(item);
            slot.setItem(item);
        }
    },
};
