import { compilePerformanceSource, extractCueEffects, type PerformanceCue } from "@piano/core";
import type { UserPerformanceRecord } from "./types";

export function parsePerformanceJsonText(
    text: string,
    songId: string,
    fallbackName: string,
    musicFingerprint?: string,
): Omit<UserPerformanceRecord, "createdAt"> {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("演出文件必须是 JSON 对象");
    }
    const firstCue = Array.isArray(parsed.cues)
        ? (parsed.cues[0] as Record<string, unknown> | undefined)
        : undefined;
    const cues: PerformanceCue[] =
        Array.isArray(parsed.cues) && parsed.cues.length > 0 && typeof firstCue?.tick === "number"
            ? (parsed.cues as PerformanceCue[])
            : compilePerformanceSource({ ...parsed, song: songId }, { expectedSongId: songId });
    if (cues.length === 0) throw new Error("演出文件不包含有效 cues");
    const name =
        (typeof parsed.name === "string" && parsed.name.trim()) ||
        (typeof parsed.title === "string" && parsed.title.trim()) ||
        fallbackName;
    const id =
        typeof parsed.id === "string" && parsed.id.trim()
            ? parsed.id.trim()
            : `user:${songId}:${Date.now().toString(36)}`;
    return {
        id,
        songId,
        musicFingerprint,
        name,
        ...(typeof parsed.author === "string" && parsed.author.trim() ? { author: parsed.author.trim() } : {}),
        ...(typeof parsed.description === "string" && parsed.description.trim()
            ? { description: parsed.description.trim() }
            : {}),
        cues,
        requiredEffects: extractCueEffects(cues),
    };
}
