import { resolveInstrument } from "@platform/assembly";
import { Block, Player, system } from "@minecraft/server";
import { CustomForm, DataDrivenScreenClosedReason, ObservableNumber } from "@minecraft/server-ui";
import { pianoWorld } from "@app/PianoWorld";
import { MidiPlayer } from "@domain/playback/player";
import { formManager } from "sapi-pro";
import { createMidiPlayerUI, MidiPlayerUIContext } from "./playerUI";
import { MidiPlayerViewModel, midiViewModel } from "./playerViewModel";
import { MidiListForm } from "./midiList";
import { LibraryForm } from "./libraryUI";

/** 从点子页面返回播放器：只捕获 player/block，避免子页面闭包拖住整个旧 UI 会话。 */
function reopenPlayer(player: Player, block: Block | null) {
    if (!player.isValid || !block?.isValid) return;
    void openMidiPlayer(player, block)
        .catch(error => console.error("[midi] 返回播放器失败", error));
}

function openSongPicker(player: Player, block: Block, midi: MidiPlayer) {
    if (!player.isValid || !block.isValid || !midi.isAlive()) return;
    formManager.open(player, MidiListForm, {
        midiPlayer: midi,
        p: 1,
        onBack: () => reopenPlayer(player, block),
    });
}

function openLibrary(player: Player, block: Block, midi: MidiPlayer) {
    if (!player.isValid || !block.isValid || !midi.isAlive()) return;
    formManager.open(player, LibraryForm, {
        midiPlayer: midi,
        onBack: () => reopenPlayer(player, block),
    });
}

/** 单个玩家的 MIDI 播放器 UI 会话；MidiPlayer 本身属于 PianoRuntime。 */
class MidiPlayerPanelSession {
    private form: CustomForm | undefined;
    private ctx!: MidiPlayerUIContext;

    private playerInst?: MidiPlayer;
    private leftBlock: Block | null = null;
    /** 这架钢琴共享的只读 MIDI 视图。 */
    private viewModel?: MidiPlayerViewModel;
    private progressUnsub?: () => void;
    private invalidUnsub?: () => void;

    /** 进度滑块：每 tick 同步播放进度；玩家拖动（值明显偏离）→ seek */
    private sliderObs?: ObservableNumber;
    /** 服务器最后一次写入滑块的值（用于区分"自己回写"与"玩家拖动"） */
    private lastSyncedSlider = -1;

    private inited = false;
    /** 滑块 Observable 的订阅，关闭时显式解绑。 */
    private sliderUnsub?: () => void;
    private disposed = false;
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

        this.releaseBindings();
        this.leftBlock = anchor;
        this.playerInst = piano.getMidiPlayer();

        const viewModel = midiViewModel(this.playerInst);
        this.viewModel = viewModel;

        const progressHandle = viewModel.progress.subscribe(pct => this.syncSlider(pct));
        this.progressUnsub = () => viewModel.progress.unsubscribe(progressHandle);

        const invalidHandle = viewModel.invalid.subscribe(() => this.close());
        this.invalidUnsub = () => viewModel.invalid.unsubscribe(invalidHandle);

        viewModel.retain();

        // 同步上下文
        if (this.ctx) {
            this.ctx.block = anchor;
        }
        return true;
    }

    private releaseBindings() {
        this.progressUnsub?.();
        this.progressUnsub = undefined;
        this.invalidUnsub?.();
        this.invalidUnsub = undefined;
        this.sliderUnsub?.();
        this.sliderUnsub = undefined;
        this.viewModel?.release();
        this.viewModel = undefined;
    }

    /** 进度滑块同步：把滑块设为当前播放进度（0~100，时间制） */
    private syncSlider(pct: number) {
        if (
            !this.sliderObs ||
            !this.form?.isShowing?.() ||
            !this.playerInst?.isAlive()
        ) {
            return;
        }
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
        const callback = (v: number) => {
            if (v === this.lastSyncedSlider) return; // 服务器回写
            this.lastSyncedSlider = v;

            const inst = this.playerInst;
            if (!inst?.isAlive()) return;
            const info = inst.getInfo();
            const durSec = (info.durationMs ?? 0) / 1000;
            if (durSec > 0) inst.seek((v / 100) * durSec);
        };
        obs.subscribe(callback);
        this.sliderUnsub = () => obs.unsubscribe(callback);
    }

    private init() {
        if (this.inited || !this.leftBlock || !this.player.isValid) return;
        const viewModel = this.viewModel;
        if (!viewModel) return;
        this.inited = true;

        // === 共享只读状态 + 玩家私有滑块 ===
        this.ctx = {
            state: viewModel.state,
            midiName: viewModel.midiName,
            queue: viewModel.queue,
            progressText: viewModel.progressText,
            progress: viewModel.progress,
            buttonText: viewModel.buttonText,
            playMode: viewModel.playMode,

            // clientWritable：允许玩家拖动写值（双向绑定）
            progressSlider: new ObservableNumber(0, { clientWritable: true }),

            block: this.leftBlock,
        };

        this.sliderObs = this.ctx.progressSlider;
        this.wireSlider(this.sliderObs);
        const pct = viewModel.progress.getData();
        this.lastSyncedSlider = pct;
        this.sliderObs.setData(pct);

        // === form（每个玩家会话一份）===
        this.form = createMidiPlayerUI(
            this.player,
            this.ctx,
            () => this.playerInst!,
            () => this.close(),
            {
                openSongPicker,
                openLibrary,
            }
        );
    }

    async show() {
        if (!this.player.isValid) return;
        this.init();
        if (!this.form || !this.playerInst || !this.viewModel) return;

        // 已在显示 / 正在打开时不要重复 show
        if (this.opening || this.form.isShowing()) return;

        this.opening = true;
        try {
            // 每次打开刷新共享状态与玩家滑块
            this.viewModel.sync();
            if (!this.viewModel || !this.form || !this.playerInst) return;
            const pct = this.viewModel.progress.getData();
            this.lastSyncedSlider = pct;
            this.sliderObs?.setData(pct);

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
        this.releaseBindings();
    }

    /** 表单关闭后清理会话；子页面返回只捕获 player/block，不依赖本对象。 */
    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.close();
        this.form = undefined;
        this.ctx = undefined as never;
        this.playerInst = undefined;
        this.leftBlock = null;
        this.sliderObs = undefined;
        this.player = undefined as never;
        this.inited = false;
        this.lastSyncedSlider = -1;
        this.opening = false;
    }
}

/** 同一玩家同时只允许一个播放器表单；关闭后实例直接丢弃。 */
const activePlayers = new Set<string>();

/** 新建的只是 UI 包装；MidiPlayer 由 PianoRuntime.getMidiPlayer() 缓存复用。 */
export async function openMidiPlayer(p: Player, block: Block) {
    if (!p.isValid || activePlayers.has(p.id)) return;

    activePlayers.add(p.id);
    const session = new MidiPlayerPanelSession(p);
    try {
        if (!session.setBlock(block)) return;
        await session.show();
    } finally {
        activePlayers.delete(p.id);
        session.dispose();
    }
}
