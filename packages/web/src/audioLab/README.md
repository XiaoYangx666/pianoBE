# Audio Lab（实验页面）

`/lab` 是 PianoBE Web 里的独立实验页，用于验证钢琴还原度与 MIDI 播放精度。
它**不修改**正式播放器、游戏包或正式音色资源，所有实验逻辑都局限在本目录。

## 能做什么

- 加载内置音型、服务端曲目或本地 `.mid`，截取任意片段。
- 对比力度：单层 + 音量 / 2 层 / 3 层真实采样。
- 对比调度：原始精确时间、50ms 向上取整（游戏现状）、最近 tick、提前 1 tick。
- 对比释放：现有 0.5/2/4s 三档、Note Off + 80/120/350ms、忽略 Note Off。
- A/B 两套方案共用曲目、片段和输出增益；支持 A→B 连播、响度匹配、WAV 导出。
- 显示触发误差、间隔改变、同 tick 压缩、力度分布、层使用率、声部数与尾音比。

## 音源

- **FluidR3**：复用 `packages/web/public/piano` 的正式三档采样。
- **VCSL 多层**：`packages/web/public/lab/vcsl`，由 `tools/audio/build-audio-lab-assets.mjs`
  从 VCSL Steinway B 的 vl2/vl3/vl4 生成（30 键 × 3 层 × 4s，OGG 约 5 MB）。
  每层先对齐响度，再套同一条力度→响度曲线，避免切换层时出现响度台阶。

## 代码结构

| 文件 | 作用 |
|---|---|
| `AudioLabPage.tsx` | 页面、A/B 槽、预设、导出与响度匹配 |
| `labEngine.ts` | WebAudio 实时引擎 + OfflineAudioContext 导出 |
| `labAssets.ts` | 音源定义、清单加载、实验配置类型 |
| `labData.ts` | 内置音型与片段切片 |
| `labMetrics.tsx` | 调度/力度/释放指标与小型图表 |
| `LabTimeline.tsx` | 钢琴卷帘：原始位置 vs 实际触发点 |

纯逻辑（量化、选层、释放、统计）在 `@piano/core/audioLab`，浏览器和 Node 离线分析共用，
避免实验页与报告使用两套规则。

## 运行

```bash
npm run build:core
# 需要 tools/piano_timbres_source/calibration.json（由 tools/audio/build-piano-timbres.mjs 生成）
node tools/audio/build-audio-lab-assets.mjs
node tools/audio/audio-lab-render.mjs
python tools/audio/audio-lab-analyze.py
npm run dev:web
```

打开 `http://localhost:5173/lab`。实验结论见 `tools/audio-lab-report.md`，
A/B 试听文件在 `build/audio-lab/`（已 gitignore）。
