import {
    DEFAULT_MAX_HELD_SECONDS,
    DEFAULT_NOTE_RELEASE_SECONDS,
    PIANO_VOICE_BUDGET,
    SAME_NOTE_FADE_SECONDS,
    SAME_NOTE_STOP_SECONDS,
} from "@piano/core";

/**
 * 声音实例释放队列：在 Note Off 后按固定时长淡出，再停止实例。
 *
 * 不依赖 @minecraft/server，便于在单元测试里用假实例验证。
 *
 * 声部上限：Bedrock 客户端同一时刻最多混 32 个音效，而淡出中的实例仍占名额。
 * 队列按 `PIANO_VOICE_BUDGET`（28）控制自己持有的 SoundInstance 数，
 * 超限时主动挑一个“最不重要”的音立即收掉，而不是让引擎随机截断。
 */
export interface ReleasableSound {
    fade(durationSeconds: number, targetVolume: number): void;
    stop(): void;
}

interface Voice {
    sound: ReleasableSound;
    midi: number;
    /** 触发时的力度（0~127），越低越先被牺牲。 */
    velocity: number;
    /** 手动敲键优先于谱面播放。 */
    manual: boolean;
    startTick: number;
    releaseTick: number;
    stopTick?: number;
    failed?: boolean;
    /** 已因超限被选中（用于统计，避免同一声部计两次）。 */
    evicted?: boolean;
}

export class SoundReleaseQueue {
    private voices: Voice[] = [];
    private evictedVoices = 0;
    private droppedVoices = 0;

    constructor(
        private readonly releaseSeconds = DEFAULT_NOTE_RELEASE_SECONDS,
        private readonly tickRate = 20,
        private readonly maxVoices = PIANO_VOICE_BUDGET,
        /** 单个实例最多保留多久；用于超长音符在采样自然结束后释放句柄。 */
        private readonly maxHeldSeconds = DEFAULT_MAX_HELD_SECONDS
    ) {}

    /** 当前持有的实例数（含淡出中的实例）。 */
    get size() {
        return this.voices.length;
    }

    /** 因超过声部预算而被提前收掉的实例数。 */
    get evictions() {
        return this.evictedVoices;
    }

    /** 因声部已满且自身更轻而被直接省略的新音符数。 */
    get dropped() {
        return this.droppedVoices;
    }

    get capacity() {
        return this.maxVoices;
    }

    /**
     * 在调用 `playSound` **之前**腾出声部名额。
     *
     * - 返回 true：可以播放；必要时已挑好牺牲者并立即收掉。
     * - 返回 false：新音符比所有正在响的音都轻，直接省略，连 SoundInstance 都不创建。
     *
     * 先腾位再播放，能避免引擎在我们来得及处理之前随机截断别的音。
     */
    makeRoom(velocity: number, manual = false, midi?: number): boolean {
        this.pruneFailed();
        if (this.voices.length < this.maxVoices) return true;

        // 同键重触发：add() 会把旧实例快速收掉，不需要再牺牲别人。
        if (midi !== undefined && this.voices.some(voice => voice.midi === midi && voice.stopTick === undefined)) {
            return true;
        }

        const victim = this.chooseVictim();
        if (!victim) return false;

        // 新音符不比牺牲者更响，且不是手动按键：省掉这次播放更划算。
        if (!manual && victim.stopTick === undefined && velocity <= victim.velocity) {
            this.droppedVoices++;
            return false;
        }

        this.releaseVoice(victim);
        return true;
    }

    /**
     * 登记一个刚开始播放的声音。
     * @param durationSeconds MIDI 音符时值；手动按键可传一个较短的固定时值。
     */
    add(
        sound: ReleasableSound,
        midi: number,
        durationSeconds: number,
        nowTick: number,
        velocity = 100,
        manual = false
    ) {
        // 同键重触发：旧实例先快速收掉，避免两个同音叠加。
        for (const voice of this.voices) {
            if (voice.midi !== midi || voice.stopTick !== undefined) continue;
            try {
                voice.sound.fade(SAME_NOTE_FADE_SECONDS, 0);
                voice.stopTick = nowTick + Math.max(1, Math.round(SAME_NOTE_STOP_SECONDS * this.tickRate));
            } catch {
                voice.failed = true;
            }
        }
        const ticks = Math.max(1, Math.round(Math.max(0, durationSeconds) * this.tickRate));
        // 采样本身最长约 4.8s（低音变调后）；超长音符在采样自然结束后就没必要继续持有实例。
        const held = Math.min(ticks, Math.max(1, Math.round(this.maxHeldSeconds * this.tickRate)));
        this.voices.push({
            sound,
            midi,
            velocity,
            manual,
            startTick: nowTick,
            releaseTick: nowTick + held,
        });
        // makeRoom 一般已经腾好位置；这里兜底，防止调用方漏掉预留步骤。
        this.enforceCapacity();
    }

    /** 每个游戏 tick 调用一次。 */
    update(nowTick: number) {
        for (let i = this.voices.length - 1; i >= 0; i--) {
            const voice = this.voices[i];
            if (voice.failed) {
                this.voices.splice(i, 1);
                continue;
            }
            if (voice.stopTick !== undefined) {
                if (nowTick < voice.stopTick) continue;
                this.stopVoice(voice, i);
                continue;
            }
            if (nowTick < voice.releaseTick) continue;
            try {
                voice.sound.fade(this.releaseSeconds, 0);
                voice.stopTick = nowTick + Math.max(1, Math.ceil(this.releaseSeconds * this.tickRate)) + 1;
            } catch {
                // 采样已经播完或实例失效：不再重试
                voice.failed = true;
                this.voices.splice(i, 1);
            }
        }
    }

    /** 停止并清空所有实例（停止播放、暂停、销毁时调用）。 */
    stopAll() {
        for (const voice of this.voices) {
            try {
                voice.sound.stop();
            } catch {
                // 忽略已结束的实例
            }
        }
        this.voices = [];
    }

    private pruneFailed() {
        if (this.voices.some(voice => voice.failed)) {
            this.voices = this.voices.filter(voice => !voice.failed);
        }
    }

    /** 超出预算时收掉优先级最低的实例（兜底路径；立即停止以保证计数一定下降）。 */
    private enforceCapacity() {
        this.pruneFailed();
        while (this.voices.length > this.maxVoices) {
            const victim = this.chooseVictim();
            if (!victim) break;
            this.releaseVoice(victim);
        }
    }

    /**
     * 牺牲者优先级（越低越先被收掉）：
     * 1. 已经在淡出的实例（马上就会消失，代价最低）；
     * 2. 谱面音符优先于手动按键；
     * 3. 力度更低（更听不出来）；
     * 4. 更接近 Note Off（本来就要结束了）；
     * 5. 更早开始（保留刚触发的新音更有意义）。
     */
    private chooseVictim(): Voice | undefined {
        let best: Voice | undefined;
        for (const voice of this.voices) {
            if (voice.failed) continue;
            if (!best) {
                best = voice;
                continue;
            }
            if (compareRank(victimRank(voice), victimRank(best)) < 0) best = voice;
        }
        return best;
    }

    /**
     * 收掉一个声部：立即 stop 并从队列移除，保证调用后实例数真的下降。
     * 牺牲者已按“最不重要”排序，因此这里不做额外淡出，避免它在淡出期间继续占名额。
     */
    private releaseVoice(voice: Voice) {
        if (!voice.evicted) {
            voice.evicted = true;
            this.evictedVoices++;
        }
        const index = this.voices.indexOf(voice);
        if (index < 0) return;
        try {
            voice.sound.stop();
        } catch {
            // 实例可能已经自然结束
        }
        this.voices.splice(index, 1);
    }

    private stopVoice(voice: Voice, index: number) {
        try {
            voice.sound.stop();
        } catch {
            // 实例可能已经自然结束
        }
        this.voices.splice(index, 1);
    }
}

function victimRank(voice: Voice): number[] {
    // 逐项比较，先比淡出状态，再比优先级。数组按字典序比较。
    return [
        voice.stopTick === undefined ? 1 : 0,
        voice.manual ? 1 : 0,
        voice.velocity,
        voice.releaseTick,
        voice.startTick,
    ];
}

function compareRank(a: number[], b: number[]): number {
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return a[i] - b[i];
    }
    return 0;
}
