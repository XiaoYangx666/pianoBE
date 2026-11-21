import { existsSync, readFileSync } from "node:fs";
import {
    PERFORMANCE_MOTIONS,
    PERFORMANCE_ZONES,
    TIME_SCALE,
    isValidPerformanceParamKey,
    isValidPerformanceSymbol,
    resolvePerformanceColor,
} from "@piano/core";

export function readPerformance(songId) {
    const path = new URL(`../../midis/performances/${songId}.json`, import.meta.url);
    if (!existsSync(path)) return;
    const source = JSON.parse(readFileSync(path, "utf8"));
    if (source.song !== songId || !Array.isArray(source.cues) || !source.cues.length) {
        throw new Error(`无效的演出源文件 ${path.pathname}`);
    }

    const ticks = (seconds) => {
        if (!Number.isFinite(seconds) || Math.abs(seconds * TIME_SCALE - Math.round(seconds * TIME_SCALE)) > 1e-7) {
            throw new Error(`时间 ${seconds} 必须对齐到 25ms`);
        }
        return Math.round(seconds * TIME_SCALE);
    };

    return source.cues.map((cue) => {
        if (!isValidPerformanceSymbol(cue.effect)) {
            throw new Error(`无效特效名称 ${cue.effect}`);
        }
        if (cue.slot !== undefined && (!Number.isInteger(cue.slot) || cue.slot < 0 || cue.slot > 7)) {
            throw new Error(`通道槽位无效 ${cue.slot}`);
        }
        if (cue.brush !== undefined && !isValidPerformanceSymbol(cue.brush)) {
            throw new Error(`无效画笔名称 ${cue.brush}`);
        }
        if (cue.variant !== undefined && !isValidPerformanceSymbol(cue.variant)) {
            throw new Error(`无效变体名称 ${cue.variant}`);
        }
        if (cue.zone !== undefined && !Object.hasOwn(PERFORMANCE_ZONES, cue.zone)) {
            throw new Error(`未知高度区域 ${cue.zone}`);
        }
        if (cue.motion !== undefined && !Object.hasOwn(PERFORMANCE_MOTIONS, cue.motion)) {
            throw new Error(`未知运动修饰 ${cue.motion}`);
        }

        let params;
        if (cue.params !== undefined) {
            if (!cue.params || typeof cue.params !== "object" || Array.isArray(cue.params)) {
                throw new Error(`无效参数对象 ${cue.effect}`);
            }
            const entries = Object.entries(cue.params);
            if (entries.length > 16) {
                throw new Error(`特效 ${cue.effect} 单条提示参数过多`);
            }
            if (entries.length > 0) {
                params = {};
                for (const [key, value] of entries) {
                    if (!isValidPerformanceParamKey(key)) {
                        throw new Error(`无效参数名称 ${key}`);
                    }
                    const validValue = typeof value === "boolean"
                        || (typeof value === "number" && Number.isFinite(value))
                        || (typeof value === "string" && isValidPerformanceSymbol(value));
                    if (!validValue) {
                        throw new Error(`无效参数值 ${key}=${String(value)}`);
                    }
                    params[key] = value;
                }
            }
        }

        const out = {
            tick: ticks(cue.at),
            effect: cue.effect,
            color: resolvePerformanceColor(cue.color ?? "moon"),
            level: cue.level ?? 80,
            scale: cue.scale ?? 100,
        };
        if (cue.slot !== undefined && cue.slot !== 0) out.slot = cue.slot;
        if (cue.color2 !== undefined) out.color2 = resolvePerformanceColor(cue.color2);
        if (cue.brush !== undefined && cue.brush !== "default") out.brush = cue.brush;
        if (cue.variant !== undefined) out.variant = cue.variant;
        if (cue.zone !== undefined && cue.zone !== "stage") out.zone = cue.zone;
        if (cue.motion !== undefined && cue.motion !== "normal") out.motion = cue.motion;
        if (params !== undefined) out.params = params;

        const op = cue.op ?? (cue.fade !== undefined ? "set" : "flash");
        if (op === "flash") {
            return { ...out, op: "flash" };
        }
        if (op !== "set") throw new Error(`未知提示操作 ${op}`);
        return { ...out, op: "set", fade: ticks(cue.fade ?? 1.5) };
    });
}
