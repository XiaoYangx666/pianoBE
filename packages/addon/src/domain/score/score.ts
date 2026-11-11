import { PIANO_SCORES } from "@data/scorePack";

/** 随资源包一起发布的曲谱。pages 为 DDUI 面板使用的单页纹理，一页一张。 */
export interface PianoScore {
    readonly id: string;
    readonly title: string;
    readonly pages: readonly string[];
    /** 原始页面数（直接导入的曲谱才有） */
    readonly pageCount?: number;
}

/** 当前包里可选择的曲谱；生成器会重写数据模块来裁剪或追加。 */
export const AVAILABLE_SCORES: readonly PianoScore[] = PIANO_SCORES;
export const DEFAULT_SCORE_ID = AVAILABLE_SCORES[0]?.id ?? "";

/** 未知或缺失的曲谱 id 一律回退到第一张，避免旧存档失去谱架。 */
export function scoreIndexOf(id: unknown): number {
    if (typeof id !== "string") return 0;
    const index = AVAILABLE_SCORES.findIndex(score => score.id === id);
    return index < 0 ? 0 : index;
}

export function scoreAt(index: number): PianoScore | undefined {
    return AVAILABLE_SCORES[index];
}

export function isValidScoreId(id: unknown): id is string {
    return typeof id === "string" && AVAILABLE_SCORES.some(score => score.id === id);
}

export function scorePages(id: unknown): readonly string[] {
    return AVAILABLE_SCORES[scoreIndexOf(id)]?.pages ?? [];
}
