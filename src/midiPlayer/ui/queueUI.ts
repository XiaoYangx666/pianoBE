import { MidiPlayer } from "@midiPlayer/player";
import { PlayQueue } from "@midiPlayer/queue";
import { midis } from "@midis";
import { CommonForm } from "sapi-pro";
import { openMidiPlayer } from "./playerUI";
import { Block, Player } from "@minecraft/server";

const PAGE_SIZE = 6;

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

        // ⭐ 在最早阶段修正
        if (args.p > maxPage) args.p = maxPage;
        if (args.p < 1) args.p = 1;

        form.body(`选择一项\n第 ${args.p} / ${maxPage} 页`);
    },
    buttons: [
        {
            label: "返回",
            func(ctx) {
                openMidiPlayer(ctx.args.ui.player, ctx.args.ui.block);
            },
        },
        {
            label: "添加",
            func(ctx) {
                ctx.push(MidiListForm, {
                    queue: ctx.args.midiPlayer.queue,
                    p: 1,
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

        // 👉 打开子菜单
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

                player.playAt(index);

                // 返回列表
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

                // ⭐ 如果删的是当前 → 播放下一首
                if (isCurrent) {
                    player.next();
                }
                ctx.back();
            },
        },
    ],
});

const MidiListForm = CommonForm.ButtonForm<{ queue: PlayQueue; p: number }>({
    title: "添加到播放列表",

    generator(form, ctx, args) {
        const maxPage = Math.max(1, Math.ceil(midis.length / PAGE_SIZE));
        form.body(`第 ${args.p} / ${maxPage} 页`);
    },

    buttons: [
        {
            label: "上一页",
            func(ctx) {
                ctx.replace(MidiListForm, {
                    queue: ctx.args.queue,
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
                ctx.replace(MidiListForm, {
                    queue: ctx.args.queue,
                    p: ctx.args.p + 1,
                });
            },
            shouldShow(player, args) {
                return args.p * PAGE_SIZE < midis.length;
            },
        },
    ],

    buttonGenerator(player, args) {
        const start = (args.p - 1) * PAGE_SIZE;
        const end = start + PAGE_SIZE;

        return midis.slice(start, end).map((midi, i) => {
            const realIndex = start + i;

            return {
                label: `${realIndex}. ${midi.name}`,
            };
        });
    },

    handler(ctx, button) {
        const { queue, p } = ctx.args;

        const start = (p - 1) * PAGE_SIZE;
        const realIndex = start + button.btnIndex;

        const midi = midis[realIndex];
        if (!midi) return;

        queue.enqueue(midi.value);

        // 保持当前页
        ctx.replace(MidiListForm, {
            queue,
            p,
        });
    },
    oncancel(res, ctx) {
        ctx.back();
    },
});
