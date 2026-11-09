import type { MidiPlayer } from "@domain/playback/player";
import { CommonForm } from "sapi-pro";
import { QueueListForm } from "./queueUI";
import { PlayListMainForm } from "./playListUI";

export interface LibraryArgs {
    midiPlayer: MidiPlayer;
    onBack?: () => void;
}

/** 歌单入口：合并原来的“队列管理”和“播放列表管理”，避免播放器主界面继续加按钮。 */
export const LibraryForm = CommonForm.ButtonForm<LibraryArgs>({
    title: "歌单",
    generator(form, player, args) {
        form.body(`当前队列: ${args.midiPlayer.queue.getLength()} 首`);
    },
    buttons: [
        {
            label: "当前队列",
            func(ctx) {
                ctx.push(QueueListForm, {
                    midiPlayer: ctx.args.midiPlayer,
                    p: -1,
                });
            },
        },
        {
            label: "播放列表",
            func(ctx) {
                ctx.push(PlayListMainForm, {
                    midiPlayer: ctx.args.midiPlayer,
                });
            },
        },
        {
            label: "返回播放器",
            func(ctx) {
                if (ctx.args.onBack) ctx.args.onBack();
                else ctx.back();
            },
        },
    ],
    oncancel(res, ctx) {
        if (ctx.args.onBack) ctx.args.onBack();
        else ctx.back();
    },
});
