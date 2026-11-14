import type { Entity, ItemStack, Vector3 } from "@minecraft/server";
import type { InstrumentLocation } from "@platform/instrumentLocation";
import { MusicCollection } from "@piano/core";
import { PIANO_STORAGE_PREFIX } from "@platform/storage/musicStorage";
import { DynamicPropertyKv } from "@platform/storage/dynamicKv";
import { cardSlotOf, readCardFromDisplay, pianoDisplayEntity } from "@platform/display";

/** 拆琴时需要整体搬运的内容：内置音乐 + 卡槽里的实体卡。 */
export interface PianoPayload {
    raw: Record<string, string>;
    card?: ItemStack;
    songs: number;
}

function readStorageRaw(entity: Entity): Record<string, string> {
    const raw: Record<string, string> = {};
    try {
        for (const key of entity.getDynamicPropertyIds()) {
            if (!key.startsWith(PIANO_STORAGE_PREFIX)) continue;
            const value = entity.getDynamicProperty(key);
            if (typeof value === "string") raw[key] = value;
        }
    } catch {
        // 实体失效：返回空包（拆琴流程会因此拒绝移除，避免丢歌）。
    }
    return raw;
}

/** 读取钢琴当前的内置音乐与插卡（不修改任何东西）。 */
export function capturePianoPayload(location: InstrumentLocation, center: Vector3): PianoPayload | undefined {
    const entity = pianoDisplayEntity(location, center);
    if (!entity) return undefined;
    const raw = readStorageRaw(entity);
    const card = readCardFromDisplay(entity);
    let songs = 0;
    try {
        songs = new MusicCollection(new DynamicPropertyKv(() => entity, PIANO_STORAGE_PREFIX), PIANO_STORAGE_PREFIX, () => Infinity)
            .entries().length;
    } catch {
        songs = 0;
    }
    return { raw, card, songs };
}

/** 把整份内置音乐写进掉落的钢琴物品；逐步回读校验。 */
export function writePianoPayloadToItem(item: ItemStack, raw: Record<string, string>): boolean {
    try {
        for (const [key, value] of Object.entries(raw)) {
            if (key.startsWith(PIANO_STORAGE_PREFIX)) item.setDynamicProperty(key, value);
        }
        for (const [key, value] of Object.entries(raw)) {
            if (item.getDynamicProperty(key) !== value) return false;
        }
        return true;
    } catch {
        return false;
    }
}

/** 清空物品上的钢琴音乐（成功放到世界后调用，避免复制）。 */
export function clearPianoPayloadFromItem(item: ItemStack) {
    try {
        for (const key of item.getDynamicPropertyIds()) {
            if (key.startsWith(PIANO_STORAGE_PREFIX)) item.setDynamicProperty(key);
        }
    } catch {
        // 清不掉最多留下冗余数据，不会影响新钢琴。
    }
}

/** 放置钢琴时，把物品里的内置音乐回灌到显示实体。 */
export function adoptPianoPayload(entity: Entity, item: ItemStack): number {
    const kv = new DynamicPropertyKv(() => entity, PIANO_STORAGE_PREFIX);
    const collection = new MusicCollection(kv, PIANO_STORAGE_PREFIX, () => Infinity);
    let raw: Record<string, string> = {};
    try {
        for (const key of item.getDynamicPropertyIds()) {
            if (!key.startsWith(PIANO_STORAGE_PREFIX)) continue;
            const value = item.getDynamicProperty(key);
            if (typeof value === "string") raw[key] = value;
        }
    } catch {
        return 0;
    }
    const incoming = Object.keys(raw).length;
    if (!incoming) return 0;
    // 已有数据的实体绝不覆盖，避免重复放置造成“旧琴内容被新琴顶掉”。
    if (collection.entries().length > 0) return 0;
    const result = collection.importRaw(raw);
    return result.songs;
}

/** 拆琴成功后清空源实体上的音乐，避免后续再次捕获造成复制。 */
export function clearPianoStorage(entity: Entity) {
    try {
        for (const key of entity.getDynamicPropertyIds()) {
            if (key.startsWith(PIANO_STORAGE_PREFIX)) entity.setDynamicProperty(key);
        }
    } catch {
        // 实体已失效时无需清理。
    }
}

/** 从显示实体上摘走卡槽物品（拆琴/迁移用）。 */
export function takeCardFromDisplay(entity: Entity) {
    const card = readCardFromDisplay(entity);
    if (!card) return undefined;
    cardSlotOf(entity)?.write(undefined);
    return card;
}
