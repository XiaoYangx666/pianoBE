import { midiManager, playlist } from "@app/midi";
import type { MidiPlayer } from "@domain/playback/player";
import type { MidiSongMeta } from "@piano/core";
import { CommonForm, NumberField, TextField, Validators } from "sapi-pro";
import { PAGE_SIZE } from "./static";

export interface MidiListArgs {
    midiPlayer?: MidiPlayer;
    targetPlayListId?: number;
    p: number;
    filter?: string;
    notice?: string;
    onBack?: () => void;
    /** 内部：从歌曲列表打开搜索时，用 offUntil 替换旧列表，避免页面栈重复。 */
    replaceList?: boolean;
    /** 当前页歌曲（服务端分页返回） */
    pageItems?: MidiSongMeta[];
    /** 匹配总数量（服务端 total） */
    total?: number;
    maxPage?: number;
}

interface MidiSearchArgs {
    midiPlayer?: MidiPlayer;
    targetPlayListId?: number;
    filter?: string;
    onBack?: () => void;
    replaceList?: boolean;
}

// --- 搜索表单 ---
export const MidiSearchForm = CommonForm.InputForm<
    { keywords: string },
    MidiSearchArgs
>({
    title: "搜索歌曲",
    fieldsGenerator(player, args) {
        return [
            new TextField("歌曲名字", "留空浏览全部", args.filter ?? "").key("keywords"),
        ];
    },
    submitButton: "搜索",
    onSubmit(data, ctx) {
        const { replaceList, ...rest } = ctx.args;
        const next: MidiListArgs = {
            ...rest,
            p: 1,
            filter: data.keywords?.trim() || undefined,
            notice: undefined,
        };
        if (replaceList) ctx.offUntil(MidiListForm, MidiListForm, next);
        else ctx.replace(MidiListForm, next);
    },
    onCancel(res, ctx) {
        ctx.back();
    },
});

// --- 列表表单 ---
export const MidiListForm = CommonForm.ButtonForm<
    MidiListArgs,
    MidiSongMeta
>({
    title: "选择歌曲",
    // 服务端分页：每页向后端请求对应页（搜索时 filter 作为 q 走服务端过滤），
    // 不下载全量列表、不缓存
    async generator(form, ctx, args) {
        if (args.p < 1) args.p = 1;
        let { items, total } = await midiManager.page(args.p, PAGE_SIZE, args.filter);
        let maxPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

        // 数据源收缩时（远程库删除/筛选变化）把页码拉回最后一页。
        if (args.p > maxPage) {
            args.p = maxPage;
            ({ items, total } = await midiManager.page(args.p, PAGE_SIZE, args.filter));
            maxPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
        }

        args.pageItems = items;
        args.total = total;
        args.maxPage = maxPage;

        const queue = args.midiPlayer?.queue;
        const lines = [
            args.targetPlayListId !== undefined ? "§e[添加至列表]§r" : "§b[点歌]§r",
            `结果: ${total} 首`,
            `页码: ${args.p} / ${maxPage}`,
        ];
        if (args.filter) lines.push(`筛选: ${args.filter}`);
        if (queue) lines.push(`队列: ${queue.getLength()} 首`);
        if (args.notice) lines.push(`§a${args.notice}`);
        form.body(lines.join("\n"));
    },
    buttons: [
        {
            label: "上一页",
            func(ctx) {
                ctx.replace(MidiListForm, {
                    ...ctx.args,
                    p: ctx.args.p - 1,
                    notice: undefined,
                });
            },
            shouldShow: (player, args) => args.p > 1,
        },
        {
            label: "下一页",
            func: (ctx) =>
                ctx.replace(MidiListForm, {
                    ...ctx.args,
                    p: ctx.args.p + 1,
                    notice: undefined,
                }),
            shouldShow(player, args) {
                return (args.maxPage ?? 1) > args.p;
            },
        },
    ],

    footerButtons: [
        {
            label: "搜索",
            func(ctx) {
                ctx.push(MidiSearchForm, { ...ctx.args, replaceList: true });
            },
        },
        {
            label: "页码",
            func(ctx) {
                ctx.push(jumpPageForm, {
                    len: ctx.args.total ?? 0,
                    args: ctx.args,
                });
            },
            shouldShow: (player, args) => (args.maxPage ?? 1) > 1,
        },
    ],

    buttonGenerator(player, args) {
        return (args.pageItems ?? []).map((midi) => ({
            label: midi.name,
            data: midi,
        }));
    },

    async handler(ctx, button) {
        const midi = button.data;
        const { midiPlayer, targetPlayListId } = ctx.args;

        if (targetPlayListId !== undefined) {
            // 模式 A: 存入后端/本地播放列表（异步读写）
            const items = await playlist.getContent(targetPlayListId);
            if (items.includes(midi.id)) {
                ctx.replace(MidiListForm, {
                    ...ctx.args,
                    notice: `已在列表中: ${midi.name}`,
                });
                return;
            }
            items.push(midi.id);
            await playlist.setContent(targetPlayListId, items);
            ctx.replace(MidiListForm, {
                ...ctx.args,
                notice: `已添加: ${midi.name}`,
            });
            return;
        }

        // 模式 B: 点歌。已在队列中则直接跳到该曲目，不重复添加。
        const queue = midiPlayer?.queue;
        if (!queue) return;

        const existing = queue.indexOf(midi.id);
        if (existing >= 0) {
            const alreadyPlaying =
                existing === queue.getIndex() && midiPlayer.isPlaying();
            if (!alreadyPlaying) {
                queue.jump(existing);
                void midiPlayer
                    .play()
                    .catch((error) => console.error("[midi] 播放失败", error));
            }
            ctx.replace(MidiListForm, {
                ...ctx.args,
                notice: `${
                    alreadyPlaying ? "正在播放" : `已跳到队列第 ${existing + 1} 首`
                }: ${midi.name}`,
            });
            return;
        }

        queue.enqueue(midi);
        ctx.replace(MidiListForm, {
            ...ctx.args,
            notice: `已加入队列: ${midi.name}`,
        });
    },
    oncancel(res, ctx) {
        if (ctx.args.onBack) ctx.args.onBack();
        else ctx.back();
    },
});

const jumpPageForm = CommonForm.InputForm<
    { p: number },
    {
        len: number;
        args: MidiListArgs;
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
    onCancel(res, ctx) {
        ctx.back();
    },
    onSubmit(data, ctx) {
        ctx.offUntil(MidiListForm, MidiListForm, {
            ...ctx.args.args,
            p: data.p,
            notice: undefined,
        });
    },
});
