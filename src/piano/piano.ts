import { Dimension, Player, system, Vector3 } from "@minecraft/server";
import { CustomForm, Observable } from "@minecraft/server-ui";
import { processNote } from "@piano/func";
import { NoteInfo } from "@piano/types";
import { Vector3Utils } from "@utils/vector";
import { keyMaps } from "./keymap";

const PIANO_LAYOUT = [
    ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-", "="],
    [" ", "q", "w", "e", "r", "t", "y", "u", "i", "o", "p", "[", "]", "\\"],
    [" ", " ", "a", "s", "d", "f", "g", "h", "j", "k", "l", ";", "'"],
    [" ", " ", " ", "z", "x", "c", "v", "b", "n", "m", ",", ".", "/"],
];

interface PianoContext {
    /**状态栏 */
    status: Observable<string>;
    /**琴键显示 */
    rows: Observable<string>[];
    /**升八度按钮 */
    octave: Observable<boolean>;
    /**输入框 */
    input: Observable<string>;
    keyMap: Observable<number>;

    isHandling: boolean;

    /**钢琴方块坐标 */
    pos: Vector3;
    /**钢琴方块维度 */
    dim: Dimension;
}

function getNoteFromKey(char: string, ctx: PianoContext) {
    const map = keyMaps[ctx.keyMap.getData()].value;
    return map[char.toLowerCase()];
}

function createKeyMapLabel(idx: number) {
    return Observable.create<string>(`当前方案: ${keyMaps[idx].name}`);
}

function switchKeyMap(ctx: PianoContext, p: Player, label: Observable<string>) {
    let idx = ctx.keyMap.getData();
    idx = (idx + 1) % keyMaps.length;

    ctx.keyMap.setData(idx);

    label.setData(`当前方案: ${keyMaps[idx].name}`);

    p.setDynamicProperty("piano:keyMap", idx);

    updateUI(ctx, []);
}

/**为玩家打开钢琴表单
 * @throws 当玩家掉线时
 */
export function openPiano(p: Player, pos: Vector3, dim: Dimension) {
    const keyMapIdx = (p.getDynamicProperty("piano:keyMap") as number) ?? 0;

    const context: PianoContext = {
        status: Observable.create<string>("§b🎹 钢琴已就绪"),
        rows: [
            Observable.create<string>(""),
            Observable.create<string>(""),
            Observable.create<string>(""),
            Observable.create<string>(""),
        ],
        keyMap: Observable.create<number>(keyMapIdx),
        octave: Observable.create<boolean>(false, {
            clientWritable: true,
        }),
        input: Observable.create<string>("", { clientWritable: true }),
        isHandling: false,
        pos,
        dim,
    };

    const keyMapLabel = createKeyMapLabel(keyMapIdx);

    const form = CustomForm.create(p, "文本钢琴")
        .label(context.status)
        .label("   ");

    context.rows.forEach((row) => form.label(row));

    form.label("   ")
        .button(keyMapLabel, () => {
            switchKeyMap(context, p, keyMapLabel);
        })
        .toggle("升8度 (高音模式)", context.octave)
        .textField("在此处快速打字...", context.input);

    let closed = false;

    function close() {
        if (closed) return;
        closed = true;

        context.input.unsubscribe(inputSub);
        context.octave.unsubscribe(octaveSub);

        if (form.isShowing()) {
            form.close();
        }
    }

    try {
        const result = form.show();
        if (!result) return;
    } catch {
        return;
    }

    // 初始化 UI
    updateUI(context, []);

    // 监听升8度
    const octaveSub = context.octave.subscribe(() => {
        updateUI(context, []);
    });

    // 监听输入
    const inputSub = context.input.subscribe((val) => {
        // 玩家无效 / 距离超出
        if (!p.isValid || Vector3Utils.squaredDistance(p.location, pos) > 16) {
            return close();
        }

        // 方块失效
        const block = dim.getBlock(pos);
        if (!block?.isValid || !block.typeId.startsWith("xypiano:piano")) {
            return close();
        }

        handleInput(val, context);
    });
}

const emptyInfo: NoteInfo = {
    name: "无",
    sample: "无",
    pitch: 0,
    midi: -1,
};

function updateUI(
    context: PianoContext,
    activeKey: string[],
    updates?: Partial<NoteInfo>
) {
    const isHigh = context.octave.getData();
    const octaveMarker = isHigh ? "§b[Semi]" : "";
    const info = updates ? { ...emptyInfo, ...updates } : emptyInfo;
    // 1. 更新顶部状态 (丰富信息)
    context.status.setData(
        `§l§f音符: §a${info.name} ${octaveMarker}\n` +
            `§7采样源: §e${info.sample}  §7音高: §e${info.pitch.toFixed(3)}`
    );

    // 2. 更新键盘显示 (保持原样大小写，仅变色)
    const labels = context.rows;
    // 根据升8度状态决定基础颜色
    const baseColor = isHigh ? "§b" : "§7";

    PIANO_LAYOUT.forEach((row, i) => {
        let rowStr = "  ";
        for (const k of row) {
            if (activeKey.includes(k)) {
                rowStr += ` §a§l${k}§r `; // 按下变绿
            } else {
                rowStr += ` ${baseColor}${k}§r `; // 未按下根据模式显示灰或蓝
            }
        }
        labels[i].setData(rowStr);
    });
}

function handleInput(val: string, ctx: PianoContext) {
    if (!val) return;

    const MAX_KEYS = 4;

    // 只取最后 N 个字符
    const slice = val.slice(-MAX_KEYS);

    let lastNote: NoteInfo | undefined;
    const keys: string[] = [];

    for (const char of slice) {
        const lowKey = char.toLowerCase();
        const originalNote = getNoteFromKey(lowKey, ctx);

        keys.push(lowKey);

        if (originalNote !== undefined) {
            const isHigh = ctx.octave.getData();
            const noteDetails = processNote(originalNote, isHigh);

            playNote(ctx.pos, ctx.dim, noteDetails);

            lastNote = noteDetails;
        } else {
            lastNote = {
                name: "未知",
                sample: "none",
                pitch: 0,
                midi: -1,
            };
        }
    }

    // UI 更新一次
    if (lastNote) {
        updateUI(ctx, keys, lastNote);
    }

    // 清空输入
    system.runTimeout(() => {
        ctx.input.setData("");
    }, 2);
}

function playNote(pos: Vector3, dim: Dimension, info: NoteInfo) {
    if (info.sample === "none") return;

    dim.playSound(`piano.${info.sample}_long`, pos, {
        pitch: info.pitch,
        volume: 1.0,
    });
}
