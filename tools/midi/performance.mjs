import { existsSync, readFileSync } from "node:fs";
import { compilePerformanceSource } from "@piano/core";

export function readPerformance(songId) {
    const path = new URL(`../../midis/performances/${songId}.json`, import.meta.url);
    if (!existsSync(path)) return;
    const source = JSON.parse(readFileSync(path, "utf8"));
    return compilePerformanceSource(source, { expectedSongId: songId });
}
