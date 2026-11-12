import { Player, PlayerPermissionLevel } from "@minecraft/server";
import { loadPbeSettings } from "@platform/storage/pbeSettingsStore";

/** 管理员 = 操作员或自定义权限；普通玩家（成员/访客）受全局设置限制。 */
export function isPbeAdmin(player: Player): boolean {
    try {
        return player.playerPermissionLevel >= PlayerPermissionLevel.Operator;
    } catch {
        return false;
    }
}

/** 当前玩家是否允许创建/提交 MIDI 导入任务。 */
export function canImportMidi(player: Player): boolean {
    return isPbeAdmin(player) || loadPbeSettings().allowPlayerImport;
}
