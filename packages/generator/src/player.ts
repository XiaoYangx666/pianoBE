import { SampledMidiPlayer, type NoteEvent } from "@piano/core/player";
import { TIME_SCALE, pbe2ToNoteEvents } from "@piano/core";
import type { TemplateInfo } from "./template";
import type { SongEntry } from "./types";

export type { NoteEvent } from "@piano/core/player";

/**
 * 生成器预览播放器（薄壳）：WebAudio 采样播放引擎在 core（@piano/core/player，
 * 与管理端 web 共用同一引擎），这里只负责：
 * - 采样源：从已加载模板 mcaddon 的 rp/sounds 提取（不重复存放音效文件）
 * - 事件来源：SongEntry 中的 PBE2 事件流
 * 播放行为（调度/变调/包络/兜底）与游戏一致，由 core 引擎保证。
 */

/** SongEntry → 音符事件（PBE2 事件流解码） */
export function songEntryToEvents(entry: SongEntry): NoteEvent[] {
    return entry.data ? pbe2ToNoteEvents(entry.data) : [];
}

export class PreviewPlayer extends SampledMidiPlayer {
    /** 播放中曲目变化回调（null = 已停止/结束），用于刷新 ▶/⏹ */
    onStateChange: (songId: string | null) => void = () => {};

    private lastId: string | null = null;

    constructor() {
        super();
        this.subscribe((s) => {
            const id =
                s.status === "playing" || s.status === "paused" ? s.songId : null;
            if (id !== this.lastId) {
                this.lastId = id;
                this.onStateChange(id);
            }
        });
    }

    /** 绑定模板（内含 rp 音效）；更换模板时重新绑定并停止播放、清空采样缓存 */
    bindTemplate(info: TemplateInfo | null) {
        this.stop();
        this.clearSampleCache();
        this.sampleSource = null;
        if (!info) return;
        const soundsRoot = `${info.rpPath}sounds/`;
        this.sampleSource = async (dir: string, fileName: string) => {
            const file = await info.addon.read(`${soundsRoot}${dir}/${fileName}.ogg`);
            if (!file) return null;
            return file.bytes.slice().buffer;
        };
    }

    /** 预览播放（须在用户手势中调用） */
    async play(entry: SongEntry): Promise<void> {
        if (!this.sampleSource) throw new Error("底包模板未加载，无法预览");
        await this.playSong(entry.id, entry.name, entry.duration / TIME_SCALE, songEntryToEvents(entry));
    }
}

/** 全局单例 */
export const previewPlayer = new PreviewPlayer();
