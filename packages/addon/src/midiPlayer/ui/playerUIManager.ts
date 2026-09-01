import { Block, Player } from "@minecraft/server";
import { CustomForm, ObservableNumber, ObservableString } from "@minecraft/server-ui";
import { Cardinal_Direction } from "@types";
import { getLeftPianoBlock } from "@utils/block";
import { DDUIManager } from "@utils/ddui";
import { midiPlayerManager } from "../index";
import { MidiPlayer } from "../player";
import { createMidiPlayerUI, MidiPlayerUIContext, updateUI } from "./playerUI";

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

    constructor(private player: Player) {}

    setBlock(block: Block): boolean {
        const left = getLeftPianoBlock(block);
        if (!left) return false;

        this.leftBlock = left;

        const dir = left.permutation.getState(
            "minecraft:cardinal_direction"
        ) as Cardinal_Direction;

        const newPlayer =
            midiPlayerManager.get(left.dimension, left.location) ??
            midiPlayerManager.add(
                new MidiPlayer(left.dimension, left.location, dir)
            );

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
            this.ctx.block = left;
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
        if (this.inited || !this.leftBlock) return;
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
            () => this.close()
        );
    }

    async show() {
        this.init();
        if (!this.form || !this.playerInst) return;

        // 每次打开刷新 UI
        updateUI(this.ctx, this.playerInst);

        try {
            await this.form.show();
        } catch (e) {
            console.error(e);
            this.close();
        }
    }

    close() {
        if (this.form?.isShowing()) {
            this.form.close();
        }
        this.unsub?.();
    }

    isShowing() {
        return this.form?.isShowing?.() ?? false;
    }
}

class MidiPlayerUIManager extends DDUIManager<MidiPlayerInstance> {
    protected create(player: Player): MidiPlayerInstance {
        return new MidiPlayerInstance(player);
    }

    async open(player: Player, block: Block) {
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
