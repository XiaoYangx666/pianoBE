import type { Player } from "@minecraft/server";
import type { ObservableBoolean, ObservableNumber, ObservableString } from "@minecraft/server-ui";
import type { DDUIContext, ObservableLike } from "sapi-pro";
import { FOLLOW_PIANO_LAYER, soundTypes } from "@domain/piano/soundTypes";

/**
 * 单个玩家面板的私有状态。
 *
 * 这是输入处理（inputHandler）与面板 UI 之间的业务契约：
 * 快捷键、按钮、输入框都改这一组 Observable，面板负责把它们映射到控件。
 */
export interface PianoState {
    octave: ObservableBoolean;
    /** 简洁模式：只留输入框和开关，隐藏文字与所有按钮 */
    compact: ObservableBoolean;
    /** 在面板里显示当前曲谱预览（快捷键可切换） */
    showScore: ObservableBoolean;
    /** 由 compact 派生，绑定控件可见性（控件只接受正向 ObservableBoolean） */
    controlsVisible: ObservableBoolean;
    input: ObservableString;
    keyMap: ObservableNumber;
    mode: ObservableBoolean;
    sound: ObservableNumber;
    /** 当前钢琴选择的曲谱下标；面板与谱架共用该选择 */
    score: ObservableNumber;
    /** 面板曲谱预览当前页（每页一张图） */
    scorePage: ObservableNumber;
}

/** 面板显示用的只读 Observable + 统一的“值不变不写”写入入口 */
export interface PianoView {
    status: ObservableString;
    rows: ObservableString[];
    keyMapLabel: ObservableString;
    modeLabel: ObservableString;
    soundLabel: ObservableString;
    write<T>(observable: ObservableLike<T>, value: T): void;
}

const KEY_ROW_COUNT = 4;

/** 从玩家动态属性恢复面板状态；紧凑模式是否生效由页面按钢琴类型决定。 */
export function createPianoState(player: Player, ui: DDUIContext<any>): PianoState {
    const keyMap = (player.getDynamicProperty("piano:keyMap") as number) ?? 0;
    const mode = (player.getDynamicProperty("piano:comMode") as boolean) ?? true;
    const storedSound = player.getDynamicProperty("piano:sound");
    const sound =
        typeof storedSound === "number" && soundTypes[storedSound] ? storedSound : FOLLOW_PIANO_LAYER;
    const compact = player.getDynamicProperty("piano:compact") === true;
    const showScore = player.getDynamicProperty("piano:scorePreview") === true;
    const octave = player.getDynamicProperty("piano:octave") === true;

    const compactObs = ui.boolean(compact);
    return {
        keyMap: ui.number(keyMap, { clientWritable: false }),
        mode: ui.boolean(mode, { clientWritable: false }),
        octave: ui.boolean(octave),
        compact: compactObs,
        showScore: ui.boolean(showScore),
        controlsVisible: ui.computed([compactObs], () => !compactObs.getData()),
        input: ui.string(""),
        sound: ui.number(sound, { clientWritable: false }),
        score: ui.number(0, { clientWritable: false }),
        scorePage: ui.number(0, { clientWritable: false }),
    };
}

/** 面板显示状态：由页面创建一次，控件直接绑定这些 Observable。 */
export function createPianoView(ui: DDUIContext<any>): PianoView {
    return {
        status: ui.string("§b钢琴已就绪", { clientWritable: false }),
        rows: Array.from({ length: KEY_ROW_COUNT }, () => ui.string("", { clientWritable: false })),
        keyMapLabel: ui.string("", { clientWritable: false }),
        modeLabel: ui.string("", { clientWritable: false }),
        soundLabel: ui.string("", { clientWritable: false }),
        write: <T>(observable: ObservableLike<T>, value: T) => ui.set(observable, value),
    };
}
