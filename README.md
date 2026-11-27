# PianoBE

[![Requires](https://img.shields.io/badge/基于-SAPI_Pro_v0.4.4-blue?style=flat-square)](https://github.com/XiaoYangx666/SAPI-Pro) ![Support](https://img.shields.io/badge/支持版本-MCBE%2026.50+-green?style=flat-square) [![QQ群](https://img.shields.io/badge/QQ群-1004513100-orange?style=flat-square)](https://qm.qq.com/q/KUgqkHM5uS)

![pianoBE](./screenshot.png)

> [B站演示视频](https://www.bilibili.com/video/BV1jLD9BzE5D)

基岩版电子钢琴模组：游戏内实时弹奏与 MIDI 播放，支持**内嵌曲库**与 **BDS 远程曲库（自托管后端）** 两种形态。

**在线生成 Addon**：[pianobe.2408807389.workers.dev](https://pianobe.2408807389.workers.dev)

---

## 简介

PianoBE 是一套面向基岩版的钢琴附加包解决方案，由以下部分组成：

| 部分 | 说明 |
|---|---|
| **附加包（addon）** | 游戏内钢琴方块：实时弹奏、MIDI 播放器、播放队列与多钢琴支持（源码与底包保持零插件） |
| **网页版工作台（studio）** | 面向普通玩家的静态应用：本地工作区将 `.mid`、曲库与 `.pbeplugin` 装配为 `.mcaddon`，内置浏览器端 ONNX 转录 |
| **自托管后端（server + studio:server）** | Hono + SQLite 单文件服务与精简管理页；外置 `plugins/` / `data/` / `logs/`，BDS 经 server-net 远程拉取曲目 |
| **音频转 MIDI（AMT）** | 玩家网页版内置浏览器端转录（多线程 WASM）；server 调用 Rust `amt-cli`（支持环境变量 / 管理页一键从 npm 下载 / `node_modules` / PATH） |
| **共享核心库（core / vfx / assembly）** | MIDI 转换/打包、曲库编解码、视觉特效与插件装配器等无游戏依赖领域逻辑 |

主要特性：

- **实时钢琴弹奏**：文本输入映射琴键，两种键盘映射（含/不含黑键）、连音/单音两种模式
- **MIDI 播放**：内嵌或远程曲库，播放队列（顺序/循环/单曲/随机）、多钢琴独立播放、UI 同步、区块卸载自动停止
- **DDUI 表单**：按需创建、关闭即释放；同一玩家同时只保留一个活动表单
- **自托管后端**：Hono + bun:sqlite + Docker；token 鉴权（Bootstrap 令牌 env 注入、分角色令牌）；React 管理页
- **曲目存储**：曲目内容与元数据一起存在 SQLite（`song_files` 表，mid/pbe3 BLOB），删库即删曲；不再读取旧版 `data/midis` 文件
- **无事务一致性**：存储端口单键原子写、派生索引、崩溃自愈（core 契约测试覆盖）
- **音频转 MIDI（AMT）**：生成器在浏览器本地运行转录模型；自托管后端调用 Rust `amt-cli`，并可直接解析 B 站视频音频

---

## 快速开始

### 1. 客户端 / 普通世界（模板包 + 在线生成器）

访问 [在线生成器](https://pianobe.2408807389.workers.dev)：

1. 从 **MIDI 曲库**（内置转换后的曲目，支持搜索与试听）选择曲目，或直接上传 `.mid` 文件
2. 设置包名与描述，导出 `.mcaddon`
3. 将包导入世界（需开启"测试版 API"），放置钢琴方块即可弹奏/播放内嵌曲目

试听音色直接取自模板底包内的真实钢琴采样，无需额外音效文件。默认的标准钢琴来自
FluidR3 GM，各音色的来源与授权见 `packages/addon/rp/THIRD_PARTY_NOTICES.md`。

### 2. BDS 服务器 + 自托管后端（远程曲库）

```bash
# 启动后端（Docker，根目录 compose；镜像内含 core/web 构建产物）
docker compose up -d
# 管理页 http://<host>:35050 登录 → 上传曲目、生成导入码、签发令牌
# （不设 BOOTSTRAP_TOKEN 时首次启动自动生成，写入容器 data/bootstrap-token.txt，
#   对应宿主机 ./packages/server/data/bootstrap-token.txt）

# 构建并直接部署到 BDS（本机后端直接写文件，不上传、不需要令牌）
npm run deploy:bds
# 已有产物时跳过构建：npm run deploy:bds -- --skip-build
# 部署到远端后端：npm run deploy:bds -- --url http://host:35050 --token <admin 令牌>

# BDS 配置（config/default/ 目录）
#   variables.json → { "pianoBackendUrl": "http://<后端>:35050" }
#   secrets.json   → { "pianoBackendToken": "Bearer <令牌>" }
```

后端默认按 MC Server 风格在运行目录（当前目录或 `--dir` / `PIANOBE_HOME`）下组织 `plugins/`、`data/`、`logs/`：把 `.pbeplugin` 直接放进 `plugins/`，在扩展中心点「刷新目录」即可识别并按需启用/信任；日志默认写入 `logs/server.log`（单文件 10 MB，轮转保留 7 个）。

管理页的「BDS 部署」默认把行为包/资源包写入 `development_behavior_packs` / `development_resource_packs`，切换目录时旧的同名包会归档到隐藏目录；manifest 的包名/描述也可以在页面自定义。本机开发时也可以一条命令跑完：`npm run deploy:bds`——直接调用后端代码写文件，不上传产物、不需要令牌（`--skip-build` 复用现有产物；`--url`/`--token` 用于部署到远端后端）。部署只写文件，重启 BDS 或重进世界后才加载新包。

只有服务器专用构建会在启动后动态 `import()` `serverAdmin`；该模块静态导入 `@minecraft/server-admin`（读配置）与 `@minecraft/server-net`（拉曲目），依赖由服务器包 manifest 声明。客户端构建会整体裁掉这个分支，继续使用内嵌曲库；服务器专用构建**不打包内嵌曲库**，配置不可用时没有任何曲目。详见 `packages/addon/README.md`。

---

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
- 统一运行时格式 **PBE3**：40 tick/秒时间差分 + VarInt + 同时刻分组 + 力度调色板 + keyDuration + Raw DEFLATE，播放器用共享 `SongCache` + `Pbe3EventCursor` 增量读取（格式细节见 [`docs/pbe3-format.md`](docs/pbe3-format.md)）
- 音频转 MIDI：服务端任务式转录（原音频 + MIDI 先预览，确认后入库），进度由 `amt-cli --events` 实时音符事件估算
- 调度：20 TPS 下采用“最近 tick”（提前半个游戏 tick 触发），把量化误差从整体拖后改成居中；子 tick 方案仍只做可行性记录
- 双端存储驱动：addon 使用世界动态属性（DPDataBase），后端使用 SQLite（meta）+ 文件（内容），共享同一套 core 端口与契约测试
- Audio Lab：纯逻辑保留在 `@piano/core/audioLab`，供离线分析脚本复用；管理页不再提供实验入口
- 声部上限：Bedrock 客户端同时最多混 32 个音效。运行时按 28 的钢琴预算主动回收实例（`SoundReleaseQueue`），导入时由 `@piano/core` 的 `estimateVoiceLoad` 预计算峰值并提示超限曲目；离线数据见 `tools/voice-load-report.md`

---

## 开发

### 环境要求

- Node.js ≥ 22（core / generator / web）
- Bun（server 运行与测试）
- Docker（后端部署与开发模式）
- Tabletop（私有依赖）：构建 addon 需要 `vendor/begame-tabletop-0.1.16.tgz`，它不随本仓库公开；拿到私有 `tabletop` 检出后执行 `npm run vendor:tabletop` 生成，详见 `vendor/README.md`

### 构建与测试

```bash
npm install

# 构建共享库与各交付物
npm run build:core          # @piano/core
npm run build:vfx           # @piano/vfx（addon/studio/web 的前置）
npm run build:assembly      # @piano/assembly（装配器）
npm run build:template      # addon 零插件客户端底包（packages/addon/dist/template.mcaddon）
npm run build:server        # addon 零插件服务器底包（packages/addon/dist/server.mcaddon）
npm run build:dev           # 开发包（基于 template.mcaddon 自动装入全部本地插件与曲库 -> dist/dev.mcaddon）
npm run build               # 一键装配满血开发包并复制到本地 Minecraft 开发目录
npm run build:server:exe    # 单文件服务端（仅含后端 + 精简管理页 + 零插件 server.mcaddon）
npm run build:web           # VFX Lab 开发预览工具
npm run docker:single       # 编译单文件二进制并构建 Docker 镜像

# Studio 两种构建（玩家网页版 / 服务器管理版）
npm run build:studio        # dist/：面向普通玩家（零插件底包、官方插件、浏览器转录 AMT）
npm run build:studio:server # dist-server/：精简服务器管理版（剔除本地工作区、ONNX 与前端装配依赖）

# 测试
npm test                    # core + vfx + assembly
npm run test:server         # server bun test
npm run test -w @piano/addon  # addon 单元测试

# 运行
npm run dev                 # addon 热重载开发
bun --filter @piano/studio dev  # Studio 开发模式

# 本机直接跑后端（非 Docker）
cp .env.example packages/server/.env   # 按需改端口 / 令牌 / PLUGIN_REGISTRY_URL
npm run build:core && npm run build:vfx && npm run build:assembly && npm run build:studio:server
npm run start:server                   # http://127.0.0.1:3000，目录为 plugins/ data/ logs/
```

### 音频转 MIDI（AMT）资源

服务端转录依赖 [Automated-Music-Transcription](https://github.com/gityag/Automated-Music-Transcription) 的运行时，现已发布为 npm 包 [`amt-cli`](https://www.npmjs.com/package/amt-cli)（当前固定 `0.1.1`）：主包（启动器 + int8 模型）通过 `optionalDependencies` 按平台拉取 `@xiaoyangx666/amt-cli-{linux,win32}-x64`，只下载当前平台的二进制与 ONNX Runtime（解压后约 40 MB）。`@piano/server` 直接声明该依赖，`npm install` 后即可用，不需要再单独同步：

```bash
npm install            # 安装 workspace 依赖（含 amt-cli）
npm run build:core
npm run start:server
```

后端按 `process.platform-process.arch` 自动选择包内二进制（`linux-x64` / `win32-x64`）与 `models/run4_int8.onnx`；npm tarball 不保留普通文件的执行位，首次解析时会自动补 `chmod +x`。也可用 `AMT_CLI` / `AMT_MODEL` 覆盖（例如指向本地 cargo 构建的二进制）。Docker 镜像构建时由 `bun install --production` 自动下载，无需预置任何文件。

浏览器端转录与服务端同源：直接使用 `amt-cli` 包内的 `run4_int8.onnx`，CQT 参数取自仓库内的 `assets/amt/cqt_meta.json`，不再依赖外部 AMT 仓库或 `AMT_DIR`。`npm run build:studio` 会在 `packages/studio/public/amt/` 下准备好模型、`cqt_meta.json` 与 ONNX Runtime WASM；缺少模型时构建直接失败，不会静默产出没有转录能力的页面。

> 模型权重来自 gityag/AMT，为 **CC BY-NC 4.0，仅限非商业使用**。随 release 或镜像
> 分发模型时，请一并提供 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) 中的署名
> 与许可链接。

### Cloudflare 生成器播放统计

生成器的网页、`library/index.json` 与 `library/{id}.pbe3` 仍由 **Workers Static Assets** 托管；
D1 只保存可变的播放量与防刷状态，不引入传统后端，也不改变现有加歌/构建流程。

首次启用统计需要在 `packages/generator` 下执行一次：

```bash
cd packages/generator

# 已创建 D1：先查数据库名与 UUID
npx wrangler d1 list

# 将下面三项写入 packages/generator/wrangler.toml：
# [[d1_databases]]
# binding = "DB"
# database_name = "<你的数据库名>"
# database_id = "<你的数据库 UUID>"

# 应用全部 migration（包含试听量与添加量）
npx wrangler d1 migrations apply <你的数据库名> --remote

# 用于 HMAC-SHA256(IP)，只保存在 Cloudflare Secret 中
npx wrangler secret put IP_HASH_SECRET

npm run build
npx wrangler deploy
```

统计规则：

- 只在试听播放器**成功开始播放后**上报，不把加载失败/误点算播放。
- 试听量（PLAYS）与添加量（ADDS）独立统计；添加量只在歌曲成功加入当前列表后上报。
- 同一 Cloudflare 访客 IP + 同一首歌 + 同一行为，15 分钟内只计 1 次。
- D1 只保存 HMAC 后的访客摘要，不保存明文 IP。
- 每个“歌曲 + 访客 + 行为”最多一条去重记录，不会按 15 分钟时间桶无限增长。
- `/api/stats` 一次返回全部试听量和添加量；曲库默认按 ADDS 降序、PLAYS 次序排列。
- D1/API 未配置或暂时故障时，曲库、试听和 addon 生成仍可正常工作；播放量显示回退为 0。

### Docker 开发模式（热重载）

```bash
# 前置：本地构建 core/web 产物（dev compose 直接挂载本地文件）
npm run build:core && npm run build:vfx && npm run build:web

# 启动开发容器：挂载本地 server 源码与 core/web 产物，bun --watch 热重载
docker compose -f docker-compose.dev.yml up
```

> 生产与开发均映射端口 35050，二者不可同时运行（切换前先 `docker compose down`）。

---

## 曲库与贡献

### 数据流

曲库目录 `midis/` 包含三类数据，入库规则不同：

| 目录 | 内容 | 版本控制 |
|---|---|---|
| `midis/files/` | 原始 `.mid` 源文件 | 不入库 |
| `packages/addon/bp/scripts/packages/addon/src/midis/` | 客户端构建直接从公共曲库生成的运行时模块 | 不入库 |
| `midis/library/` | PBE3 曲库 `<id>.pbe3` + `index.json` + 人工分类表 `genres.json` | **入库**（生成器数据源） |

原始 MIDI 不在仓库中，因此**新增曲目必须使用增量命令**（全量转换 `npm run midi -- convert` 会以本机 `midis/files` 为准重写曲库，仅适合持有完整源文件的本地维护）。

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

- `PBE3` 是唯一运行时格式：头部含 id/名称/时长/音符数/解压长度/CRC32/力度调色板，事件流由 `@piano/core` 的 `Pbe3Codec` 编解码；完整格式见 [`docs/pbe3-format.md`](docs/pbe3-format.md)。
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

---

## 分支

架构重构工作在 `refactor/monorepo-arch` 分支：五大阶段（core 抽取 → addon 接入 → 后端+管理页 → 生成器重构 → server-net 联调）+ 双目标构建。

## 许可证

- **除 addon 外的代码**（`core` / `generator` / `server` / `web` / `ui`）：
  **CC BY-NC 4.0**（与 AMT 模型一致，见 [`LICENSE`](LICENSE)）——允许非商业使用、修改和再分发，
  **禁止商业使用**，再分发需保留署名。
- **`packages/addon`**：专有软件，**All Rights Reserved**（见 [`packages/addon/LICENSE`](packages/addon/LICENSE)）。
  仅允许最终用户安装和游玩，不得再分发、改包或复用其代码/素材；商业授权或其他授权请联系作者。
- 第三方模型与运行时：见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。AMT 模型为
  **CC BY-NC 4.0**，仅限非商业使用，需保留署名。
