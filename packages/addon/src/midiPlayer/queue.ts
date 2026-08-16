import { MidiInfo } from "@types";

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

export class PlayQueue {
    private list: MidiInfo[] = [];
    private index = -1;
    private mode: PlayMode = "sequence";

    /* ================== 基础 ================== */

    clear() {
        this.list.length = 0;
        this.index = -1;
    }

    current(): MidiInfo | undefined {
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
    insertBack(midi: MidiInfo): MidiInfo {
        if (this.index === -1) {
            this.list.push(midi);
            this.index = 0;
            return midi;
        }

        const insertIndex = this.index + 1;
        this.list.splice(insertIndex, 0, midi);
        this.index = insertIndex;
        return midi;
    }

    /**
     * 普通加入队列（尾部）
     */
    enqueue(midi: MidiInfo): MidiInfo | undefined {
        this.list.push(midi);

        if (this.index === -1) {
            this.index = 0;
            return this.list[0];
        }
    }

    remove(index: number): MidiInfo | undefined {
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

    jump(index: number): MidiInfo | undefined {
        if (index < 0 || index >= this.list.length) return;
        this.index = index;
        return this.list[index];
    }

    /* ================== 跳转 ================== */

    next(): MidiInfo | undefined {
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

    prev(): MidiInfo | undefined {
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

    getIndex() {
        return this.index;
    }

    getLength() {
        return this.list.length;
    }

    /* ================== 导入与导出 ================== */

    /**导入播放列表，覆盖当前 */
    import(list: MidiInfo[]): void {
        this.list = list;
        this.index = list.length == 0 ? -1 : 0;
    }

    /**导出midi的id列表 */
    export(): string[] {
        return this.list.map((t) => t.id);
    }
}
