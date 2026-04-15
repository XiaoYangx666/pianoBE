# PianoBE

[![Requires](https://img.shields.io/badge/基于-SAPI_Pro_v0.4.0_beta-blue?style=flat-square)](https://github.com/XiaoYangx666/SAPI-Pro) ![Requires](https://img.shields.io/badge/依赖-SAPI%202.6.0%20Beta-red?style=flat-square) ![Support](https://img.shields.io/badge/支持版本-MCBE%2026.10+-green?style=flat-square) [![QQ群](https://img.shields.io/badge/QQ群-1004513100-orange?style=flat-square)](https://qm.qq.com/q/KUgqkHM5uS)

![painoBE](./screenshot.png)

> [👉 B站演示视频](https://www.bilibili.com/video/BV1jLD9BzE5D)

基岩版电子钢琴模组，基于最新 DDUI 表单开发，支持实时弹奏与 MIDI 文件播放。

🔗 **在线生成 Addon**：[pianobe.2408807389.workers.dev](https://pianobe.2408807389.workers.dev)

---

## 主要特性

- 🎹 **实时钢琴弹奏**  
  将文本输入映射为琴键，支持两种键盘映射（含黑键/不含黑键）和两种输入模式：
    - **连音模式**（2 tick 窗口内识别多键，适合电脑多指和弦）
    - **单音模式**（每 tick 读取末字符，低延迟，适合手机快速单音）

- 🎵 **MIDI 文件播放**  
  支持导入 `.mid` 文件，内置播放队列和全局调度器，实现多钢琴独立播放、UI 同步、区块卸载自动停止。

- 🧩 **DDUI 内存优化**  
  针对 DDUI 内存泄露问题，内置 `DDUI Manager`，每个玩家/表单只创建一次实例，避免重复创建导致内存堆积。

---

## 🚀 快速开始

1. **生成 Addon**  
   访问 [在线生成工具](https://pianobe.2408807389.workers.dev)，上传 MIDI 文件使用模板生成 `.mcaddon`。

2. **安装至世界**  
   将生成的 Addon 导入 Minecraft 基岩版，确保开启“测试版 API”。

3. **放置钢琴方块**  
   在游戏内获取钢琴，放置后点击打开 DDUI 控制面板。

4. **开始演奏或播放 MIDI**
    - 弹奏模式：在文本框输入 `q w e r t y` 等对应琴键
    - MIDI 模式：通过前端生成的 Addon 已内嵌 MIDI 数据，在 UI 中选择播放

---

## 🔧 技术细节

### 音源处理

- 采样源：[Salamander Grand Piano V3](https://archive.org/details/SalamanderGrandPianoV3)（CC-BY，作者 Alexander Holm）
- 原始音源缺少部分音高，通过改变 `pitch` 实现不同音高
- 三种预置音效时长：
    - `piano_short` – 0.5s（用于 ≤1s 的 MIDI 音符）
    - `piano` – 2s（用于 1~4s 的 MIDI 音符）
    - `piano_long` – 4s（用于 >4s 的 MIDI 音符及弹奏模式）

### MIDI 播放机制

- 前端使用 [`@tonejs/midi`](https://github.com/Tonejs/Midi) 将 `.mid` 转为 JSON，并打包为 JS 模块
- 脚本侧：
    - `player` 实例：每个钢琴方块独立，管理当前播放序列
    - `manager` 全局调度：每 tick 驱动所有活跃 `player`，超出数量上限时清理非活跃实例
    - 区块卸载时自动停止播放，方块被破坏时删除 `player` 实例
    - DDUI 表单通过订阅 `player` 的 `signal` 实时同步播放进度
- MIDI 数据优化：转换后的 js 仅保留 `tracks` 与 `notes` 信息，移除冗余字段；音符数据以 `Float32Array` 存储，显著减少内存占用。模块通过 `import()` 函数动态引入，仅在播放时加载，避免常驻内存。

---

## ⚠️ 已知问题

### DDUI 内存泄露

当前 Minecraft 基岩版 DDUI 表单一经创建不会被垃圾回收。  
本 Addon 通过 **DDUI Manager** 减轻了此问题——每个玩家每种表单全局仅创建一次，复用实例，从而避免长期游玩导致内存持续增长。
