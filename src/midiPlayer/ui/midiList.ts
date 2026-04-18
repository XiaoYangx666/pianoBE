import { midiManager } from "@midiPlayer";
import { PlayQueue } from "@midiPlayer/queue";
import { MidiInfo } from "@types";
import { CommonForm, TextField } from "sapi-pro";
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
    { queue: PlayQueue | undefined; targetPlayListId: number | undefined }
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
export const MidiListForm = CommonForm.ButtonForm<{
    queue: PlayQueue | undefined;
    targetPlayListId: number | undefined;
    p: number;
    filter: string | undefined;
}>({
    title: "选择歌曲",
    async generator(form, ctx, args) {
        const filteredList = getFilteredList(args.filter);
        const maxPage = Math.max(1, Math.ceil(filteredList.length / PAGE_SIZE));
        const mode = args.targetPlayListId ? "§e[添加至列表]§r" : "§b[点歌]§r";
        form.body(
            `${mode}\n结果: ${filteredList.length} 首\n页码: ${args.p} / ${maxPage}`
        );
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
        const filteredList = getFilteredList(args.filter);
        const start = (args.p - 1) * PAGE_SIZE;
        return filteredList.slice(start, start + PAGE_SIZE).map((midi) => ({
            label: `${midi.name}`,
            data: midi,
        }));
    },

    handler(ctx, button) {
        const midi = button.data as MidiInfo;
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
