import { openMidiPlayer } from "@midiPlayer/ui/playerUI";
import { Block, Player, system } from "@minecraft/server";
import { CustomForm, Observable } from "@minecraft/server-ui";
import { NoteInfo } from "@types";
import { keyMaps } from "./keymap";
import { PIANO_LAYOUT } from "./layout";

export interface PianoState {
    octave: Observable<boolean>;
    fullUI: Observable<boolean>;
    input: Observable<string>;
    keyMap: Observable<number>;
    mode: Observable<boolean>;
}

export interface PianoUIRefs {
    status: Observable<string>;
    rows: Observable<string>[];
}

function switchKeyMap(state: PianoState, p: Player, label: Observable<string>) {
    let idx = state.keyMap.getData();
    idx = (idx + 1) % keyMaps.length;
    state.keyMap.setData(idx);
    label.setData(`当前方案: ${keyMaps[idx].name}`);
    p.setDynamicProperty("piano:keyMap", idx);
}

function switchComMode(
    state: PianoState,
    p: Player,
    label: Observable<string>
) {
    const newMode = !state.mode.getData();
    state.mode.setData(newMode);
    label.setData(newMode ? "模式: 单音模式" : "模式: 连音模式");
    p.setDynamicProperty("piano:comMode", newMode);
}

export function createPianoUI(
    p: Player,
    state: PianoState,
    ui: PianoUIRefs,
    block: Block
) {
    //动态文本
    const keyMapLabel = Observable.create<string>(
        `当前方案: ${keyMaps[state.keyMap.getData()].name}`
    );
    const modeLabel = Observable.create<string>(
        state.mode.getData() ? "模式: 单音模式" : "模式: 连音模式"
    );
    //表单构建
    const options = { visible: state.fullUI };
    const form = CustomForm.create(p, "文本钢琴")
        .label(ui.status, options)
        .label("   ", options);
    ui.rows.forEach((row) => form.label(row, options));
    form.label("   ", options)
        .textField("在此处快速打字...", state.input)
        .toggle("升8度 (高音模式)", state.octave, options)
        .button(
            "MIDI播放",
            () => {
                form.close();
                system.runTimeout(() => openMidiPlayer(p, block), 20);
            },
            options
        )
        .button(
            keyMapLabel,
            () => {
                switchKeyMap(state, p, keyMapLabel);
                updatePianoUI(state, ui, []);
            },
            options
        )
        .button(
            modeLabel,
            () => {
                switchComMode(state, p, modeLabel);
                updatePianoUI(state, ui, []);
            },
            options
        )
        .toggle("详细信息", state.fullUI);

    return form;
}

const emptyInfo: NoteInfo = {
    name: "无",
    sample: "无",
    pitch: 0,
    midi: -1,
};

export function updatePianoUI(
    state: PianoState,
    ui: PianoUIRefs,
    keys: string[],
    last?: NoteInfo
) {
    if (!state.fullUI.getData()) return;

    const isHigh = state.octave.getData();
    const baseColor = isHigh ? "§b" : "§7";

    const info = last ?? emptyInfo;

    ui.status.setData(
        `§l§f音符: §a${info.name}\n§7音高: §e${info.pitch.toFixed(3)}`
    );

    PIANO_LAYOUT.forEach((row, i) => {
        let rowStr = "  ";
        for (const k of row) {
            rowStr += keys.includes(k)
                ? ` §a§l${k}§r `
                : ` ${baseColor}${k}§r `;
        }
        ui.rows[i].setData(rowStr);
    });
}
