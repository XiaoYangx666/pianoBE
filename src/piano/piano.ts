import { Block, Player, system } from "@minecraft/server";
import { Observable } from "@minecraft/server-ui";
import { Cardinal_Direction, PianoEnv } from "@types";
import { getLeftPianoBlock } from "@utils/block";
import { Vector3Utils } from "sapi-pro/utils";
import { handleInput } from "./input";
import { createPianoUI, PianoState, PianoUIRefs, updatePianoUI } from "./ui";

function createContext(p: Player, leftBlock: Block) {
    const keyMapIdx = (p.getDynamicProperty("piano:keyMap") as number) ?? 0;
    const mode = (p.getDynamicProperty("piano:comMode") as boolean) ?? true;
    const state: PianoState = {
        keyMap: Observable.create<number>(keyMapIdx),
        mode: Observable.create<boolean>(mode),
        octave: Observable.create<boolean>(false, {
            clientWritable: true,
        }),
        fullUI: Observable.create<boolean>(true, { clientWritable: true }),
        input: Observable.create<string>("", { clientWritable: true }),
    };
    const ui: PianoUIRefs = {
        status: Observable.create<string>("§b🎹 钢琴已就绪"),
        rows: [
            Observable.create<string>(""),
            Observable.create<string>(""),
            Observable.create<string>(""),
            Observable.create<string>(""),
        ],
    };
    const env: PianoEnv = {
        pos: leftBlock.location,
        dim: leftBlock.dimension,
        dir: leftBlock.permutation.getState(
            "minecraft:cardinal_direction"
        ) as Cardinal_Direction,
    };
    return {
        state,
        ui,
        env,
    };
}

/**为玩家打开钢琴表单*/
export async function openPiano(p: Player, block: Block) {
    const leftBlock = getLeftPianoBlock(block);
    if (!leftBlock) return;

    const { state, ui, env } = createContext(p, leftBlock);

    const form = createPianoUI(p, state, ui, block);
    //初始化
    updatePianoUI(state, ui, []);

    let closed = false;

    function close() {
        if (closed) return;
        closed = true;

        state.input.unsubscribe(inputSub);
        state.octave.unsubscribe(octaveSub);
        state.fullUI.unsubscribe(hideUISub);

        if (form.isShowing()) {
            form.close();
        }
    }

    // 监听升8度
    const octaveSub = state.octave.subscribe(() => {
        updatePianoUI(state, ui, []);
    });
    const hideUISub = state.fullUI.subscribe(() => {
        updatePianoUI(state, ui, []);
    });

    let lastLength = 0;
    // 监听输入
    const inputSub = state.input.subscribe((val) => {
        // 玩家无效 / 距离超出
        if (shouldClose(p, block)) {
            return close();
        }
        //字符变短时不触发
        if (val.length <= lastLength) {
            lastLength = val.length;
            return;
        }
        lastLength = val.length;
        //处理输入
        const result = handleInput(val, state, env);
        //更新UI
        updatePianoUI(state, ui, result.keys, result.last);
        //清空输入
        if (result.shouldClear) {
            system.runTimeout(() => {
                state.input.setData("");
            }, 2);
        }
    });

    try {
        const result = await form.show();
        if (!result) {
            close();
        }
    } catch {
        close();
        return;
    }
}

function shouldClose(p: Player, block: Block) {
    //距离过远
    if (
        !p.isValid ||
        Vector3Utils.squaredDistance(p.location, block.location) > 16
    ) {
        return true;
    }
    // 方块失效
    if (!block?.isValid || !block.typeId.startsWith("xypiano:piano")) {
        return true;
    }
    return false;
}
