import { Block, Player } from "@minecraft/server";
import { CustomForm, ObservableBoolean, ObservableString } from "@minecraft/server-ui";
import { SCORE_RESOURCE_PACK_ID } from "@data/scorePack";
import { AVAILABLE_SCORES, scoreAt } from "@domain/score/score";
import { NoteInfo } from "@domain/types";
import { processNote } from "@domain/util/note";
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

export function switchComMode(state: PianoState, p: Player) {
    const newMode = !state.mode.getData();
    state.mode.setData(newMode);
    p.setDynamicProperty("piano:comMode", newMode);
}

/** 面板里的音长按钮：跟随钢琴 → 长音 → 标准音 → 短音 → 跟随钢琴 */
export function switchSoundType(state: PianoState, p: Player) {
    const next = state.sound.getData() + 1;
    const idx = next >= soundTypes.length ? FOLLOW_PIANO_LAYER : next;
    state.sound.setData(idx);
    p.setDynamicProperty("piano:sound", idx);
}

type Cleanup = () => void;

function trackObservable<T>(
    observable: {
        subscribe(callback: (value: T) => void): (value: T) => void;
        unsubscribe(callback: (value: T) => void): boolean;
    },
    callback: (value: T) => void,
    cleanups: Cleanup[]
) {
    const handle = observable.subscribe(callback);
    cleanups.push(() => observable.unsubscribe(handle));
}

function addScoreControls(
    form: CustomForm,
    state: PianoState,
    controlsVisible: ObservableBoolean,
    cleanups: Cleanup[]
) {
    // Earlier DDUI versions still need to be able to open the piano panel.
    if (typeof form.image !== "function" || AVAILABLE_SCORES.length === 0) return;
    const showScore = state.showScore;
    const visible = new ObservableBoolean(false);
    const source = new ObservableString("");
    const atStart = new ObservableBoolean(true);
    const atEnd = new ObservableBoolean(true);

    const pages = () => scoreAt(state.score.getData())?.pages ?? [];

    const updateVisibility = () => visible.setData(controlsVisible.getData() && showScore.getData());
    trackObservable(showScore, updateVisibility, cleanups);
    trackObservable(controlsVisible, updateVisibility, cleanups);
    updateVisibility();

    const syncPage = () => {
        const list = pages();
        const page = Math.max(0, Math.min(state.scorePage.getData(), list.length - 1));
        if (page !== state.scorePage.getData()) {
            // 越界时先纠正下标，订阅会再同步一次。
            state.scorePage.setData(page);
            return;
        }
        source.setData(list[page] ?? "");
        atStart.setData(page === 0);
        atEnd.setData(page >= list.length - 1);
    };
    trackObservable(state.scorePage, syncPage, cleanups);

    // 曲谱选择在独立的曲谱配置表单里完成；本表单只预览当前选中的曲谱。
    const onScoreChange = () => {
        state.scorePage.setData(0);
        syncPage();
    };
    trackObservable(state.score, onScoreChange, cleanups);
    syncPage();

    const turnPage = (step: number) => {
        const next = state.scorePage.getData() + step;
        if (!visible.getData() || next < 0 || next >= pages().length) return;
        state.scorePage.setData(next);
    };

    form.toggle("在面板中显示曲谱", showScore, { visible: controlsVisible });
    form.image(source, SCORE_RESOURCE_PACK_ID, { visible, width: .96 })
        .button("上一页", () => turnPage(-1), { visible, disabled: atStart })
        .button("下一页", () => turnPage(1), { visible, disabled: atEnd });
}

export interface PianoUIActions {
    openMidi(): void;
    openSettings(): void;
    openScores(): void;
    openShortcuts(): void;
    openImport(): void;
}

export function createPianoUI(
    p: Player,
    state: PianoState,
    ui: PianoUIRefs,
    _getBlock: () => Block | null,
    actions: PianoUIActions,
    cleanups: Cleanup[] = []
) {
    const options = { visible: state.controlsVisible };

    const form = new CustomForm(p, "文本钢琴")
        .label(ui.status, options)
        .label("   ", options);

    ui.rows.forEach((row) => form.label(row, options));

    form.label("   ", options)
        .textField("在此处快速打字...", state.input);
    addScoreControls(form, state, state.controlsVisible, cleanups);
    form.toggle("升8度 (高音模式)", state.octave)
        .button(
            ui.keyMapLabel,
            () => {
                switchKeyMap(state, p);
                updatePianoUI(state, ui);
            },
            options
        )
        .button(
            ui.modeLabel,
            () => {
                switchComMode(state, p);
                updatePianoUI(state, ui);
            },
            options
        )
        .button(
            ui.soundLabel,
            () => {
                switchSoundType(state, p);
                updatePianoUI(state, ui);
            },
            options
        )
        .button("♪ MIDI 播放器", () => actions.openMidi(), options)
        .button("钢琴设置", () => actions.openSettings(), options)
        .button("曲谱配置", () => actions.openScores(), options)
        .button("快捷键设置", () => actions.openShortcuts(), options)
        .button("导入 MIDI", () => actions.openImport(), options)
        .toggle("简洁模式", state.compact);

    return form;
}

const emptyInfo: NoteInfo = {
    name: "无",
    sample: "无",
    pitch: 0,
    midi: -1,
};

/** 值没变就不写 Observable，减少每键一次的客户端同步与字符串分配。 */
function setIfChanged(observable: ObservableString, value: string) {
    if (observable.getData() !== value) observable.setData(value);
}

export function updatePianoUI(
    state: PianoState,
    ui: PianoUIRefs,
    last?: NoteInfo
) {
    if (!state.controlsVisible.getData()) return;

    const keyMap = keyMaps[state.keyMap.getData()].value;

    const info = last ?? emptyInfo;

    setIfChanged(ui.keyMapLabel, `当前方案: ${keyMaps[state.keyMap.getData()].name}`);
    //更新模式
    setIfChanged(
        ui.modeLabel,
        state.mode.getData() ? "模式: 单音模式" : "模式: 连音模式"
    );
    //更新sound类型
    const sound = state.sound.getData();
    setIfChanged(
        ui.soundLabel,
        sound < 0
            ? "音长: 跟随钢琴"
            : `音长: ${soundTypes[sound]?.name ?? soundTypes[0].name}`
    );

    if (last) {
        setIfChanged(
            ui.status,
            `§l§f音符: §a${info.name}\n§7音高: §e${info.pitch.toFixed(3)} §7采样: ${info.sample}`
        );
    } else {
        const hasGaps = PIANO_LAYOUT.some((row) =>
            row.some((k) => k.trim() !== "" && keyMap[k] === undefined)
        );
        setIfChanged(
            ui.status,
            hasGaps
                ? `§b钢琴已就绪\n§7深灰色按键为当前方案的空位`
                : `§b钢琴已就绪`
        );
    }

    // 键位行来自 per-piano active keys，由会话用当前 keyMap/octave 渲染。
    ui.renderRows?.();
}

/** 用一架钢琴的 active MIDI notes 渲染当前玩家视角的键位行。 */
export function updatePianoRows(
    state: PianoState,
    ui: PianoUIRefs,
    activeNotes: ReadonlySet<number>
) {
    const isHigh = state.octave.getData();
    const baseColor = isHigh ? "§b" : "§7";
    const keyMap = keyMaps[state.keyMap.getData()].value;

    PIANO_LAYOUT.forEach((row, i) => {
        let rowStr = "  ";
        for (const k of row) {
            const key = keyMap[k];
            const bound = key !== undefined;
            const active = key !== undefined && activeNotes.has(processNote(key, isHigh).midi);
            if (active) {
                rowStr += ` §a§l${k}§r `;
            } else {
                rowStr += bound
                    ? ` ${baseColor}${k}§r `
                    : ` §8${k}§r `;
            }
        }
        setIfChanged(ui.rows[i], rowStr);
    });
}
