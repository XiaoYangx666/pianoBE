import type { Player } from "@minecraft/server";
import { CommonForm, FieldType, formManager, type contextArgs, type StringConfig } from "sapi-pro";
import {
    DEFAULT_SHORTCUTS,
    isValidShortcutKey,
    normalizeShortcutBindings,
    SHORTCUT_ACTIONS,
    SHORTCUT_CHARS,
    type ShortcutBindings,
} from "@domain/piano/shortcuts";

export const SHORTCUTS_PROPERTY = "piano:shortcuts";

/** 从玩家动态属性读取快捷键；旧存档或损坏数据会回退为空绑定。 */
export function loadShortcuts(player: Player): ShortcutBindings {
    return normalizeShortcutBindings(player.getDynamicProperty(SHORTCUTS_PROPERTY));
}

interface ShortcutArgs extends contextArgs {
    /** 表单里正在编辑的值；校验失败重开时用它保留用户输入 */
    bindings: ShortcutBindings;
}

function textField(label: string): StringConfig<ShortcutArgs> {
    return {
        type: FieldType.String,
        label,
        placeholder: "输入一个符号，留空取消绑定",
        optional: true,
    };
}

/**
 * 快捷键设置：每个动作一个输入框。
 * 校验放在 onSubmit 里统一处理，失败时把输入写回 args 再重开，
 * 这样用户不用把 7 个框重新填一遍。
 */
export const ShortcutSettingsForm = CommonForm.ConfigForm<ShortcutArgs>().create(
    {
        compact: textField("切换简洁模式"),
        octave: textField("升八度"),
        sound: textField("切换音长"),
        legato: textField("切换连音"),
        score: textField("切换曲谱显示"),
        prevPage: textField("曲谱上一页"),
        nextPage: textField("曲谱下一页"),
    },
    {
        title: `快捷键设置（只能填 ${SHORTCUT_CHARS} 中的一个）`,
        submitButton: "保存",
        initialValues: (player, args) => args.bindings ?? loadShortcuts(player),
        onSubmit(result, player, ctx) {
            const draft = { ...DEFAULT_SHORTCUTS };
            const owners = new Map<string, string>();
            let error: string | undefined;

            for (const action of SHORTCUT_ACTIONS) {
                const entered = (result[action.id] ?? "").trim();
                draft[action.id] = entered;
                if (!entered) continue;
                if (!isValidShortcutKey(entered)) {
                    error ??= `「${action.label}」只能填 ${SHORTCUT_CHARS} 中的一个字符`;
                    continue;
                }
                const owner = owners.get(entered);
                if (owner) {
                    error ??= `字符 ${entered} 已经绑定给「${owner}」`;
                    continue;
                }
                owners.set(entered, action.label);
            }

            if (error) {
                ctx.args.bindings = draft;
                player.sendMessage(`§e${error}`);
                ctx.reopen();
                return;
            }

            player.setDynamicProperty(SHORTCUTS_PROPERTY, JSON.stringify(draft));
            player.sendMessage("§a快捷键已保存");
        },
    }
);

/** 打开快捷键设置（sapi-pro 表单管理器会处理并发/重开）。 */
export function openShortcutSettings(player: Player) {
    formManager.open(player, ShortcutSettingsForm, { bindings: loadShortcuts(player) });
}
