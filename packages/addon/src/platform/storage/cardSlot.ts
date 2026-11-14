import {
    type Container,
    type Entity,
    EntityComponentTypes,
    type EntityInventoryComponent,
    type ItemStack,
    type Player,
} from "@minecraft/server";
import { CardAccess, MUSIC_CARD_ID, bindCardIdentity, containerItemSlot, isMusicCard, type ItemSlot } from "@platform/storage/cardItem";

/** 显示实体上的卡槽：真实的 1 格实体容器（minecraft:inventory）。 */
export const CARD_SLOT_INDEX = 0;

export interface CardSlotResult {
    ok: boolean;
    message: string;
}

/**
 * 钢琴卡槽适配层。
 *
 * 目前由显示实体的 `minecraft:inventory` 承载；业务层只依赖这里的
 * insert/take/read，将来换成方块容器不需要改队列、存储与 UI。
 */
export class CardSlot {
    constructor(private readonly entity: Entity) {}

    get isValid(): boolean {
        try {
            return this.entity.isValid;
        } catch {
            return false;
        }
    }

    private container(): Container | undefined {
        if (!this.isValid) return undefined;
        try {
            const component = this.entity.getComponent(EntityComponentTypes.Inventory) as EntityInventoryComponent | undefined;
            return component?.container;
        } catch {
            return undefined;
        }
    }

    private slot(): ItemSlot | undefined {
        const container = this.container();
        return container ? containerItemSlot(container, CARD_SLOT_INDEX) : undefined;
    }

    read(): ItemStack | undefined {
        const item = this.slot()?.read();
        return isMusicCard(item) ? item : undefined;
    }

    get occupied(): boolean {
        return this.read() !== undefined;
    }

    /** 卡片句柄；没有卡或槽位失效时返回 undefined。 */
    access(): CardAccess | undefined {
        const slot = this.slot();
        return slot ? CardAccess.open(slot) : undefined;
    }

    /** 插入一张卡：槽位已占用时拒绝（绝不覆盖/交换）。 */
    insert(card: ItemStack): CardSlotResult {
        const slot = this.slot();
        if (!slot) return { ok: false, message: "卡槽暂不可用（钢琴未加载）" };
        if (slot.read() !== undefined) return { ok: false, message: "卡槽里已经有一张存储卡，请先取出" };
        if (!isMusicCard(card)) return { ok: false, message: `只能把 ${MUSIC_CARD_ID} 插入卡槽` };
        try {
            slot.write(bindCardIdentity(card));
            if (!isMusicCard(slot.read())) {
                slot.write(undefined);
                return { ok: false, message: "卡槽写入失败，卡片未插入" };
            }
            return { ok: true, message: "存储卡已插入" };
        } catch (error) {
            return { ok: false, message: `插入失败：${(error as Error).message ?? error}` };
        }
    }

    /** 取出卡片（不做任何“复制”），由调用方负责交还玩家或掉落。 */
    take(): ItemStack | undefined {
        const slot = this.slot();
        if (!slot) return undefined;
        const item = slot.read();
        if (!isMusicCard(item)) return undefined;
        slot.write(undefined);
        return item;
    }

    /** 交给玩家：背包满时掉在脚下，绝不吞卡。 */
    ejectTo(player: Player): { item: ItemStack; delivered: boolean } | undefined {
        const item = this.take();
        if (!item) return undefined;
        const delivered = giveItem(player, item);
        return { item, delivered };
    }
}

/** 给玩家或掉落在脚下；返回是否放进了背包。 */
export function giveItem(player: Player, item: ItemStack): boolean {
    try {
        const container = player.getComponent(EntityComponentTypes.Inventory)?.container;
        if (!container) throw new Error("玩家背包不可用");
        const leftover = container.addItem(item);
        if (!leftover) return true;
        player.dimension.spawnItem(leftover, player.location);
        return false;
    } catch {
        try {
            player.dimension.spawnItem(item, player.location);
        } catch {
            // 最后兜底：脚下掉落也失败时只能提示玩家。
        }
        return false;
    }
}
