import { MidiPlayer } from "@midiPlayer/player";
import { Block } from "@minecraft/server";
import { CommonForm, FuncButton } from "sapi-pro";
import { MidiListForm, MidiSearchForm } from "./midiList";
import { openMidiPlayer } from "./playerUIManager";
import { PAGE_SIZE } from "./static";

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

        // p = -1 时跳转到当前播放页
        if (args.p === -1) {
            const current = queue.getIndex();
            if (current >= 0) {
                args.p = Math.floor(current / PAGE_SIZE) + 1;
            } else {
                args.p = 1;
            }
        }

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

        const buttons: FuncButton<typeof args, any>[] = list
            .slice(start, end)
            .map((name, i) => {
                const realIndex = start + i;

                return {
                    label:
                        realIndex === current
                            ? `§q▶ ${name}`
                            : `${realIndex}. ${name}`,
                };
            });
        buttons.push({
            label: "§c§l清空列表",
            shouldShow: () => args.p == 1,
            func(ctx) {
                ctx.args.midiPlayer.queue.clear();
                ctx.back();
            },
        });
        return buttons;
    },

    handler(ctx, button) {
        const { midiPlayer: player, p } = ctx.args;

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
