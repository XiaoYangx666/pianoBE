import { sameMusicSelection, toMusicSelection, type MusicSelection } from "@piano/core";

export type PlayMode = "sequence" | "loop" | "single" | "shuffle";

const modeName: Record<PlayMode, string> = {
    sequence: "顺序播放",
    loop: "循环播放",
    single: "单曲循环",
    shuffle: "随机播放",
};

export function getPlayModeName(mode: PlayMode) {
    return modeName[mode] ?? "未知播放模式";
}

/**
 * 播放队列：只负责“接下来放哪一首”。
 *
 * 每条记录都是带来源的选择（存储卡 / 曲库）。
 * 身份判断同时比较来源与内容指纹，避免把不同存储里的同 id 曲目当成同一首。
 */
export class PlayQueue {
    private list: MusicSelection[] = [];
    private index = -1;
    private mode: PlayMode = "sequence";

    /* ================== 基础 ================== */

    clear() {
        this.list.length = 0;
        this.index = -1;
    }

    current(): MusicSelection | undefined {
        if (this.index < 0 || this.index >= this.list.length) return;
        return this.list[this.index];
    }

    /* ================== 播放模式 ================== */

    setMode(mode: PlayMode) {
        this.mode = mode;
    }

    getMode() {
        return this.mode;
    }

    /* ================== 核心行为 ================== */

    /**
     * 插入当前后面并立即跳转
     */
    insertBack(midi: MusicSelection): MusicSelection {
        const selection = toMusicSelection(midi, midi.performanceId);
        if (this.index === -1) {
            this.list.push(selection);
            this.index = 0;
            return selection;
        }

        const insertIndex = Math.min(this.list.length, this.index + 1);
        this.list.splice(insertIndex, 0, selection);
        this.index = insertIndex;
        return selection;
    }

    /**
     * 普通加入队列（尾部）
     */
    enqueue(midi: MusicSelection): MusicSelection | undefined {
        this.list.push(toMusicSelection(midi, midi.performanceId));

        if (this.index === -1) {
            this.index = 0;
            return this.list[0];
        }
    }

    /** 去重加入尾部；已存在时不产生第二条。 */
    enqueueUnique(midi: MusicSelection): "added" | "exists" {
        if (this.indexOf(midi) >= 0) return "exists";
        this.enqueue(midi);
        return "added";
    }

    /** 在当前曲目之后插入整组歌曲并跳到第一首；其余歌曲保留在后面。 */
    insertCollectionAfterCurrent(refs: readonly MusicSelection[]): { added: number; exists: number } {
        const unique: MusicSelection[] = [];
        for (const ref of refs) {
            if (!unique.some(item => sameMusicSelection(item, ref))) unique.push(toMusicSelection(ref, ref.performanceId));
        }
        if (!unique.length) return { added: 0, exists: 0 };
        const selected = (ref: MusicSelection) => unique.some(item => sameMusicSelection(item, ref));
        const previous = this.list;
        const exists = unique.filter(ref => previous.some(item => sameMusicSelection(item, ref))).length;
        const current = this.current();
        const currentIsSelected = current !== undefined && selected(current);
        const originalInsertAt = this.index < 0 ? 0
            : Math.min(previous.length, this.index + (currentIsSelected ? 0 : 1));
        let removedBefore = 0;
        const kept: MusicSelection[] = [];
        for (let i = 0; i < previous.length; i++) {
            if (selected(previous[i])) {
                if (i < originalInsertAt) removedBefore++;
            } else kept.push(previous[i]);
        }
        const insertAt = originalInsertAt - removedBefore;
        kept.splice(insertAt, 0, ...unique);
        this.list = kept;
        this.index = insertAt;
        return { added: unique.length - exists, exists };
    }

    /** 调整顺序；当前播放位置跟随被移动的曲目。 */
    move(from: number, to: number): boolean {
        if (from < 0 || from >= this.list.length || to < 0 || to >= this.list.length || from === to) return false;
        const [item] = this.list.splice(from, 1);
        this.list.splice(to, 0, item);
        if (this.index === from) {
            this.index = to;
        } else if (from < this.index && to >= this.index) {
            this.index--;
        } else if (from > this.index && to <= this.index) {
            this.index++;
        }
        return true;
    }

    remove(index: number): MusicSelection | undefined {
        if (index < 0 || index >= this.list.length) return;

        const removed = this.list[index];
        this.list.splice(index, 1);

        // 删除的是当前 → index 不变（指向"下一首"）
        if (index === this.index) {
            if (this.index >= this.list.length) {
                this.index = this.list.length; // 越界（表示结束）
            }
            return removed;
        }

        // 删除的是当前前面的
        if (index < this.index) {
            this.index--;
        }

        return removed;
    }

    jump(index: number): MusicSelection | undefined {
        if (index < 0 || index >= this.list.length) return;
        this.index = index;
        return this.list[index];
    }

    /**
     * 摘除读取失败的曲目，返回它的后继曲目。
     *
     * 不沿用 `next()` 的取歌规则：单曲循环/随机模式下“再放一次当前曲”没有意义，
     * 失效条目被摘掉后应继续往后走。返回 undefined 表示已无后继。
     *
     * @param expected 期望被摘除的引用。`loadMidi` 是异步的，期间玩家可能改动队列，
     *                 按引用定位可避免误删当前选中的其它曲目。
     */
    dropCurrent(expected?: MusicSelection): MusicSelection | undefined {
        const index = expected ? this.indexOf(expected) : this.index;
        if (index < 0 || index >= this.list.length) return expected ? this.current() : undefined;
        this.list.splice(index, 1);
        if (index < this.index) {
            this.index--;
            return this.current();
        }
        if (index > this.index) return this.current();
        // 摘除的正是当前项：splice 后指针正好落在原后继上，越界表示已到末尾。
        if (this.index >= this.list.length) this.index = this.list.length;
        return this.list[this.index];
    }

    /* ================== 跳转 ================== */

    next(): MusicSelection | undefined {
        if (this.list.length === 0) return;

        if (this.mode === "single") {
            return this.current();
        }

        if (this.mode === "shuffle") {
            this.index = Math.floor(Math.random() * this.list.length);
            return this.list[this.index];
        }

        // 顺序 / 列表循环
        if (this.index + 1 < this.list.length) {
            this.index++;
            return this.list[this.index];
        }

        // 到尾部
        if (this.mode === "loop") {
            this.index = 0;
            return this.list[0];
        }

        // sequence 模式 → 结束
        this.index = this.list.length;
        return;
    }

    prev(): MusicSelection | undefined {
        if (this.list.length === 0) return;

        if (this.mode === "single") {
            return this.current();
        }

        if (this.mode === "shuffle") {
            this.index = Math.floor(Math.random() * this.list.length);
            return this.list[this.index];
        }

        if (this.index - 1 >= 0) {
            this.index--;
            return this.list[this.index];
        }

        if (this.mode === "loop") {
            this.index = this.list.length - 1;
            return this.list[this.index];
        }

        return;
    }

    /* ================== 状态 ================== */

    isEmpty() {
        return this.list.length === 0;
    }

    /** 队列是否已播完（无下一首） */
    isEnd() {
        return this.index >= this.list.length;
    }

    /** 队列原始引用（UI/来源标记用）。 */
    getRefs(): readonly MusicSelection[] {
        return this.list;
    }

    getIndex() {
        return this.index;
    }

    getLength() {
        return this.list.length;
    }

    indexOf(ref: MusicSelection) {
        return this.list.findIndex((song) => sameMusicSelection(song, ref));
    }

    snapshot() {
        return { songs: this.list.slice(), index: this.index, mode: this.mode };
    }

    restore({ songs, index, mode }: { songs: MusicSelection[]; index: number; mode: PlayMode }) {
        this.list = songs.map(song => toMusicSelection(song, song.performanceId));
        this.index = index;
        this.mode = mode;
    }
}
