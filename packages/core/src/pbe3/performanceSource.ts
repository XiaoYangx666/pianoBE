import { TIME_SCALE } from "../constants.js";
import {
    PERFORMANCE_MOTIONS,
    PERFORMANCE_ZONES,
    isValidPerformanceParamKey,
    isValidPerformanceSymbol,
    resolvePerformanceColor,
    type PerformanceCue,
    type PerformanceMotion,
    type PerformanceParamValue,
    type PerformanceZone,
} from "./performance.js";

export interface PerformanceSourceBlackoutCue {
    at: number;
    op: "blackout";
    fade?: number;
    except?: readonly string[];
}

export interface PerformanceSourceEffectCue {
    at: number;
    op?: "set" | "flash";
    effect: string;
    slot?: number;
    color?: string;
    color2?: string;
    brush?: string;
    variant?: string;
    zone?: PerformanceZone;
    motion?: PerformanceMotion;
    params?: Record<string, PerformanceParamValue>;
    level?: number;
    scale?: number;
    fade?: number;
}

export type PerformanceSourceCue = PerformanceSourceBlackoutCue | PerformanceSourceEffectCue;

export interface PerformanceSourceSection {
    at: number;
    label?: string;
    note?: string;
    cues?: readonly PerformanceSourceCue[];
}

export interface PerformanceSourceDocument {
    song: string;
    title?: string;
    sections?: readonly PerformanceSourceSection[];
    cues?: readonly PerformanceSourceCue[];
}

export interface CompilePerformanceSourceOptions {
    expectedSongId?: string;
    validateParams?: (effect: string, params: unknown) => Record<string, PerformanceParamValue> | undefined;
}

function toTicks40(seconds: unknown, label = "时间"): number {
    if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) {
        throw new Error(`${label} ${String(seconds)} 无效`);
    }
    const ticks = seconds * TIME_SCALE;
    if (Math.abs(ticks - Math.round(ticks)) > 1e-7) {
        throw new Error(`${label} ${seconds} 必须对齐到 25ms`);
    }
    return Math.round(ticks);
}

function collectRawCues(doc: Record<string, unknown>): PerformanceSourceCue[] {
    const collected: PerformanceSourceCue[] = [];
    if (doc.cues !== undefined) {
        if (!Array.isArray(doc.cues)) throw new Error("演出源文件 cues 必须是数组");
        collected.push(...(doc.cues as PerformanceSourceCue[]));
    }
    if (doc.sections !== undefined) {
        if (!Array.isArray(doc.sections)) throw new Error("演出源文件 sections 必须是数组");
        for (const section of doc.sections) {
            if (!section || typeof section !== "object" || Array.isArray(section)) {
                throw new Error("演出源文件 section 条目无效");
            }
            const sectionRecord = section as Record<string, unknown>;
            if (sectionRecord.cues !== undefined) {
                if (!Array.isArray(sectionRecord.cues)) {
                    throw new Error("演出源文件 section.cues 必须是数组");
                }
                collected.push(...(sectionRecord.cues as PerformanceSourceCue[]));
            }
        }
    }
    if (!collected.length) throw new Error("演出源文件缺少任何演出提示");
    return collected;
}

function validateGenericParams(effect: string, raw: unknown): Record<string, PerformanceParamValue> | undefined {
    if (raw === undefined) return undefined;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error(`无效参数对象 ${effect}`);
    }
    const entries = Object.entries(raw as Record<string, unknown>);
    if (entries.length > 16) {
        throw new Error(`特效 ${effect} 单条提示参数过多`);
    }
    if (!entries.length) return undefined;
    const params: Record<string, PerformanceParamValue> = {};
    for (const [key, value] of entries) {
        if (!isValidPerformanceParamKey(key)) throw new Error(`无效参数名称 ${key}`);
        const valid = typeof value === "boolean"
            || (typeof value === "number" && Number.isFinite(value))
            || (typeof value === "string" && isValidPerformanceSymbol(value));
        if (!valid) throw new Error(`无效参数值 ${key}=${String(value)}`);
        params[key] = value;
    }
    return params;
}

function validateRawEffectCue(
    cue: PerformanceSourceEffectCue,
    tick: number,
    validateParams?: (effect: string, params: unknown) => Record<string, PerformanceParamValue> | undefined,
): PerformanceCue {
    if (!isValidPerformanceSymbol(cue.effect)) {
        throw new Error(`无效特效名称 ${String(cue.effect)}`);
    }
    if (cue.slot !== undefined && (!Number.isInteger(cue.slot) || cue.slot < 0 || cue.slot > 7)) {
        throw new Error(`通道槽位无效 ${String(cue.slot)}`);
    }
    if (cue.brush !== undefined && !isValidPerformanceSymbol(cue.brush)) {
        throw new Error(`无效画笔名称 ${String(cue.brush)}`);
    }
    if (cue.variant !== undefined && !isValidPerformanceSymbol(cue.variant)) {
        throw new Error(`无效变体名称 ${String(cue.variant)}`);
    }
    if (cue.zone !== undefined && !Object.hasOwn(PERFORMANCE_ZONES, cue.zone)) {
        throw new Error(`未知高度区域 ${String(cue.zone)}`);
    }
    if (cue.motion !== undefined && !Object.hasOwn(PERFORMANCE_MOTIONS, cue.motion)) {
        throw new Error(`未知运动修饰 ${String(cue.motion)}`);
    }

    const level = cue.level ?? 80;
    const scale = cue.scale ?? 100;
    if (!Number.isInteger(level) || level < 0 || level > 100) {
        throw new Error(`强度 level 超出范围 ${String(cue.level)}`);
    }
    if (!Number.isInteger(scale) || scale < 50 || scale > 170) {
        throw new Error(`缩放 scale 超出范围 ${String(cue.scale)}`);
    }

    const params = validateParams
        ? validateParams(cue.effect, cue.params)
        : validateGenericParams(cue.effect, cue.params);
    if (params) {
        for (const key of Object.keys(params)) {
            if (!isValidPerformanceParamKey(key)) throw new Error(`无效参数名称 ${key}`);
        }
    }

    const base = {
        tick,
        effect: cue.effect,
        color: resolvePerformanceColor(cue.color ?? "moon"),
        level,
        scale,
    };
    const optional: Partial<PerformanceCue> = {};
    if (cue.slot !== undefined && cue.slot !== 0) optional.slot = cue.slot;
    if (cue.color2 !== undefined) optional.color2 = resolvePerformanceColor(cue.color2);
    if (cue.brush !== undefined && cue.brush !== "default") optional.brush = cue.brush;
    if (cue.variant !== undefined) optional.variant = cue.variant;
    if (cue.zone !== undefined && cue.zone !== "stage") optional.zone = cue.zone;
    if (cue.motion !== undefined && cue.motion !== "normal") optional.motion = cue.motion;
    if (params !== undefined) optional.params = params;

    const op = cue.op ?? (cue.fade !== undefined ? "set" : "flash");
    if (op === "flash") return { ...base, ...optional, op: "flash" };
    if (op !== "set") throw new Error(`未知提示操作 ${String(op)}`);
    return { ...base, ...optional, op: "set", fade: toTicks40(cue.fade ?? 1.5, "淡变时间") };
}

/**
 * 将演出源 JSON（支持顶层 `cues` 与/或 `sections[].cues`、无序 `at` 自动稳定排序，
 * 以及 `op: "blackout"` 一键清场宏）编译为规范化的 `PerformanceCue[]`。
 */
export function compilePerformanceSource(
    source: unknown,
    options: CompilePerformanceSourceOptions = {},
): PerformanceCue[] {
    if (!source || typeof source !== "object" || Array.isArray(source)) {
        throw new Error("无效的演出源文件对象");
    }
    const doc = source as Record<string, unknown>;
    if (options.expectedSongId !== undefined && doc.song !== options.expectedSongId) {
        throw new Error(`演出源文件 song=${String(doc.song)} 与目标曲目 ${options.expectedSongId} 不匹配`);
    }
    if (typeof doc.song !== "string" || !doc.song.trim()) {
        throw new Error("演出源文件缺少 song 标识");
    }

    const tagged = collectRawCues(doc).map((cue) => {
        if (!cue || typeof cue !== "object" || Array.isArray(cue)) {
            throw new Error("演出提示条目必须是对象");
        }
        return { cue, tick: toTicks40((cue as { at?: unknown }).at) };
    });
    tagged.sort((a, b) => a.tick - b.tick);

    const compiled: PerformanceCue[] = [];
    const activeChannels = new Map<string, PerformanceCue & { op: "set" }>();

    for (const { cue, tick } of tagged) {
        if (cue.op === "blackout") {
            const fade = toTicks40(cue.fade ?? 1.5, "blackout 淡变时间");
            const exceptList = cue.except ?? [];
            if (!Array.isArray(exceptList)) throw new Error("blackout.except 必须是数组");
            const except = new Set<string>();
            for (const name of exceptList) {
                if (!isValidPerformanceSymbol(name)) throw new Error(`blackout.except 包含无效特效名 ${String(name)}`);
                except.add(name);
            }
            for (const [key, lastCue] of [...activeChannels.entries()]) {
                if (except.has(lastCue.effect)) continue;
                const offCue: PerformanceCue & { op: "set" } = {
                    tick,
                    effect: lastCue.effect,
                    color: lastCue.color,
                    level: 0,
                    scale: lastCue.scale,
                    op: "set",
                    fade,
                };
                if (lastCue.slot !== undefined) offCue.slot = lastCue.slot;
                if (lastCue.color2 !== undefined) offCue.color2 = lastCue.color2;
                if (lastCue.brush !== undefined) offCue.brush = lastCue.brush;
                if (lastCue.variant !== undefined) offCue.variant = lastCue.variant;
                if (lastCue.zone !== undefined) offCue.zone = lastCue.zone;
                if (lastCue.motion !== undefined) offCue.motion = lastCue.motion;
                compiled.push(offCue);
                activeChannels.delete(key);
            }
            continue;
        }

        const out = validateRawEffectCue(cue, tick, options.validateParams);
        compiled.push(out);
        if (out.op === "set") {
            const key = `${out.effect}:${out.slot ?? 0}`;
            if (out.level > 0) activeChannels.set(key, out);
            else activeChannels.delete(key);
        }
    }

    if (!compiled.length) {
        throw new Error("编译后的演出提示不能为空");
    }
    return compiled;
}
