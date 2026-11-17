# PianoBE VFX Lab 视觉研究与设计

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

## A · 空间悬浮粒子场

- **空间和材质** · 蓝灰色散点覆盖琴周围约 5.8 × 2.15 × 4.2 格的体积，横向中密外疏。较小的漫射光粒充当背景，少数偏大的星芒提供亮度参照。每个点分布在真实三维坐标，侧向观察会改变前后遮挡。
- **出现到消失** · 客户端在各方向随机取样，约 32% 的样本静止，其余沿正负三轴缓漂并受阻尼。单点先淡入、轻微起伏，再逐渐消退，寿命 1.2–3.2 秒。通过重叠短发射窗口维持整体氛围。
- **Bedrock** · `emitter_rate_steady`、`emitter_lifetime_once`、`emitter_shape_custom`、三轴 `particle_initial_speed`、`particle_motion_dynamic`、`lookat_xyz`，用随机变量切换图集的柔光与星芒两格。
- **引擎边界** · 体积由多个发光平面构成，深度来自三维分布和透视。局部空间混合、近景遮挡及光晕仍取决于客户端的渲染设置。

## B · 流动曲面

- **空间和材质** · 琴后方横向展开约 5.5 格。中心丝线最完整、最亮，前后两层错开高度、纵深和相位，内侧较宽，末端垂下亮度并消隐。图集中用窄芯叠加细薄的宽晕作为丝线截面。
- **出现到消失** · 默认每条中心线 21 列。每列的高度是主正弦加较弱的二次谐波。主波默认 2.9 秒一周期、波长 5.5 格，沿琴的局部正 X 传播。每个光段沿曲线切线摆放，宽度按采样间距与斜率调整，软端互相覆盖。发射按列铺开，分批出生的采样按整场时钟校准相位，接续段沿用该相位。
- **Bedrock** · `emitter_rate_instant` 为每个确定位置生成一个段，随后 `particle_motion_parametric` 在客户端驱动高度。Billboard 使用 `direction_x` 和 `custom_direction` 对齐局部切线，`particle_appearance_tinting` 控制沿波峰的光度变化和整段淡入淡出。
- **引擎边界** · 每层是交叠的平面小段。极端组合（低密度、极短波长、大跨度和高波幅）以及接近侧缘或正上方的机位可能看见间隙或变薄。相位按服务端发射刻推算，网络到包抖动可能扰动同帧对齐。

## C · 纹理光条与流光

- **空间和材质** · 暖白主芯、偏软的不对称尾晕、隐约的两侧细丝和逐渐收细的头尾。贴图沿长度分别控制芯、晕和截面，形成明确的头尾。反向流光放在不同高度和纵深。
- **出现到消失** · 各轨道在弯曲路径上前进，短而暗的延迟段跟随主段。流光从低亮度进入，在场地中部达到可见长度，离开前收束并淡出。集中爆发向多个角度展开。单条直线可以通过 `lanes:1`、`segments:1`、`bend:0` 配置。
- **Bedrock** · `emitter_rate_instant` 与 `particle_motion_parametric` 驱动三维位置，`direction_x` 使用路径导数作为切线，`particle_appearance_billboard` 取独立的 256 × 48 纹理单元。颜色和淡入淡出由 `particle_appearance_tinting` 控制。
- **引擎边界** · 角度极接近边缘时，平面可能变细。拖尾是沿同一路径传播的线段采样，连续性受各段长度、速度与偏移影响。柔光来自透明纹理和加法合成，场景照明依赖世界原有灯光。

## 合成与资源

三种效果共用一张原创 256 × 128 RGBA 图集。生成器独立绘制两格点光、丝线截面和光束渐变，并预留透明边。透明度沿粒子时间和纹理空间分别计算。评估的备选组件包括 `emitter_shape_box` 的均匀体积、`emitter_shape_disc` 的盘面采样、`uv.flipbook` 的逐帧换图和 `particle_appearance_lighting` 的世界光照采样。当前选择自定义发射位置、静态图集区域和 Molang 时间包络，使造型和材质变化来自明确的空间及时间参数。Billboard 的 `size` 按半宽和半高设置。[Microsoft Particle Effects](https://learn.microsoft.com/en-us/minecraft/creator/documents/particleeffects?view=minecraft-bedrock-stable)

资料依据：[Microsoft 粒子介绍](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/particlesreference/particlesintroduction)、[组件文档](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/particlesreference/examples/particlecomponents/particle_effect?view=minecraft-bedrock-stable)、[Mojang 粒子组件和变量说明](https://mojang.github.io/bedrock-samples/Particles.html)、[Dimension.spawnParticle](https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/dimension?view=minecraft-bedrock-stable)。
