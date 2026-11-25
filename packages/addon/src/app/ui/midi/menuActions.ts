import type { DDUIContext } from "sapi-pro";
import type { PianoRuntime } from "@app/PianoRuntime";

/**
 * MIDI 播放器主界面的可选菜单入口。
 *
 * 基础包只提供注册表，不关心具体功能；服务器版构建在初始化后注册自己的入口，
 * 普通版构建不注册任何动作，因此不会出现不可用的按钮。
 */
export interface MidiMenuAction {
    /** 去重键：重复初始化不会叠加按钮 */
    readonly id: string;
    readonly label: string;
    open(ui: DDUIContext<any>, piano: PianoRuntime): void;
}

const actions: MidiMenuAction[] = [];

export function registerMidiMenuAction(action: MidiMenuAction): void {
    const index = actions.findIndex((item) => item.id === action.id);
    if (index >= 0) actions[index] = action;
    else actions.push(action);
}

export function midiMenuActions(): readonly MidiMenuAction[] {
    return actions;
}
