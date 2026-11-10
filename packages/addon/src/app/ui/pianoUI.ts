import { Block, Player } from "@minecraft/server";
import { CustomForm } from "@minecraft/server-ui";
import { NoteInfo } from "@domain/types";
import { soundTypes, FOLLOW_PIANO_LAYER } from "@domain/piano/soundTypes";
import { keyMaps } from "@domain/piano/keymap";
import { PIANO_LAYOUT } from "@domain/piano/layout";
import type { PianoState, PianoUIRefs } from "./pianoState";

function switchKeyMap(state: PianoState, p: Player) {
    let idx = state.keyMap.getData();
    idx = (idx + 1) % keyMaps.length;
    state.keyMap.setData(idx);
    p.setDynamicProperty("piano:keyMap", idx);
}

function switchComMode(state: PianoState, p: Player) {
    const newMode = !state.mode.getData();
    state.mode.setData(newMode);
    p.setDynamicProperty("piano:comMode", newMode);
}

/** 面板里的音长按钮：跟随钢琴 → 长音 → 标准音 → 短音 → 跟随钢琴 */
function switchSoundType(state: PianoState, p: Player) {
    const next = state.sound.getData() + 1;
    const idx = next >= soundTypes.length ? FOLLOW_PIANO_LAYER : next;
    state.sound.setData(idx);
    p.setDynamicProperty("piano:sound", idx);
}

export interface PianoUIActions {
    openMidi(): void;
    openSettings(): void;
}

export function createPianoUI(
    p: Player,
    state: PianoState,
    ui: PianoUIRefs,
    _getBlock: () => Block | null,
    actions: PianoUIActions
) {
    const options = { visible: state.fullUI };

    const form = new CustomForm(p, "文本钢琴")
        .label(ui.status, options)
        .label("   ", options);

    ui.rows.forEach((row) => form.label(row, options));

    form.label("   ", options)
        .textField("在此处快速打字...", state.input)
        .toggle("升8度 (高音模式)", state.octave)
        .button(
            ui.keyMapLabel,
            () => {
                switchKeyMap(state, p);
                updatePianoUI(state, ui, []);
            },
            options
        )
        .button(
            ui.modeLabel,
            () => {
                switchComMode(state, p);
                updatePianoUI(state, ui, []);
            },
            options
        )
        .button(
            ui.soundLabel,
            () => {
                switchSoundType(state, p);
                updatePianoUI(state, ui, []);
            },
            options
        )
        .button("♪ MIDI 播放器", () => actions.openMidi(), options)
        .button("钢琴设置", () => actions.openSettings(), options)
        .toggle("简洁模式", state.compact);

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
    const keyMap = keyMaps[state.keyMap.getData()].value;

    const info = last ?? emptyInfo;
    // 当前方案中未绑定音高的按键（黑键方案里钢琴没有黑键的空位）
    const unmapped = keys.filter(
        (k) => k.trim() !== "" && keyMap[k] === undefined
    );

    ui.keyMapLabel.setData(`当前方案: ${keyMaps[state.keyMap.getData()].name}`);
    //更新模式
    ui.modeLabel.setData(
        state.mode.getData() ? "模式: 单音模式" : "模式: 连音模式"
    );
    //更新sound类型
    const sound = state.sound.getData();
    ui.soundLabel.setData(
        sound < 0
            ? "音长: 跟随钢琴"
            : `音长: ${soundTypes[sound]?.name ?? soundTypes[0].name}`
    );

    if (last) {
        ui.status.setData(
            `§l§f音符: §a${info.name}\n§7音高: §e${info.pitch.toFixed(3)} §7采样: ${info.sample}`
        );
    } else if (unmapped.length > 0) {
        // 未绑定的按键不再显示"采样: 无"，改为明确提示，避免误以为采样缺失
        ui.status.setData(
            `§c「${unmapped.join(" ")}」在当前方案中没有对应琴键\n§7这些位置在钢琴上没有黑键，可切换「不带黑键方案」使用全部按键`
        );
    } else {
        const hasGaps = PIANO_LAYOUT.some((row) =>
            row.some((k) => k.trim() !== "" && keyMap[k] === undefined)
        );
        ui.status.setData(
            hasGaps
                ? `§b🎹 钢琴已就绪\n§7深灰色按键为当前方案的空位`
                : `§b🎹 钢琴已就绪`
        );
    }

    PIANO_LAYOUT.forEach((row, i) => {
        let rowStr = "  ";
        for (const k of row) {
            const bound = keyMap[k] !== undefined;
            if (keys.includes(k)) {
                rowStr += bound ? ` §a§l${k}§r ` : ` §c§l${k}§r `;
            } else {
                rowStr += bound
                    ? ` ${baseColor}${k}§r `
                    : ` §8${k}§r `;
            }
        }
        ui.rows[i].setData(rowStr);
    });
}
