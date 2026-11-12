import type { Player } from "@minecraft/server";
import { CommonForm, FieldType, formManager, type contextArgs } from "sapi-pro";
import { DEFAULT_PBE_SETTINGS, normalizePbeSettings, type PbeSettings } from "@domain/settings/pbeSettings";
import { loadPbeSettings, savePbeSettings } from "@platform/storage/pbeSettingsStore";
import { isPbeAdmin } from "@app/permissions";

interface PbeSettingsArgs extends contextArgs {
    settings: PbeSettings;
}

/**
 * 管理员设置：使用 SAPI-Pro CommonForm.ConfigForm。
 * 命令本身由原生命令权限限制，提交时再次校验管理员身份。
 */
export const PbeSettingsForm = CommonForm.ConfigForm<PbeSettingsArgs>().create(
    {
        allowPlayerImport: {
            type: FieldType.Boolean,
            label: "允许普通玩家导入 MIDI",
            tooltip: "关闭后普通玩家不能创建或提交导入任务；管理员始终允许。已导入曲目仍可播放。",
            defaultValue: DEFAULT_PBE_SETTINGS.allowPlayerImport,
        },
    },
    {
        title: "PianoBE 设置",
        submitButton: "保存",
        initialValues: (player, args) => args.settings ?? loadPbeSettings(),
        onSubmit(result, player) {
            if (!isPbeAdmin(player)) {
                player.sendMessage("§c只有管理员可以修改该设置。");
                return;
            }
            const next = normalizePbeSettings({
                ...DEFAULT_PBE_SETTINGS,
                allowPlayerImport: result.allowPlayerImport,
            });
            savePbeSettings(next);
            player.sendMessage(
                `§a[PianoBE] 玩家导入已${next.allowPlayerImport ? "开启" : "关闭"}`
            );
        },
    }
);

/** 打开管理员设置（供 `/pbe:pbe_setting` 使用）。 */
export function openPbeSettings(player: Player) {
    if (!isPbeAdmin(player)) {
        player.sendMessage("§c该命令仅限管理员使用。");
        return;
    }
    formManager.open(player, PbeSettingsForm, { settings: loadPbeSettings() });
}
