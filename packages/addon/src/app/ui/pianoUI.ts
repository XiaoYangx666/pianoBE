import type { Player } from "@minecraft/server";
import type { DDUIContext } from "sapi-pro";
import { SCORE_RESOURCE_PACK_ID } from "@data/scorePack";
import { AVAILABLE_SCORES, scoreAt } from "@domain/score/score";
import { NoteInfo } from "@domain/types";
import { processNote } from "@domain/util/note";
import { soundTypes, FOLLOW_PIANO_LAYER } from "@domain/piano/soundTypes";
import { keyMaps } from "@domain/piano/keymap";
import { PIANO_LAYOUT } from "@domain/piano/layout";
import type { PianoState, PianoView } from "./pianoState";

export function switchKeyMap(state: PianoState, p: Player) {
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

/**
 * 曲谱预览：可见性、当前页图片、上一页/下一页可用状态都由 Observable 派生。
 * 越界页码会被纠正写回 state.scorePage（`ui.set` 不会再触发 onChange）。
 */
export function addScoreControls(ui: DDUIContext<any>, state: PianoState) {
    if (AVAILABLE_SCORES.length === 0) return;

    const visible = ui.computed(
        [state.controlsVisible, state.showScore],
        () => state.controlsVisible.getData() && state.showScore.getData()
    );
    const source = ui.string("", { clientWritable: false });
    const atStart = ui.boolean(true, { clientWritable: false });
    const atEnd = ui.boolean(true, { clientWritable: false });

    const pages = () => scoreAt(state.score.getData())?.pages ?? [];

    let syncing = false;
    const syncPage = () => {
        if (syncing) return;
        syncing = true;
        try {
            const list = pages();
            const raw = state.scorePage.getData();
            const page = Math.max(0, Math.min(raw, list.length - 1));
            if (page !== raw) ui.set(state.scorePage, page);
            ui.set(source, list[page] ?? "");
            ui.set(atStart, page === 0);
            ui.set(atEnd, page >= list.length - 1);
        } finally {
            syncing = false;
        }
    };

    // 翻页 / 曲谱变化时重算（立即执行一次）
    ui.watch([state.scorePage], syncPage);
    ui.onChange(state.score, () => {
        ui.set(state.scorePage, 0);
        syncPage();
    });

    const turnPage = (step: number) => {
        const next = state.scorePage.getData() + step;
        if (!visible.getData() || next < 0 || next >= pages().length) return;
        ui.set(state.scorePage, next);
    };

    ui.toggle("在面板中显示曲谱", state.showScore, { visible: state.controlsVisible })
        .image(source, SCORE_RESOURCE_PACK_ID, { visible, width: 0.96 })
        .button("上一页", () => turnPage(-1), { visible, disabled: atStart })
        .button("下一页", () => turnPage(1), { visible, disabled: atEnd });
}

export function updatePianoUI(
    state: PianoState,
    view: PianoView,
    activeNotes: ReadonlySet<number>,
    last?: NoteInfo
) {
    if (!state.controlsVisible.getData()) return;

    const keyMap = keyMaps[state.keyMap.getData()].value;
    const info = last ?? emptyInfo;
    const sound = state.sound.getData();

    view.write(view.keyMapLabel, `当前方案: ${keyMaps[state.keyMap.getData()].name}`);
    view.write(view.modeLabel, state.mode.getData() ? "模式: 单音模式" : "模式: 连音模式");
    view.write(
        view.soundLabel,
        sound < 0 ? "音长: 跟随钢琴" : `音长: ${soundTypes[sound]?.name ?? soundTypes[0].name}`
    );

    if (last) {
        view.write(
            view.status,
            `§l§f音符: §a${info.name}\n§7音高: §e${info.pitch.toFixed(3)} §7采样: ${info.sample}`
        );
    } else {
        const hasGaps = PIANO_LAYOUT.some(
            (row) => row.some((k) => k.trim() !== "" && keyMap[k] === undefined)
        );
        view.write(
            view.status,
            hasGaps ? `§b钢琴已就绪\n§7深灰色按键为当前方案的空位` : `§b钢琴已就绪`
        );
    }

    // 键位行来自 per-piano active keys，由页面按当前玩家的 keyMap/octave 渲染。
    updatePianoRows(state, view, activeNotes);
}

const emptyInfo: NoteInfo = {
    name: "无",
    sample: "无",
    pitch: 0,
    midi: -1,
};

/** 用一架钢琴的 active MIDI notes 渲染当前玩家视角的键位行。 */
export function updatePianoRows(
    state: PianoState,
    view: PianoView,
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
                rowStr += bound ? ` ${baseColor}${k}§r ` : ` §8${k}§r `;
            }
        }
        view.write(view.rows[i], rowStr);
    });
}
