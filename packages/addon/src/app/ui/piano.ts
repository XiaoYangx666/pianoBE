import { resolveInstrument } from "@platform/assembly";
import { Block, Player, system } from "@minecraft/server";
import { DDUIManager } from "@app/ui/ddui";
import { Vector3Utils } from "sapi-pro";
import { handleInput } from "@app/inputHandler";
import { pianoWorld } from "@app/PianoWorld";
import type { PianoRuntime } from "@app/PianoRuntime";
import { createPianoUI, updatePianoUI } from "@app/ui/pianoUI";
import { FOLLOW_PIANO_LAYER, soundTypes } from "@domain/piano/soundTypes";
import { openMidiPlayer } from "@app/ui/midi/playerUIManager";
import { openPianoSettings } from "@app/ui/settingsUI";
import type { PianoState, PianoUIRefs } from "@app/ui/pianoState";
import {
    ObservableBoolean,
    ObservableNumber,
    ObservableString,
} from "@minecraft/server-ui";

/** 单个玩家的 Piano 实例 */
class PianoInstance {
    private form: any;
    private state!: PianoState;
    private ui!: PianoUIRefs;
    private piano?: PianoRuntime;
    private unsubscribePiano?: () => void;

    private leftBlock: Block | null = null;
    private inited = false;
    private lastLength = 0;
    /** 防止同一帧内连续交互导致 show() 并发调用（两次 show 会刷新表单实例，客户端写入被拒） */
    private opening = false;
    /** 上一次表单关闭的 tick，用于避免“刚关闭就重开”的 DDUI 竞态 */
    private lastClosedTick = -1;

    constructor(private player: Player) {}

    /** 设置当前钢琴方块 */
    setPianoBlock(block: Block) {
        const location = resolveInstrument(block);
        if (!location) return false;
        const anchor = location.dimension.getBlock(location.pos);
        const piano = pianoWorld.get(location);
        if (!anchor || !piano) return false;
        this.leftBlock = anchor;
        if (this.piano !== piano) {
            this.unsubscribePiano?.();
            this.piano = piano;
            this.unsubscribePiano = piano.disposedSignal.subscribe(() => {
                this.piano = undefined;
                this.leftBlock = null;
                this.unsubscribePiano = undefined;
                this.close();
            });
        }
        return true;
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

        this.state = {
            keyMap: new ObservableNumber(keyMapIdx),
            mode: new ObservableBoolean(mode),
            octave: new ObservableBoolean(false, {
                clientWritable: true,
            }),
            compact: new ObservableBoolean(compact, {
                clientWritable: true,
            }),
            controlsVisible: new ObservableBoolean(!compact),
            input: new ObservableString("", {
                clientWritable: true,
            }),
            sound: new ObservableNumber(sound),
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
            }
        );

        // === 订阅（只注册一次）===

        // 输入
        this.state.input.subscribe((val) => {
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

            this.lastLength = val.length;

            // 处理输入
            const result = handleInput(val, this.state, this.piano!, this.player);

            // 更新 UI
            updatePianoUI(this.state, this.ui, result.keys, result.last);

            // 清空输入
            if (result.shouldClear) {
                system.runTimeout(() => {
                    this.state.input.setData("");
                }, 1);
            }
        });
        // 升8度
        this.state.octave.subscribe(() => {
            updatePianoUI(this.state, this.ui, []);
        });

        // 简洁模式：隐藏文字与按钮，只留输入框和开关；选择按玩家保存
        this.state.compact.subscribe((compact) => {
            if (this.player.isValid) this.player.setDynamicProperty("piano:compact", compact);
            this.state.controlsVisible.setData(!compact);
            updatePianoUI(this.state, this.ui, []);
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
            // 重置输入状态
            this.lastLength = 0;
            this.state.input.setData("");

            // 刷新 UI
            updatePianoUI(this.state, this.ui, []);

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
        if (!this.player.isValid) return;
        this.close();
        this.lastClosedTick = system.currentTick;
        system.runTimeout(() => {
            if (this.player.isValid) open();
        }, 2);
    }

    /** 「MIDI 播放器」入口 */
    private openMidi() {
        const block = this.leftBlock;
        if (!block || !this.player.isValid) return;
        this.reopen(() => {
            if (block.isValid) void openMidiPlayer(this.player, block);
        });
    }

    /** 「钢琴设置」入口 */
    private openSettings() {
        const piano = this.piano;
        if (!piano || !this.player.isValid) return;
        this.reopen(() => {
            if (piano.isAlive()) void openPianoSettings(this.player, piano);
        });
    }

    /** 实例被新会话替换时清理（旧 Player 表单已不可再交互） */
    dispose() {
        this.close();
        this.unsubscribePiano?.();
        this.unsubscribePiano = undefined;
        this.piano = undefined;
        this.inited = false;
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

    isShowing() {
        return this.form?.isShowing?.() ?? false;
    }
}

/** Piano 管理器 */
class PianoManager extends DDUIManager<PianoInstance> {
    protected create(player: Player): PianoInstance {
        return new PianoInstance(player);
    }

    protected discard(inst: PianoInstance): void {
        inst.dispose();
    }

    async open(player: Player, block: Block) {
        if (!player.isValid) return;

        const inst = this.get(player);

        if (!inst.setPianoBlock(block)) return;

        if (inst.isShowing()) return;

        await inst.show();
    }
}

// 单例导出
export const pianoManager = new PianoManager();

/** 对外入口 */
export async function openPiano(p: Player, block: Block) {
    await pianoManager.open(p, block);
}
