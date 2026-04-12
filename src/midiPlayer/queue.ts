import { MidiJson } from "@types";

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
    private list: MidiJson[] = [];
    private index = -1;

    private mode: PlayMode = "sequence";

    /* ================== 基础 ================== */

    clear() {
        this.list.length = 0;
        this.index = -1;
    }

    current(): MidiJson | undefined {
        if (this.index < 0 || this.index >= this.list.length) return;
        return this.list[this.index];
    }

    hasCurrent() {
        return this.current() !== undefined;
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
     * 播放（插入当前后面并立即播放）
     */
    play(midi: MidiJson): MidiJson {
        if (this.index === -1) {
            // 没有当前 → 直接放入
            this.list.push(midi);
            this.index = 0;
            return midi;
        }

        // 插入到当前后面
        const insertIndex = this.index + 1;
        this.list.splice(insertIndex, 0, midi);

        // 跳到它
        this.index = insertIndex;
        return midi;
    }

    /**
     * 普通加入队列（尾部）
     */
    enqueue(midi: MidiJson) {
        this.list.push(midi);

        if (this.index === -1) {
            this.index = 0;
            return this.list[0];
        }
    }

    remove(index: number): MidiJson | undefined {
        if (index < 0 || index >= this.list.length) return;

        const removed = this.list[index];

        // 删除元素
        this.list.splice(index, 1);

        // ⭐ 情况1：删除的是当前
        if (index === this.index) {
            // 当前被删 → index 不变（指向“下一首”）
            if (this.index >= this.list.length) {
                // 删的是最后一个
                this.index = this.list.length; // 越界（表示结束）
            }

            return removed;
        }

        // ⭐ 情况2：删除的是当前前面的
        if (index < this.index) {
            this.index--;
        }

        // ⭐ 情况3：删除的是后面的 → 不用动

        return removed;
    }

    jump(index: number): MidiJson | undefined {
        if (index < 0 || index >= this.list.length) return;

        this.index = index;
        return this.list[index];
    }

    /* ================== 跳转 ================== */

    next(): MidiJson | undefined {
        if (this.list.length === 0) return;

        // 单曲循环
        if (this.mode === "single") {
            return this.current();
        }

        // 随机
        if (this.mode === "shuffle") {
            const nextIndex = Math.floor(Math.random() * this.list.length);
            this.index = nextIndex;
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
        this.index = this.list.length; // 越界
        return;
    }

    prev(): MidiJson | undefined {
        if (this.list.length === 0) return;

        // 单曲循环
        if (this.mode === "single") {
            return this.current();
        }

        // 随机（简单实现：再随机一个）
        if (this.mode === "shuffle") {
            const prevIndex = Math.floor(Math.random() * this.list.length);
            this.index = prevIndex;
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

    getQueue() {
        return this.list.map((m) => m.name ?? "unknown");
    }

    getIndex() {
        return this.index;
    }

    getLength() {
        return this.list.length;
    }
}
