import { resolveInstrument } from "@platform/assembly";
import { Block, Player, system } from "@minecraft/server";
import { CustomForm, DataDrivenScreenClosedReason, ObservableNumber, ObservableString } from "@minecraft/server-ui";
import { DDUIManager } from "@app/ui/ddui";
import { pianoWorld } from "@app/PianoWorld";
import { MidiPlayer } from "@domain/playback/player";
import { formManager } from "sapi-pro";
import { createMidiPlayerUI, MidiPlayerUIContext, updateUI } from "./playerUI";
import { MidiListForm } from "./midiList";
import { LibraryForm } from "./libraryUI";

class MidiPlayerInstance {
    private form: CustomForm | undefined;
    private ctx!: MidiPlayerUIContext;

    private playerInst?: MidiPlayer;
    private leftBlock: Block | null = null;

    /** 进度滑块：每 tick 同步播放进度；玩家拖动（值明显偏离）→ seek */
    private sliderObs?: ObservableNumber;
    /** 服务器最后一次写入滑块的值（用于区分"自己回写"与"玩家拖动"） */
    private lastSyncedSlider = -1;

    private inited = false;
    private unsub?: () => void;
    /** 防止连续交互导致 show() 并发调用 */
    private opening = false;
    /** 上一次表单关闭的 tick，用于避免“刚关闭就重开”的 DDUI 竞态 */
    private lastClosedTick = -1;

    constructor(private player: Player) {}

    setBlock(block: Block): boolean {
        const location = resolveInstrument(block);
        if (!location) return false;
        const anchor = location.dimension.getBlock(location.pos);
        const piano = pianoWorld.get(location);
        if (!anchor || !piano) return false;
        this.leftBlock = anchor;
        const newPlayer = piano.getMidiPlayer();

        if (this.unsub) {
            try {
                this.unsub();
            } catch {}
            this.unsub = undefined;
        }
        this.playerInst = newPlayer;

        this.unsub = this.playerInst.signal.subscribe(() => {
            if (!this.form?.isShowing?.() || !this.playerInst?.isAlive()) {
                return this.close();
            }
            updateUI(this.ctx, this.playerInst);
            this.syncSlider();
        });

        // 同步上下文
        if (this.ctx) {
            this.ctx.block = anchor;
        }
        return true;
    }

    /** 进度滑块同步：把滑块设为当前播放进度（0~100，时间制） */
    private syncSlider() {
        if (
            !this.sliderObs ||
            !this.form?.isShowing?.() ||
            !this.playerInst?.isAlive()
        ) {
            return;
        }
        const info = this.playerInst.getInfo();
        const pct = Math.round(info.progress * 100);
        if (pct === this.lastSyncedSlider) return;
        this.lastSyncedSlider = pct;
        this.sliderObs.setData(pct);
    }

    /**
     * 监听滑块变化，按"写入者身份"判断：
     * - 值为 lastSyncedSlider（服务器刚写的）→ 忽略
     * - 其它值（clientWritable 下玩家拖动写入）→ seek
     * 这样慢速拖动（±1%）也不会被服务器回写拽回。
     */
    private wireSlider(obs: ObservableNumber) {
        obs.subscribe((v: number) => {
            if (v === this.lastSyncedSlider) return; // 服务器回写
            this.lastSyncedSlider = v;

            const inst = this.playerInst;
            if (!inst?.isAlive()) return;
            const info = inst.getInfo();
            const durSec = (info.durationMs ?? 0) / 1000;
            if (durSec > 0) inst.seek((v / 100) * durSec);
        });
    }

    private init() {
        if (this.inited || !this.leftBlock || !this.player.isValid) return;
        this.inited = true;

        // === Observable（只创建一次）===
        this.ctx = {
            state: new ObservableString("§7加载中..."),
            midiName: new ObservableString(""),
            queue: new ObservableString(""),

            progressText: new ObservableString(""),

            // clientWritable：允许玩家拖动写值（双向绑定）
            progressSlider: new ObservableNumber(0, { clientWritable: true }),

            buttonText: new ObservableString("▶ 播放"),
            playMode: new ObservableString(""),

            block: this.leftBlock!,
        };

        this.sliderObs = this.ctx.progressSlider;
        this.wireSlider(this.sliderObs);

        // === form（只创建一次）===
        this.form = createMidiPlayerUI(
            this.player,
            this.ctx,
            () => this.playerInst!,
            () => this.close(),
            {
                openSongPicker: () => this.openSongPicker(),
                openLibrary: () => this.openLibrary(),
            }
        );
    }

    private openSongPicker() {
        if (!this.player.isValid || !this.playerInst?.isAlive()) return;
        formManager.open(this.player, MidiListForm, {
            midiPlayer: this.playerInst,
            p: 1,
            onBack: () => this.reopen(),
        });
    }

    private openLibrary() {
        if (!this.player.isValid || !this.playerInst?.isAlive()) return;
        formManager.open(this.player, LibraryForm, {
            midiPlayer: this.playerInst,
            onBack: () => this.reopen(),
        });
    }

    /**
     * 从队列等子页面返回播放器：重新走一次打开入口，
     * 重新解析钢琴/运行时并恢复 MIDI 信号订阅。
     *
     * 不能直接调用 show()：close() 会取消订阅，而 show() 不负责重新订阅；
     * 同时旧运行时可能已被卸载或替换，必须重新获取 MidiPlayer。
     */
    private reopen() {
        if (!this.player.isValid || !this.leftBlock) return;
        void midiUIManager.open(this.player, this.leftBlock)
            .catch(error => console.error("[midi] 返回播放器失败", error));
    }

    async show() {
        if (!this.player.isValid) return;
        this.init();
        if (!this.form || !this.playerInst) return;

        // 已在显示 / 正在打开时不要重复 show
        if (this.opening || this.form.isShowing()) return;

        this.opening = true;
        try {
            // 每次打开刷新 UI
            updateUI(this.ctx, this.playerInst);

            await this.showForm();
        } catch (e) {
            console.error(e);
            this.close();
        } finally {
            this.opening = false;
            this.lastClosedTick = system.currentTick;
        }
    }

    /** 显示表单；UserBusy 时稍等重试，避免留下“看似打开但无写权限”的旧界面 */
    private async showForm() {
        // 避免 hide→show 竞态
        if (this.lastClosedTick >= 0) {
            const wait = 2 - (system.currentTick - this.lastClosedTick);
            if (wait > 0) {
                await new Promise<void>((resolve) =>
                    system.runTimeout(() => resolve(), wait)
                );
            }
        }

        for (let attempt = 0; attempt < 10; attempt++) {
            let reason: DataDrivenScreenClosedReason;
            try {
                reason = await this.form!.show();
            } catch (e) {
                if ((e as { reason?: string })?.reason === "AlreadyShowing") {
                    return;
                }
                throw e;
            }

            if (reason !== DataDrivenScreenClosedReason.UserBusy) return;

            if (!this.player.isValid) return;
            await new Promise<void>((resolve) =>
                system.runTimeout(() => resolve(), 2)
            );
        }
        console.warn("[midi] 表单打开失败：玩家界面持续处于忙碌状态");
    }

    close() {
        try {
            if (this.form?.isShowing()) {
                this.form.close();
            }
        } catch {
            // 旧会话的 Player 已失效
        }
        this.unsub?.();
        this.unsub = undefined;
    }

    /** 实例被新会话替换时清理订阅与旧表单 */
    dispose() {
        this.close();
        this.inited = false;
        this.sliderObs = undefined;
    }

    isShowing() {
        return this.form?.isShowing?.() ?? false;
    }
}

class MidiPlayerUIManager extends DDUIManager<MidiPlayerInstance> {
    protected create(player: Player): MidiPlayerInstance {
        return new MidiPlayerInstance(player);
    }

    protected discard(inst: MidiPlayerInstance): void {
        inst.dispose();
    }

    async open(player: Player, block: Block) {
        if (!player.isValid) return;

        const inst = this.get(player);

        const result = inst.setBlock(block);
        if (!result) return;

        if (inst.isShowing()) return;

        await inst.show();
    }
}

export const midiUIManager = new MidiPlayerUIManager();

export async function openMidiPlayer(p: Player, block: Block) {
    await midiUIManager.open(p, block);
}
