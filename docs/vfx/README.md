# PianoBE VFX Lab

[视觉研究、组件和引擎限制](design.md)

## 在基岩版预览

用仓库现有构建流程安装行为包和资源包。在有命令权限的世界里，站在 12 格内，准星对准 P-88 或三角钢琴的任意琴体方块。命令从完整装配获取锚点和朝向，两种钢琴均可使用。正 X 沿键列，正 Z 向琴体后方。可以先输入命令，再退到正面斜视位置观察。

```mcfunction
/scriptevent pbe:vfx field
/scriptevent pbe:vfx wave
/scriptevent pbe:vfx beam {"lanes":1,"segments":1,"bend":0,"heading":28,"beamColor":"#FFD5A8"}
/scriptevent pbe:vfx mix {"amplitude":0.68,"period":3.4,"waveColor":"#76B6FF"}
/scriptevent pbe:vfx burst
/scriptevent pbe:vfx demo
/scriptevent pbe:vfx stop
/scriptevent pbe:vfx reset
/scriptevent pbe:vfx status
```

参数只作用于本次预览。重新运行场景会停止上一场的后续发射，并在其现存粒子到期后启动新场景。`stop` 取消后续发射或排队的预览，现存粒子按自身寿命淡出。`reset` 以默认参数重播当前仍在运行或退场的场景。`status` 可在没有瞄准目标时查看。调试命令入口接收玩家发起的脚本事件。

| 场景 | 内容 |
| --- | --- |
| `field` | 约 15 秒的体积悬浮场，适合观察远近点、静止点与缓漂点。 |
| `wave` | 约 13 秒的三层行波，适合斜视检查曲面间距、相位和切线。 |
| `beam` | 两次交错穿场，默认每次 4 条轨道，每轨 3 段。 |
| `mix` | 底层悬浮场加三层波与穿场流光。 |
| `burst` | 短闪的悬浮场和曲面，默认伴随 6 道向不同角度扩张的流光。 |
| `demo` | 约 22 秒的组合演出。 |

## 参数

| 参数 | 范围 | 作用 |
| --- | --- | --- |
| `range` | 0.65–1.6 | 横向扩展比例，同时调整悬浮场深度、波浪层间距和光条轨迹距离 |
| `height` | −0.5–2 格 | 整体竖向偏移 |
| `opacity` | 0.1–1 | 透明度乘数 |
| `density` | 0.4–1.4 | 悬浮发射频率和波浪横向采样密度，波浪设有采样下限 |
| `size` | 0.6–1.6 | 悬浮粒子尺寸、波线及光条粗细 |
| `speed` | 0.5–1.8 | 悬浮漂移速度、行波角速度、光条穿场速度的乘数 |
| `fieldColor` / `waveColor` / `beamColor` | `#RRGGBB` | 分别调整各效果的色调 |
| `amplitude` | 0.08–1.1 格 | 波浪的基准振幅，默认 0.5 |
| `period` | 1.2–6 秒 | 行波基准周期，默认 2.9 |
| `wavelength` | 2.5–9 格 | 行波基准波长，默认 5.5 |
| `phase` | −360–360° | 行波初始相位 |
| `length` / `width` | 0.35–2.4 / 0.025–0.26 格 | 光条基准长度和宽度，默认 1.22 / 0.10 |
| `heading` | −180–180° | 相对琴的局部行进方向，0° 沿正 X |
| `bend` | 0–1.4 格 | 光条曲线横向偏移，默认 0.64 |
| `lanes` / `segments` | 1–6 / 1–3，整数 | 穿场轨道数、每条轨道上的流光段数 |

默认公共倍率为 1、偏移为 0。上述参数由纯逻辑模块 `domain/piano/vfxLab.ts` 接收，效应描述为局部坐标、每批预估粒子数、寿命和具名 Molang 参数。`platform/vfxParticle.ts` 将其转换为 Bedrock 发射位置和变量。预览调度位于 `app/vfxLab.ts`。

## Demo 编排

| 时间 | 画面 |
| --- | --- |
| 0–3.4 秒 | 琴周围浮出低亮度冷蓝散点 |
| 3.4–7.9 秒 | 琴后上方逐渐铺开青色波面，第二组接续并增加起伏 |
| 7.9–11.5 秒 | 上方暖色光线斜穿，青色波面继续推进 |
| 11.5–15.4 秒 | 六轨展开，行波波幅达到峰值，底层散点延续 |
| 15.4–约 22 秒 | 波浪与光条逐步退场，最后几批低亮度散点渐隐 |

## 构建与观测

```powershell
node tools/assets/build-vfx-lab.mjs
node tools/assets/build-vfx-lab.mjs --check
npm run test -w @piano/addon
npm run verify:addon-build
```

最多四架琴同时占用预览槽，退场也计入槽位。每架琴每刻最多提交 6 个发射器，全局上限 24 个。悬浮场每个发射器最多保留 40 个粒子，单个波浪或光条发射器只发射一个粒子。现存发射器和粒子以配置的上限估算，发送成功只表示服务端提交成功。调度在最后一个尾部到期后休眠。开启四架琴的 `demo` 后，可用 `status` 对比发送峰值、脚本调度耗时和失败数。客户端帧率与叠加渲染成本需在目标设备单独采样。需要进一步定位脚本开销时，可使用官方 profiler。[Minecraft Script Profiler](https://learn.microsoft.com/en-us/minecraft/creator/documents/scripting/script-performance?view=minecraft-bedrock-stable)

实机观察点包括四个朝向的琴后波面、近景与 6–10 格斜视时的连续性、亮暗环境下光条的端点和余光，以及四架琴同时播放时的客户端帧率。当前的实机视觉验收待完成。

本阶段的离线验证覆盖 218 项 addon 测试、client 与 server 双目标构建、图集和粒子文档的生成一致性，以及用第三方 Molang 解析器进行的方向、寿命和参数边界采样。解析器结果仅覆盖表达式的语法与数值行为。
