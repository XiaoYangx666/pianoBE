import {
    Container,
    EntityComponentTypes,
    EquipmentSlot,
    ItemStack,
    type Player,
} from "@minecraft/server";
import { formatBytes, type StorageUsage } from "@piano/core";
import { DynamicMusicStorage, CARD_META_PREFIX, CARD_STORAGE_PREFIX } from "@platform/storage/musicStorage";
import { currentPbeSettings } from "@platform/storage/settingsProvider";

/** 自定义物品：音乐存储卡（不可堆叠）。 */
export const MUSIC_CARD_ID = "xypiano:music_card";
const CARD_UID = `${CARD_META_PREFIX}uid`;
const CARD_REV = `${CARD_META_PREFIX}rev`;
const CARD_NAME = `${CARD_META_PREFIX}name`;
export const CARD_NAME_MAX = 32;
export const DEFAULT_CARD_NAME = "音乐存储卡";

/** 可读写的物品槽位（容器格 / 玩家手部）。ItemStack 是快照，必须写回。 */
export interface ItemSlot {
    read(): ItemStack | undefined;
    write(item: ItemStack | undefined): void;
}

export function containerItemSlot(container: Container, index: number): ItemSlot {
    return {
        read: () => {
            try {
                return container.isValid ? container.getItem(index) : undefined;
            } catch {
                return undefined;
            }
        },
        write: (item) => {
            if (container.isValid) container.setItem(index, item);
        },
    };
}

export function equipmentItemSlot(player: Player, slot: EquipmentSlot): ItemSlot | undefined {
    try {
        const equippable = player.getComponent(EntityComponentTypes.Equippable);
        if (!equippable) return undefined;
        const containerSlot = equippable.getEquipmentSlot(slot);
        return {
            read: () => (player.isValid ? containerSlot.getItem() : undefined),
            write: (item) => {
                if (player.isValid) containerSlot.setItem(item);
            },
        };
    } catch {
        return undefined;
    }
}

export function mainhandItemSlot(player: Player): ItemSlot | undefined {
    return equipmentItemSlot(player, EquipmentSlot.Mainhand);
}

export function isMusicCard(item: ItemStack | undefined): item is ItemStack {
    return item?.typeId === MUSIC_CARD_ID;
}

function stringProperty(item: ItemStack, key: string): string | undefined {
    try {
        const value = item.getDynamicProperty(key);
        return typeof value === "string" ? value : undefined;
    } catch {
        return undefined;
    }
}

export function cardUid(item: ItemStack): string | undefined {
    return stringProperty(item, CARD_UID);
}

export function cardRevision(item: ItemStack): number {
    try {
        const value = item.getDynamicProperty(CARD_REV);
        return typeof value === "number" && Number.isFinite(value) ? value : 0;
    } catch {
        return 0;
    }
}

/** 卡片名称：优先玩家重命名，其次物品名，最后默认名。 */
export function cardName(item: ItemStack): string {
    return (stringProperty(item, CARD_NAME) ?? item.nameTag ?? DEFAULT_CARD_NAME).trim().slice(0, CARD_NAME_MAX)
        || DEFAULT_CARD_NAME;
}

export function normalizeCardName(value: string): string | undefined {
    const trimmed = value.trim().slice(0, CARD_NAME_MAX);
    return trimmed || undefined;
}

function newUid(): string {
    return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** 给实体卡绑定稳定身份（插入卡槽时调用），之后所有写入都能检测“卡片被换掉”。 */
export function bindCardIdentity(item: ItemStack): ItemStack {
    if (!cardUid(item)) item.setDynamicProperty(CARD_UID, newUid());
    return item;
}

function bumpRevision(item: ItemStack) {
    item.setDynamicProperty(CARD_REV, cardRevision(item) + 1);
}

/** 更新物品 Lore，让卡片在背包里也能看到容量与歌曲数（不占音乐容量）。 */
export function refreshCardLore(item: ItemStack, usage?: StorageUsage, songNames?: readonly string[]) {
    const stat = usage
        ? `已存 ${usage.songs} 首 · ${formatBytes(usage.usedBytes)} / ${formatBytes(usage.limitBytes)}`
        : undefined;
    const lines = [stat ?? "空卡（未写入音乐）", "右键钢琴可插入卡槽"];
    if (songNames?.length) {
        const shown = songNames.slice(0, 2).join("、");
        lines.push(songNames.length > 2 ? `${shown} 等 ${songNames.length} 首` : shown);
    }
    try {
        item.setLore(lines);
        if (stringProperty(item, CARD_NAME)) item.nameTag = cardName(item);
    } catch {
        // Lore/名字是展示优化，失败不影响数据。
    }
}

/**
 * 一张卡的可写句柄。
 *
 * 每次写入都重新读取所在槽位，并校验 UID 未变化：
 * 卡片被移走/替换/取走后，迟到的异步操作会失败而不是写错物品。
 */
export class CardAccess {
    readonly uid?: string;

    constructor(private readonly slot: ItemSlot, uid?: string) {
        this.uid = uid;
    }

    static open(slot: ItemSlot): CardAccess | undefined {
        const item = slot.read();
        return isMusicCard(item) ? new CardAccess(slot, cardUid(item)) : undefined;
    }

    get item(): ItemStack | undefined {
        const item = this.slot.read();
        return isMusicCard(item) ? item : undefined;
    }

    get exists(): boolean {
        return this.item !== undefined;
    }

    /** 读取-修改-写回；UID 不一致时抛错（调用方展示中文提示）。 */
    mutate(mutator: (item: ItemStack) => void): ItemStack {
        const current = this.slot.read();
        if (!isMusicCard(current)) throw new Error("存储卡已从卡槽/手中移走");
        const uid = cardUid(current);
        if (this.uid !== undefined && uid !== this.uid) throw new Error("存储卡已被替换，操作已取消");
        const copy = current.clone();
        mutator(copy);
        if (!cardUid(copy)) copy.setDynamicProperty(CARD_UID, newUid());
        bumpRevision(copy);
        this.slot.write(copy);
        return copy;
    }

    rename(name: string): void {
        const normalized = normalizeCardName(name);
        if (!normalized) throw new Error("卡片名称不能为空");
        const usage = this.storage().usage();
        this.mutate((item) => {
            item.setDynamicProperty(CARD_NAME, normalized);
            item.nameTag = normalized;
            refreshCardLore(item, usage);
        });
    }

    /** 卡片正文存储（每次操作都绑定当前槽位内容）。 */
    storage(limitBytes?: number): DynamicMusicStorage {
        const kv = {
            keys: () => {
                const item = this.item;
                if (!item) return [];
                try {
                    return item.getDynamicPropertyIds().filter(key => key.startsWith(CARD_STORAGE_PREFIX));
                } catch {
                    return [];
                }
            },
            get: (key: string) => {
                const item = this.item;
                if (!item) return undefined;
                const value = stringProperty(item, key);
                return value;
            },
            set: (key: string, value: string) => {
                this.mutate((item) => item.setDynamicProperty(key, value));
            },
            delete: (key: string) => {
                if (!this.exists) return;
                this.mutate((item) => item.setDynamicProperty(key));
            },
        };
        const storage = new DynamicMusicStorage(
            kv,
            CARD_STORAGE_PREFIX,
            "card",
            () => limitBytes ?? currentPbeSettings().cardStorageBytes,
            () => (this.item ? cardName(this.item) : DEFAULT_CARD_NAME)
        );
        return storage;
    }

    /** 写入/删除后刷新 Lore（best effort）。 */
    refreshLore(songNames?: readonly string[]) {
        const storage = this.storage();
        const usage = storage.usage();
        if (!this.exists) return;
        this.mutate((item) => refreshCardLore(item, usage, songNames ?? storage.list().map(entry => entry.name)));
    }
}
