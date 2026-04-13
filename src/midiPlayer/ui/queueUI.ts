import { MidiPlayer } from "@midiPlayer/player";
import { PlayQueue } from "@midiPlayer/queue";
import { midis } from "@midis/index";
import { Block, Player } from "@minecraft/server";
import { CommonForm, FuncButton, TextField } from "sapi-pro";
import { openMidiPlayer } from "./playerUI";

const PAGE_SIZE = 10;

export const QueueListForm = CommonForm.ButtonForm<{
    midiPlayer: MidiPlayer;
    ui: { player: Player; block: Block };
    p: number;
}>({
    title: "midi播放器列表",
    generator(form, player, args) {
        const queue = args.midiPlayer.queue;
        const total = queue.getLength();
        const maxPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

        if (args.p > maxPage) args.p = maxPage;
        if (args.p < 1) args.p = 1;

        form.body(`选择一项\n第 ${args.p} / ${maxPage} 页`);
    },
    buttons: [
        {
            label: "添加",
            func(ctx) {
                ctx.push(MidiListForm, {
                    queue: ctx.args.midiPlayer.queue,
                    p: 1,
                    filter: undefined,
                });
            },
        },
        {
            label: "搜索添加",
            func(ctx) {
                ctx.push(MidiSearchForm, {
                    queue: ctx.args.midiPlayer.queue,
                });
            },
        },
        {
            label: "上一页",
            func(ctx) {
                ctx.replace(QueueListForm, {
                    ...ctx.args,
                    p: ctx.args.p - 1,
                });
            },
            shouldShow(player, args) {
                return args.p > 1;
            },
        },
        {
            label: "下一页",
            func(ctx) {
                ctx.replace(QueueListForm, {
                    ...ctx.args,
                    p: ctx.args.p + 1,
                });
            },
            shouldShow(player, args) {
                const queue = args.midiPlayer.queue;
                return args.p * PAGE_SIZE < queue.getLength();
            },
        },
    ],

    buttonGenerator(player, args) {
        const queue = args.midiPlayer.queue;
        const list = queue.getQueue();

        const start = (args.p - 1) * PAGE_SIZE;
        const end = start + PAGE_SIZE;

        const current = queue.getIndex();

        return list.slice(start, end).map((name, i) => {
            const realIndex = start + i;

            return {
                label:
                    realIndex === current
                        ? `▶ ${name}`
                        : `${realIndex}. ${name}`,
            };
        });
    },

    handler(ctx, button) {
        const { midiPlayer: player, p } = ctx.args;
        const queue = player.queue;

        const start = (p - 1) * PAGE_SIZE;
        const realIndex = start + button.btnIndex;

        ctx.push(QueueItemForm, {
            player,
            index: realIndex,
        });
    },
    oncancel(res, ctx) {
        openMidiPlayer(ctx.args.ui.player, ctx.args.ui.block);
    },
});

const QueueItemForm = CommonForm.ButtonForm<{
    player: MidiPlayer;
    index: number;
}>({
    title: "队列操作",

    generator(form, player, args) {
        const queue = args.player.queue;
        const list = queue.getQueue();

        const name = list[args.index] ?? "unknown";

        form.body(`当前项：\n${args.index}. ${name}`);
    },

    buttons: [
        {
            label: "返回",
            func(ctx) {
                ctx.back();
            },
        },
        {
            label: "▶ 播放",
            func(ctx) {
                const { player, index } = ctx.args;

                player.queue.jump(index);
                player.play();

                ctx.back();
            },
        },
        {
            label: "❌ 删除",
            func(ctx) {
                const { player, index } = ctx.args;
                const queue = player.queue;

                const isCurrent = index === queue.getIndex();

                queue.remove(index);

                if (isCurrent) {
                    player.play();
                }
                ctx.back();
            },
        },
    ],
});

const MidiSearchForm = CommonForm.InputForm<
    { keywords: string },
    { queue: PlayQueue }
>({
    title: "搜索歌曲",
    fields: [new TextField("歌曲名字", "请输入歌曲名字", "").key("keywords")],
    submitButton: "搜索",
    onSubmit(data, ctx) {
        const keywords = data.keywords?.trim() || "";
        ctx.push(MidiListForm, {
            queue: ctx.args.queue,
            p: 1,
            filter: keywords || undefined,
        });
    },
    onCancel(res, ctx) {
        ctx.back();
    },
});

/** 获取筛选后的列表 */
function getFilteredList(filter?: string) {
    if (!filter) return midis;
    const lowerFilter = filter.toLowerCase();
    return midis.filter((m) => m.name.toLowerCase().includes(lowerFilter));
}

const MidiListForm = CommonForm.ButtonForm<{
    queue: PlayQueue;
    p: number;
    filter: any;
}>({
    title: "添加到播放列表",

    generator(form, ctx, args) {
        const filteredList = getFilteredList(args.filter);
        const maxPage = Math.max(1, Math.ceil(filteredList.length / PAGE_SIZE));

        if (args.p > maxPage) args.p = maxPage;
        if (args.p < 1) args.p = 1;

        const filterInfo = args.filter ? `搜索: "${args.filter}"\n` : "";
        form.body(
            `${filterInfo}共 ${filteredList.length} 首\n第 ${args.p} / ${maxPage} 页`
        );
    },

    buttons: [
        {
            label: "上一页",
            func(ctx) {
                ctx.replace(MidiListForm as any, {
                    queue: ctx.args.queue,
                    p: ctx.args.p - 1,
                    filter: ctx.args.filter,
                });
            },
            shouldShow(player, args) {
                return args.p > 1;
            },
        },
        {
            label: "清除搜索",
            func(ctx) {
                ctx.replace(MidiListForm, {
                    queue: ctx.args.queue,
                    p: 1,
                    filter: undefined,
                });
            },
            shouldShow(player, args) {
                return !!args.filter;
            },
        },
    ],

    buttonGenerator(player, args) {
        const filteredList = getFilteredList(args.filter);

        const start = (args.p - 1) * PAGE_SIZE;
        const end = start + PAGE_SIZE;

        const buttons: FuncButton<any, any>[] = filteredList
            .slice(start, end)
            .map((midi, i) => {
                const realIndex = start + i;
                return {
                    label: `${realIndex}. ${midi.name}`,
                };
            });
        const queue = args.queue;
        if (args.p * PAGE_SIZE < queue.getLength()) {
            buttons.push({
                label: "下一页",
                func(ctx) {
                    ctx.replace(MidiListForm, {
                        queue: ctx.args.queue,
                        p: ctx.args.p + 1,
                        filter: ctx.args.filter,
                    });
                },
            });
        }

        return buttons;
    },

    handler(ctx, button) {
        const { queue, p, filter } = ctx.args;
        const filteredList = getFilteredList(filter);

        const start = (p - 1) * PAGE_SIZE;
        const realIndex = start + button.btnIndex;

        const midi = filteredList[realIndex];
        if (!midi) return;

        queue.enqueue(midi);

        ctx.replace(MidiListForm, {
            queue,
            p,
            filter,
        });
    },
    oncancel(res, ctx) {
        ctx.back();
    },
});
