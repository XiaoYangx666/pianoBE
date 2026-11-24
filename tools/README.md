# tools 工具目录

按职责分组的命令行工具。所有脚本从**仓库根目录**运行（`npm run ...` 或 `node tools/<分组>/<脚本>`）。
脚本用 `import.meta.url` / `__file__` 锚定仓库根，移动脚本时需同步更新锚点层级与下方命令。

## `midi/` — 曲库管理

| 脚本 | 用途 | npm 入口 |
|---|---|---|
| `add-song.mjs` | 增量添加/更新曲目（内容 CRC32 去重，贡献者主入口） | `npm run add-song -- <文件或目录>` |
| `convert.js` | 全量重建 `midis/js` + `midis/library`（需完整源文件） | `npm run convert` |
| `show-song.mjs` | 按关键词查曲目信息 | `npm run show-song -- <关键词>` |
| `import-midis.mjs` | 批量上传到 BDS 后端曲库 | `npm run import:midis` |
| `bench-pbe3.mjs` | PBE3 体积 / SongCache 性能基准 | `npm run bench:pbe3` |

## `model/` — 模型与资源生成

从 Blockbench 模型生成钢琴方块的几何、贴图、碰撞、曲谱资源。`model-grand.py` / `model-piano-bench.py` / `publish-grand.py` 依赖同目录的 `model-upright.py`（`with_name` 载入），**必须保持同目录**。

| 脚本 | 用途 |
|---|---|
| `model-grand.py` | 构建三角钢琴模型并切块 |
| `model-upright.py` | 构建立式钢琴并切块（被上面几个复用） |
| `model-piano.py` | 构建电钢琴（FP-30X 风格）并导出 Bedrock 资源 |
| `model-piano-bench.py` | 生成三角琴凳方块几何与材质 |
| `publish-grand.py` | 发布三角钢琴的可用资源 |
| `grand-item-icon.py` | 从模型渲染三角钢琴物品图标 |
| `grand_score.py` | 发布本地测试曲谱页与空白谱架图集 |
| `preview-piano-midi-performer.py` | 演奏姿态预览图（模型单位对照） |

## `audio/` — 音色与音频实验

| 脚本 | 用途 | npm 入口 |
|---|---|---|
| `build-piano-timbres.mjs` | 从源采样构建各音色包（addon + web） | `npm run build:timbres` |
| `build-audio-lab-assets.mjs` | 生成 Audio Lab 试听素材 | `npm run audio-lab:assets` |
| `audio-lab-render.mjs` | 渲染音色对比音频 | `npm run audio-lab:render` |
| `audio-lab-analyze.py` | Audio Lab 客观分析 + 报告 | `npm run audio-lab:report` |
| `loudness_check.py` | 响度校准验证 + A/B 试听生成 | — |
| `analyze-voice-load.mjs` | 离线声部负载模拟 | `npm run analyze:voices` |

## `verify/` — 构建与端到端验证

| 脚本 | 用途 | npm 入口 |
|---|---|---|
| `verify-addon-build.mjs` | 校验 client/server 构建产物与 MIDI 路径 | `npm run verify:addon-build` |
| `verify-timbres.mjs` | 校验音色包结构 | `npm run verify:timbres` |
| `verify-generator.mjs` | 生成器端到端验证（bun） | — |

## `vendor/` — 私有依赖打包

| 脚本 | 用途 | npm 入口 |
|---|---|---|
| `pack-tabletop.mjs` | 打包私有 `@begame/tabletop` | `npm run vendor:tabletop` |
| `sync-sapipro.mjs` | 构建/打包本地 SAPI-Pro | `npm run vendor:sapipro` |

## `build/` — 构建辅助

| 脚本 | 用途 |
|---|---|
| `strip-template-timbres.mjs` | 从模板包裁剪可选音色（`build:template` 调用） |

## 数据目录与报告

- `piano_source/` — Salamander 明亮三角的 30 个原始母带采样（商业音源，gitignore；删后无法重建该音色）
- `piano_timbres_source/` — 各音色下载/渲染缓存 + `calibration.json`（gitignore；删后无法重建音色/响度校准）
- `*-report.md`、`loudness-verification.md` — 分析结论文档（保留在此，被 README 引用）

> Audio Lab 的 VCSL 原始 WAV 缓存（`audio_lab_source/`）属临时数据，构建产物已在 `packages/web/public/lab/vcsl/`（入库），缓存可随时删除并由 `audio-lab:assets` 重新下载。
