import { decodeBase64Url, readPbe3Header } from "@piano/core";
import { HttpRequestMethod } from "../net/httpMethod";
import type { NetFetch } from "./netSource";

/**
 * 后端转录接口的最小客户端（BDS 专用）。
 *
 * 纯网络层，不依赖 @minecraft/server*，便于单测。调用方负责令牌头注入。
 */

export type TranscribeStage =
    | "queued"
    | "downloading"
    | "analyzing"
    | "transcribing"
    | "finalizing"
    | "done"
    | "error";

export interface TranscribeJob {
    id: string;
    stage: TranscribeStage;
    name: string;
    message?: string;
    /** 0-100；-1 表示无法估算 */
    percent: number;
    noteCount: number;
    durationSec?: number;
    midiDuration?: number;
    error?: string;
}

export interface TranscribeSong {
    id: string;
    name: string;
    /** 与 MidiSongMeta.duration 相同的 tick 单位（40 tick = 1 秒） */
    duration: number;
    noteCount: number;
    bytes: number;
    expiresAt: number;
    pbe3: Uint8Array;
}

export interface OnlineTranscribeOptions {
    baseUrl: string;
    fetch: NetFetch;
    /** 附加请求头（Authorization 等 SecretString 原样透传） */
    extraHeaders?: () => Record<string, unknown>;
}

export class OnlineTranscribeError extends Error {}

export class OnlineTranscribeClient {
    constructor(private readonly opts: OnlineTranscribeOptions) {}

    private base(path: string): string {
        return `${this.opts.baseUrl.replace(/\/+$/, "")}${path}`;
    }

    private async request(
        path: string,
        init: {
            method?: HttpRequestMethod;
            headers?: Record<string, string>;
            body?: string;
        } = {}
    ): Promise<unknown> {
        const res = await this.opts.fetch(this.base(path), {
            method: init.method,
            headers: { ...(this.opts.extraHeaders?.() ?? {}), ...(init.headers ?? {}) },
            body: init.body,
        });
        let payload: unknown;
        try {
            payload = await res.json();
        } catch {
            payload = undefined;
        }
        if (res.status < 200 || res.status >= 300) {
            const message =
                payload && typeof payload === "object" && typeof (payload as { error?: unknown }).error === "string"
                    ? (payload as { error: string }).error
                    : `请求失败 (${res.status})`;
            throw new OnlineTranscribeError(message);
        }
        return payload;
    }

    /** 创建 B 站点歌转录任务 */
    async startBilibili(input: string, name?: string): Promise<{ id: string }> {
        const body = await this.request("/api/transcribe/jobs/bilibili", {
            method: HttpRequestMethod.Post,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ input, name }),
        });
        const id = (body as { id?: unknown } | undefined)?.id;
        if (typeof id !== "string" || !id) throw new OnlineTranscribeError("响应缺少任务 ID");
        return { id };
    }

    async getJob(id: string): Promise<TranscribeJob> {
        const body = await this.request(`/api/transcribe/jobs/${encodeURIComponent(id)}`);
        const job = body as Partial<TranscribeJob> | undefined;
        if (!job || typeof job.id !== "string" || typeof job.stage !== "string") {
            throw new OnlineTranscribeError("任务响应格式不正确");
        }
        return job as TranscribeJob;
    }

    /** 拉取转录结果并解码为 PBE3 */
    async getSong(id: string): Promise<TranscribeSong> {
        const body = await this.request(`/api/transcribe/jobs/${encodeURIComponent(id)}/song`);
        const song = body as
            | {
                  id?: unknown;
                  name?: unknown;
                  duration?: unknown;
                  noteCount?: unknown;
                  bytes?: unknown;
                  expiresAt?: unknown;
                  data?: unknown;
              }
            | undefined;
        if (!song || typeof song.data !== "string" || !song.data) {
            throw new OnlineTranscribeError("转录结果缺少曲目数据");
        }
        const pbe3 = decodeBase64Url(song.data);
        const header = readPbe3Header(pbe3);
        return {
            id: typeof song.id === "string" ? song.id : header.id,
            name: typeof song.name === "string" ? song.name : header.name,
            duration: typeof song.duration === "number" ? song.duration : header.duration,
            noteCount: typeof song.noteCount === "number" ? song.noteCount : header.noteCount,
            bytes: typeof song.bytes === "number" ? song.bytes : pbe3.byteLength,
            expiresAt: typeof song.expiresAt === "number" ? song.expiresAt : 0,
            pbe3,
        };
    }

    /** 放弃任务（read 令牌可能无权限，调用方按需忽略错误） */
    cancel(id: string): Promise<unknown> {
        return this.request(`/api/transcribe/jobs/${encodeURIComponent(id)}`, {
            method: HttpRequestMethod.Delete,
        });
    }
}
