import { reportDiagnostic, utf8ByteLength } from "@piano/core";
import type { Entity } from "@minecraft/server";
import { readPlaybackRecord, serializePlaybackRecord, type PlaybackRecord } from "@domain/playback/playbackRecord";

const PLAYBACK = "pbe:playback";
const LEGACY_PLAYBACK_KEY = /^pbe:playback_v1(?::[01]:\d+)?$/;
export const PLAYBACK_BUDGET_BYTES = 24 * 1024;
const WRITE_RETRY_TICKS = 600;

type Failure = "budget" | "invalid" | "write";

export class PlaybackStore {
    private saved?: string;
    private rejected?: string;
    private failure?: Failure;
    private retryAt = 0;

    constructor(private readonly entity: Entity, candidates: readonly Entity[]) {
        for (const key of entity.getDynamicPropertyIds()) {
            if (LEGACY_PLAYBACK_KEY.test(key)) entity.setDynamicProperty(key, undefined);
        }
        const raw = entity.getDynamicProperty(PLAYBACK);
        if (typeof raw === "string" && utf8ByteLength(raw) <= PLAYBACK_BUDGET_BYTES && readPlaybackRecord(raw)) {
            this.saved = raw;
            return;
        }
        if (raw !== undefined) {
            reportDiagnostic("warn", "playback", "已忽略无效播放快照", undefined, { entity: entity.id });
        }
        for (const candidate of candidates) {
            if (candidate.id === entity.id) continue;
            const raw = candidate.getDynamicProperty(PLAYBACK);
            if (typeof raw !== "string" || utf8ByteLength(raw) > PLAYBACK_BUDGET_BYTES || !readPlaybackRecord(raw)) continue;
            entity.setDynamicProperty(PLAYBACK, raw);
            this.saved = raw;
            break;
        }
    }

    get record() { return readPlaybackRecord(this.saved); }

    checkpoint(record: PlaybackRecord, tick: number) {
        if (!this.entity.isValid) return;
        if (tick < this.retryAt) return;
        const raw = serializePlaybackRecord(record);
        if (raw === undefined) {
            this.warn("invalid", "播放快照无效，保留上次存档", record);
            return;
        }
        if (raw === this.saved) {
            this.rejected = undefined;
            this.failure = undefined;
            this.retryAt = 0;
            return;
        }
        if (raw === this.rejected) return;
        const bytes = utf8ByteLength(raw);
        if (bytes > PLAYBACK_BUDGET_BYTES) {
            this.rejected = raw;
            this.warn("budget", "播放快照超出容量，保留上次存档", record, bytes);
            return;
        }
        try {
            this.entity.setDynamicProperty(PLAYBACK, raw);
            this.saved = raw;
            this.rejected = undefined;
            this.failure = undefined;
        } catch (error) {
            this.retryAt = tick + WRITE_RETRY_TICKS;
            this.warn("write", "保存播放状态失败，将延后重试", record, bytes, error);
        }
    }

    private warn(failure: Failure, message: string, record: PlaybackRecord, bytes?: number, error?: unknown) {
        if (this.failure === failure) return;
        this.failure = failure;
        reportDiagnostic("warn", "playback", message, error, {
            entity: this.entity.id, tracks: record.songs.length, bytes, budget: PLAYBACK_BUDGET_BYTES,
        });
    }
}
