import type { PerformanceCue } from "../pbe3/performance.js";

/** 内容来源类型 */
export type ContentOriginKind = "official" | "plugin" | "user" | "embedded" | "server" | "card";

/** 内容来源描述 */
export interface ContentOrigin {
    kind: ContentOriginKind;
    /** 来源标识（如插件 ID、曲库 ID、服务器名等） */
    id?: string;
    /** 可读来源名称 */
    name?: string;
}

/** 演出编排元信息与可选提示数据（拥有独立稳定 ID） */
export interface PerformanceDescriptor {
    /** 稳定演出标识（例如 "embedded:f3b8fb2"、"pianobe.chinese:rain_green"、"plain"） */
    id: string;
    /** 演出名称（如 "雨过见青"、"罪人的终幕"） */
    name: string;
    author?: string;
    description?: string;
    /** 目标歌曲 ID */
    songId?: string;
    /** 目标音乐本体指纹 */
    musicFingerprint?: string;
    /** 编排提示数据（元信息列表场景可省略，按需加载） */
    cues?: readonly PerformanceCue[];
    /** 所需特效 ID 列表 */
    requiredEffects?: readonly string[];
    /** 声明依赖的插件 ID 列表 */
    requiredPlugins?: readonly string[];
    /** 演出来源 */
    origin?: ContentOrigin;
    /** 部署/运行时状态 */
    status?: ResourceDeployStatus;
}

/** 曲库逻辑集合 */
export interface LibraryRecord {
    id: string;
    name: string;
    description?: string;
    author?: string;
    kind: "official" | "plugin" | "user" | "server";
    pluginId?: string;
    songIds: readonly string[];
    readonly?: boolean;
    createdAt?: number;
    updatedAt?: number;
}

/** 歌曲或演出合并冲突 */
export interface SongConflict {
    kind: "id_content_mismatch" | "performance_id_conflict";
    songId: string;
    performanceId?: string;
    existingName?: string;
    incomingName?: string;
    message: string;
}

/** 服务端/运行时统一四态 */
export type ResourceDeployStatus = "active" | "pending_deploy" | "pending_restart" | "unavailable";

export const PLAIN_PERFORMANCE_ID = "plain";
export const DEFAULT_PERFORMANCE_ID = "default";

export function defaultPerformanceId(songId: string): string {
    return `embedded:${songId}`;
}

export function extractCueEffects(cues: readonly PerformanceCue[]): string[] {
    return [...new Set(cues.map((cue) => cue.effect))].sort();
}
