import { midiManager, playlist } from "@midiPlayer";
import { PlayQueue } from "@midiPlayer/queue";
import type { MidiSongMeta } from "@piano/core";
import { CommonForm, NumberField, TextField, Validators } from "sapi-pro";
const PAGE_SIZE = 8;

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
        /** 当前页歌曲（服务端分页返回） */
        pageItems?: MidiSongMeta[];
        /** 匹配总数量（服务端 total） */
        total?: number;
        maxPage?: number;
    },
    MidiSongMeta
>({
    title: "选择歌曲",
    // 服务端分页：每页向后端请求对应页（搜索时 filter 作为 q 走服务端过滤），
    // 不下载全量列表、不缓存
    async generator(form, ctx, args) {
        const { items, total } = await midiManager.page(args.p, PAGE_SIZE, args.filter);
        const maxPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
        args.pageItems = items;
        args.total = total;
        args.maxPage = maxPage;
        const mode = args.targetPlayListId ? "§e[添加至列表]§r" : "§b[点歌]§r";
        form.body(`${mode}\n结果: ${total} 首\n页码: ${args.p} / ${maxPage}`);
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
                return (args.maxPage ?? 1) > args.p;
            },
        },
    ],

    buttonGenerator(player, args) {
        return (args.pageItems ?? []).map((midi) => ({
            label: `${midi.name}`,
            data: midi,
        }));
    },

    footerButtons: [
        {
            label: "§q一键添加",
            shouldShow: (player, args) => args.p === 1,
            async func(ctx) {
                const { queue, targetPlayListId, filter } = ctx.args;
                // 批量操作需要匹配全集：metaAll 分页取全（远程源后端过滤）
                const filteredList = await midiManager.metaAll(filter);
                if (targetPlayListId !== undefined) {
                    // 模式 A：批量加入播放列表
                    const items = await playlist.getContent(targetPlayListId);
                    let added = 0;

                    for (const midi of filteredList) {
                        if (!items.includes(midi.id)) {
                            items.push(midi.id);
                            added++;
                        }
                    }

                    await playlist.setContent(targetPlayListId, items);
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
            },
        },
        {
            label: "跳页",
            func(ctx) {
                ctx.push(jumpPageForm, {
                    len: ctx.args.total ?? 0,
                    args: ctx.args,
                });
            },
        },
    ],

    async handler(ctx, button) {
        const midi = button.data;
        const { queue, targetPlayListId } = ctx.args;

        if (targetPlayListId !== undefined) {
            // 模式 A: 存入后端/本地播放列表（异步读写）
            const items = await playlist.getContent(targetPlayListId);
            if (!items.includes(midi.id)) {
                items.push(midi.id);
                await playlist.setContent(targetPlayListId, items);
                ctx.player.sendMessage(`§a已添加: ${midi.name}`);
            } else {
                ctx.player.sendMessage(`§e歌曲已存在`);
            }
            // 停留在当前页，方便继续添加下一首（generator 重新请求该页）
            ctx.replace(MidiListForm, ctx.args);
        } else if (queue) {
            // 模式 B: 直接加入当前队列
            queue.enqueue(midi);
            ctx.player.sendMessage(`§a已加入当前播放队列`);
            // 停留在当前页，方便继续添加下一首（generator 重新请求该页）
            ctx.replace(MidiListForm, ctx.args);
        }
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