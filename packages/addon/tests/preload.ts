// 构建期由 bepack 的 compile.define 替换这些标识符；bun test 直接跑源码时
// 需要提供同名全局值，否则加载 scorePack.ts 会抛 ReferenceError。
(globalThis as Record<string, unknown>).__PIANO_SCORE_RESOURCE_PACK__ =
    "00000000-0000-0000-0000-000000000000";
(globalThis as Record<string, unknown>).__PIANO_TARGET__ = "client";
