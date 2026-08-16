import { Block, Player } from "@minecraft/server";
import { CustomForm, ObservableString } from "@minecraft/server-ui";
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
        });

        // 同步上下文
        if (this.ctx) {
            this.ctx.block = left;
        }
        return true;
    }

    private init() {
        if (this.inited || !this.leftBlock) return;
        this.inited = true;

        // === Observable（只创建一次）===
        this.ctx = {
            state: new ObservableString("§7加载中..."),
            midiName: new ObservableString(""),
            queue: new ObservableString(""),

            progressBar: new ObservableString(""),
            progressText: new ObservableString(""),

            buttonText: new ObservableString("▶ 播放"),
            playMode: new ObservableString(""),

            block: this.leftBlock!,
        };

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
