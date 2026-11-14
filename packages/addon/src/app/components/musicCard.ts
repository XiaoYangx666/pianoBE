import {
    EntityComponentTypes,
    EquipmentSlot,
    type ItemCustomComponent,
    type Player,
} from "@minecraft/server";
import { formatBytes } from "@piano/core";
import { CardAccess, cardName, isMusicCard, mainhandItemSlot } from "@platform/storage/cardItem";

/** 手持卡片右键空气：在聊天栏给出卡片摘要。插入钢琴由方块交互处理。 */
export const MusicCardComponent: ItemCustomComponent = {
    onUse(e) {
        const player = e.source;
        if (player?.typeId !== "minecraft:player") return;
        showCardSummary(player as Player);
    },
};

export function showCardSummary(player: Player) {
    const slot = mainhandItemSlot(player);
    const access = slot ? CardAccess.open(slot) : undefined;
    const item = access?.item;
    if (!access || !item) {
        player.sendMessage("§7手里没有音乐存储卡。");
        return;
    }
    const storage = access.storage();
    const usage = storage.usage();
    const entries = storage.list();
    const lines = [
        `§b${cardName(item)}`,
        `§7歌曲 §f${usage.songs} §7首 · 占用 §f${formatBytes(usage.usedBytes)} §7/ §f${formatBytes(usage.limitBytes)}`,
    ];
    if (entries.length) {
        lines.push(`§7内容：§f${entries.slice(0, 4).map(entry => entry.name).join("、")}${entries.length > 4 ? "…" : ""}`);
    }
    lines.push("§8右键钢琴插入卡槽；蹲下 + 空手右键钢琴可取卡。");
    player.sendMessage(lines.join("\n"));
}

/** 插入成功后从手中移除一张卡。 */
export function consumeHeldCard(player: Player): boolean {
    const slot = player.getComponent(EntityComponentTypes.Equippable)?.getEquipmentSlot(EquipmentSlot.Mainhand);
    const item = slot?.getItem();
    if (!item || !isMusicCard(item)) return false;
    if (item.amount <= 1) slot?.setItem(undefined);
    else {
        item.amount--;
        slot?.setItem(item);
    }
    return true;
}
