# VFX 创作与扩展指南

面向要新增舞台视觉、粒子素材或演出主题的开发者。目标：把"想一个新效果"变成一次小改动，并且不破坏已发布的提示格式。

相关文件一览：

| 文件 | 作用 |
| --- | --- |
| `packages/core/src/pbe3/performance.ts` | 方法 ID 注册表、笔刷/高度/运动枚举、编解码 |
| `packages/addon/src/domain/piano/vfxPainters.ts` | 25 种画笔实现、舞台主题组合 |
| `packages/addon/src/domain/piano/vfxDraw.ts` | 几何与发射器组合器（采样曲线、笔画、点阵、地面环） |
| `packages/addon/src/domain/piano/vfxLab.ts` | 旧版效果发射器（`effectEmitters`） |
| `packages/addon/src/domain/piano/vfxPreset.ts` | Web Lab 预设 |
| `tools/assets/build-vfx-lab.mjs` | 粒子贴图图集、MER、全部 `pbe:vfx_*` 粒子文档生成 |
| `packages/web/src/vfxLab/` | 网页预览器 |
| `midis/performances/<id>.json` | 单曲编排源文件 |

---

## 1. 编排是怎么跑起来的

```
JSON cue（方法 + 颜色 + 强度/缩放/淡入淡出）
  → encodePerformance（颜色表 + 提示字节）
  → VfxPerformancePlayer（按通道插值出当前状态）
  → VFX_PAINTERS[method].emit(context)（返回若干 VfxEmitter）
  → VfxBudget 排队 / 限流
  → spawnVfxEmitter（换算世界坐标 + Molang 变量）
  → Minecraft 粒子
```

关键点：

- 一条 cue 只控制**通道状态**（强度、缩放、颜色、样式），具体形状由方法决定。
- 同一方法可用 `slot: 0..7` 开多条并行通道，各自独立淡入淡出。
- 瞬时方法（`floor_sweep` / `shockwave` / `prism_rewind` / `firework_bloom`）只在 cue 时刻触发一次。

---

## 2. 新增一种画笔（新视觉）

### 2.1 三条硬性规则

1. **ID 只能追加，不能重排或复用**（已编码进历史曲目）。
2. `PERFORMANCE_METHODS` 与 `VFX_PAINTERS` 的键必须一一对应（有测试守护）。
3. `emit()` 返回的所有数值必须是有限数；NaN 会被 Molang 拒绝（`vfxEmitterFinite.test.ts` 会逐帧扫描）。

### 2.2 需要改动的源码

新增视觉本质上就是在源码里写一个 `emit()`，一共三处：

1. **分配稳定 ID** — `packages/core/src/pbe3/performance.ts`

   ```ts
   export const PERFORMANCE_METHODS = {
       ...
       key_style: 25,
       aurora_pulse: 26,   // 追加在末尾，不能复用或重排
   } as const;
   ```

2. **实现画笔** — `packages/addon/src/domain/piano/vfxPainters.ts`，在 `VFX_PAINTERS` 末尾追加条目（见 2.3 骨架）。需要的 `drawPoints` / `drawStrokeSegments` / `sampleArch` / `resolveBrush` 等已经在文件顶部导入。

3. **同步文档** — `docs/pbe3-format.md` 的「内置绘制方法由 `PERFORMANCE_METHODS`（N 种：…）」清单加上新名字并更新数量；`vfxRegistry.test.ts` 会校验这一项，漏改会直接测试失败。

然后：

```bash
npm run build:core      # addon 与测试通过 dist 读取注册表
bun test -w @piano/addon
```

网页 `/vfx-lab` 的方法下拉和标签直接读注册表，新方法会自动出现；游戏内同样可用：

```
/scriptevent pbe:vfx painters
/scriptevent pbe:vfx draw aurora_pulse phrase {"color":"ice"}
```

### 2.3 手写骨架

```ts
    aurora_pulse: {
        label: "极光脉冲",
        category: "curve",      // atmosphere | curve | stage | keys | accent
        instant: false,
        interval: 12,           // 最小发射间隔（游戏刻），瞬时方法写 0
        priority: 3,            // 越大越先占用粒子上限
        defaultBrush: "star",   // 默认笔刷，必须不是 "default"
        emit({ color, color2, intensity, scale, brush, zone, motion, music, phase = 0 }) {
            const m = motionFactors(motion);
            const y = zoneBaseY(zone, 1.1);
            return {
                priority: 3,
                emitters: [
                    ...drawStrokeSegments(sampleArch(2.2 * m.spread, 1.6, 0.8, y, 16), {
                        count: 12,
                        life: 1.2,
                        brush: resolveStrokeBrush(brush, 0),
                        color, color2,
                        opacity: 0.3 + 0.5 * intensity,
                        width: 0.1,
                        scale,
                    }),
                ],
            };
        },
    },
```

### 2.4 `emit()` 上下文

| 字段 | 说明 |
| --- | --- |
| `color` / `color2` | 已解析的 `#RRGGBB` |
| `intensity` | 0–1（由 cue 的 `level` 和淡入淡出插值得到） |
| `scale` | 0.5–1.7（cue 的 `scale`） |
| `brush` / `zone` / `motion` | 已校验的枚举，可能为 `undefined` |
| `music` | `activity/density/sustain/surge/chord/onset/velocity/pitch/low/middle/high` 等实时特征 |
| `recentNotes` / `lastNoteTick` | 最近弹奏的音（琴键类方法使用） |
| `definition` | 琴的几何定义，用于算琴键位置 |
| `phase` | 播放器给的相位（时间或步进） |
| `solo` | Web Lab 单方法预览时为 `true` |

返回 `{ priority, emitters }`；琴键类方法还可用 `nextLength` / `nextAmplitude` 保存跨帧状态。

---

## 3. 可复用的几何组合器（`vfxDraw.ts`）

这些函数返回 `VfxEmitter[]` 或点数组，新画笔应优先用它们，而不是从零写数学：

| 函数 | 产出 | 常用参数 |
| --- | --- | --- |
| `drawPoints(opts)` | `field` 通道的点阵（圆环/散布/螺旋） | `count, radius, radiusEnd, phase, spread, velocity, size, twinkle` |
| `drawStrokeSegments(points, opts)` | 沿折线排布的 `beam` 笔画 | `count, width, life, opacity, travel, taperEnds` |
| `drawPolygonFrame(vertices, opts)` | 闭合多边形边框 | `closed, width, overlap` |
| `drawGroundRing(opts)` | 贴地扩散光环（`draw_plane`） | `radiusStart, radiusEnd, spin, spinRate, style, life` |
| `sampleArch(w, h, depth, y, samples)` | 拱形点列 | — |
| `sampleStarPolygon(r, sides, y, rot, inset)` | 星形/多边形点列 | — |
| `sampleWingPair(side, r, h, spread, y)` | 左右翼展曲线 | — |
| `sampleLissajous(...)` | 李萨如曲线 | — |
| `catmullRom(points, samples)` | 平滑样条 | — |
| `segmentsAlong(points, count)` | 等距采样（含切线/间距） | — |
| `motionFactors(motion)` | 把运动修饰变成 `dir/speed/spread/energy` 系数 | — |
| `blendHex` / `colorVars` / `pitchGradientHex` | 配色与渐变 | — |

约束：

- 单个 `emit()` 建议 ≤ 40 个发射器；整个舞台的粒子上限由 `VfxBudget` 控制（当前峰值约 275 粒子、24 次/刻）。
- `interval` 决定频率；持续方法一般 12–22 刻，琴键类可用 1–2 刻。
- 位置偏移以舞台中心为原点，`zoneBaseY()` 负责把高度区域换算成 y。
- 数值必须有限；`Math.acos/asin`、除零、`undefined` 参与运算都要防。

### 3.1 方法词汇表

同一类效果往往有多种实现，按"想要什么感觉"选，而不是看名字：

| 类别 | 方法 | 适用场景 |
| --- | --- | --- |
| 氛围 | `starfield` | 全曲底噪，最省预算；motion=gentle 更柔 |
| | `aurora_veil` | 更明显的横向光幕，适合副歌铺底 |
| | `wing_curtain` | 双侧柔光幕（目前未启用，需要时可以拿来替换 aurora_veil） |
| 曲线流动 | `silk_streams` | 少量长丝带，安静段落 |
| | `wing_ribbons` | 左右展开的丝带，副歌主视觉 |
| | `double_helix` | 螺旋上升，推进段 |
| | `orbit_halo` | 倾斜星环（未启用，比 magic_circle 轻） |
| | `wave_ribbon` | 环形音浪（未启用，适合律动强的段落） |
| | `lissajous_weave` | 利萨如曲线（未启用，最"电流感"） |
| | `vortex_column` | 旋涡柱（未启用，纵向张力） |
| 舞台结构 | `crown_fan` | 冠形光束，副歌高点 |
| | `portal_arch` | 拱门，空间感 |
| | `magic_circle` | 地面法阵，神秘/安静 |
| | `light_pillars` | 成排光柱，电子风 |
| | `stage_truss` | 门架光框（未启用，接近 portal_arch） |
| 琴键 | `key_notes` | 每键飞出音符，最常用 |
| | `key_fountain` | 琴键喷泉，爆发段 |
| | `key_constellation` | 键间星座连线，稀疏段 |
| | `key_style` | 只替换弹奏粒子本身，不额外占舞台预算 |
| 重音 | `floor_sweep` | 贴地扫光，弱重音 |
| | `shockwave` | 地面冲击环，强重音 |
| | `prism_rewind` | 棱晶回溯，转场 |
| | `firework_bloom` | 烟花绽放，最终高点 |

标注"未启用"表示目前没有编排/主题引用，但 ID 已发布、代码可用，属于保留词汇而不是死代码。不要为了"清理"删除或复用这些 ID。

---

## 4. 新增粒子素材（贴图层）

图集由 `tools/assets/build-vfx-lab.mjs` 一次性生成，**不要手改 PNG**。

### 4.1 图集布局（1024×1024）

| 区域 | 内容 |
| --- | --- |
| 左上 512×368 | 旧效果素材（mote/glint/silk/beam/shaft/aurora…） |
| `[0,512,256,256]` | `ripple` 地面光环 |
| `[0,768]` 起，8×128² | `brush_*` 八种笔刷单元 |
| `[0,896]` 起，4×256×96 | `stroke_*` 四种笔画条 |

### 4.2 加一种笔刷（不新增粒子文档）

1. 在 `tiles` 里加 128² 单元；注意 `draw_point` 的 UV 按 `brushIndex * 128` 计算，目前**固定 8 格**。
2. 在 `PERFORMANCE_BRUSHES`（core）追加枚举（ID 只能追加）。
3. 加一段 `paint(tiles.brush_xxx, emissive, profile)` 绘制轮廓。
4. 在 `particleOverride.ts` 的 `BRUSH_TO_KEY_STYLE` / `KEY_PARTICLE_STYLE_IDS` 决定它是否也能用于 `key_style`。
5. 运行 `node tools/assets/build-vfx-lab.mjs`，再用 `--check` 确认可重复。

> 超过 8 格笔刷需要同时改 `draw_point` 的 clamp 上限和图集排布，属于格式性改动。

### 4.3 加一种全新基础效果

1. `vfxLab.ts`：扩展 `VfxEffect` 联合类型与 `VFX_COLORS`。
2. `effectEmitters()` 里加分支，返回带 `variables` 的发射器。
3. `build-vfx-lab.mjs`：`particle("xxx", …)` 生成 `pbe:vfx_xxx.particle.json`（含 UV、生命周期、运动、tint）。
4. 网页 Lab：`packages/web/src/vfxLab/particles.ts` 补渲染映射。
5. 测试：`vfxLab.test.ts` 会校验粒子文档的 UV 越界与未知 Molang 变量；新变量要加入允许列表。

---

## 5. 新增舞台主题

`VFX_STAGE_THEMES` 是纯数据组合：

```ts
    aurora: {
        label: "极光回廊",
        keyParticle: { style: "stardust", colors: ["#7C92FF", "#68E4FF"], glimmer: true },
        layers: [
            { method: "aurora_veil", color: "aurora", color2: "ice",
              level: { input: "activity", from: 45, to: 88 } },
            { method: "key_notes", color: "ice", brush: "star", level: 80 },
            { method: "prism_rewind", color: "cyan", level: 70,
              gate: { input: "surge", threshold: 0.7, cooldown: 40 } },
        ],
    },
```

- `level` 可以是固定值，也可以按音乐特征映射。
- `gate` 只对瞬时方法有效，`cooldown` 为游戏刻。
- 主题名要同步到 `settings.ts` 的 `PIANO_STAGE_THEMES`，才能在游戏设置里选择。

---

## 6. 写一首曲子的编排

1. 新建 `midis/performances/<songId>.json`：

```json
{
  "song": "e1563b03",
  "cues": [
    { "at": 1.625, "method": "starfield", "color": "moon", "motion": "gentle", "level": 52, "fade": 2.2 },
    { "at": 72.05, "method": "shockwave", "color": "gold", "level": 82 }
  ]
}
```

2. `npm run export:performance <songId>`：编码进 `.pbe3`、更新索引与运行时模块。
3. 预览：网页 `/vfx-lab` 打开曲目，或游戏内 `/scriptevent pbe:vfx draw …`。
4. `npm run build` 部署。

字段：`at`（秒，必须对齐 25ms）、`method`、`slot`、`color`/`color2`、`brush`、`zone`、`motion`、`level`、`scale`、`fade`、`op`；`key_style` 额外支持 `style` 语义别名。

---

## 7. 自检清单

- [ ] ID 是追加的，没有改动已有数值
- [ ] `VFX_PAINTERS` 与 `PERFORMANCE_METHODS` 一一对应
- [ ] `defaultBrush` 是有效笔刷且不为 `default`
- [ ] `emit()` 所有数值有限（跑 `vfxEmitterFinite.test.ts`）
- [ ] 文档的方法清单与注册表一致（`vfxRegistry.test.ts` 会检查）
- [ ] 图集可用 `node tools/assets/build-vfx-lab.mjs --check` 复现
- [ ] 网页 Lab 与游戏内 `/scriptevent pbe:vfx painters` 都能看到新方法
