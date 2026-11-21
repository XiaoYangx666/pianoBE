# VFX 架构与模块职责

## 1. 总体依赖方向

```text
@piano/core (PBE3 编解码与演出提示通用格式，无具体特效耦合)
        ▲
        │
@piano/vfx (跨平台视觉领域：基岩版与 Web 完全共享)
   ├── src/data/vfxAtlas.json (图集、画笔与贴片唯一数据源)
   ├── src/instrument.ts (琴型、琴键坐标、弹奏粒子锚点、舞台框架)
   ├── src/data/keys.generated.ts (由模型数据生成的琴键坐标)
   ├── src/brushes.ts / color.ts / music.ts / budget.ts / stage.ts / geometry.ts
   ├── src/keyParticles.ts (弹奏粒子覆盖解析，显式 variant 语义)
   ├── src/primitives.ts (底层绘图原语：点/线/面/云/彗星/光束/光幕等)
   ├── src/effects/*.ts (33 种内置特效：atmosphere / curves / stage / keys / accents)
   ├── src/themes.ts (7 套内置主题 + JSON 校验)
   ├── src/programs.ts (曲目演出 / 主题 / 单特效 → 统一 VfxProgram 适配器)
   ├── src/engine.ts (唯一运行时执行引擎 VfxEngine)
   └── assets/ (Bedrock 粒子文档 + 图集/MER；弹奏粒子复用同一图集)
        ▲                                 ▲
        │                                 │
packages/addon (Bedrock 平台使用者)   packages/web (Three.js + Wintersky 预览)
```

`@piano/vfx` 不依赖 `packages/addon` 或 `packages/web`，两者只通过包入口与资源路径使用它。

## 2. 分层职责

| 层级 | 目录/文件 | 职责 |
| --- | --- | --- |
| 通用格式层 | `packages/core/src/pbe3/performance.ts` | 使用曲目内部符号表与颜色表读写演出提示；不依赖任何具体特效表或画笔编号 |
| 单一数据源 | `packages/vfx/src/data/vfxAtlas.json` | 声明图集尺寸、8×2 点画笔网格、条带线条笔刷、贴片区域与默认亲和关系 |
| 资产生成器 | `tools/assets/build-vfx-lab.mjs`, `tools/assets/vfx/*` | 从 `vfxAtlas.json` 生成图集、MER 与 17 个 `pbe_vfx_*` 粒子文档；同时从模型数据同步 `keys.generated.ts` |
| 资源同步 | `tools/assets/sync-vfx-assets.mjs` | 把 `packages/vfx/assets` 下的粒子与纹理同步进 Addon 资源包（生成物不重复提交） |
| VFX 领域层 | `packages/vfx/src/` | 特效注册、绘制原语、主题组合、音乐特征提取、琴型/琴键/舞台锚点、粒子预算（275/架，6 发射/刻）与统一 `VfxEngine` |
| Bedrock 适配 | `packages/addon/src/app/vfx/` & `platform/vfxParticle.ts` | 会话调度、订阅 `PianoRuntime.noteSignal`/`transportSignal`、`spawnParticle` 投放与开发调试命令 |
| Web 预览层 | `packages/web/src/vfxLab/` | 仅负责 Three.js 场景与 Wintersky MoLang 渲染；运行完全相同的 `VfxEngine` / `VfxBudget` / `VfxMusic` |

## 3. 数据与资源归属

- **琴型与舞台布局**：`@piano/vfx` 以 `"upright" | "grand"` 表示琴型，`vfxStageFrame()` 提供舞台中心与深度，`keyOriginFor()` / `keyParticleOrigin()` 提供共享琴键坐标。Addon 的装配定义只负责游戏实体，用 `vfxInstrumentFor(definition)` 映射到 VFX 琴型。
- **模型数据的单一来源**：原始琴键命中盒仍由 `tools/model/*.py` 生成到 Addon；`build-vfx-lab.mjs` 从中派生 `packages/vfx/src/data/keys.generated.ts`，避免运行时跨包读取 Addon。
- **粒子资源**：粒子 JSON、`vfx_lab` 图集与 MER 都生成到 `packages/vfx/assets`。普通弹奏粒子与舞台粒子共用同一张图集；点状样式使用 `pbe:vfx_draw_point`，魔法流光与花瓣/雪晶分别使用专用 `pbe:vfx_key_stream` / `pbe:vfx_key_drift`，不再有独立纹理。Web 直接从这里加载；Addon 构建前通过 `sync:assets` 复制进 `packages/addon/rp`，因此同一份资源不会在仓库里提交两次。
- **演出提示**：`.pbe3` 只保存符号与颜色，特效清单、画笔和变体语义全部属于 `@piano/vfx`。

## 4. 核心设计边界

1. **控制来源 vs 执行机制分离**：`VfxEngine` 不关心参数来自 `.pbe3` 曲目关键帧、动态主题配方还是单特效调试面板，所有控制源统一编译为 `VfxProgram`。
2. **显式触发语义与标签协作**：特效触发由 `trigger`（`continuous` | `note` | `instant` | `control`）决定，而非依赖分类名 `category`；持续跨帧状态由特效定义自带 `createState()` 维护并随 `reset()` / `seek()` 自动清理；特效间让步由通用 `tags` 与 `yields` 声明，不在引擎中特判具体特效名称。
3. **语义正交**：`effect` 决定视觉行为，`brush` 仅决定粒子/笔画贴图材质，`variant` 由具体特效解释（包含 `key_style` 的显式弹奏粒子样式，如 `stardust`、`snow`、`glimmer`、`none`）。
4. **生命周期闭环**：暂停、跳转、切歌、拆琴、卸载或异常时统一调用 `stopSession` / `budget.clearPending()` / `music.clear()`；`VfxBudget` 仅退还尚未发往客户端的待发批次，已发出的粒子继续保留预算直到客户端寿命自然过期。
