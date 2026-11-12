import { resolveInstrument } from "@platform/assembly";
import { Block, Player, system } from "@minecraft/server";
import { Vector3Utils } from "sapi-pro";
import { handleInput, handleShortcuts } from "@app/inputHandler";
import { pianoWorld } from "@app/PianoWorld";
import type { PianoRuntime } from "@app/PianoRuntime";
import { createPianoUI, updatePianoRows, updatePianoUI } from "@app/ui/pianoUI";
import { pianoViewModel, type PianoViewModel } from "@app/ui/pianoViewModel";
import { FOLLOW_PIANO_LAYER, soundTypes } from "@domain/piano/soundTypes";
import { scoreIndexOf } from "@domain/score/score";
import { openMidiPlayer } from "@app/ui/midi/playerUIManager";
import { openMidiImport } from "@app/ui/midi/importUI";
import { openPianoSettings } from "@app/ui/settingsUI";
import { openScoreConfig } from "@app/ui/scoreUI";
import { loadShortcuts, openShortcutSettings } from "@app/ui/shortcutUI";
import type { ShortcutBindings } from "@domain/piano/shortcuts";
import type { PianoState, PianoUIRefs } from "@app/ui/pianoState";
import {
    ObservableBoolean,
    ObservableNumber,
    ObservableString,
} from "@minecraft/server-ui";

/** 单个玩家的钢琴面板 UI 会话；真正的钢琴状态在 PianoRuntime。 */
class PianoPanelSession {
    private form: any;
    private state!: PianoState;
    private ui!: PianoUIRefs;
    private piano?: PianoRuntime;
    private unsubscribePiano?: () => void;
    /** 这架钢琴共享的按键视图。 */
    private viewModel?: PianoViewModel;
    private activeKeysUnsub?: () => void;
    /** 表单内 Observable 的订阅，关闭时显式解绑，避免回调闭包拖住会话。 */
    private readonly cleanups: Array<() => void> = [];
    private disposed = false;

    private leftBlock: Block | null = null;
    private inited = false;
    private lastLength = 0;
    private shortcuts!: ShortcutBindings;
    /** 防止同一帧内连续交互导致 show() 并发调用（两次 show 会刷新表单实例，客户端写入被拒） */
    private opening = false;
    private syncingCompact = false;
    /** 上一次表单关闭的 tick，用于避免“刚关闭就重开”的 DDUI 竞态 */
    private lastClosedTick = -1;

    constructor(private player: Player) {}

    /** 订阅 Observable 并登记解绑函数。 */
    private track<T>(
        observable: {
            subscribe(callback: (value: T) => void): (value: T) => void;
            unsubscribe(callback: (value: T) => void): boolean;
        },
        callback: (value: T) => void
    ) {
        const handle = observable.subscribe(callback);
        this.cleanups.push(() => observable.unsubscribe(handle));
    }

    /** 设置当前钢琴方块 */
    setPianoBlock(block: Block) {
        const location = resolveInstrument(block);
        if (!location) return false;
        const anchor = location.dimension.getBlock(location.pos);
        const piano = pianoWorld.get(location);
        if (!anchor || !piano) return false;

        this.releaseViewModel();
        this.leftBlock = anchor;
        this.piano = piano;

        this.viewModel = pianoViewModel(piano);
        const viewModel = this.viewModel;
        const activeKeys = viewModel.activeKeys.subscribe(() => this.renderRows());
        this.activeKeysUnsub = () => viewModel.activeKeys.unsubscribe(activeKeys);

        this.unsubscribePiano = piano.disposedSignal.subscribe(() => {
            this.piano = undefined;
            this.leftBlock = null;
            this.unsubscribePiano = undefined;
            this.close();
        });
        return true;
    }

    /** 释放本会话对共享 view model 的引用，不销毁 view model。 */
    private releaseViewModel() {
        this.activeKeysUnsub?.();
        this.activeKeysUnsub = undefined;
        this.unsubscribePiano?.();
        this.unsubscribePiano = undefined;
        this.viewModel = undefined;
    }

    /** 用共享 active keys + 当前玩家的 keyMap/octave 重绘键位行。 */
    private renderRows() {
        if (!this.state || !this.ui) return;
        updatePianoRows(this.state, this.ui, this.viewModel?.activeNotes() ?? new Set());
    }

    /** 初始化（只执行一次） */
    private init() {
        if (this.inited || !this.leftBlock || !this.piano?.isAlive() || !this.player.isValid) return;
        this.inited = true;

        // === state ===
        const keyMapIdx =
            (this.player.getDynamicProperty("piano:keyMap") as number) ?? 0;
        const mode =
            (this.player.getDynamicProperty("piano:comMode") as boolean) ??
            true;
        const storedSound = this.player.getDynamicProperty("piano:sound");
        const sound = typeof storedSound === "number" && soundTypes[storedSound]
            ? storedSound
            : FOLLOW_PIANO_LAYER;
        const compact = this.player.getDynamicProperty("piano:compact") === true;
        const showScore = this.player.getDynamicProperty("piano:scorePreview") === true;
        const octave = this.player.getDynamicProperty("piano:octave") === true;

        this.state = {
            keyMap: new ObservableNumber(keyMapIdx),
            mode: new ObservableBoolean(mode),
            octave: new ObservableBoolean(octave, {
                clientWritable: true,
            }),
            compact: new ObservableBoolean(compact, {
                clientWritable: true,
            }),
            showScore: new ObservableBoolean(showScore, {
                clientWritable: true,
            }),
            controlsVisible: new ObservableBoolean(!compact),
            input: new ObservableString("", {
                clientWritable: true,
            }),
            sound: new ObservableNumber(sound),
            score: new ObservableNumber(0),
            scorePage: new ObservableNumber(0),
        };

        // === UI ===
        this.ui = {
            status: new ObservableString("§b钢琴已就绪"),
            rows: [
                new ObservableString(""),
                new ObservableString(""),
                new ObservableString(""),
                new ObservableString(""),
            ],
            keyMapLabel: new ObservableString(""),
            modeLabel: new ObservableString(""),
            soundLabel: new ObservableString(""),
            renderRows: () => this.renderRows(),
        };

        // === form（只创建一次）===
        this.form = createPianoUI(
            this.player,
            this.state,
            this.ui,
            () => this.leftBlock,
            {
                openMidi: () => this.openMidi(),
                openSettings: () => this.openSettings(),
                openScores: () => this.openScores(),
                openShortcuts: () => this.openShortcuts(),
                openImport: () => this.openImport(),
            }
        );

        // === 订阅（只注册一次）===

        this.shortcuts = loadShortcuts(this.player);

        // 输入
        this.track(this.state.input, (val) => {
            // ❗玩家 / 方块校验
            if (this.shouldClose()) {
                this.close();
                return;
            }

            // ❗长度控制
            if (val.length <= this.lastLength) {
                this.lastLength = val.length;
                return;
            }

            const added = val.slice(this.lastLength);
            this.lastLength = val.length;

            // 先处理本次新输入的快捷键，再按普通音符处理
            if (handleShortcuts(added, this.state, this.player, this.shortcuts)) {
                updatePianoUI(this.state, this.ui);
            }

            // 处理输入
            const result = handleInput(val, this.state, this.piano!, this.player);

            // 更新 UI
            updatePianoUI(this.state, this.ui, result.last);

            // 清空输入
            if (result.shouldClear) {
                system.runTimeout(() => {
                    if (!this.disposed) this.state.input.setData("");
                }, 1);
            }
        });
        // 升8度
        this.track(this.state.octave, (octave) => {
            if (this.player.isValid) this.player.setDynamicProperty("piano:octave", octave);
            updatePianoUI(this.state, this.ui);
        });

        // 简洁模式：隐藏文字与按钮，只留输入框和开关；选择按玩家保存
        this.track(this.state.compact, (compact) => {
            if (!this.syncingCompact && this.player.isValid) this.player.setDynamicProperty("piano:compact", compact);
            this.state.controlsVisible.setData(!compact);
            updatePianoUI(this.state, this.ui);
        });

        // 曲谱预览开关同样按玩家保存，快捷键与面板开关共用这一份状态
        this.track(this.state.showScore, (show) => {
            if (this.player.isValid) this.player.setDynamicProperty("piano:scorePreview", show);
        });
    }

    /** 打开 UI */
    async show() {
        this.init();
        if (!this.form) return;

        // 已在显示 / 正在打开时不要再次 show，否则会重新绑定 DDUI 实例
        if (this.opening || this.form.isShowing()) return;

        this.opening = true;
        try {
            // Grand pianos use the main panel as the only entry to settings and MIDI.
            const compact = this.piano?.hasScreen === true && this.player.getDynamicProperty("piano:compact") === true;
            this.syncingCompact = true;
            try {
                this.state.compact.setData(compact);
            } finally {
                this.syncingCompact = false;
            }
            // 同步当前钢琴的曲谱选择；首次打开或换了一架琴时更新面板预览
            this.state.score.setData(this.currentScoreIndex());
            this.shortcuts = loadShortcuts(this.player);

            // 重置输入状态
            this.lastLength = 0;
            this.state.input.setData("");

            // 刷新 UI
            updatePianoUI(this.state, this.ui);

            await this.showForm();
        } catch (e) {
            console.error("[piano] 打开表单失败", e);
            this.close();
        } finally {
            this.opening = false;
            this.lastClosedTick = system.currentTick;
        }
    }

    /**
     * 显示表单。
     * 1.26.40 在旧表单还没完全关闭时再次 show 会返回 UserBusy（表单没有真正显示），
     * 此时客户端看到的可能仍是旧界面，但写权限已不在旧表单上，交互就会报
     * "does not have access"。这里等待界面空闲后重试，避免留下这种半打开状态。
     */
    private async showForm() {
        // 刚关闭就重开：等一两个 tick 让客户端完成关闭，避免 hide→show 竞态
        if (this.lastClosedTick >= 0) {
            const wait = 2 - (system.currentTick - this.lastClosedTick);
            if (wait > 0) {
                await new Promise<void>((resolve) =>
                    system.runTimeout(() => resolve(), wait)
                );
            }
        }

        for (let attempt = 0; attempt < 10; attempt++) {
            let reason: string;
            try {
                reason = await this.form.show();
            } catch (e) {
                // 已经在显示：视为成功
                if ((e as { reason?: string })?.reason === "AlreadyShowing") {
                    return;
                }
                throw e;
            }

            if (reason !== "UserBusy") return;

            if (!this.player.isValid) return;
            await new Promise<void>((resolve) =>
                system.runTimeout(() => resolve(), 2)
            );
        }
        console.warn("[piano] 表单打开失败：玩家界面持续处于忙碌状态");
    }

    close() {
        // 1. 关闭 UI
        try {
            if (this.form?.isShowing?.()) {
                this.form.close();
            }
        } catch {
            // 玩家已离开/表单已随旧会话关闭
        }
    }

    /**
     * 面板里的入口按钮：DDUI 同一玩家同时只能有一个表单，
     * 先关掉本表单并记下关闭时刻，等客户端完成关闭后再打开目标界面。
     */
    private reopen(open: () => void) {
        const player = this.player;
        if (!player.isValid) return;
        this.close();
        this.lastClosedTick = system.currentTick;
        system.runTimeout(() => {
            if (player.isValid) open();
        }, 2);
    }

    private currentScoreIndex() {
        return scoreIndexOf(this.piano?.settings?.scoreId);
    }

    /** 「MIDI 播放器」入口 */
    private openMidi() {
        const player = this.player;
        const block = this.leftBlock;
        if (!block || !player.isValid) return;
        this.reopen(() => {
            if (block.isValid) void openMidiPlayer(player, block);
        });
    }

    /** 「钢琴设置」入口 */
    private openSettings() {
        const player = this.player;
        const piano = this.piano;
        if (!piano || !player.isValid) return;
        this.reopen(() => {
            if (piano.isAlive()) void openPianoSettings(player, piano);
        });
    }

    /** 「曲谱配置」入口 */
    private openScores() {
        const player = this.player;
        const piano = this.piano;
        if (!piano || !player.isValid) return;
        this.reopen(() => {
            if (piano.isAlive()) void openScoreConfig(player, piano);
        });
    }

    /** 「快捷键设置」入口：使用 sapi-pro 的 ConfigForm */
    private openShortcuts() {
        const player = this.player;
        if (!player.isValid) return;
        this.reopen(() => {
            if (!player.isValid) return;
            try {
                openShortcutSettings(player);
            } catch (error) {
                console.warn("[piano] 打开快捷键设置失败", error);
                if (player.isValid) player.sendMessage("§e无法打开快捷键设置。");
            }
        });
    }

    /** 「导入 MIDI」入口（DDUI 分段粘贴） */
    private openImport() {
        const player = this.player;
        if (!player.isValid) return;
        this.reopen(() => {
            if (player.isValid) void openMidiImport(player);
        });
    }

    /** 表单关闭后清理会话；已排队的两 tick 回调只捕获 player，不依赖本对象。 */
    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.close();
        this.releaseViewModel();
        for (const cleanup of this.cleanups.splice(0)) {
            try {
                cleanup();
            } catch {
                // Observable 可能已随旧会话失效
            }
        }
        this.piano = undefined;
        this.leftBlock = null;
        this.form = undefined;
        this.state = undefined as never;
        this.ui = undefined as never;
        this.shortcuts = undefined as never;
        this.player = undefined as never;
        this.inited = false;
        this.lastLength = 0;
        this.opening = false;
    }

    private shouldClose(): boolean {
        const p = this.player;
        const piano = this.piano;

        //玩家失效
        if (!p.isValid) return true;
        // 方块失效
        if (!piano?.isAlive() || p.dimension.id !== piano.location.dimension.id ||
            piano.verify(system.currentTick) !== "complete") return true;
        //距离太远
        if (Vector3Utils.squaredDistance(p.location, piano.center) > 25) {
            return true;
        }
        return false;
    }
}

/** 同一玩家同时只允许一个钢琴面板；关闭后实例直接丢弃。 */
const activePlayers = new Set<string>();

/** 对外入口。这里新建的只是玩家级 UI 包装，真实 PianoRuntime 由 PianoWorld 缓存复用。 */
export async function openPiano(p: Player, block: Block) {
    if (!p.isValid || activePlayers.has(p.id)) return;

    activePlayers.add(p.id);
    const session = new PianoPanelSession(p);
    try {
        if (!session.setPianoBlock(block)) return;
        await session.show();
    } finally {
        activePlayers.delete(p.id);
        session.dispose();
    }
}
