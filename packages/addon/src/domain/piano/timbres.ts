import { PIANO_TIMBRES } from "@piano/core";

/**
 * 当前资源包实际启用的音色 id。
 *
 * 零插件基础模板仅保留标准钢琴（`piano`）；装配音色插件或生成器导出时会覆写编译产物
 * `scripts/packages/addon/src/domain/piano/timbres.js`。
 */
export const ENABLED_PIANO_TIMBRES: readonly string[] = [PIANO_TIMBRES[0].id];
