import { MidiPlayer } from "@midiPlayer/player";
import { Block } from "@minecraft/server";
import { CommonForm } from "sapi-pro";
import { MidiListForm, MidiSearchForm } from "./midiList";
import { openMidiPlayer } from "./playerUIManager";

const PAGE_SIZE = 10;

export const QueueListForm = CommonForm.ButtonForm<{
    midiPlayer: MidiPlayer;
    block: Block;
    p: number;
}>({
    title: "播放器序列",
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
                } as any);
            },
            shouldShow(player, args) {
                return args.p == 1; //仅第一页显示
            },
        },
        {
            label: "搜索添加",
            func(ctx) {
                ctx.push(MidiSearchForm, {
                    queue: ctx.args.midiPlayer.queue,
                } as any);
            },
            shouldShow(player, args) {
                return args.p == 1; //仅第一页显示
            },
        },
        {
            label: "返回首页",
            func(ctx) {
                ctx.replace(QueueListForm, {
                    ...ctx.args,
                    p: 1,
                });
            },
            shouldShow(player, args) {
                return args.p != 1;
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
        openMidiPlayer(ctx.player, ctx.args.block);
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
