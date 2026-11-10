import type { ObservableBoolean, ObservableNumber, ObservableString } from "@minecraft/server-ui";

export interface PianoState {
    octave: ObservableBoolean;
    /** 简洁模式：只留输入框和开关，隐藏文字与所有按钮 */
    compact: ObservableBoolean;
    /** 由 compact 派生，绑定控件可见性（控件只接受正向 ObservableBoolean） */
    fullUI: ObservableBoolean;
    input: ObservableString;
    keyMap: ObservableNumber;
    mode: ObservableBoolean;
    sound: ObservableNumber;
}

export interface PianoUIRefs {
    status: ObservableString;
    rows: ObservableString[];
    keyMapLabel: ObservableString;
    modeLabel: ObservableString;
    soundLabel: ObservableString;
}
