import { nameDb } from "@ext";
import { midiManager, playlist } from "@midiPlayer";
import { MidiPlayer } from "@midiPlayer/player";
import type { PlaylistMeta } from "@piano/core";
import { Player } from "@minecraft/server";
import { CommonForm, TextField, Validators } from "sapi-pro";
import { MidiListForm, MidiSearchForm } from "./midiList";
import { PAGE_SIZE } from "./static";
import { isAdmin } from "sapi-pro/func";

function canManage(player: Player, meta: PlaylistMeta) {
    return isAdmin(player) || player.id === meta.owner;
}
// --- 入口 ---
export const PlayListMainForm = CommonForm.ButtonForm<
    {
        midiPlayer: MidiPlayer;
        metas?: PlaylistMeta[];
    },
    PlaylistMeta
>({
    title: "播放列表管理",
    async generator(form, player, args) {
        args.metas = await playlist.listMy(player.id);
        form.body(`我的列表: ${args.metas.length} 个`);
    },
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
    buttonGenerator(player, args) {
        return (args.metas ?? []).map((meta) => ({
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
    {
        midiPlayer: MidiPlayer;
        metas?: PlaylistMeta[];
    },
    PlaylistMeta
>({
    title: "公开播放列表",
    async generator(form, ctx, args) {
        args.metas = await playlist.listPublic();
    },
    buttonGenerator: (player, args) =>
        (args.metas ?? []).map((meta) => ({
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
const PlayListDetailForm = CommonForm.ButtonForm<
    {
        meta: PlaylistMeta;
        midiPlayer: MidiPlayer;
        items?: string[];
    },
    PlaylistMeta
>({
    title: "列表详情",
    async generator(form, ctx, args) {
        const m = args.meta;
        args.items = await playlist.getContent(m.id);
        form.body(
            `名称: ${m.name}\n` +
                `状态: ${m.public ? "公开" : "私有"}\n` +
                `播放量: ${m.playCount}\n` +
                `歌曲数: ${args.items.length} 首`
        );
    },
    buttons: [
        {
            label: "▶ 替换并播放序列",
            async func(ctx) {
                const { meta, midiPlayer } = ctx.args;
                const songIds = await playlist.getContent(meta.id);
                // 按需解析元信息（远程源逐 id 拉取，不依赖全量快照）
                const midiInfos = (
                    await Promise.all(
                        songIds.map((id) =>
                            midiManager.infoOf(id).catch(() => undefined)
                        )
                    )
                ).filter((i): i is NonNullable<typeof i> => !!i);

                if (midiInfos.length === 0) {
                    return ctx.player.sendMessage(
                        "§c该列表内没有可播放的歌曲！"
                    );
                }

                midiPlayer.queue.import(midiInfos as any);
                midiPlayer.play();
                // 播放计数（远程实现上报后端）
                await playlist.incPlayCount(meta.id, ctx.player.id);
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
            async func(ctx) {
                const updated = await playlist.update(ctx.args.meta.id, { public: true });
                if (updated) {
                    ctx.args.meta = updated;
                    ctx.replace(PlayListDetailForm, ctx.args);
                } else {
                    ctx.player.sendMessage("§c操作失败（列表不存在或无权限）");
                }
            },
        },
        {
            label: "设为私有",
            shouldShow: (player, args) =>
                canManage(player, args.meta) && args.meta.public,
            async func(ctx) {
                const updated = await playlist.update(ctx.args.meta.id, { public: false });
                if (updated) {
                    ctx.args.meta = updated;
                    ctx.replace(PlayListDetailForm, ctx.args);
                } else {
                    ctx.player.sendMessage("§c操作失败（列表不存在或无权限）");
                }
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
        meta: PlaylistMeta;
        p: number;
        items?: string[];
    },
    number
>({
    title: "管理列表歌曲",
    async generator(form, ctx, args) {
        // 内容为小数据（歌曲 id 数组），每次打开现拉一整个数组即可
        args.items = await playlist.getContent(args.meta.id);
        const maxPage = Math.ceil(args.items.length / PAGE_SIZE) || 1;
        if (args.p > maxPage) args.p = maxPage;

        form.body(
            `列表: ${args.meta.name}\n总计: ${args.items.length} 首\n页码: ${args.p} / ${maxPage}`
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
                const items = args.items;
                return items ? args.p * PAGE_SIZE < items.length : false;
            },
            func: (ctx) =>
                ctx.replace(PlayListItemsManager, {
                    ...ctx.args,
                    p: ctx.args.p + 1,
                }),
        },
    ],
    buttonGenerator(player, args) {
        const items = args.items ?? [];
        const start = (args.p - 1) * PAGE_SIZE;
        const end = start + PAGE_SIZE;

        // 按需解析本页歌名（远程源逐 id 拉取，不依赖全量快照；未命中显示 id 兜底）
        void Promise.all(
            items
                .slice(start, end)
                .map((id) => midiManager.infoOf(id).catch(() => undefined))
        );

        return items.slice(start, end).map((id, i) => {
            const realIndex = start + i; // 全局索引
            const name = midiManager.getInfo(id)?.name ?? id;
            return {
                label: `${realIndex}. ${name} [移除]`,
                data: realIndex, // 传递全局索引
            };
        });
    },
    async handler(ctx, button) {
        if (!canManage(ctx.player, ctx.args.meta)) return;

        const realIndex = button.data;
        const items = ctx.args.items ?? [];

        if (realIndex >= 0 && realIndex < items.length) {
            const removed = items.splice(realIndex, 1)[0];
            await playlist.setContent(ctx.args.meta.id, items);
            // 按需解析歌名用于提示（不依赖全量快照）
            const info = await midiManager.infoOf(removed).catch(() => undefined);
            ctx.player.sendMessage(`§e已移除: ${info?.name ?? removed}`);
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
    async onSubmit(data, ctx) {
        const newName = data.newName?.trim();
        if (!newName) return ctx.player.sendMessage("§c名称不能为空");

        const updated = await playlist.update(ctx.args.meta.id, { name: newName });
        if (updated) {
            ctx.args.meta.name = updated.name; // 同步引用数据
            ctx.player.sendMessage("§a修改成功！");
        } else {
            ctx.player.sendMessage("§c操作失败（列表不存在或无权限）");
        }
        ctx.back();
    },
});

// --- 创建和确认删除 ---
const CreatePlayListForm = CommonForm.InputForm<{ name: string }>({
    title: "创建列表",
    fields: [
        new TextField("名称", "", "新列表")
            .key("name")
            .validator(Validators.stringLength(2, 8, "播放列表名字长度错误")),
    ],
    submitButton: "创建",
    async onSubmit(data, ctx) {
        const meta = await playlist.create(ctx.player.id, data.name || "未命名");
        if (meta) {
            nameDb.set(ctx.player);
            ctx.player.sendMessage(`§a已创建: ${meta.name}`);
        } else {
            ctx.player.sendMessage("§c创建失败");
        }
        ctx.back(); // 返回歌单首页（onSubmit 被框架 await，导航在生命周期内）
    },
});

const ConfirmDeleteForm = CommonForm.SimpleMessageForm<any>({
    title: "确认删除",
    generator(form, p, args) {
        form.body(`确认删除 ${args.meta.name}？`);
    },
    button1: {
        text: "确定",
        async func(ctx) {
            await playlist.remove(ctx.args.meta.id);
            ctx.player.sendMessage("§a已删除");
            ctx.back();
        },
    },
    button2: { text: "取消", func: (ctx) => ctx.back() },
});