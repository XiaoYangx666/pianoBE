# PianoBE VFX Lab

[视觉研究、组件和引擎限制](design.md) · [音乐事件、映射和扩展接口](architecture.md) · [创作与扩展指南](authoring.md)

## 《Secret》首演

Web 端用 `/vfx-lab/replay` 对照游戏内效果：它按曲目时间运行真实的 `SecretCinemaPlayer` 批次，并直接渲染开发包里的 `cinema_*` 粒子 JSON。基岩版由开发包脚本驱动同一份曲目时间与音符分析。

```powershell
npm run build:core
npm run dev:web
```

回放页的使用方法见下文「Web 排练」。

### 基岩版编排

新版开发包播放同一份《Secret》音符时会启动电影编排的基岩版实现。根据原曲 ID 与音符流 CRC 选择舞台，支持普通 PBE3 和带演出区块的 PBE3。基岩版的细小光点从琴键升起，成簇沿不同高度和纵深回旋，两个重拍分别向外推开不同力度的粒子波。两条丝带各由 26 段沿样条采样的贴片拼接，相邻贴片相互重叠，两端渐隐，按整条曲线一起淡入淡出；两次重拍另有 20 段贴片铺成地面弧线。两个版本共用 `@piano/core` 的曲目时间和音符分析，资源和实际着色由各自引擎负责。

```powershell
node tools/assets/build-secret-cinema.mjs
node tools/assets/build-secret-cinema.mjs --check
npm run build:core
npm run build
```

在 `/vfx-lab` 的音乐片段里选「Secret · 时门」，按播放从头观看，或用乐段按钮定位。基岩版用钢琴的常规曲库搜索「周杰伦 - Secret」并播放，曲目会自动启动演出。对准钢琴运行 `/scriptevent pbe:vfx status` 可查看发射和预算。

[编排源文件](../../midis/performances/e1563b03.json)中的 `sections` 是段落与观察目标，`cues` 按秒填写，最小步长为 0.025 秒。`method` 指定 25 种内置粒子绘制方法之一（见下文，含 `key_style` 弹奏粒子样式通道），可选 `slot`（`0..7` 允许同方法多通道并行叠加）、主色 `color`、渐变副色 `color2`、笔刷 `brush`（`default`/`mote`/`star`/`petal`/`snow`/`note`/`shard`/`spark`/`ring`）、高度区域 `zone`（`stage`/`low`/`mid`/`high`）与运动修饰 `motion`（`normal`/`reverse`/`intense`/`gentle`）。`level` 是强度百分比，`scale` 是缩放百分比。持续提示用 `fade` 填入渐变秒数，瞬时绘制方法或显式 `"op": "flash"` 触发一次性爆发。

示例曲目《Secret · 时门》在各幕同步编排了舞台特效与 `key_style` 弹奏粒子过渡（从星火、蓝眼泪、魔法流光、雪晶到棱光晶片并在尾声释放恢复默认）。

```powershell
npm run build:core
npm run export:performance
```

导出改写 `midis/library/e1563b03.pbe3` 及曲库字节数，有本地内嵌模块时同时更新 `midis/js`。后续曲目可在 `midis/performances/<曲库 ID>.json` 中自由组合 25 种内置绘制方法，并用 `npm run export:performance -- <曲库 ID>` 导出。

### 25 种内置绘制方法

| 分类 | 绘制方法（`method`） | 表现与特性 |
| --- | --- | --- |
| 氛围（`atmosphere`） | `starfield`、`petal_fall`、`firefly_rise`、`aurora_veil`、`wing_curtain` | Bokeh 星尘雾海、双侧飘落花瓣/雪花、地面升腾流萤、极光天幕、双翼光幕 |
| 曲线（`curve`） | `wing_ribbons`、`double_helix`、`orbit_halo`、`silk_streams`、`wave_ribbon`、`vortex_column`、`lissajous_weave` | 双翼 Catmull-Rom 丝带、双螺旋星轨、倾斜行星环、穿场丝带、律动音浪环、旋涡漏斗、3D 利萨如织光 |
| 舞台（`stage`） | `light_pillars`、`crown_fan`、`stage_truss`、`magic_circle`、`portal_arch` | 霓虹灯柱阵、圣光扇束冠冕、门架光框、旋转六芒星辰法阵、时空光拱门 |
| 琴键（`keys`） | `key_notes`、`key_fountain`、`key_constellation`、`key_style` | 实时琴键飞音符、琴键重力音泉喷涌、活跃音符星座连线；`key_style` 用于在演出中动态替换/渐变弹奏粒子样式与配色（`style` 别名或 `brush`/`motion`，`level: 0` 恢复默认） |
| 瞬时（`accent`） | `floor_sweep`、`shockwave`、`prism_rewind`、`firework_bloom` | 地面彗星扫光弧、双环扩散冲击波、棱晶回卷（`reverse` 为向外裂变）、高空重力烟花盛放 |

### 验收记录

| 项目 | 结果 |
| --- | --- |
| 曲目 | 原 MIDI 982 音，首尾起音约 1.643 / 81.683 秒。PBE3 首尾起音 1.625 / 81.675 秒，含踏板尾音共 86.1 秒 |
| 编解码 | 62 条提示，1,553 → 2,115 字节（+562 B，颜色表版本 3）。去掉演出区块后与原曲目逐字节一致，支持未知 `methodId` 向前兼容跳过；`@piano/core` 74 项测试全过 |
| 预算与调度 | `@piano/addon` 254 项测试全过，含全部 25 种绘制方法与弹奏粒子覆盖校验、4 套新主题与新版《Secret · 时门》4 琴错峰全曲压测（峰值 ≤ 275 粒子、≤ 24 调用/刻，丢弃 0 批） |
| 资源与构建 | `1024 × 1024` 图集（地面环 256²、笔刷 128²、笔画 256×96）、MER 贴图及 `draw_point`/`draw_stroke`/`draw_plane` 等粒子文档通过校验，Web 与 Addon 编译构建通过 |
| 待实机复核 | 基岩版游戏世界内的视觉亮度、MER 发光、遮挡与实机帧率待进世界复核 |

## Web 排练

```powershell
npm run dev:web
```

`/vfx-lab/replay` 不进游戏也能看真实粒子：它读取 `packages/addon/rp/particles/pbe_vfx_cinema_*.particle.json` 和图集，用 MoLang 求值，按 20 Hz 把 `SecretCinemaPlayer` 的真实 emitter 批次画成 billboard，并显示存活粒子、预算预留、丢弃数和发射器数。支持 `?t=74.2` 直接定位，页面右下角可暂停、拖动和跳章节。场景中的钢琴与演奏者来自 `models.ts`，与基岩版使用同一份模型数据。

回放页的粒子副本由 `npm run sync:replay` 生成，`dev:web` 和 `build:web` 前会自动执行；不要手改 `packages/web/public/replay/`。

在命令打印的本机地址后访问 `/vfx-lab`（开发工具，不显示在管理页导航中）。选择三角钢琴或 P-88、朝向、舞台/演奏/自由视角。自由视角拖动旋转，滚轮拉近，右键拖动平移。排练台和场景布光是 Web 的观测环境，右侧可切换到平地。

- 用标准乐句的弱奏、长音、和弦、高潮和回落提示定位。打开本地 MIDI 后，可在钢琴卷帘或时间条上跳转，设置循环首尾。音频用项目采样库播放。
- 每个图层可显隐、调色、修改空间位置和音乐映射。已有映射的参数可直接调整映射范围。预设 JSON 导出后可粘贴到游戏里的 `compose` 或 `save` 命令。
- 展开图层查看该效果的存活粒子、预算预留与近一秒发射次数。右侧可以打开网格、发射点和轨迹，验收画面时建议关闭。

### 固定画面与版本对照

```powershell
node tools/assets/capture-vfx-lab.mjs
node tools/assets/capture-vfx-lab.mjs --preset stage --time 8.7 --time 11.4 --piano p88 --direction east --view performer --out build/vfx-stage-p88
```

截图脚本使用本机 Chrome，可用 `--browser` 指定可执行文件。默认输出 1440 × 900 的三种预设，时间为 3.75 秒弱奏、8.70 秒高潮、11.40 秒回落，随图生成 `metrics.json`。加 `--flat` 可比较平地，在同一相机和素材条件下可用 `--presets path/to/presets.json` 载入旧版预设表。

## 在基岩版预览

用仓库现有构建流程安装行为包和资源包。在有命令权限的世界里，站在 12 格内，准星对准 P-88 或三角钢琴的任意琴体方块。正 X 沿键列，正 Z 从演奏位指向琴体远端。默认舞台以琴体和标准演奏位的共同范围为中心，三角钢琴沿琴尾方向加长。可坐到琴凳，从第三人称检查左右翼、琴外侧和演奏者身后的轨迹。

检查自发光时，在客户端视频设置的图形模式里选择 Vibrant Visuals。图集附带独立的 MER 发光图，标准模式也可看到粒子贴图自身的亮芯和柔边。[Vibrant Visuals 资源包说明](https://learn.microsoft.com/en-us/minecraft/creator/documents/vibrantvisuals/vvresourcepacks?view=minecraft-bedrock-stable)

### 游戏内「舞台演出」设置与音乐响应主题

普通玩家可在钢琴设置主界面进入 **「舞台演出」** 子页（[stageSettingsUI.ts](../../packages/addon/src/app/ui/stageSettingsUI.ts)）：
- **启用曲目自带舞台编排**（默认开启）：播放带 PBE3 演出区块的曲目时自动呈现定制舞台；
- **允许舞台替换弹奏粒子**（默认开启）：开启后，曲目编排或舞台主题可替换弹奏时的琴键粒子样式与配色（内置 7 套主题也各带有匹配的弹奏粒子配置）；
- **默认舞台主题**（默认关闭）：可从 7 套内置音乐响应主题中任选一套，供普通 MIDI 曲目与手弹（无操作 8 秒自动休眠）使用。

此外，三角钢琴的弹奏粒子发射基准线 `GRAND_PARTICLE_LINE` 位于琴键与铭牌后方的琴盖台面上方（`y = 19.146601, z = 1.210572`），与 P-88 保持统一的落点比例。

开发者指令预览：

```mcfunction
/scriptevent pbe:vfx list
/scriptevent pbe:vfx painters
/scriptevent pbe:vfx painters curve
/scriptevent pbe:vfx draw magic_circle phrase {"color":"ice","color2":"violet","brush":"star"}
/scriptevent pbe:vfx draw key_style live {"style":"snow","color":"ice"}
/scriptevent pbe:vfx theme sakura live
/scriptevent pbe:vfx preview ripple {"range":1.15,"rippleColor":"#AFFCE9"}
/scriptevent pbe:vfx preset galaxy phrase
/scriptevent pbe:vfx preset neon live
/scriptevent pbe:vfx preset stage dense
```

| 主题 | 联动 |
| --- | --- |
| `galaxy` · 梦幻星河 | 上方与后景是错层的青紫帷幕，琴体两侧是反向游动的丝带，稀疏星尘给出远近参照。长音牵引帷幕呼吸和丝带延展。 |
| `neon` · 霓虹音乐会 | 六根固定的青蓝侧灯和淡紫背灯形成对称灯阵，按活动度、密度和延音缓慢改变长短与亮度。 |
| `stage` · 高能舞台 | 后场紫色灯柱先确定空间，持续密集后，左右翼抬升暖色光幕并外展，火花仅作为高潮点缀。休止后光幕与扇束收回。 |
| `sakura` · 落樱星庭 | 高空落樱花瓣、低位流萤、延音丝带与琴键樱花喷泉联动。 |
| `starlight` · 星空法阵 | 旋转星辰法阵、双螺旋星轨与活跃音符星座连线联动。 |
| `cathedral` · 圣光时空 | 极光天幕、时空光拱门、圣光冠冕与高蓄势棱晶回卷联动。 |
| `carnival` · 璀璨烟花夜 | 暖金双翼流光、霓虹灯柱阵与和弦触发的高空烟花盛放联动。 |

`live` 接收这架琴的手弹和播放器 MIDI。启动后可用钢琴原来的播放器选曲、暂停、继续、拖动进度或切歌。`phrase` 固定轮播休止、琶音、长音、和弦和密集段。`note`、`chord`、`dense` 分别模拟单音、和弦和密集段。`solo` 将图层作为自主效果预览。模拟输入直接送入视觉分析。`status` 对准琴时还会显示当前密度、活跃度、力度、音高和延音值。

### 组合和保存

```mcfunction
/scriptevent pbe:vfx compose phrase {"seconds":18,"layers":[{"effect":"orbit","options":{"intensity":0.45}},{"effect":"wave","map":[{"input":"density","parameter":"amplitude","from":0.12,"to":0.62}]},{"effect":"ripple","gate":"chord"}]}
/scriptevent pbe:vfx save dusk {"seconds":24,"fadeIn":1,"fadeOut":2,"layers":[{"effect":"field","options":{"z":0.4,"scale":0.9}},{"effect":"beam","map":[{"input":"pitch","parameter":"height","from":-0.25,"to":0.6}]}]}
/scriptevent pbe:vfx preset dusk live
/scriptevent pbe:vfx remove dusk
```

最多六个图层，每个图层最多六条标量映射。预设默认 45 秒，可设置 5–180 秒。`compose` 直接试演，`save` 保存到当前世界，最多 12 个自定义预设。`list` 自动列出注册效果和已保存的预设。预览和预设命令要求玩家瞄准一架钢琴；列表和预设管理可直接运行。

`shaft` 图层的 `layout` 可选 `rails`、`backline`、`fan`、`truss`、`neon-sides`、`neon-rear`，`curtain` 可选 `aurora`、`wings`。`beam` 的 `profile: "silk"` 使用柔边双丝贴图。布局与纹理选项位于图层本身，颜色和位置仍位于 `options`。

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
| `fieldColor` / `waveColor` / `beamColor` / `rippleColor` / `fountainColor` / `curtainColor` / `orbitColor` / `shaftColor` | `#RRGGBB` | 各效果色调 |
| `amplitude` | 0.08–1.1 格 | 波浪的基准振幅，默认 0.37 |
| `period` | 1.2–6 秒 | 行波基准周期，默认 2.9 |
| `wavelength` | 2.5–9 格 | 环形行波的目标波长，默认 5.2。就近匹配整数个周期使首尾相接 |
| `phase` | −360–360° | 行波初始相位 |
| `length` / `width` | 0.35–2.4 / 0.025–0.26 格 | 光条基准长度和宽度，默认 1.36 / 0.16 |
| `heading` | −180–180° | 显式设置时使用定向穿场光条，0° 沿正 X。默认沿舞台外围绕行 |
| `bend` | 0–1.4 格 | 环绕路线的纵深和起伏，或定向穿场路线的横向偏移。0 为直线 |
| `lanes` / `segments` | 1–6 / 1–3，整数 | 穿场轨道数、每条轨道上的流光段数 |

默认公共倍率为 1、偏移为 0。上述参数由纯逻辑模块 `domain/piano/vfxLab.ts` 接收，效应描述为局部坐标、每批预估粒子数、寿命和具名 Molang 参数。`platform/vfxParticle.ts` 将其转换为 Bedrock 发射位置和变量。预览调度位于 `app/vfxLab.ts`。

## Demo 编排

| 时间 | 画面 |
| --- | --- |
| 0.8–3.4 秒 | 琴和演奏位外围浮出低亮度冷蓝散点 |
| 3.4–7.9 秒 | 青色波浪沿外围展开，第二组接续并增加起伏 |
| 7.9–11.8 秒 | 暖色流光分轨绕过琴和演奏位，青色波面继续推进 |
| 11.8–15.4 秒 | 六轨从不同方位展开，行波波幅达到峰值，底层散点延续 |
| 15.4–约 22 秒 | 波浪与光条逐步退场，最后几批低亮度散点渐隐 |

## 构建与观测

```powershell
node tools/assets/build-vfx-lab.mjs
node tools/assets/build-vfx-lab.mjs --check
npm run test -w @piano/addon
npm run verify:addon-build
```

本机安装用 `npm run build`。在开发世界分别对准三角钢琴与 P-88 运行 `/scriptevent pbe:vfx preset <galaxy|neon|stage> phrase`，等乐句完整走过休止、弱奏和高潮。第三人称绕到琴尾与演奏位两侧，观察 Neon 灯柱方向、光幕是否遮脸、扇束是否在休止收回。用 `live` 复测手弹、MIDI 暂停及切歌。标准图形和 Vibrant Visuals 分别检查一次透明遮挡、发光和亮度。四架琴同时运行时用 `/scriptevent pbe:vfx status` 观察预留、丢批、失败和峰值调用。

最多四架琴同时占用预览槽，退场也计入槽位。每架琴每刻最多提交 6 个发射器，全局上限 24 个。每架琴的活跃与待发批次共预留最多 275 个粒子。预算紧张时优先保留高优先级批次和已开始的形状批次。`status` 可查看预留量、丢弃批数、发送峰值、脚本耗时和失败数。可以对四架琴分别运行 `preset stage dense`，再用 `status` 对照客户端帧率。客户端帧率需要在目标设备采样，脚本耗时可以用官方 profiler 进一步定位。[Minecraft Script Profiler](https://learn.microsoft.com/en-us/minecraft/creator/documents/scripting/script-performance?view=minecraft-bedrock-stable)

实机观察点包括两种琴型、四个朝向、演奏位两侧与身后的轨迹、亮暗环境下光条的端点和余光，以及四架琴同时播放时的客户端帧率。环绕布局的实机视觉验收待完成。

离线验证覆盖播放状态、固定力度的旧曲目、响应映射、时间包络、图集与粒子文档，以及客户端和服务器构建。实机重点复核新版波浪的辉光层次、低位波纹的深度遮挡，以及真实 MIDI 切歌和暂停时的画面收敛。
