import { readFileSync, existsSync } from "node:fs";
import { PERFORMANCE_LAYERS, TIME_SCALE } from "@piano/core";

export function readPerformance(songId) {
    const path = new URL(`../../midis/performances/${songId}.json`, import.meta.url);
    if (!existsSync(path)) return;
    const source = JSON.parse(readFileSync(path, "utf8"));
    if (source.song !== songId || !Array.isArray(source.cues) || !source.cues.length) {
        throw new Error(`无效的演出源文件 ${path.pathname}`);
    }
    const ticks = seconds => {
        if (!Number.isFinite(seconds) || Math.abs(seconds * TIME_SCALE - Math.round(seconds * TIME_SCALE)) > 1e-7) {
            throw new Error(`时间 ${seconds} 必须对齐到 25ms`);
        }
        return Math.round(seconds * TIME_SCALE);
    };
    return source.cues.map(cue => {
        if (!Object.hasOwn(PERFORMANCE_LAYERS, cue.layer)) throw new Error(`未知图层 ${cue.layer}`);
        const base = { tick: ticks(cue.at), layer: PERFORMANCE_LAYERS[cue.layer], level: cue.level, scale: cue.scale };
        if (cue.op === "flash") return { ...base, op: "flash" };
        if (cue.op !== undefined && cue.op !== "set") throw new Error(`未知提示操作 ${cue.op}`);
        return { ...base, op: "set", fade: ticks(cue.fade) };
    });
}
