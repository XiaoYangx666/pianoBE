/**
 * 声音实例释放队列：在 Note Off 后按固定时长淡出，再停止实例。
 *
 * 不依赖 @minecraft/server，便于在单元测试里用假实例验证。
 */
export interface ReleasableSound {
    fade(durationSeconds: number, targetVolume: number): void;
    stop(): void;
}

/** 同键重触发时旧实例的快速淡出时长。 */
const SAME_NOTE_RELEASE_SECONDS = 0.04;

interface Voice {
    sound: ReleasableSound;
    midi: number;
    releaseTick: number;
    stopTick?: number;
    failed?: boolean;
}

export class SoundReleaseQueue {
    private voices: Voice[] = [];

    constructor(
        private readonly releaseSeconds = 0.6,
        private readonly tickRate = 20,
        /** 同时持有的实例上限；全库实测峰值 41，64 留出余量。 */
        private readonly maxVoices = 64,
        /** 单个实例最多保留多久；用于超长音符在采样自然结束后释放句柄。 */
        private readonly maxHeldSeconds = 8
    ) {}

    get size() {
        return this.voices.length;
    }

    /**
     * 登记一个刚开始播放的声音。
     * @param durationSeconds MIDI 音符时值；手动按键可传一个较短的固定时值。
     */
    add(sound: ReleasableSound, midi: number, durationSeconds: number, nowTick: number) {
        // 同键重触发：旧实例先快速收掉，避免两个同音叠加。
        for (const voice of this.voices) {
            if (voice.midi !== midi || voice.stopTick !== undefined) continue;
            try {
                voice.sound.fade(SAME_NOTE_RELEASE_SECONDS, 0);
                voice.stopTick = nowTick + 2;
            } catch {
                voice.failed = true;
            }
        }
        const ticks = Math.max(1, Math.round(Math.max(0, durationSeconds) * this.tickRate));
        // 采样本身最长约 4.8s（低音变调后）；超长音符在采样自然结束后就没必要继续持有实例。
        const held = Math.min(ticks, Math.max(1, Math.round(this.maxHeldSeconds * this.tickRate)));
        this.voices.push({ sound, midi, releaseTick: nowTick + held });
        // 极密段落里限制同时保留的实例，超出时丢掉最早的一个，避免无限增长。
        while (this.voices.length > this.maxVoices) {
            const oldest = this.voices.shift();
            try {
                oldest?.sound.stop();
            } catch {
                // 已自然结束
            }
        }
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
                try {
                    voice.sound.stop();
                } catch {
                    // 实例可能已经自然结束
                }
                this.voices.splice(i, 1);
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
}
