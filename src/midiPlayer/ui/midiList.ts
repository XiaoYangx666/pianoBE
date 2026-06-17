import { midiManager } from "@midiPlayer";
import { PlayQueue } from "@midiPlayer/queue";
import { MidiInfo } from "@types";
import { CommonForm, NumberField, TextField, Validators } from "sapi-pro";
import { PlayListStore } from "../playlist"; // 导入你的存储类

const playListStore = new PlayListStore();
const PAGE_SIZE = 8;

/** 获取筛选后的列表 */
function getFilteredList(filter?: string) {
    const midis = midiManager.list();
    if (!filter) return midis;
    const lowerFilter = filter.toLowerCase();
    return midis.filter((m) => m.name.toLowerCase().includes(lowerFilter));
}

// --- 搜索表单 ---
export const MidiSearchForm = CommonForm.InputForm<
    { keywords: string },
    { queue?: PlayQueue; targetPlayListId?: number }
>({
    title: "搜索歌曲",
    fields: [new TextField("歌曲名字", "请输入歌曲名字", "").key("keywords")],
    submitButton: "搜索",
    onSubmit(data, ctx) {
        ctx.replace(MidiListForm, {
            queue: ctx.args.queue,
            targetPlayListId: ctx.args.targetPlayListId,
            p: 1,
            filter: data.keywords?.trim() || undefined,
        });
    },
    onCancel(res, ctx) {
        ctx.back();
    },
});

// --- 列表表单 ---
export const MidiListForm = CommonForm.ButtonForm<
    {
        queue?: PlayQueue;
        targetPlayListId?: number;
        p: number;
        filter?: string;
        filteredList?: MidiInfo[];
    },
    MidiInfo
>({
    title: "选择歌曲",
    async generator(form, ctx, args) {
        const filteredList = getFilteredList(args.filter);
        const maxPage = Math.max(1, Math.ceil(filteredList.length / PAGE_SIZE));
        const mode = args.targetPlayListId ? "§e[添加至列表]§r" : "§b[点歌]§r";
        form.body(
            `${mode}\n结果: ${filteredList.length} 首\n页码: ${args.p} / ${maxPage}`
        );
        args.filteredList = filteredList;
    },
    buttons: [
        {
            label: "上一页",
            func(ctx) {
                ctx.replace(MidiListForm, { ...ctx.args, p: ctx.args.p - 1 });
            },
            shouldShow: (player, args) => args.p > 1,
        },
        {
            label: "下一页",
            func: (ctx) =>
                ctx.replace(MidiListForm, { ...ctx.args, p: ctx.args.p + 1 }),
            shouldShow(player, args) {
                return args.p * PAGE_SIZE < getFilteredList(args.filter).length;
            },
        },
    ],

    buttonGenerator(player, args) {
        const start = (args.p - 1) * PAGE_SIZE;
        const list = args
            .filteredList!.slice(start, start + PAGE_SIZE)
            .map((midi) => ({
                label: `${midi.name}`,
                data: midi,
            }));

        return list;
    },

    footerButtons: [
        {
            label: "§q一键添加",
            shouldShow: (player, args) => args.p === 1,
            func(ctx) {
                const { queue, targetPlayListId, filter } = ctx.args;
                const filteredList = getFilteredList(filter);

                if (targetPlayListId !== undefined) {
                    // 模式 A：批量加入播放列表
                    const items = playListStore.getContent(targetPlayListId);
                    let added = 0;

                    for (const midi of filteredList) {
                        if (!items.includes(midi.id)) {
                            items.push(midi.id);
                            added++;
                        }
                    }

                    playListStore.setContent(targetPlayListId, items);
                    ctx.player.sendMessage(`§a已添加 ${added} 首歌曲到列表`);
                } else if (queue) {
                    // 模式 B：批量加入队列
                    for (const midi of filteredList) {
                        queue.enqueue(midi);
                    }
                    ctx.player.sendMessage(
                        `§a已加入 ${filteredList.length} 首到播放队列`
                    );
                }

                // 刷新当前页
                ctx.replace(MidiListForm, ctx.args);
            },
        },
        {
            label: "跳页",
            func(ctx) {
                ctx.push(jumpPageForm, {
                    len: ctx.args.filteredList!.length,
                    args: ctx.args,
                });
            },
        },
    ],

    handler(ctx, button) {
        const midi = button.data;
        const { queue, targetPlayListId } = ctx.args;

        if (targetPlayListId !== undefined) {
            // 模式 A: 存入数据库播放列表
            const items = playListStore.getContent(targetPlayListId);
            if (!items.includes(midi.id)) {
                items.push(midi.id);
                playListStore.setContent(targetPlayListId, items);
                ctx.player.sendMessage(`§a已添加: ${midi.name}`);
            } else {
                ctx.player.sendMessage(`§e歌曲已存在`);
            }
        } else if (queue) {
            // 模式 B: 直接加入当前队列
            queue.enqueue(midi);
            ctx.player.sendMessage(`§a已加入当前播放队列`);
        }

        // 停留在当前页，方便继续添加下一首
        ctx.replace(MidiListForm, ctx.args);
    },
    oncancel(res, ctx) {
        ctx.back();
    },
});

const jumpPageForm = CommonForm.InputForm<
    { p: number },
    {
        len: number;
        args: {
            queue?: PlayQueue;
            targetPlayListId?: number;
            filter?: string;
        };
    }
>({
    title: "跳页",
    fieldsGenerator(player, args) {
        return [
            new NumberField("页码", "请输入页码")
                .key("p")
                .validator(
                    Validators.numberRange(
                        1,
                        Math.ceil(args.len / PAGE_SIZE),
                        "页码超出范围"
                    )
                ),
        ];
    },
    onCancel(res, ctx) {
        ctx.back();
    },
    onSubmit(data, ctx) {
        ctx.back();
        ctx.back();
        ctx.push(MidiListForm, { ...ctx.args.args, p: data.p });
    },
});
