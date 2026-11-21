# VFX 系统总览

PianoBE 的舞台视觉系统围绕**一套统一的特效定义、一套编排引擎与一张单一粒子图集**运作，同时服务于基岩版游戏内舞台（主题与曲目演出）、弹奏粒子覆盖、开发者调试指令，以及 Web 端实时预览实验室（`/vfx-lab`）。

## 1. 核心能力

- **33 种内置特效 (`VFX_EFFECTS`)**：覆盖氛围环境（`atmosphere`）、三维曲线（`curve`）、舞台建筑（`stage`）、琴键联动（`keys`）、瞬时强调（`accent`）与状态控制（`control`，如 `key_style`）。
- **7 套内置舞台主题 (`VFX_THEMES`)**：`galaxy`、`neon`、`stage`、`sakura`、`starlight`、`cathedral`、`carnival`，全部使用统一的图层组合与音乐特征映射数据模型。
- **曲目级演出编排 (`PBE3 v3`)**：通过紧凑的曲目内部符号表 + 颜色表随 `.pbe3` 曲目分发（如 `e1563b03` 《Secret》、`c8159589` 《Secret Base》、`b0cae095` 《Sparkle》），无需新增专用播放器代码或修改运行时代码。
- **统一图集与画笔 (`vfxAtlas.json`)**：1024×1024 单张粒子图集 + Vibrant Visuals MER 贴图，统一管理 9 种点状画笔与 4 种线条笔刷。普通弹奏粒子也复用 `pbe:vfx_draw_point`，样式只在 `keyParticles.ts` 的单一注册表里声明。
- **Web VFX Lab (`/vfx-lab`)**：直接在浏览器中复用 `@piano/vfx` 引擎、特效定义、音乐特征采样、预算限制与 `.particle.json` 资源，不再维护独立的预览/回放实现。

## 2. 常用命令

```sh
# 校对或重新生成琴键坐标、粒子图集、MER 与所有 pbe_vfx_*.particle.json
npm run assets:vfx
node tools/assets/build-vfx-lab.mjs --check

# 把 VFX 粒子与纹理同步进 Addon 资源包（Addon 构建会自动执行）
npm run sync:vfx-assets

# 导出三首演示曲目的 PBE3 v3 演出区块
npm run export:performance

# 本地测试与构建检查
npm run build:core
npm run build:vfx
npm run test
npm run test -w @piano/addon
npm run build:web
npm run verify:addon-build
```

进一步阅读：
- 架构设计与模块职责：[architecture.md](./architecture.md)
- 新增特效、画笔、主题与曲目编排指南：[authoring.md](./authoring.md)
- PBE3 二进制与演出区块格式：[../pbe3-format.md](../pbe3-format.md)
