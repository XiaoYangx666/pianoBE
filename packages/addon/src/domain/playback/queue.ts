import { normalizeMusicRef, sameMusicRef, type MusicRef } from "@piano/core";

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
 * 每条记录都是带来源的 MusicRef（钢琴 / 存储卡 / 曲库），不复制曲目正文。
 * 身份判断同时比较来源与内容指纹，避免把不同存储里的同 id 曲目当成同一首。
 */
export class PlayQueue {
    private list: MusicRef[] = [];
    private index = -1;
    private mode: PlayMode = "sequence";

    /* ================== 基础 ================== */

    clear() {
        this.list.length = 0;
        this.index = -1;
    }

    current(): MusicRef | undefined {
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
    insertBack(midi: MusicRef): MusicRef {
        if (this.index === -1) {
            this.list.push(midi);
            this.index = 0;
            return midi;
        }

        const insertIndex = Math.min(this.list.length, this.index + 1);
        this.list.splice(insertIndex, 0, midi);
        this.index = insertIndex;
        return midi;
    }

    /**
     * 普通加入队列（尾部）
     */
    enqueue(midi: MusicRef): MusicRef | undefined {
        this.list.push(midi);

        if (this.index === -1) {
            this.index = 0;
            return this.list[0];
        }
    }

    /** 去重加入尾部；已存在时不产生第二条。 */
    enqueueUnique(midi: MusicRef): "added" | "exists" {
        if (this.indexOf(midi) >= 0) return "exists";
        this.enqueue(midi);
        return "added";
    }

    /** 在当前曲目之后插入整组歌曲并跳到第一首；其余歌曲保留在后面。 */
    insertCollectionAfterCurrent(refs: readonly MusicRef[]): { added: number; exists: number } {
        const unique: MusicRef[] = [];
        for (const ref of refs) if (!unique.some(item => sameMusicRef(item, ref))) unique.push(ref);
        if (!unique.length) return { added: 0, exists: 0 };
        const selected = (ref: MusicRef) => unique.some(item => sameMusicRef(item, ref));
        const previous = this.list;
        const exists = unique.filter(ref => previous.some(item => sameMusicRef(item, ref))).length;
        const currentIsSelected = this.current() !== undefined && selected(this.current()!);
        const originalInsertAt = this.index < 0 ? 0
            : Math.min(previous.length, this.index + (currentIsSelected ? 0 : 1));
        let removedBefore = 0;
        const kept: MusicRef[] = [];
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

    /** 移除指定引用（按来源/id/指纹匹配）；用于整卡播放前整理重复项。 */
    removeRefs(refs: readonly MusicRef[]): number {
        let removed = 0;
        for (const ref of refs) {
            const index = this.indexOf(ref);
            if (index < 0) continue;
            this.remove(index);
            removed++;
        }
        return removed;
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

    remove(index: number): MusicRef | undefined {
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

    jump(index: number): MusicRef | undefined {
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
    dropCurrent(expected?: MusicRef): MusicRef | undefined {
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

    next(): MusicRef | undefined {
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

    prev(): MusicRef | undefined {
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

    getQueue() {
        return this.list.map((m) => m.name ?? "unknown");
    }

    /** 队列原始引用（UI/来源标记用）。 */
    getRefs(): readonly MusicRef[] {
        return this.list;
    }

    getIndex() {
        return this.index;
    }

    getLength() {
        return this.list.length;
    }

    /** 查找曲目在队列中的位置；字符串按 id 匹配（兼容旧调用），对象按来源+id+指纹匹配。 */
    indexOf(ref: MusicRef | string) {
        if (typeof ref === "string") return this.list.findIndex((song) => song.id === ref);
        return this.list.findIndex((song) => sameMusicRef(song, ref));
    }

    snapshot() {
        // Save playback selectors and track identity. Cue arrays belong to the library.
        const songs = this.list.map((ref) => normalizeMusicRef(ref)!);
        return { songs, index: this.index, mode: this.mode };
    }

    restore({ songs, index, mode }: { songs: MusicRef[]; index: number; mode: PlayMode }) {
        this.list = songs.slice();
        this.index = index;
        this.mode = mode;
    }

    /* ================== 导入与导出 ================== */

    /**导入播放列表，覆盖当前 */
    import(list: MusicRef[]): void {
        this.list = list;
        this.index = list.length == 0 ? -1 : 0;
    }

    /**导出midi的id列表 */
    export(): string[] {
        return this.list.map((t) => t.id);
    }
}
