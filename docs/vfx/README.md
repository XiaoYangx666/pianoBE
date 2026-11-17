# PianoBE VFX Lab

[视觉研究、组件和引擎限制](design.md) · [音乐事件、映射和扩展接口](architecture.md)

## 在基岩版预览

用仓库现有构建流程安装行为包和资源包。在有命令权限的世界里，站在 12 格内，准星对准 P-88 或三角钢琴的任意琴体方块。命令从完整装配获取锚点和朝向，两种钢琴均可使用。正 X 沿键列，正 Z 向琴体后方。可以先输入命令，再退到正面斜视位置观察。

检查自发光时，在客户端视频设置的图形模式里选择 Vibrant Visuals。图集附带独立的 MER 发光图，标准模式也可看到粒子贴图自身的亮芯和柔边。[Vibrant Visuals 资源包说明](https://learn.microsoft.com/en-us/minecraft/creator/documents/vibrantvisuals/vvresourcepacks?view=minecraft-bedrock-stable)

### 音乐响应预设

```mcfunction
/scriptevent pbe:vfx list
/scriptevent pbe:vfx list surface
/scriptevent pbe:vfx preview ripple {"range":1.15,"rippleColor":"#AFFCE9"}
/scriptevent pbe:vfx preset galaxy phrase
/scriptevent pbe:vfx preset neon live
/scriptevent pbe:vfx preset stage dense
```

| 预设 | 联动 |
| --- | --- |
| `galaxy` · 梦幻星河 | 活跃度控制悬浮星尘的强弱，力度控制漂移。持续音的加权音高改变光带的高度，长音拉长光带。倾斜的星芒轨道作为低亮度底层持续运行。 |
| `neon` · 霓虹音乐会 | 音符密度抬高波幅，力度调节波面透明度，光带跟随音区和活跃度。和弦触发层叠扩散的低位同心波纹。 |
| `stage` · 高能舞台 | 密集段落逐渐加快并加密两侧喷泉，后方光幕拉长。高音区加快光幕运动，低音区影响和弦波纹的范围。休止后喷泉和光幕恢复到低强度。 |

`live` 接收这架琴的手弹和播放器 MIDI。启动后可用钢琴原来的播放器选曲、暂停、继续、拖动进度或切歌。`phrase` 固定轮播休止、琶音、长音、和弦和密集段。`note`、`chord`、`dense` 分别模拟单音、和弦和密集段。`solo` 将图层作为自主效果预览。模拟输入直接送入视觉分析。`status` 对准琴时还会显示当前密度、活跃度、力度、音高和延音值。

### 组合和保存

```mcfunction
/scriptevent pbe:vfx compose phrase {"seconds":18,"layers":[{"effect":"orbit","options":{"intensity":0.45}},{"effect":"wave","map":[{"input":"density","parameter":"amplitude","from":0.12,"to":0.62}]},{"effect":"ripple","gate":"chord"}]}
/scriptevent pbe:vfx save dusk {"seconds":24,"fadeIn":1,"fadeOut":2,"layers":[{"effect":"field","options":{"z":0.4,"scale":0.9}},{"effect":"beam","map":[{"input":"pitch","parameter":"height","from":-0.25,"to":0.6}]}]}
/scriptevent pbe:vfx preset dusk live
/scriptevent pbe:vfx remove dusk
```

最多六个图层，每个图层最多六条标量映射。预设默认 45 秒，可设置 5–180 秒。`compose` 直接试演，`save` 保存到当前世界，最多 12 个自定义预设。`list` 自动列出注册效果和已保存的预设。预览和预设命令要求玩家瞄准一架钢琴；列表和预设管理可直接运行。

### 原有独立场景

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

重新运行场景会停止上一场的后续发射，并在其现存粒子到期后启动新场景。`stop` 取消后续发射或排队的预览，现存粒子按自身寿命淡出。`reset` 重播当前预设，或以默认参数重播原有固定场景。`status` 可在没有瞄准目标时查看全局统计。

| 场景 | 内容 |
| --- | --- |
| `field` | 约 15 秒的体积悬浮场，适合观察远近点、静止点与缓漂点。 |
| `wave` | 约 13 秒的三层行波，适合斜视检查主线连续性和层间距。 |
| `beam` | 两次交错穿场，默认每次 4 条轨道，每轨 3 段。 |
| `mix` | 底层悬浮场加三层波与穿场流光。 |
| `burst` | 短闪的悬浮场和曲面，默认伴随 6 道向不同角度扩张的流光。 |
| `demo` | 约 22 秒的组合演出。 |

## 参数

下面的参数与 `x/y/z`、`rotation`、`scale`、`intensity` 可以用于选中的特效。`effectColor` 以实际效果名为前缀，例如 `rippleColor`。`list` 从注册表输出每种效果可用的运动参数。

| 参数 | 范围 | 作用 |
| --- | --- | --- |
| `x` / `y` / `z` | −5–5 / −3–4 / −5–7 格 | 钢琴局部位移。先缩放和旋转效果，再加位移 |
| `rotation` / `scale` | −180–180° / 0.5–1.7 | 绕竖轴转向与整体缩放 |
| `intensity` | 0–1 | 图层强度乘数，包括完全压低该图层 |
| `range` | 0.65–1.6 | 横向扩展比例，同时调整悬浮场深度、波浪层间距和光条轨迹距离 |
| `height` | −0.5–2 格 | 整体竖向偏移 |
| `opacity` | 0.1–1 | 透明度乘数 |
| `density` | 0.4–1.4 | 悬浮发射频率和波浪横向采样密度，波浪设有采样下限 |
| `size` | 0.6–1.6 | 悬浮粒子尺寸、波线及光条粗细 |
| `speed` | 0.5–1.8 | 悬浮漂移速度、行波角速度、光条穿场速度的乘数 |
| `fieldColor` / `waveColor` / `beamColor` / `rippleColor` / `fountainColor` / `curtainColor` / `orbitColor` | `#RRGGBB` | 各效果色调 |
| `amplitude` | 0.08–1.1 格 | 波浪的基准振幅，默认 0.37 |
| `period` | 1.2–6 秒 | 行波基准周期，默认 2.9 |
| `wavelength` | 2.5–9 格 | 行波基准波长，默认 4.6 |
| `phase` | −360–360° | 行波初始相位 |
| `length` / `width` | 0.35–2.4 / 0.025–0.26 格 | 光条基准长度和宽度，默认 1.36 / 0.16 |
| `heading` | −180–180° | 相对琴的局部行进方向，0° 沿正 X，默认爆发朝 90° 扇出 |
| `bend` | 0–1.4 格 | 光条曲线横向偏移，默认 0.56 |
| `lanes` / `segments` | 1–6 / 1–3，整数 | 穿场轨道数、每条轨道上的流光段数 |

默认公共倍率为 1、偏移为 0。上述参数由纯逻辑模块 `domain/piano/vfxLab.ts` 接收，效应描述为局部坐标、每批预估粒子数、寿命和具名 Molang 参数。`platform/vfxParticle.ts` 将其转换为 Bedrock 发射位置和变量。预览调度位于 `app/vfxLab.ts`。

## Demo 编排

| 时间 | 画面 |
| --- | --- |
| 0.8–3.4 秒 | 琴体后侧浮出低亮度冷蓝散点 |
| 3.4–7.9 秒 | 琴后上方逐渐铺开青色波面，第二组接续并增加起伏 |
| 7.9–11.8 秒 | 琴体后侧上方的暖色光线斜穿，青色波面继续推进 |
| 11.8–15.4 秒 | 六轨向琴后方展开，行波波幅达到峰值，底层散点延续 |
| 15.4–约 22 秒 | 波浪与光条逐步退场，最后几批低亮度散点渐隐 |

## 构建与观测

```powershell
node tools/assets/build-vfx-lab.mjs
node tools/assets/build-vfx-lab.mjs --check
npm run test -w @piano/addon
npm run verify:addon-build
```

最多四架琴同时占用预览槽，退场也计入槽位。每架琴每刻最多提交 6 个发射器，全局上限 24 个。每架琴的活跃与待发批次共预留最多 275 个粒子。预算紧张时优先保留高优先级批次和已开始的形状批次。`status` 可查看预留量、丢弃批数、发送峰值、脚本耗时和失败数。可以对四架琴分别运行 `preset stage dense`，再用 `status` 对照客户端帧率。客户端帧率需要在目标设备采样，脚本耗时可以用官方 profiler 进一步定位。[Minecraft Script Profiler](https://learn.microsoft.com/en-us/minecraft/creator/documents/scripting/script-performance?view=minecraft-bedrock-stable)

实机观察点包括四个朝向的琴后波面、近景与 6–10 格斜视时的连续性、亮暗环境下光条的端点和余光，以及四架琴同时播放时的客户端帧率。当前的实机视觉验收待完成。

离线验证覆盖播放状态、固定力度的旧曲目、响应映射、时间包络、图集与粒子文档，以及客户端和服务器构建。实机重点复核新版波浪的辉光层次、低位波纹的深度遮挡，以及真实 MIDI 切歌和暂停时的画面收敛。
