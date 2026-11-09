import type { ObservableBoolean, ObservableNumber, ObservableString } from "@minecraft/server-ui";

export interface PianoState {
    octave: ObservableBoolean;
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
