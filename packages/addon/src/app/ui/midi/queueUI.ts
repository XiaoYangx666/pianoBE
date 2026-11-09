import { MidiPlayer } from "@domain/playback/player";
import { CommonForm, FuncButton, NumberField, Validators } from "sapi-pro";
import { MidiListForm } from "./midiList";
import { PAGE_SIZE } from "./static";

export interface QueueListArgs {
    midiPlayer: MidiPlayer;
    p: number;
    onBack?: () => void;
}

export const QueueListForm = CommonForm.ButtonForm<
    QueueListArgs,
    void
>({
    title: "播放器序列",
    generator(form, player, args) {
        const queue = args.midiPlayer.queue;
        const total = queue.getLength();
        const maxPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

        // p = -1 时跳转到当前播放页
        if (args.p === -1) {
            const current = queue.getIndex();
            args.p =
                current >= 0 && current < total
                    ? Math.floor(current / PAGE_SIZE) + 1
                    : maxPage;
        }

        if (args.p > maxPage) args.p = maxPage;
        if (args.p < 1) args.p = 1;

        const current = queue.current()?.name;
        form.body(
            `第 ${args.p} / ${maxPage} 页\n队列: ${total} 首` +
                (current ? `\n当前: ${current}` : "")
        );
    },
    buttons: [
        {
            label: "添加歌曲",
            func(ctx) {
                ctx.push(MidiListForm, {
                    midiPlayer: ctx.args.midiPlayer,
                    p: 1,
                });
            },
        },
        {
            label: "当前播放",
            func(ctx) {
                const queue = ctx.args.midiPlayer.queue;
                const total = queue.getLength();
                const maxPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
                const current = queue.getIndex();
                const p =
                    current >= 0 && current < total
                        ? Math.floor(current / PAGE_SIZE) + 1
                        : maxPage;
                ctx.replace(QueueListForm, { ...ctx.args, p });
            },
            shouldShow: (player, args) => args.midiPlayer.queue.getLength() > 0,
        },
        {
            label: "页码",
            func(ctx) {
                ctx.push(QueuePageForm, {
                    len: ctx.args.midiPlayer.queue.getLength(),
                    args: ctx.args,
                });
            },
            shouldShow: (player, args) =>
                args.midiPlayer.queue.getLength() > PAGE_SIZE,
        },
        {
            label: "§c清空列表",
            func(ctx) {
                ctx.push(ClearQueueForm, {
                    midiPlayer: ctx.args.midiPlayer,
                });
            },
            shouldShow: (player, args) => args.midiPlayer.queue.getLength() > 0,
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
        if (ctx.args.onBack) ctx.args.onBack();
        else ctx.back();
    },
});

const QueuePageForm = CommonForm.InputForm<
    { p: number },
    {
        len: number;
        args: QueueListArgs;
    }
>({
    title: "跳页",
    fieldsGenerator(player, args) {
        const maxPage = Math.max(1, Math.ceil(args.len / PAGE_SIZE));
        return [
            new NumberField("页码", `1-${maxPage}`)
                .key("p")
                .validator(
                    Validators.numberRange(1, maxPage, "页码超出范围")
                ),
        ];
    },
    onSubmit(data, ctx) {
        ctx.offUntil(QueueListForm, QueueListForm, {
            ...ctx.args.args,
            p: data.p,
        });
    },
    onCancel(res, ctx) {
        ctx.back();
    },
});

const ClearQueueForm = CommonForm.SimpleMessageForm<{
    midiPlayer: MidiPlayer;
}>({
    title: "清空队列",
    generator(form, player, args) {
        form.body(
            `确定清空队列中的 ${args.midiPlayer.queue.getLength()} 首歌曲？`
        );
    },
    button1: {
        text: "清空",
        func(ctx) {
            ctx.args.midiPlayer.queue.clear();
            ctx.back();
        },
    },
    button2: {
        text: "取消",
        func(ctx) {
            ctx.back();
        },
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
                void player
                    .play()
                    .catch((error) => console.error("[midi] 播放失败", error));

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
                    void player
                        .play()
                        .catch((error) => console.error("[midi] 播放失败", error));
                }
                ctx.back();
            },
        },
    ],
});
