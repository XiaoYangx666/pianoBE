import type { Player } from "@minecraft/server";
import { CommonForm, FieldType, formManager, type contextArgs } from "sapi-pro";
import {
    DEFAULT_PBE_SETTINGS,
    normalizePbeSettings,
    PBE_STORAGE_LIMITS,
    type PbeSettings,
} from "@domain/settings/pbeSettings";
import { loadPbeSettings, savePbeSettings } from "@platform/storage/pbeSettingsStore";
import { isPbeAdmin } from "@app/permissions";
import { formatBytes } from "@piano/core";

interface PbeSettingsArgs extends contextArgs {
    settings: PbeSettings;
}

function storageValidator(label: string) {
    return (value: number): string | undefined => {
        if (!Number.isInteger(value)) return `${label}必须是整数（字节）`;
        if (value < PBE_STORAGE_LIMITS.min || value > PBE_STORAGE_LIMITS.max) {
            return `${label}需在 ${formatBytes(PBE_STORAGE_LIMITS.min)} ~ ${formatBytes(PBE_STORAGE_LIMITS.max)} 之间`;
        }
        return undefined;
    };
}

/**
 * 管理员设置：使用 SAPI-Pro CommonForm.ConfigForm（一次性表单，不改成 DDUI）。
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
        pianoStorageBytes: {
            type: FieldType.Number,
            label: "每架钢琴内置存储上限（字节）",
            tooltip: `默认 ${formatBytes(DEFAULT_PBE_SETTINGS.pianoStorageBytes)}。只降低上限不会删除已有歌曲，但会禁止继续新增。`,
            defaultValue: DEFAULT_PBE_SETTINGS.pianoStorageBytes,
            validators: [storageValidator("钢琴存储上限")],
        },
        cardStorageBytes: {
            type: FieldType.Number,
            label: "每张存储卡容量上限（字节）",
            tooltip: `默认 ${formatBytes(DEFAULT_PBE_SETTINGS.cardStorageBytes)}。已写满的卡仍可读取与删除。`,
            defaultValue: DEFAULT_PBE_SETTINGS.cardStorageBytes,
            validators: [storageValidator("存储卡容量")],
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
                pianoStorageBytes: result.pianoStorageBytes,
                cardStorageBytes: result.cardStorageBytes,
            });
            savePbeSettings(next);
            player.sendMessage(
                `§a[PianoBE] 玩家导入已${next.allowPlayerImport ? "开启" : "关闭"}；` +
                `钢琴存储 ${formatBytes(next.pianoStorageBytes)}，存储卡 ${formatBytes(next.cardStorageBytes)}`
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
