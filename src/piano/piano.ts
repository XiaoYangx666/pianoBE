import { Block, Player, system } from "@minecraft/server";
import { Cardinal_Direction, PianoEnv } from "@types";
import { getLeftPianoBlock } from "@utils/block";
import { DDUIManager } from "@utils/ddui";
import { Vector3Utils } from "sapi-pro";
import { handleInput } from "./input";
import { createPianoUI, PianoState, PianoUIRefs, updatePianoUI } from "./ui";
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
    private env!: PianoEnv;

    private leftBlock: Block | null = null;
    private inited = false;
    private lastLength = 0;

    constructor(private player: Player) {}

    /** 设置当前钢琴方块 */
    setPianoBlock(block: Block) {
        const left = getLeftPianoBlock(block);
        if (!left) return;

        this.leftBlock = left;

        // 已初始化 → 更新 env
        if (this.inited && this.env) {
            this.env.pos = left.location;
            this.env.dim = left.dimension;
            this.env.dir = left.permutation.getState(
                "minecraft:cardinal_direction"
            ) as Cardinal_Direction;
        }
    }

    /** 初始化（只执行一次） */
    private init() {
        if (this.inited || !this.leftBlock) return;
        this.inited = true;

        const left = getLeftPianoBlock(this.leftBlock);
        if (!left) return;

        // === state ===
        const keyMapIdx =
            (this.player.getDynamicProperty("piano:keyMap") as number) ?? 0;
        const mode =
            (this.player.getDynamicProperty("piano:comMode") as boolean) ??
            true;
        const sound =
            (this.player.getDynamicProperty("piano:sound") as number) ?? 0;

        this.state = {
            keyMap: new ObservableNumber(keyMapIdx),
            mode: new ObservableBoolean(mode),
            octave: new ObservableBoolean(false, {
                clientWritable: true,
            }),
            fullUI: new ObservableBoolean(true, {
                clientWritable: true,
            }),
            input: new ObservableString("", {
                clientWritable: true,
            }),
            sound: new ObservableNumber(sound),
        };

        // === UI ===
        this.ui = {
            status: new ObservableString("§b🎹 钢琴已就绪"),
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

        // === env ===
        this.env = {
            pos: left.location,
            dim: left.dimension,
            dir: left.permutation.getState(
                "minecraft:cardinal_direction"
            ) as Cardinal_Direction,
        };

        // === form（只创建一次）===
        this.form = createPianoUI(
            this.player,
            this.state,
            this.ui,
            () => this.leftBlock
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
            const result = handleInput(val, this.state, this.env);

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

        // UI开关
        this.state.fullUI.subscribe(() => {
            updatePianoUI(this.state, this.ui, []);
        });
    }

    /** 打开 UI */
    async show() {
        this.init();
        if (!this.form) return;

        // 重置输入状态
        this.lastLength = 0;
        this.state.input.setData("");

        // 刷新 UI
        updatePianoUI(this.state, this.ui, []);

        await this.form.show();
    }

    close() {
        // 1. 关闭 UI
        if (this.form?.isShowing?.()) {
            this.form.close();
        }
    }

    private shouldClose(): boolean {
        const p = this.player;
        const block = this.leftBlock;

        //玩家失效
        if (!p.isValid) return true;
        // 方块失效
        if (!block?.isValid || !block.typeId.startsWith("xypiano:piano")) {
            return true;
        }
        //距离太远
        if (Vector3Utils.squaredDistance(p.location, block.location) > 25) {
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

    async open(player: Player, block: Block) {
        const inst = this.get(player);

        inst.setPianoBlock(block);

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
