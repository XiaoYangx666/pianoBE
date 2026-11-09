import { PIANO_TIMBRES } from "@piano/core";

/**
 * 当前资源包实际启用的音色 id。
 *
 * 开发构建默认包含全部音色；生成器导出时会覆写编译产物
 * `scripts/packages/addon/src/domain/piano/timbres.js`，只保留用户勾选的音色（经典 P-88 始终保留）。
 */
export const ENABLED_PIANO_TIMBRES: readonly string[] = PIANO_TIMBRES.map(
    (timbre) => timbre.id
);
