# VFX 创作与扩展指南

重构后的 VFX 系统在新增特效、画笔、舞台主题或曲目演出时，无需修改通用播放器 `VfxEngine` 或 `@piano/core` PBE3 编解码器。

## 1. 新增内置特效

1. 在 `packages/vfx/src/effects/` 对应分类模块（`atmosphere.ts`、`curves.ts`、`stage.ts`、`keys.ts` 或 `accents.ts`）添加定义：
   - 填写 `id`、`label`、`category`、`trigger`（`continuous` / `note` / `instant` / `control`）、`interval`、`priority`。
   - 需要跨帧平滑衔接（如前一帧长度/高度）或切换状态时声明 `createState: () => ({ ... })`，避免在播放器中维护全局字段。
   - 如需动态调整间隔或与其他特效互相让步，可选声明 `nextInterval`、`tags` 与 `yields: { tag, ticks }`。
   - 在 `emit(context)` 中调用 `primitives.ts` 提供的 `drawPoints`、`drawStrokeSegments`、`drawGroundRing` 等原语返回 `{ priority, emitters }`。
2. 所有已并入 `effects/index.ts` 的特效会自动出现在 Web VFX Lab「单特效」、主题图层选择器以及 `.pbe3` 符号表调度中；无需修改 `@piano/core` 或任何开关表。
3. 运行 `npm run test:vfx`，`packages/vfx/tests/vfxRegistry.test.ts` 与 `vfxPerformance.test.ts` 会自动验证新特效的变量完备性、有限性与生命周期上限。

## 2. 新增画笔或粒子贴图资源

1. 在唯一数据源 `packages/vfx/src/data/vfxAtlas.json` 中追加 `pointBrushes`（8×2 网格内最多 16 项）或 `strokeBrushes` 条目，或扩展 `tiles`。
2. 在 `tools/assets/vfx/atlas.mjs` 实现对应像素与 MER 发光层绘制函数。
3. 执行资源生成并校验：
   ```sh
   npm run assets:vfx
   node tools/assets/build-vfx-lab.mjs --check
   ```
   `brushes.ts`、`pbe_vfx_draw_point.particle.json`（二维图集网格坐标）以及 Web VFX Lab 下拉菜单都会自动读取新画笔，无需手动同步多个索引常量。

## 3. 新增普通弹奏粒子样式

普通弹奏粒子与舞台粒子共用同一张 `vfx_lab` 图集。新增样式只需要在 `packages/vfx/src/keyParticles.ts` 的 `KEY_PARTICLE_STYLES` 添加一条，并在同一个定义里声明渲染方式与配色能力：

```ts
my_style: {
    label: "我的键上粒子",
    value: 8,              // 出现在钢琴设置中；不写则仅作为 key_style 变体
    render: "point",       // point = draw_point；stream = key_stream；drift = key_drift
    brush: "star",         // vfxAtlas 点画笔
    alpha: 0.9,
    color: { mode: "free" }, // free / limited / fixed；fixed 使用 colors
    draw: { count: 3, life: 0.6, size: 0.05, aspect: 1, velocity: [0, 1.2, 0], twinkle: 0.5 },
},
```

- `render: "point"` 使用共享 `pbe:vfx_draw_point`；`aspect` 可做非等比尺寸，`colorRandom` 可让每个粒子在双色间随机。
- `render: "stream"` 使用加法混合、竖向拉伸和 `rotate_y` Billboard 的 `pbe:vfx_key_stream`（魔法流光）。
- `render: "drift"` 使用普通透明混合、`lookat_xyz` Billboard 与自然飘落运动的 `pbe:vfx_key_drift`（樱吹雪、雪晶）。
- 配色策略集中在样式定义里：`free` 使用四套全局预设；`limited` 自带专属调色板；`fixed` 由样式提供自然色，玩家设置直接隐藏配色项。演出编排中的显式 `colors` 仍是创作者覆盖，对任何样式都优先生效。

标签、设置下拉、`key_style` 变体、颜色选项和变量校验都会自动派生，不需要再改粒子文档或 UI 样式名判断。运行 `npm run test:vfx` 会按实际 `render` 对应的粒子文档验证变量。

## 4. 新增或编辑舞台主题

1. 在 `packages/vfx/src/themes.ts` 中的 `VFX_THEME_ORDER` 与 `VFX_THEMES` 添加条目（或在 Web VFX Lab 的「主题编排」面板实时调整并点击「导出 JSON」）。
2. 每个图层按需配置：`effect`、`slot`（同特效多轨槽位）、`color`、`color2`、`brush`、`variant`、`zone`、`motion`、`level`（固定数值或 `{ input, from, to }` 音乐特征映射）、`scale` 与瞬时特效门限 `gate`。
3. 需同步到游戏内菜单选项时，在 `packages/addon/src/domain/piano/settings.ts` 登记主题 ID 与显示标题。
4. 运行 `npm run test:vfx` 确认 4 架钢琴错峰演奏 0 丢弃、单架峰值 ≤ 275 粒子。

## 5. 为新曲目创作独立演出编排

制作定制曲目演出不需要新增专用播放器、修改运行时或改动 Core：

1. 在 `midis/performances/<songId>.json` 编写提示序列（`op`: `"set"` 或 `"flash"`，`effect`: 任意已注册特效名，可选 `slot`、`brush`、`variant`、`zone`、`motion`、`fade`）：
   ```json
   {
     "at": 12.5,
     "op": "set",
     "effect": "key_style",
     "variant": "snow",
     "color": "ice",
     "color2": "silver",
     "level": 85,
     "scale": 100,
     "fade": 1.2
   }
   ```
2. 执行导出命令将其打包进 `midis/library/<songId>.pbe3`（带曲目内部符号表与颜色表）：
   ```sh
   npm run export:performance
   ```
3. 直接打开 `/vfx-lab` 导入 `.pbe3` 文件即可 1:1 实时试看。

## 6. 发布前回归检查项

- [ ] `node tools/assets/build-vfx-lab.mjs --check` 通过
- [ ] `npm run build:core && npm run build:vfx && npm run test` 通过
- [ ] `npm run test:vfx && npm run test -w @piano/addon` 全部通过（含 33 种特效、7 套主题、3 首演出曲目与生命周期边界测试）
- [ ] `npx tsc --noEmit -p packages/addon/tsconfig.json && npx tsc --noEmit -p packages/web/tsconfig.json` 无错误
- [ ] `npm run build:web && npm run verify:addon-build` 成功
