import { nameDb } from "@ext";
import { midiManager, playListStore } from "@midiPlayer";
import { MidiPlayer } from "@midiPlayer/player";
import { PlayListMeta } from "@midiPlayer/playlist";
import { Player } from "@minecraft/server";
import { CommonForm, TextField, Validators } from "sapi-pro";
import { MidiListForm, MidiSearchForm } from "./midiList";
import { PAGE_SIZE } from "./static";
import { isAdmin } from "sapi-pro/func";

function canManage(player: Player, meta: PlayListMeta) {
    return isAdmin(player) || player.id === meta.owner;
}
// --- 入口 ---
export const PlayListMainForm = CommonForm.ButtonForm<
    {
        midiPlayer: MidiPlayer;
    },
    PlayListMeta
>({
    title: "播放列表管理",
    buttons: [
        {
            label: "公开广场",
            func: (ctx) =>
                ctx.push(PublicPlayListForm, {
                    midiPlayer: ctx.args.midiPlayer,
                }),
        },
        {
            label: "+ 创建新列表",
            func: (ctx) => ctx.push(CreatePlayListForm, {}),
        },
    ],
    buttonGenerator(player) {
        return playListStore.getMetasByOwner(player.id).map((meta) => ({
            label: `${meta.public ? "§q[公开]" : "§s[私有]"} §r${meta.name}\n播放: ${meta.playCount}`,
            data: meta,
        }));
    },
    handler(ctx, button) {
        if (button.data)
            ctx.push(PlayListDetailForm, {
                meta: button.data,
                midiPlayer: ctx.args.midiPlayer,
            });
    },
});

// --- 公开广场 ---
const PublicPlayListForm = CommonForm.ButtonForm<
    { midiPlayer: MidiPlayer },
    PlayListMeta
>({
    title: "公开播放列表",
    buttonGenerator: () =>
        playListStore.getPublicMetas(true).map((meta) => ({
            label: `${meta.name}\n作者: ${nameDb.getNameById(meta.owner) ?? meta.owner} | 播放: ${meta.playCount}`,
            data: meta,
        })),
    handler(ctx, button) {
        if (button.data)
            ctx.push(PlayListDetailForm, {
                meta: button.data,
                midiPlayer: ctx.args.midiPlayer,
            });
    },
    oncancel(res, ctx) {
        ctx.back();
    },
});

// --- 详情页 ---
const PlayListDetailForm = CommonForm.ButtonForm<{
    meta: PlayListMeta;
    midiPlayer: MidiPlayer;
}>({
    title: "列表详情",
    generator(form, player, args) {
        const m = args.meta;
        // 直接加载 items 获取准确数量
        const items = playListStore.getContent(m.id);
        form.body(
            `名称: ${m.name}\n` +
                `状态: ${m.public ? "公开" : "私有"}\n` +
                `播放量: ${m.playCount}\n` +
                `歌曲数: ${items.length} 首`
        );
    },
    validator(ctx) {
        // 如果列表已被删除，自动退回
        if (!playListStore.getMeta(ctx.args.meta.id)) {
            ctx.back();
        }
    },
    buttons: [
        {
            label: "▶ 替换并播放序列",
            func(ctx) {
                const { meta, midiPlayer } = ctx.args;
                const songIds = playListStore.getContent(meta.id);
                const midiInfos = songIds
                    .map((id) => midiManager.getInfo(id))
                    .filter((i) => !!i);

                if (midiInfos.length === 0) {
                    return ctx.player.sendMessage(
                        "§c该列表内没有可播放的歌曲！"
                    );
                }

                midiPlayer.queue.import(midiInfos as any);
                midiPlayer.play();
                // 增加播放数 (限制每人每天一次)
                playListStore.incPlayCount(meta.id, ctx.player.id);
                ctx.player.sendMessage(`§a成功导入 ${midiInfos.length} 首歌曲`);
                ctx.back();
            },
        },
        {
            label: "管理歌曲",
            func: (ctx) =>
                ctx.push(PlayListItemsManager, { meta: ctx.args.meta, p: 1 }),
        },
        {
            label: "重命名",
            shouldShow: (player, args) => canManage(player, args.meta),
            func: (ctx) =>
                ctx.push(RenamePlayListForm, { meta: ctx.args.meta }),
        },
        {
            label: "设为公开",
            shouldShow: (player, args) =>
                canManage(player, args.meta) && !args.meta.public,
            func(ctx) {
                playListStore.updateMeta(ctx.args.meta.id, { public: true });
                ctx.args.meta.public = true;
                ctx.replace(PlayListDetailForm, ctx.args);
            },
        },
        {
            label: "设为私有",
            shouldShow: (player, args) =>
                canManage(player, args.meta) && args.meta.public,
            func(ctx) {
                playListStore.updateMeta(ctx.args.meta.id, { public: false });
                ctx.args.meta.public = false;
                ctx.replace(PlayListDetailForm, ctx.args);
            },
        },
        {
            label: "删除列表",
            shouldShow: (player, args) => canManage(player, args.meta),
            func: (ctx) => ctx.push(ConfirmDeleteForm, { meta: ctx.args.meta }),
        },
    ],
    oncancel(res, ctx) {
        ctx.back();
    },
});

// --- 歌曲管理页 (分页版) ---
const PlayListItemsManager = CommonForm.ButtonForm<
    {
        meta: PlayListMeta;
        p: number;
    },
    number
>({
    title: "管理列表歌曲",
    generator(form, player, args) {
        const items = playListStore.getContent(args.meta.id);
        const maxPage = Math.ceil(items.length / PAGE_SIZE) || 1;
        if (args.p > maxPage) args.p = maxPage;

        form.body(
            `列表: ${args.meta.name}\n总计: ${items.length} 首\n页码: ${args.p} / ${maxPage}`
        );
    },
    buttons: [
        {
            label: "+ 添加歌曲",
            shouldShow: (p, args) => canManage(p, args.meta),
            func: (ctx) =>
                ctx.push(MidiListForm, {
                    targetPlayListId: ctx.args.meta.id,
                    p: 1,
                }),
        },
        {
            label: "搜索添加",
            shouldShow: (p, args) => canManage(p, args.meta),
            func: (ctx) =>
                ctx.push(MidiSearchForm, {
                    targetPlayListId: ctx.args.meta.id,
                }),
        },
        {
            label: "上一页",
            shouldShow: (p, args) => args.p > 1,
            func: (ctx) =>
                ctx.replace(PlayListItemsManager, {
                    ...ctx.args,
                    p: ctx.args.p - 1,
                }),
        },
        {
            label: "下一页",
            shouldShow: (p, args) => {
                const items = playListStore.getContent(args.meta.id);
                return args.p * PAGE_SIZE < items.length;
            },
            func: (ctx) =>
                ctx.replace(PlayListItemsManager, {
                    ...ctx.args,
                    p: ctx.args.p + 1,
                }),
        },
    ],
    buttonGenerator(player, args) {
        const items = playListStore.getContent(args.meta.id);
        const start = (args.p - 1) * PAGE_SIZE;
        const end = start + PAGE_SIZE;

        return items.slice(start, end).map((id, i) => {
            const realIndex = start + i; // 全局索引
            return {
                label: `${realIndex}. ${midiManager.getInfo(id)?.name ?? "未知歌曲"} [移除]`,
                data: realIndex, // 传递全局索引
            };
        });
    },
    handler(ctx, button) {
        if (!canManage(ctx.player, ctx.args.meta)) return;

        const realIndex = button.data;
        const items = playListStore.getContent(ctx.args.meta.id);

        if (realIndex >= 0 && realIndex < items.length) {
            const removed = items.splice(realIndex, 1)[0];
            const name = midiManager.getInfo(removed)?.name ?? removed;
            playListStore.setContent(ctx.args.meta.id, items);
            ctx.player.sendMessage(`§e已移除: ${name}`);
        }

        // 刷新当前页
        ctx.replace(PlayListItemsManager, ctx.args);
    },
    oncancel(res, ctx) {
        ctx.back();
    },
});

// --- 重命名表单 ---
const RenamePlayListForm = CommonForm.InputForm<any, any>({
    title: "重命名播放列表",
    fields: [
        new TextField("新名称", "请输入新的列表名称", "")
            .key("newName")
            .validator(Validators.stringLength(2, 8, "播放列表名字长度错误")),
    ],
    submitButton: "确定",
    onSubmit(data, ctx) {
        const newName = data.newName?.trim();
        if (!newName) return ctx.player.sendMessage("§c名称不能为空");

        playListStore.updateMeta(ctx.args.meta.id, { name: newName });
        ctx.args.meta.name = newName; // 同步引用数据
        ctx.player.sendMessage("§a修改成功！");
        ctx.back();
    },
});

// --- 创建和确认删除 (略，逻辑同前) ---
const CreatePlayListForm = CommonForm.InputForm<{ name: string }>({
    title: "创建列表",
    fields: [
        new TextField("名称", "", "新列表")
            .key("name")
            .validator(Validators.stringLength(2, 8, "播放列表名字长度错误")),
    ],
    submitButton: "创建",
    onSubmit: (data, ctx) => {
        playListStore.create(ctx.player.id, data.name || "未命名");
        nameDb.set(ctx.player);
        ctx.back();
    },
});

const ConfirmDeleteForm = CommonForm.SimpleMessageForm<any>({
    title: "确认删除",
    generator(form, p, args) {
        form.body(`确认删除 ${args.meta.name}？`);
    },
    button1: {
        text: "确定",
        func: (ctx) => {
            playListStore.delete(ctx.args.meta.id);
            ctx.back();
        },
    },
    button2: { text: "取消", func: (ctx) => ctx.back() },
});
