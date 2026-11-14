import type { Dimension, Vector3 } from "@minecraft/server";
import type { Cardinal_Direction } from "@domain/types";
import type { InstrumentDefinition } from "@domain/instrument/definition";

/**
 * 一架乐器在世界中的定位信息。
 *
 * 独立成模块是为了避免 `assembly` 与 `display`/`pianoItem` 之间因类型引用形成环。
 */
export interface InstrumentLocation {
    dimension: Dimension;
    pos: Vector3;
    direction: Cardinal_Direction;
    definition?: InstrumentDefinition;
}
