import { readFileSync, existsSync } from "node:fs";
import {
    isInstantPerformanceMethod,
    PERFORMANCE_BRUSHES,
    PERFORMANCE_METHODS,
    PERFORMANCE_MOTIONS,
    PERFORMANCE_ZONES,
    resolvePerformanceColor,
    TIME_SCALE,
} from "@piano/core";

const KEY_STYLE_ALIASES = {
    magic_trail: { brush: "spark" },
    blue_tears: { brush: "mote" },
    neon_note: { brush: "note" },
    pulse_ring: { brush: "ring" },
    sakura_drift: { brush: "petal" },
    stardust: { brush: "star" },
    prism_shards: { brush: "shard" },
    snow: { brush: "snow" },
    inherit: { brush: "default" },
    glimmer: { motion: "gentle" },
    none: { motion: "reverse" },
    off: { motion: "reverse" },
};

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
        if (!Object.hasOwn(PERFORMANCE_METHODS, cue.method)) {
            throw new Error(`未知绘制方法 ${cue.method}`);
        }
        if (cue.slot !== undefined && (!Number.isInteger(cue.slot) || cue.slot < 0 || cue.slot > 7)) {
            throw new Error(`通道槽位无效 ${cue.slot}`);
        }
        let aliasBrush;
        let aliasMotion;
        if (cue.style !== undefined) {
            if (cue.method !== "key_style") {
                throw new Error(`style 字段仅适用于 key_style 方法：${cue.method}`);
            }
            const normalized = String(cue.style).trim().toLowerCase();
            if (!Object.hasOwn(KEY_STYLE_ALIASES, normalized)) {
                throw new Error(`未知弹奏粒子样式 ${cue.style}`);
            }
            ({ brush: aliasBrush, motion: aliasMotion } = KEY_STYLE_ALIASES[normalized]);
        }
        const brush = cue.brush ?? aliasBrush;
        const motion = cue.motion ?? aliasMotion;
        if (brush !== undefined && !Object.hasOwn(PERFORMANCE_BRUSHES, brush)) {
            throw new Error(`未知笔刷 ${brush}`);
        }
        if (cue.zone !== undefined && !Object.hasOwn(PERFORMANCE_ZONES, cue.zone)) {
            throw new Error(`未知高度区域 ${cue.zone}`);
        }
        if (motion !== undefined && !Object.hasOwn(PERFORMANCE_MOTIONS, motion)) {
            throw new Error(`未知运动修饰 ${motion}`);
        }
        const instant = isInstantPerformanceMethod(cue.method);
        const out = {
            tick: ticks(cue.at),
            method: cue.method,
            color: resolvePerformanceColor(cue.color ?? "moon"),
            level: cue.level ?? 80,
            scale: cue.scale ?? 100,
        };
        if (cue.slot !== undefined && cue.slot !== 0) out.slot = cue.slot;
        if (cue.color2 !== undefined) out.color2 = resolvePerformanceColor(cue.color2);
        if (brush !== undefined && brush !== "default") out.brush = brush;
        if (cue.zone !== undefined && cue.zone !== "stage") out.zone = cue.zone;
        if (motion !== undefined && motion !== "normal") out.motion = motion;
        if (cue.op === "flash" || (cue.op === undefined && instant)) {
            return { ...out, op: "flash" };
        }
        if (cue.op !== undefined && cue.op !== "set") throw new Error(`未知提示操作 ${cue.op}`);
        return { ...out, op: "set", fade: ticks(cue.fade ?? 1.5) };
    });
}
