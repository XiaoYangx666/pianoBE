import type { ObservableBoolean, ObservableNumber, ObservableString } from "@minecraft/server-ui";

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

export interface PianoUIRefs {
    status: ObservableString;
    rows: ObservableString[];
    keyMapLabel: ObservableString;
    modeLabel: ObservableString;
    soundLabel: ObservableString;
    /** 使用 per-piano active keys + 当前玩家的 keyMap/octave 重绘键位行。 */
    renderRows?: () => void;
}
