# PianoBE

[![Requires](https://img.shields.io/badge/基于-SAPI_Pro_v0.4.2_beta-blue?style=flat-square)](https://github.com/XiaoYangx666/SAPI-Pro) ![Support](https://img.shields.io/badge/支持版本-MCBE%2026.30+-green?style=flat-square) [![QQ群](https://img.shields.io/badge/QQ群-1004513100-orange?style=flat-square)](https://qm.qq.com/q/KUgqkHM5uS)

![pianoBE](./screenshot.png)

> [B站演示视频](https://www.bilibili.com/video/BV1jLD9BzE5D)

基岩版电子钢琴模组：游戏内实时弹奏与 MIDI 播放，支持**内嵌曲库**与 **BDS 远程曲库（自托管后端）** 两种形态。

**在线生成 Addon**：[pianobe.2408807389.workers.dev](https://pianobe.2408807389.workers.dev)

---

## 简介

PianoBE 是一套面向基岩版的钢琴附加包解决方案，由以下部分组成：

| 部分 | 说明 |
|---|---|
| **附加包（addon）** | 游戏内钢琴方块：实时弹奏、MIDI 播放器、播放队列与多钢琴支持 |
| **在线生成器（generator）** | 网页端将 `.mid` 文件与内置曲库打包为 `.mcaddon`，可直接部署到 Cloudflare Workers |
| **自托管后端（server + web）** | Hono + SQLite 文件曲库与播放列表服务，配套 React 管理页；BDS 服务器经 server-net 远程拉取曲目 |
| **共享核心库（core）** | MIDI 转换/打包、曲库编解码、音符映射、存储端口等无游戏依赖的领域逻辑 |

主要特性：

- **实时钢琴弹奏**：文本输入映射琴键，两种键盘映射（含/不含黑键）、连音/单音两种模式
- **MIDI 播放**：内嵌或远程曲库，播放队列（顺序/循环/单曲/随机）、多钢琴独立播放、UI 同步、区块卸载自动停止
- **DDUI 内存优化**：DDUI Manager 保证每个玩家/表单只创建一次实例
- **自托管后端**：Hono + bun:sqlite + Docker；token 鉴权（Bootstrap 令牌 env 注入、分角色令牌）；React 管理页
- **曲目文件存储**：SQLite 仅存元数据，完整曲目以 `data/midis/{id}.mid` 源文件存储，JSON 按需转换；前端直接解析 `.mid` 播放
- **无事务一致性**：存储端口单键原子写、派生索引、崩溃自愈（core 契约测试覆盖）

---

## 快速开始

### 1. 客户端 / 普通世界（模板包 + 在线生成器）

访问 [在线生成器](https://pianobe.2408807389.workers.dev)：

1. 从 **MIDI 曲库**（内置转换后的曲目，支持搜索与试听）选择曲目，或直接上传 `.mid` 文件
2. 设置包名与描述，导出 `.mcaddon`
3. 将包导入世界（需开启"测试版 API"），放置钢琴方块即可弹奏/播放内嵌曲目

试听音色直接取自模板底包内的真实钢琴采样，无需额外音效文件。

### 2. BDS 服务器 + 自托管后端（远程曲库）

```bash
# 启动后端（Docker，根目录 compose；镜像内含 core/web 构建产物）
docker compose up -d
# 管理页 http://<host>:35050 登录 → 上传曲目、创建播放列表、签发令牌
# （.env 中 BOOTSTRAP_TOKEN 为管理员令牌；对外端口 35050，容器内 3000）

# 构建服务器专用包
npm run build:server   # 产出 packages/addon/dist/server.mcaddon

# BDS 配置（config/default/ 目录）
#   variables.json → { "pianoBackendUrl": "http://<后端>:35050" }
#   secrets.json   → { "pianoBackendToken": "Bearer <令牌>" }
```

addon 启动时动态导入 `@minecraft/server-admin` 读取配置、`@minecraft/server-net` 拉取曲目；任一环节不可用（客户端环境/未配置）时自动降级为内嵌曲库。详见 `packages/addon/README.md`。

---

## 架构

### 仓库结构（npm workspaces monorepo）

```
pianoBE/
├── packages/          # npm workspaces：共享库与各交付物
│   ├── core/          # 共享核心库 @piano/core（零 MC 依赖）
│   ├── addon/         # 附加包 @piano/addon（双目标构建：模板包 / 服务器专用包）
│   ├── server/        # 后端 @piano/server：Hono + bun:sqlite + 文件曲库
│   ├── web/           # 管理页 @piano/web：React + Vite
│   └── generator/     # 独立生成器 @piano/generator（Cloudflare 可部署）
├── midis/             # 曲库数据资产（见"曲库与贡献"）
├── tools/             # 转换与验证脚本
```
（sapi-pro 使用 npm 发布版，不再 vendor 内置）

**依赖方向**：`addon`、`server`、`generator` → `core`；`web` → `server` API；addon（BDS）→ `server`（server-net 拉取）。

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
- 播放列表：meta 与 items 同记录原子更新，owner/public 视图派生（读取即修复，无需索引维护）
- 双端存储驱动：addon 使用世界动态属性（DPDataBase），后端使用 SQLite（meta）+ 文件（内容），共享同一套 core 端口与契约测试

---

## 开发

### 环境要求

- Node.js ≥ 22（core / generator / web）
- Bun（server 运行与测试）
- Docker（后端部署与开发模式）

### 构建与测试

```bash
npm install

# 构建共享库与各交付物
npm run build:core       # @piano/core
npm run build:template   # addon 模板包（生成器底包，build:generator 的前置）
npm run build:server     # addon 服务器专用包
npm run build:generator  # 生成器
npm run build:web        # 管理页

# 测试
npm test                 # core vitest
npm run test:server      # server bun test
npm run test -w @piano/addon  # addon netSource 缓存/降级

# 运行
npm run dev:generator    # 生成器开发模式（predev 自动同步底包与曲库到 public/）
```

### Docker 开发模式（热重载）

```bash
# 前置：本地构建 core/web 产物（dev compose 直接挂载本地文件）
npm run build:core && npm run build:web

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
| `midis/js/` | addon 运行时模块（转换产物） | 不入库（构建期生成） |
| `midis/library/` | 曲库二进制 `<id>.bin` + `index.json` | **入库**（生成器数据源） |

原始 MIDI 不在仓库中，因此**新增曲目必须使用增量命令**（全量转换 `npm run convert` 会以本机 `midis/files` 为准重写曲库，仅适合持有完整源文件的本地维护）。

### 添加歌曲

```bash
# 单首
npm run add-song -- <歌曲.mid>

# 批量（多个文件或整个目录）
npm run add-song -- ./目录A/ ./目录B/歌曲.mid

# 查看入库结果（按曲名关键词或 ID 搜索）
npm run show-song -- <关键词>
```

命令说明：

- **内容寻址防重复**：曲目 ID 为 MIDI 内容的 CRC32，内容相同的文件自动识别并跳过（输出 `跳过(重复)`）；同名但内容不同的文件打印警告并分别入库，不会互相覆盖
- **最小改动**：`add-song` 仅新增/更新指定曲目，`git diff` 只包含对应的 `<id>.bin` 与 `index.json` 两项变更，便于审查
- **转换确定性**：同一文件重复转换结果一致；曲名取自文件名，无需了解二进制格式

### 全量重建（本地维护）

```bash
npm run convert           # 以 midis/files 全量重建曲库与 addon 模块
npm run convert -- --force  # 输入数量少于现有曲库时的保护需显式确认
```

全量转换在输入文件数少于现有曲库时拒绝执行（防止误清空），确认重建需追加 `--force`。

### 提交与提 PR

```bash
git add midis/library
git commit -m "曲库: 新增 <歌名>"
git push origin <分支>    # 提交 Pull Request
```

曲库与后端管理页曲库使用同一套 id 算法；后端新增曲目可将其 `packages/server/data/midis/{id}.mid` 导出后经 `add-song` 收编入库。

---

## 已知问题

- **DDUI 内存泄露**：Minecraft 基岩版 DDUI 表单一经创建不会被 GC；DDUI Manager 缓解（每玩家每表单仅创建一次）

## 分支

架构重构工作在 `refactor/monorepo-arch` 分支：五大阶段（core 抽取 → addon 接入 → 后端+管理页 → 生成器重构 → server-net 联调）+ 双目标构建。