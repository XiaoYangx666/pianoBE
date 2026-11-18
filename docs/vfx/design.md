# PianoBE VFX Lab 视觉研究与设计

## 舞台预设

| 参考影像 | 构图观察与 PianoBE 转译 |
| --- | --- |
| [Ólafur Arnalds · 慕尼黑现场摄影](https://sonicboomevents.de/4040/olafur-arnalds) · [Harpa 现场 0:43](https://www.youtube.com/watch?v=Q4MBK2rs9lQ&t=43s) | 深色空间把钢琴和演奏者留在较小的亮区，纵向冷光从后面标出空间。Neon 把最亮的线留给侧翼，中央给琴和人。 |
| [光·遇 AURORA 演出 1:59](https://www.youtube.com/watch?v=lzUg5ffOyOo&t=119s) | 入场段中，侧面高低不同的暗色轮廓保留纵深，光与散点沿同一个视觉方向流动。Galaxy 将上方星云、侧面丝带和点状星尘分层，保持暗处可见。 |
| [Fortnite · Rift Tour](https://www.fortnite.com/rift-tour/) · [演出影像 2:38](https://www.youtube.com/watch?v=RiM0moNk74o&t=158s) | 大尺度背景和近处路径分别组织注意力，段落变化会改变空间角色。银河的流动主要发生在画面边缘，高能段则通过后景升起和向外展开改变轮廓。 |
| [初音未来 Magical Mirai 2023 演出摘要 1:22](https://www.youtube.com/watch?v=BLUQVBWqzeo&t=82s) | 灯阵和屏幕以有限几何轮廓组织舞台，主角保持在留出的视觉窗口。Neon 用对称青蓝侧灯和淡紫背灯留出中央演奏区。 |
| [Afterlife · Brooklyn Mirage 现场影像](https://www.after.life/newyork) · [Anyma · Sphere 演出 1:37](https://www.youtube.com/watch?v=QN2BgUsFq7A&t=97s) | 纵向形体和从两翼打开的光线扩大舞台尺度，Sphere 段落仍以明亮的人形对比暗色背景几何。Stage 在持续密集时才启用宽扇束和光幕，并缩短幕布寿命给休止留出退场空间。 |
| [Shapescape · Minecraft Music Concert](https://www.youtube.com/watch?v=RE4m8Qr8XHs) | 约 0:56 的镜头里，实体或方块排成灯位和背屏，漂移粒子负责短拍触发。PianoBE 把持续形状交给有方向的大平面，把点粒子留给星尘或高潮火花。 |

### 三套预设的形与动

- **Galaxy** 的主画面是错开高度、滚转和深度的三张星云帷幕。冷青到紫蓝色来自图集，随演奏活动度改变光度。两个反向移动的丝带层从远近两侧穿过，延音拉长帷幕或丝带。星尘留在低亮度和小粒径。
- **Neon** 用两组错层竖直灯柱框住演奏区。基岩版实机中，自定义方向的门架和导线出现交叉斜线，因此预设切换到固定竖轴的 Billboard，并单独压低贴图发光。音乐改变灯柱的延展和明暗。
- **Stage** 保留低亮度紫色背灯。聚合后的密度和活动度越过阈值后，暖色幕布从两翼升起，扇束稍后随长短与亮度展开，琴尾区域少量火花强调高潮。稀疏段与短和弦保留安静基线，长间歇会使外展回落。

### 预览器选型与可比范围

[Snowstorm](https://github.com/JannisX11/snowstorm) 适合独立调整单个 Bedrock JSON，本身使用 [Wintersky](https://github.com/JannisX11/wintersky)。Lab 直接接入其 MIT 许可的渲染层，复用 MolangJS 执行项目粒子定义。Blockbench 可对单个效应和骨骼挂点做对照，项目里的多层预算、音符聚合和舞台锚点由两端共用的 PianoBE 代码计算。

方向模式直接使用两端共同支持的 `custom`，向量字段为 `custom_direction`。适配器补齐向量初速的长度及连续发射的分数速率。浏览器使用实际 RGBA 图集、尺寸、运动和透明度曲线。世界照明、MER/Vibrant Visuals、客户端采样、混合与网络时序保留为实机检查项。排练台、演奏代理模型及环境布光提供固定观测条件。

首次重做时，使用同一固定镜头回看发现，细线稿的 Neon 和 Stage 仍像画在空地上的调试效果。加上实体排练台后，重拍旧预设作对照。两侧门架、星云大形、暖色幕后纵深是随后加入的主要变化。回看同条件的弱奏与高潮后，压低台沿反光，并缩短 Stage 光幕存活时间以缩短退场。

## 作品与取舍

| 参考 | 观察与转译 |
| --- | --- |
| [Brian Drucker · Particle Storm](https://www.briandrucker.com/particle-storm) · [作者作品集](https://www.briandrucker.com/) | 暗背景中，稠密丝束和外围散点形成不同深度，冷暖光集中在不同区域。作者将它描述为 Cadillac 装置的视觉均衡器实验。A 取中密外疏和点状光的明暗层次，B 取主线周围的稀疏副层。 |
| [Ashley Kim · Morph](https://www.yjashleykim.com/works/morph/) | 作品图中细线随曲面折返，亮面像丝绸一样翻转，层与层之间保留黑色缝隙。B 转译为相位错开的三层弧线，边缘逐渐变薄，重叠交接时维持相位。 |
| [Rich & Miyu · The Chemical Brothers — Live Again](https://richandmiyu.com/projects/chemical-brothers---live-again) | 多股蓝色细轨在转弯时束紧又散开，交叉点叠出更亮的重音。作者用 TouchDesigner 模拟椋鸟群，使光丝随合成器声部向舞台中央涌动。C 提取长短亮暗不一的前导和余光，用反向斜穿和错拍发射形成节奏。 |
| [Notch · Corps en lumière](https://www.notch.one/madewithnotch/corps-en-lumiere) | 同一演出在多个段落维持色彩联系，通过场改变粒子运动。A 保持缓慢呼吸的背景角色，Demo 在冷色延续的基础上把暖光留给段落重音。 |
| [Derivative · TouchDesigner Particle SOP](https://docs.derivative.ca/Particle_SOP) | 从几何采样点发射是明确组织空间的手段。B 用固定网格坐标与可计算的切线，保证每列有中心采样位。 |
| [Epic · Niagara Ribbon](https://dev.epicgames.com/documentation/unreal-engine/how-to-create-a-ribbon-effect-in-niagara-for-unreal-engine) · [Niagara Beam](https://dev.epicgames.com/documentation/unreal-engine/how-to-create-a-beam-effect-in-niagara-for-unreal-engine) | Ribbon renderer 打通相邻采样点，Beam 用曲线控制空间轨迹。Bedrock 用局部方向一致、软端相接的 Billboard 接近这种轮廓。 |
| [fuse* · Dökk](https://www.fuseworks.it/artwork/dokk) | 视听演出围绕中心表演者展开，实时数据参与画面变化。Demo 沿用留出中心表演空间、再逐渐扩展到舞台深度的段落关系。 |
| [Bild Studios 与 Notch · teamLab Phenomena 开幕演出](https://www.notch.one/madewithnotch/teamlab-phenomena-grand-opening) | 围绕 Einaudi 的演奏，粒子波与环绕形态包住表演空间，并配合独立现场提示。用来设计 `orbit` 的低亮度椭圆、`wave` 的轮廓和预设中位置分工。 |
| [NorthHouse 与 Notch · FKJ 巡演](https://www.notch.one/madewithnotch/fkj-world-tour-22-24) | 舞台后方的窗面建立纵深，声音驱动背景颜色与时间变化。用于 `curtain` 的后景定位和长度变化，让表演者前方保持可读。 |
| [Rich & Miyu · Resonant Matter for Yamaha](https://richandmiyu.com/projects/resonant-matter-for-yamaha) · [Derivative · AudioAnalysis 与 ParticlesGPU](https://derivative.ca/community-post/tutorial/audioreactive-particlesgpu-touchdesigner-audioanalysis/72722) | Yamaha 装置把画面、空间音响与实体乐器编入同一个体验。TouchDesigner 案例展示分析信号与粒子状态之间的分工。PianoBE 将音域、活动度与持续音分开映射，背景、轨迹和光幕各用不同输入。 |
| [Epic · Niagara Sparks](https://dev.epicgames.com/documentation/en-us/unreal-engine/how-to-create-a-sparks-effect-in-niagara-for-unreal-engine) · [Epic · Niagara Shield FX](https://dev.epicgames.com/community/learning/tutorials/58Klb/unreal-engine-shield-fx-in-ue5-niagara-tutorial) | 火花喷发提供成束上抛再散开的轮廓，径向纹理让边缘先被读到。用于 `fountain` 的成对抛物线和 `ripple` 的低位定向扩散。 |

## A · 空间悬浮粒子场

- **空间和材质** · 淡蓝散点分布在琴与演奏位周围的椭圆环带，留出琴键和人体中间的空间。较小的漫射光粒充当背景，少数偏大的星芒提供亮度参照。每个点分布在真实三维坐标，侧向观察会改变前后遮挡。
- **出现到消失** · 客户端在各方向随机取样，约 32% 的样本静止，其余沿正负三轴缓漂并受阻尼。单点先淡入、轻微起伏，再逐渐消退，寿命 1.2–3.2 秒。通过重叠短发射窗口维持整体氛围。
- **Bedrock** · `emitter_rate_steady`、`emitter_lifetime_once`、`emitter_shape_custom`、三轴 `particle_initial_speed`、`particle_motion_dynamic`、`lookat_xyz`，用随机变量切换图集的柔光与星芒两格。
- **引擎边界** · 体积由多个发光平面构成，深度来自三维分布和透视。局部空间混合、近景遮挡及光晕仍取决于客户端的渲染设置。

## B · 流动曲面

- **空间和材质** · 主线是包围琴与演奏位的椭圆。内外副线错开高度、半径和相位，保留更疏、更暗的层次。
- **出现到消失** · 默认主线 36 个采样，两条副线每隔三个采样点补一颗。高度由主正弦和二次谐波控制，默认 2.9 秒一周期，沿椭圆传播。目标波长量化到整数个周向周期，避免环的接缝出现高度跳变。分批出生的采样按整场时钟校准相位。
- **Bedrock** · `emitter_rate_instant` 为每个确定位置生成一个采样，随后 `particle_motion_parametric` 在客户端驱动高度。Billboard 使用 `rotate_xyz` 让圆形光芯在斜视时保持可见，`particle_appearance_tinting` 控制沿波峰的光度变化和整段淡入淡出。
- **引擎边界** · 每层由平面光点叠成，极端组合（低密度、极短波长、大跨度和高波幅）可能拉开采样之间的距离。相位按服务端发射刻推算，网络到包抖动可能扰动同帧对齐。
- **实机反馈后的调整** · 早期截图里的副层像两串发亮的大圆球。当前版限制了粒径，副层比主层更细，MER 发光系数为 0.23。环形轮廓的实机连续性待复核。

## C · 纹理光条与流光

- **空间和材质** · 暖白主芯、偏软的不对称尾晕、隐约的两侧细丝和逐渐收细的头尾。贴图沿长度分别控制芯、晕和截面，形成明确的头尾。反向流光放在不同高度和纵深。
- **出现到消失** · 默认从多个相位沿椭圆绕行，短而暗的延迟段跟随主段。流光从低亮度进入，绕经琴与演奏位外侧，离开前收束并淡出。集中爆发从多个相位展开。单条直线可以通过 `lanes:1`、`segments:1`、`bend:0` 配置。
- **Bedrock** · `emitter_rate_instant` 与 `particle_motion_parametric` 驱动三维位置，`direction_x` 使用路径导数作为切线，`particle_appearance_billboard` 取独立的 256 × 48 纹理单元。颜色和淡入淡出由 `particle_appearance_tinting` 控制。
- **引擎边界** · 角度极接近边缘时，平面可能变细。拖尾是沿同一路径传播的线段采样，连续性受各段长度、速度与偏移影响。柔光来自透明纹理和加法合成，场景照明依赖世界原有灯光。

## D–G · 后景、径向与弹道

| Effect | 构图、运动与退场 | Bedrock 路径与观察点 |
| --- | --- | --- |
| `ripple` 低位波纹 | 两道细刻纹围成浅色圆环。音符或和弦触发后由小向外扩散并消隐，强和弦最多三层，内外层的高度、半径和寿命各异。 | XZ 固定平面，按年龄放大 Billboard。轮廓在一张原创纹理内闭合；低侧角会变薄，地面和琴腿可遮挡。 |
| `fountain` 火花喷泉 | 琴后左右两束，偏暖的菱形芯上抛、向外打开，落下时淡出。密集段提高发射密度和初速度，安静时回落。 | Custom shape 配合三轴初速、阻尼和向下加速度，客户端完成全部弹道。速度上限和短寿命控制范围。 |
| `curtain` 侧翼光幕 | 琴与演奏位左右的竖直细丝错开相位，轻摆向下滑。以薄而低对比的紫蓝围出两侧，长度随密度改变。 | `lookat_y` 始终保持竖直，参数化位置驱动深度和高度，纹理内置细丝和柔边。多个平面提供幕的轮廓。 |
| `orbit` 倾斜环绕 | 稀疏星芒分布在倾斜椭圆上，约 2.5 秒寿命内沿同向转动，每批淡入淡出叠接。它提供包围感和留白，亮度低于旋律光带。 | 单发射器产生一组不同相位的粒子，通过正弦、余弦定义半径和倾斜。图集同时用于悬浮星芒，空间轨迹由独立公式控制。 |

## 合成与资源

Lab 效果共用一张原创 512 × 256 RGBA 图集。同尺寸的 MER 图集用绿通道标记自发光，光芯最强，半透明边缘逐渐变暗，透明区为零。Vibrant Visuals 通过粒子 Texture Set 读取发光图。波面及后景的发光低于光条，粒子时间包络和纹理透明度分别计算。Billboard 的 `size` 按半宽和半高设置。[Microsoft Particle Effects](https://learn.microsoft.com/en-us/minecraft/creator/documents/particleeffects?view=minecraft-bedrock-stable) · [Vibrant Visuals Texture Sets](https://learn.microsoft.com/en-us/minecraft/creator/documents/vibrantvisuals/vvresourcepacks?view=minecraft-bedrock-stable)

资料依据：[Microsoft 粒子介绍](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/particlesreference/particlesintroduction)、[组件文档](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/particlesreference/examples/particlecomponents/particle_effect?view=minecraft-bedrock-stable)、[Mojang 粒子组件和变量说明](https://mojang.github.io/bedrock-samples/Particles.html)、[Dimension.spawnParticle](https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/dimension?view=minecraft-bedrock-stable)。
