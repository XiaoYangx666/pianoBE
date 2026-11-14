import { Block, BlockPermutation, Dimension, ItemStack, Vector3 } from "@minecraft/server";
import { Cardinal_Direction } from "@domain/types";
import { RightOffsets } from "@domain/geometry/offsets";
import { Signal } from "@domain/util/signal";
import { definitionForPart, grandDefinition, pianoDefinition, type InstrumentDefinition } from "@domain/instrument/definition";
import { capturePianoPayload, clearPianoStorage, writePianoPayloadToItem, takeCardFromDisplay } from "@platform/storage/pianoItem";
import { pianoDisplayEntity } from "@platform/display";
import type { InstrumentLocation } from "@platform/instrumentLocation";

export type { InstrumentLocation } from "@platform/instrumentLocation";
export const instrumentPlaced = new Signal<InstrumentLocation>();
export const instrumentDestroyed = new Signal<InstrumentLocation>();

export function instrumentKey(dimension: Dimension, pos: Vector3): string {
    return `${dimension.id}:${pos.x},${pos.y},${pos.z}`;
}

/** 乐器中心点（显示实体/声音/粒子共用的基准位置）。 */
export function instrumentCenter(location: InstrumentLocation): Vector3 {
    const { pos, direction, definition } = location;
    const right = RightOffsets[direction];
    const center = definition === grandDefinition ? 0 : .5;
    return { x: pos.x + .5 + right.x * center, y: pos.y, z: pos.z + .5 + right.z * center };
}

export function resolveInstrument(block: Block, definition?: InstrumentDefinition): InstrumentLocation | undefined {
    try { return resolveInstrumentSnapshot(block.dimension, block.location, block.permutation, definition); }
    catch { return undefined; }
}
export function resolveInstrumentSnapshot(dimension: Dimension, pos: Vector3, permutation: BlockPermutation,
    definition = definitionForPart(permutation.type.id)): InstrumentLocation | undefined {
    const part = definition?.parts.find(p => p.typeId === permutation.type.id);
    if (!part) return;
    const direction = permutation.getState("minecraft:cardinal_direction") as Cardinal_Direction;
    const right = RightOffsets[direction];
    if (!right) return;
    const forward = { x: -right.z, z: right.x };
    return { dimension, pos: { x: pos.x - right.x * part.right - forward.x * (part.forward ?? 0), y: pos.y - (part.up ?? 0), z: pos.z - right.z * part.right - forward.z * (part.forward ?? 0) }, direction, definition };
}
function partPosition(location: InstrumentLocation, part: InstrumentDefinition["parts"][number]): Vector3 {
    const right = RightOffsets[location.direction];
    const forward = { x: -right.z, z: right.x };
    return { x: location.pos.x + right.x * part.right + forward.x * (part.forward ?? 0), y: location.pos.y + (part.up ?? 0), z: location.pos.z + right.z * part.right + forward.z * (part.forward ?? 0) };
}
function readPart(location: InstrumentLocation, part: InstrumentDefinition["parts"][number]): Block | undefined {
    const pos = partPosition(location, part);
    try {
        if (!location.dimension.isChunkLoaded(pos)) return undefined;
        const block = location.dimension.getBlock(pos);
        return block?.isValid ? block : undefined;
    } catch { return undefined; }
}
export function inspectInstrument(location: InstrumentLocation, definition = location.definition ?? pianoDefinition): "complete" | "incomplete" | "unloaded" {
    let incomplete = false;
    for (const part of definition.parts) {
        const block = readPart(location, part);
        if (!block) return "unloaded";
        try {
            if (block.typeId !== part.typeId || block.permutation.getState("minecraft:cardinal_direction") !== location.direction) incomplete = true;
        } catch { return "unloaded"; }
    }
    return incomplete ? "incomplete" : "complete";
}
export function placeInstrument(location: InstrumentLocation, definition = location.definition ?? pianoDefinition): boolean {
    const blocks = definition.parts.map(part => readPart(location, part));
    if (blocks.some(block => !block?.isValid || (!block.isAir && !block.isLiquid))) return false;
    const permutations = definition.parts.map(part => BlockPermutation.resolve(part.typeId, { "minecraft:cardinal_direction": location.direction }));
    // Prepare before mutating and restore on a failed write, avoiding partial assemblies.
    const previous = blocks.map(block => block!.permutation);
    try {
        blocks.forEach((block, i) => block!.setPermutation(permutations[i]));
    } catch (error) {
        blocks.forEach((block, i) => { try { block!.setPermutation(previous[i]); } catch {} });
        console.warn("[piano] placement failed", error);
        return false;
    }
    instrumentPlaced.publish({ ...location, definition });
    return true;
}
/** Only clear matching parts, never unrelated or differently oriented neighbors. */
export function destroyInstrument(location: InstrumentLocation, drop: boolean, definition = location.definition ?? pianoDefinition): boolean {
    if (inspectInstrument(location, definition) === "unloaded") return false;
    const center = instrumentCenter(location);
    const display = pianoDisplayEntity(location, center);
    // 先搬运再拆：内置音乐写进掉落的钢琴物品，卡槽里的实体卡单独退还。
    // 物品写失败时直接放弃本次拆除，宁可拆不掉也不能丢歌。
    const payload = display ? capturePianoPayload(location, center) : undefined;
    const carried = payload && payload.songs > 0 ? new ItemStack(definition.itemId) : undefined;
    if (carried && !writePianoPayloadToItem(carried, payload!.raw)) {
        console.warn("[piano] 拆琴前保存内置音乐失败，已取消本次拆除");
        return false;
    }
    const card = display ? takeCardFromDisplay(display) : undefined;
    // 数据已经安全进入掉落物：清空源实体，后续任何清理都不会再复制一份。
    if (carried && display) clearPianoStorage(display);

    let removed = false;
    for (const part of definition.parts) {
        const block = readPart(location, part);
        if (block?.typeId === part.typeId && block.permutation.getState("minecraft:cardinal_direction") === location.direction) {
            block.setType("minecraft:air");
            removed = true;
        }
    }
    if (!removed) return false;
    instrumentDestroyed.publish({ ...location, definition });
    const spawn = { x: location.pos.x + .5, y: location.pos.y + .5, z: location.pos.z + .5 };
    // drop=false（创造模式/活塞）本来不掉落物品；但只要钢琴里有音乐，仍然
    // 掉落带数据的钢琴物品，保证内容不会凭空消失。卡永远退还。
    if (drop || carried) location.dimension.spawnItem(carried ?? new ItemStack(definition.itemId), spawn);
    if (card) {
        try {
            location.dimension.spawnItem(card, spawn);
        } catch (error) {
            console.warn("[piano] 退还存储卡失败", error);
        }
    }
    return true;
}
