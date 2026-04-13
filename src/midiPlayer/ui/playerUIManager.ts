import { Block, Player } from "@minecraft/server";
import { Observable } from "@minecraft/server-ui";
import { Cardinal_Direction } from "@types";
import { getLeftPianoBlock } from "@utils/block";
import { DDUIManager } from "@utils/ddui";
import { midiPlayerManager } from "../manager";
import { MidiPlayer } from "../player";
import { createMidiPlayerUI, MidiPlayerUIContext, updateUI } from "./playerUI";
import { Vector3Utils } from "sapi-pro";

class MidiPlayerInstance {
    private form: any;
    private ctx!: MidiPlayerUIContext;

    private playerInst!: MidiPlayer;
    private leftBlock: Block | null = null;

    private inited = false;
    private unsub?: () => void;

    constructor(private player: Player) {}

    setBlock(block: Block) {
        const left = getLeftPianoBlock(block);
        if (!left) return;

        this.leftBlock = left;

        const dir = left.permutation.getState(
            "minecraft:cardinal_direction"
        ) as Cardinal_Direction;

        const newPlayer =
            midiPlayerManager.get(left.dimension, left.location) ??
            midiPlayerManager.add(
                new MidiPlayer(left.dimension, left.location, dir)
            );

        if (this.playerInst !== newPlayer) {
            if (this.unsub) {
                try {
                    this.unsub();
                } catch {}
                this.unsub = undefined;
            }

            this.playerInst = newPlayer;

            this.unsub = this.playerInst.signal.subscribe(() => {
                if (!this.form?.isShowing?.()) {
                    return this.close();
                }
                updateUI(this.ctx, this.playerInst);
            });
        }

        // 同步上下文
        if (this.ctx) {
            this.ctx.block = left;
        }
    }

    private init() {
        if (this.inited || !this.leftBlock) return;
        this.inited = true;

        // === Observable（只创建一次）===
        this.ctx = {
            state: Observable.create<string>("§7加载中..."),
            midiName: Observable.create<string>(""),
            queue: Observable.create<string>(""),

            progressBar: Observable.create<string>(""),
            progressText: Observable.create<string>(""),

            buttonText: Observable.create<string>("▶ 播放"),
            playMode: Observable.create<string>(""),

            block: this.leftBlock!,
        };

        // === form（只创建一次）===
        this.form = createMidiPlayerUI(
            this.player,
            this.ctx,
            () => this.playerInst,
            () => this.close()
        );
    }

    async show() {
        this.init();
        if (!this.form) return;

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

        inst.setBlock(block);

        if (inst.isShowing()) return;

        await inst.show();
    }
}

export const midiUIManager = new MidiPlayerUIManager();

export async function openMidiPlayer(p: Player, block: Block) {
    await midiUIManager.open(p, block);
}
