import { resolveInstrument } from "@platform/assembly";
import { Block, Player, system } from "@minecraft/server";
import { DDUI, Vector3Utils } from "sapi-pro";
import { handleInput, handleShortcuts } from "@app/inputHandler";
import { pianoWorld } from "@app/PianoWorld";
import type { PianoRuntime } from "@app/PianoRuntime";
import {
    addScoreControls,
    switchComMode,
    switchKeyMap,
    switchSoundType,
    updatePianoRows,
    updatePianoUI,
} from "@app/ui/pianoUI";
import { createPianoState, createPianoView } from "@app/ui/pianoState";
import { pianoViewModel } from "@app/ui/pianoViewModel";
import { scoreIndexOf } from "@domain/score/score";
import { MidiPlayerPage } from "@app/ui/midi/playerUI";
import { MidiImportPage } from "@app/ui/midi/importUI";
import { PianoSettingsPage } from "@app/ui/settingsUI";
import { PianoScorePage } from "@app/ui/scoreUI";
import { loadShortcuts, ShortcutSettingsForm } from "@app/ui/shortcutUI";

/** 连音模式下保留的输入尾部长度；parseInput 只读最后 1~3 个字符。 */
const MAX_INPUT_LENGTH = 32;

/**
 * 文本钢琴主面板。
 *
 * 业务状态（PianoState）与输入解析留在 PianoBE；页面生命周期、订阅、定时器、
 * 导航与“旧会话失效”由 DDUI 负责。面板关闭/返回时不会重建整张表单以外的任何东西。
 */
export const PianoPanelPage = DDUI.page<{ piano: PianoRuntime; block: Block }>(
    "文本钢琴",
    (ui, args) => {
        const player = ui.player;
        const { piano, block } = args;
        if (!block.isValid || !piano.isAlive()) {
            ui.close();
            return;
        }
        ui.subscribe(piano.disposedSignal, () => ui.close());

        const state = createPianoState(player, ui);
        const view = createPianoView(ui);
        const shortcuts = loadShortcuts(player);
        /** 这架钢琴共享的按键视图；它的生命周期属于 PianoRuntime，页面只订阅。 */
        const viewModel = pianoViewModel(piano);
        const activeNotes = () => viewModel.activeNotes();

        // 共享按键变化只重绘 4 行文本，不重建表单
        ui.subscribe(viewModel.activeKeys, () => updatePianoRows(state, view, activeNotes()));

        // 玩家级状态持久化；ui.set 的同步不会触发
        ui.onChange(state.octave, (octave) => {
            if (player.isValid) player.setDynamicProperty("piano:octave", octave);
            updatePianoUI(state, view, activeNotes());
        });
        ui.onChange(state.compact, (compact) => {
            if (player.isValid) player.setDynamicProperty("piano:compact", compact);
            updatePianoUI(state, view, activeNotes());
        });
        ui.onChange(state.showScore, (show) => {
            if (player.isValid) player.setDynamicProperty("piano:scorePreview", show);
        });

        // 打开时同步：大钢琴只有主面板入口，简洁模式只在有屏幕的钢琴上生效
        ui.set(state.compact, piano.hasScreen && player.getDynamicProperty("piano:compact") === true);
        ui.set(state.score, scoreIndexOf(piano.settings?.scoreId));

        const shouldClose = () => {
            if (!player.isValid || !piano.isAlive()) return true;
            if (player.dimension.id !== piano.location.dimension.id) return true;
            if (piano.verify(system.currentTick) !== "complete") return true;
            return Vector3Utils.squaredDistance(player.location, piano.center) > 25;
        };

        // === 输入：每个字符一次，只做状态更新与文本写入 ===
        let lastLength = 0;
        let clearScheduled = false;
        ui.onChange(state.input, (value) => {
            if (shouldClose()) return ui.close();

            // 删除/清空不会触发发声
            if (value.length <= lastLength) {
                lastLength = value.length;
                return;
            }
            const added = value.slice(lastLength);
            lastLength = value.length;

            // 先处理本次新输入的快捷键，再按普通音符处理
            if (handleShortcuts(added, state, player, shortcuts)) {
                updatePianoUI(state, view, activeNotes());
            }

            const result = handleInput(value, state, piano, player);
            updatePianoUI(state, view, activeNotes(), result.last);

            // 连音模式不会清空输入框，长期打字只保留一小段尾部
            if (!result.shouldClear && value.length > MAX_INPUT_LENGTH) {
                const trimmed = value.slice(-MAX_INPUT_LENGTH);
                lastLength = trimmed.length;
                ui.set(state.input, trimmed);
            }

            if (result.shouldClear && !clearScheduled) {
                clearScheduled = true;
                ui.timeout(() => {
                    clearScheduled = false;
                    lastLength = 0;
                    ui.set(state.input, "");
                }, 1);
            }
        });

        updatePianoUI(state, view, activeNotes());

        // === 控件（与迁移前一一对应）===
        const options = { visible: state.controlsVisible };
        ui.label(view.status, options).label("   ", options);
        view.rows.forEach((row) => ui.label(row, options));
        ui.label("   ", options).textField("在此处快速打字...", state.input);

        addScoreControls(ui, state);

        const refresh = () => updatePianoUI(state, view, activeNotes());

        ui.toggle("升8度 (高音模式)", state.octave)
            .button(
                view.keyMapLabel,
                () => {
                    switchKeyMap(state, player);
                    refresh();
                },
                options
            )
            .button(
                view.modeLabel,
                () => {
                    switchComMode(state, player);
                    refresh();
                },
                options
            )
            .button(
                view.soundLabel,
                () => {
                    switchSoundType(state, player);
                    refresh();
                },
                options
            )
            .button("♪ MIDI 播放器", () => ui.push(MidiPlayerPage, { piano, block }), options)
            .button("钢琴设置", () => ui.push(PianoSettingsPage, { piano }), options)
            .button("曲谱配置", () => ui.push(PianoScorePage, { piano }), options)
            .button(
                "快捷键设置",
                () => ui.push(ShortcutSettingsForm, { bindings: loadShortcuts(player) }),
                options
            )
            .button("导入 MIDI", () => ui.push(MidiImportPage), options)
            .toggle("简洁模式", state.compact);
    }
);

/** 对外入口。这里新建的只是玩家级 UI 页面，真实 PianoRuntime 由 PianoWorld 缓存复用。 */
export function openPiano(player: Player, block: Block) {
    if (!player.isValid || !block.isValid) return;
    const location = resolveInstrument(block);
    const anchor = location?.dimension.getBlock(location.pos);
    const piano = location ? pianoWorld.get(location) : undefined;
    if (!anchor || !piano || !piano.isAlive()) return;
    DDUI.open(player, PianoPanelPage, { piano, block: anchor });
}
