# PianoBE 开发与贡献

## 环境与首次安装

- Node.js 22 或更新版本、npm，以及支持 `bun check` 的 Bun（已验证 Bun 1.4.5）。
- 从仓库根目录运行 `npm install`。Addon 使用 npm 上的 [独立 Minecraft 适配层](https://www.npmjs.com/package/@begame/minecraft)，版本由依赖清单和锁文件固定。
- Docker 用于构建后端镜像和运行容器。开发命令默认从仓库根目录执行。

## 日常测试

| 用途 | 命令 |
|---|---|
| 类型检查 | `npm run typecheck` |
| 所有源码测试 | `npm test` |
| 类型检查与源码测试 | `npm run check` |
| VFX 专项验证 | `npm run check:vfx` |
| 单个 Addon 测试文件 | `npm run test:addon -- tests/pianoPanel.test.ts` |

`test:core`、`test:vfx`、`test:assembly`、`test:server` 和 `test:studio` 可单独运行。Server 的两项集成测试会连接它们自行启动的本机 HTTP 服务。依赖真实底包的装配和 BDS 部署测试由 `verify:release` 执行。

## 构建与发布

| 用途 | 命令或产物 |
|---|---|
| 构建开发附加包 | `npm run build`，产物为 `packages/addon/dist/dev.mcaddon` |
| 更新本机 Minecraft 开发包 | `npm run deploy:dev`，可设置 `MC_DEV_DIR` 指定游戏目录 |
| 生成客户端模板或 BDS 底包 | `npm run build:template` 或 `npm run build:server` |
| 更新官方插件、曲库及音色归档 | `npm run pack:plugins`，产物在 `build/plugins/` |
| 生成发布产物 | `npm run build:release`，依次准备共享库、Addon 和插件，再构建 Studio |
| 验证现有发布产物 | `npm run verify:release` |
| 运行发布全流程 | `npm run check:full`，依次执行 `check`、`build:release`、`verify:release` |
| 构建单文件后端或其镜像 | `npm run build:server:exe` 或 `npm run docker:single`，见[后端文档](../packages/server/README.md#单文件发行版) |

开发包会优先复用 `build/plugins/` 下的插件归档。修改插件、官方曲库或音色后，用 `npm run pack:plugins` 更新归档，再打包或部署开发包。

## 本机开发

- **Addon**　`npm run dev` 启动 BePack 热重载。
- **Studio**　首次运行 `npm run build:release` 准备网页所需的共享库、底包和插件，然后用 `npm run dev:studio`。已有素材时可直接启动，修改共享库后用对应的 `build:core`、`build:vfx` 或 `build:assembly` 更新。
- **VFX Lab**　先运行 `npm run build:core`，再运行 `npm run dev:web`。静态构建使用 `npm run build:web`。
- **后端**　按[源码启动说明](../packages/server/README.md#快速开始本地源码运行)设置运行目录和管理页路径，然后用 `npm run dev:server` 热重载。

### Docker 开发环境

准备本地发布产物后启动容器：

```bash
npm run build:release
docker compose -f docker-compose.dev.yml up --build
```

容器挂载 Server、VFX、Assembly 源码以及本地 Studio 和插件产物。改动 Core 或 Studio 后分别运行 `npm run build:core` 或 `npm run build:studio`。开发与生产配置都使用宿主机端口 35050，切换前请先停止正在运行的配置。

## 音频转 MIDI

Studio 的 ONNX 模型来自 npm 包 `amt-cli`，构建时与 CQT 参数和 ONNX Runtime WASM 一起同步到 `packages/studio/public/amt/`。服务端运行时的模型和程序来源见[后端文档](../packages/server/README.md#环境变量)。分发模型或镜像时一并保留[第三方署名与许可](../THIRD_PARTY_NOTICES.md)。

## 架构

### 仓库结构（npm workspaces monorepo）

```
pianoBE/
├── packages/          # npm workspaces：共享库与各交付物
│   ├── core/          # 共享核心库 @piano/core（零 MC 依赖）
│   ├── vfx/           # 跨平台视觉库 @piano/vfx（琴型/琴键/舞台/特效/粒子资源，Addon 与 Web 共用）
│   ├── assembly/      # 统一装配器 @piano/assembly（插件依赖校验、BP/RP 装配）
│   ├── ui/            # 共享设计系统 @piano/ui：Tailwind 主题、基础组件、布局、播放器
│   ├── addon/         # 附加包 @piano/addon（零插件底包：template.mcaddon / server.mcaddon）
│   ├── studio/        # 统一工作台 @piano/studio（网页完整版 dist / 服务器精简版 dist-server）
│   ├── server/        # 后端 @piano/server：Hono + bun:sqlite + 外置目录服务
│   └── web/           # 开发期 VFX Lab 预览工具（Three.js + Wintersky）
├── plugins/           # 官方 VFX 扩展源码
├── midis/             # 曲库与官方精选演出资产
└── tools/             # 构建、插件打包、开发装配与验证脚本
```
（sapi-pro 使用 npm 发布版，不再 vendor 内置）

**依赖方向**：`addon`、`server`、`studio` → `core`；`addon`、`studio`、`web` → `vfx` → `core`；`studio`、`web` → `ui`；`studio:server` → `server` API；addon（BDS）→ `server`（server-net 拉取）。

**双构建说明**：`studio`（面向普通玩家，纯静态可部署 Cloudflare）与 `studio:server`（面向 BDS 服主，内嵌进单文件服务端，自动剔除浏览器 ONNX 与本地装配依赖）共用 UI 与状态层但产物彻底隔离；`addon` 的生产构建（`build:template` / `build:server`）始终输出零插件纯净底包，本地日常开发运行 `npm run build` 或 `npm run build:dev` 时会自动把全部本地插件与曲库装配进开发包。

### 两个 Addon 包（同一份源码，注入式条件编译）

| | 模板包（client） | 服务器专用包（server） |
|---|---|---|
| 产物 | `dist/template.mcaddon`（生成器底包） | `dist/server.mcaddon` |
| 构建 | `npm run build:template` | `npm run build:server` |
| 曲库 | 生成器内嵌 / 无 BDS 逻辑 | **纯远程**（server-net 从后端拉取 + 游戏内缓存） |
| 依赖 | 仅 server / server-ui | 另需 `@minecraft/server-net`、`@minecraft/server-admin` |
| 适用 | 客户端 / 普通世界 | BDS 专用服务器，搭配自托管后端 |

实现方式：`__PIANO_TARGET__` 由 bepack `compile.define` 注入字符串字面量，经 rolldown 常量折叠与死代码消除裁剪不可达分支（client 产物物理上不含 server 逻辑，已验证）。

### 技术要点

- 曲目 `id = crc32(.mid 内容)`，内容寻址；后端、内嵌曲库、生成器三端同一算法，天然对账
- 统一运行时格式 **PBE3**：40 tick/秒时间差分 + VarInt + 同时刻分组 + 力度调色板 + keyDuration + Raw DEFLATE，播放器用共享 `SongCache` + `Pbe3EventCursor` 增量读取（格式细节见 [`docs/pbe3-format.md`](pbe3-format.md)）
- 音频转 MIDI：服务端任务式转录（原音频 + MIDI 先预览，确认后入库），进度由 `amt-cli --events` 实时音符事件估算
- 调度：20 TPS 下采用“最近 tick”（提前半个游戏 tick 触发），把量化误差从整体拖后改成居中；子 tick 方案仍只做可行性记录
- 双端存储驱动：addon 使用世界动态属性（DPDataBase），后端使用 SQLite 保存元数据和曲目内容，共享同一套 core 端口与契约测试
- Audio Lab：纯逻辑保留在 `@piano/core/audioLab`，供离线分析脚本复用；管理页不再提供实验入口
- 声部上限：Bedrock 客户端同时最多混 32 个音效。运行时按 28 的钢琴预算主动回收实例（`SoundReleaseQueue`），导入时由 `@piano/core` 的 `estimateVoiceLoad` 预计算峰值并提示超限曲目；离线数据见 `tools/voice-load-report.md`

## 曲库维护

### 数据流

曲库目录 `midis/` 包含三类数据，入库规则不同：

| 目录 | 内容 | 版本控制 |
|---|---|---|
| `midis/files/` | 原始 `.mid` 源文件 | 不入库 |
| `packages/addon/bp/scripts/packages/addon/src/midis/` | 客户端构建直接从公共曲库生成的运行时模块 | 不入库 |
| `midis/library/` | PBE3 曲库 `<id>.pbe3` + `index.json` + 人工分类表 `genres.json` | **入库**（生成器数据源） |

原始 MIDI 不在仓库中，因此**新增曲目必须使用增量命令**（全量转换 `npm run midi -- convert` 会以本机 `midis/files` 为准重写曲库，仅适合持有完整源文件的本地维护）。例外是 `tools/verify/fixtures/` 下的两首固定样例，只用于生成器端到端验证。

### 添加歌曲

```bash
# 单首
npm run midi -- add-song <歌曲.mid>

# 批量（多个文件或整个目录）
npm run midi -- add-song ./目录A/ ./目录B/歌曲.mid

# 查看入库结果（按曲名关键词或 ID 搜索）
npm run midi -- show-song <关键词>
```

命令说明：

- **曲目归并**：曲目 ID 默认取 MIDI 的 CRC32。转换后的音乐内容相同则沿用已有曲目，同名不同音乐分别入库，ID 冲突时为新曲生成稳定的可用 ID。
- **增量入库**：`add-song` 只写入新曲的 `<id>.pbe3` 和索引。专属演出可单独导出，再在生成器中与原曲归并。
- **手动分类**：官方分发包的曲库归属以 `midis/library/genres.json` 为准（`歌曲 id -> 曲库 key`），新增曲目必须在这里补一行；打包脚本遇到未登记曲目会直接报错，避免再被关键词规则分错。
- **转换确定性**：同一文件重复转换结果一致；曲名取自文件名，无需了解二进制格式

### PBE3 与游戏内导入

- `PBE3` 是唯一运行时格式：头部含 id/名称/时长/音符数/解压长度/CRC32/力度调色板，事件流由 `@piano/core` 的 `Pbe3Codec` 编解码；完整格式见 [`docs/pbe3-format.md`](pbe3-format.md)。
- 转换阶段会把 MIDI CC64 延音踏板烘焙进 `soundDuration`（Note Off 后踏板仍按下则延长到抬起，单音最多再延长 4 秒，与采样长度一致），同时保留原始按键时长 `keyDuration` 供琴键显示；因此 PBE3 本身不需要携带控制器事件。
- addon 只解压一次并在 `SongCache` 中共享；每架钢琴持有独立 `Pbe3EventCursor`，跳转使用 5 秒稀疏索引。
- 在线生成器曲目条目上的「码」按钮可导出分段导入码；游戏内钢琴面板 →「导入 MIDI」逐段粘贴。
- 普通玩家导入权限由管理员命令 `/pbe:pbe_setting` 控制（默认关闭，管理员始终允许）。
- 基准：`npm run midi -- bench`。

### 全量重建（本地维护）

```bash
npm run midi -- convert           # 以 midis/files 全量重建曲库与 addon 模块
npm run midi -- convert --force  # 输入数量少于现有曲库时的保护需显式确认
```

全量转换在输入文件数少于现有曲库时拒绝执行（防止误清空），确认重建需追加 `--force`。

### 提交与提 PR

```bash
git add midis/library
git commit -m "曲库: 新增 <歌名>"
git push origin <分支>    # 提交 Pull Request
```

公共曲库和后端管理页通常使用 MIDI 内容的 CRC32 作为 ID。后端曲目可通过 `/api/songs/{id}/raw` 导出 MIDI，再经 `add-song` 收编入库。
