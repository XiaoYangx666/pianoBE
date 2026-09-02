import { SampledMidiPlayer, type NoteEvent } from "@piano/core/player";
import { TIME_SCALE, OTHER_SCALE } from "@piano/core";
import type { TemplateInfo } from "./template";
import type { SongEntry } from "./types";

export type { NoteEvent } from "@piano/core/player";

/**
 * 生成器预览播放器（薄壳）：WebAudio 采样播放引擎在 core（@piano/core/player，
 * 与管理端 web 共用同一引擎），这里只负责：
 * - 采样源：从已加载模板 mcaddon 的 rp/sounds 提取（不重复存放音效文件）
 * - 事件来源：SongEntry（曲库二进制/上传 midi/模板内嵌模块文本）
 * 播放行为（调度/变调/包络/兜底）与游戏一致，由 core 引擎保证。
 */

/** 各类 SongEntry → 音符事件（兼容 song 对象与模板 moduleText） */
export function songEntryToEvents(entry: SongEntry): NoteEvent[] {
    const events: NoteEvent[] = [];
    if (entry.song) {
        for (const track of entry.song.tracks) {
            pushQuads(events, track.notes);
        }
    } else if (entry.moduleText) {
        const noteArrays = entry.moduleText.match(/notes:new Uint16Array\(\[([\d,]+)\]\)/g) ?? [];
        for (const m of noteArrays) {
            const nums = (m.match(/[\d,]+/)![0]).split(",").map(Number);
            pushQuads(events, nums);
        }
    }
    events.sort((a, b) => a.time - b.time);
    return events;
}

function pushQuads(events: NoteEvent[], nums: number[]) {
    for (let i = 0; i + 3 < nums.length; i += 4) {
        const velocity = nums[i + 3] / OTHER_SCALE;
        if (velocity <= 0) continue;
        events.push({
            midi: nums[i],
            time: nums[i + 1] / TIME_SCALE,
            duration: nums[i + 2] / OTHER_SCALE,
            velocity,
        });
    }
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
            const file = info.zip.file(`${soundsRoot}${dir}/${fileName}.ogg`);
            if (!file) return null;
            const blob = await file.async("blob");
            return blob.arrayBuffer();
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