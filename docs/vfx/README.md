# VFX 系统总览

PianoBE 的舞台视觉系统围绕**一套共享的插件宿主与渲染原语 (`@piano/vfx`)、一套编排引擎与一张单一粒子图集**运作，同时服务于基岩版游戏内舞台（主题与曲目演出）、弹奏粒子覆盖、开发者调试指令，以及 Web 端实时预览实验室（`/vfx-lab`）与生成器（按需打包内置/第三方 `.pbeplugin`）。

## 1. 核心能力

- **内置 VFX 插件包 (`plugins/*`)**：默认包含 6 个内置插件（`pianobe.atmosphere`、`pianobe.curves`、`pianobe.stage`、`pianobe.keys`、`pianobe.accents`、`pianobe.themes`），通过统一 `VfxRegistry` 注册 **38 种特效**、**7 套舞台主题**（`galaxy`、`neon`、`stage`、`sakura`、`starlight`、`cathedral`、`carnival`）、**8 套舞台锚点布局**与 **7 种弹奏粒子样式**。宿主同时支持零插件模式与第三方 `.pbeplugin` 扩展。
- **曲目级演出编排 (`PBE3 v3`)**：通过紧凑的曲目内部符号表 + 颜色表随 `.pbe3` 曲目分发（如 `e1563b03` 《Secret》、`c8159589` 《Secret Base》、`b0cae095` 《Sparkle》、`ff9c1534` 《打上花火》），无需新增专用播放器代码或修改运行时代码。
- **统一图集与画笔 (`vfxAtlas.json`)**：1024×1024 单张粒子图集 + Vibrant Visuals MER 贴图，统一管理 9 种点状画笔与 4 种线条笔刷。宿主提供 17 个公共绘制粒子文档，而 `pianobe.keys` 插件自带 4 个专属琴键粒子文档（`pbe:vfx_key_stream`、`pbe:vfx_key_drift` 与使用 `piano_fx` 贴图的 `pbe:vfx_magic_trail` / `pbe:vfx_key_blue_tears`）。每种样式自带自由、限定或固定配色策略。
- **Web VFX Lab (`/vfx-lab`)**：直接在浏览器中复用 `@piano/vfx` 引擎、插件注册表、音乐特征采样、预算限制与 `.particle.json` 资源，并支持实时勾选/屏蔽不同插件组合进行预览与零插件验证。

## 2. 常用命令

```sh
# 校对或重新生成琴键坐标、粒子图集、MER 与所有 pbe_vfx_*.particle.json
npm run assets:vfx
node tools/assets/build-vfx-lab.mjs --check

# 把 VFX 粒子与纹理同步进 Addon 资源包（Addon 构建会自动执行）
npm run sync:vfx-assets

# 导出演出曲目的 PBE3 v3 演出区块
npm run export:performance

# 构建与打包校验内置 .pbeplugin 插件包
npm run build:plugins
npm run pack:plugins
npm run validate:plugins

# 一键验证 VFX / 插件全链路或完整仓库校验流水线
npm run check:vfx
npm run check
```

进一步阅读：
- 架构设计与模块职责：[architecture.md](./architecture.md)
- 新增特效、画笔、主题与曲目编排指南：[authoring.md](./authoring.md)
- PBE3 二进制与演出区块格式：[../pbe3-format.md](../pbe3-format.md)
