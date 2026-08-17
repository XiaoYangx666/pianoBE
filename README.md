# PianoBE

[![Requires](https://img.shields.io/badge/基于-SAPI_Pro_v0.4.2_beta-blue?style=flat-square)](https://github.com/XiaoYangx666/SAPI-Pro) ![Support](https://img.shields.io/badge/支持版本-MCBE%2026.30+-green?style=flat-square) [![QQ群](https://img.shields.io/badge/QQ群-1004513100-orange?style=flat-square)](https://qm.qq.com/q/KUgqkHM5uS)

![painoBE](./screenshot.png)

> [👉 B站演示视频](https://www.bilibili.com/video/BV1jLD9BzE5D)

基岩版电子钢琴模组：游戏内实时弹奏 + MIDI 播放器，支持**内嵌曲库**与 **BDS 远程曲库（搭配自托管后端）** 两种形态。

🔗 **在线生成 Addon**：[pianobe.2408807389.workers.dev](https://pianobe.2408807389.workers.dev)

---

## 仓库结构（npm workspaces monorepo）

```
pianoBE/
├── packages/          # npm workspaces：唯一共享库 + 各独立交付物
│   ├── core/          # 共享核心库 @piano/core（零 MC 依赖）
│   │                  #   .mid 转换/打包解包/crc32、addon 模块文本、
│   │                  #   存储端口接口(SongPort/PlaylistPort/MidiSource)+业务层
│   ├── addon/         # 附加包 @piano/addon（游戏内钢琴与 MIDI 播放器）
│   │                  #   双目标构建：模板包(client) / 服务器专用包(server)
│   ├── server/        # 后端 @piano/server：Hono + bun:sqlite + 文件曲库，
│   │                  #   token 鉴权，Docker 部署，同源托管管理页
│   ├── web/           # 管理页 @piano/web：React+Vite（曲库/播放列表/令牌）
│   └── generator/     # 独立生成器 @piano/generator：.mid 内嵌打包（Cloudflare 可部署）
├── midis/             # 曲库数据资产（.mid 源文件 + 转换产物）
├── tools/             # convert / verify 脚本
└── vendor/            # sapi-pro tarball（仓库自包含）
```

**依赖方向**：`addon`、`server`、`generator` → `core`；`web` → `server` API；addon（BDS）→ `server`（server-net 拉取）。

## 两个 Addon 包（同一份源码，注入式条件编译）

| | 模板包（client） | 服务器专用包（server） |
|---|---|---|
| 产物 | `dist/template.mcaddon`（生成器底包） | `dist/server.mcaddon` |
| 构建 | `npm run build:template` | `npm run build:server` |
| 曲库 | 生成器内嵌 / 无 BDS 逻辑 | **纯远程**（server-net 从后端拉取 + 游戏内缓存） |
| 依赖 | 仅 server / server-ui | + `@minecraft/server-net`、`@minecraft/server-admin` |
| 适用 | 客户端 / 普通世界 | BDS 专用服务器，搭配自托管后端 |

实现：`__PIANO_TARGET__` 由 bepack `compile.define` 注入字符串字面量，rolldown 常量折叠 + 死代码消除裁剪不可达分支（client 产物物理上不含 server 逻辑，已验证）。

## 快速开始

### 1. 客户端/普通世界（模板包 + 生成器）

访问 [在线生成器](https://pianobe.2408807389.workers.dev)，上传 `.mid` 生成 `.mcaddon` 导入世界（开启"测试版 API"）。放置钢琴方块即可弹奏/播放内嵌曲目。

### 2. BDS 服务器 + 自托管后端（远程曲库）

```bash
# 后端（Docker 部署，根目录 compose；镜像内含 core/web 构建产物）
docker compose up -d
# 管理页 http://<host>:35050 登录 → 上传曲目、创建播放列表、签发令牌
# （.env 里 BOOTSTRAP_TOKEN 是管理员令牌；端口 35050 对外，容器内 3000）

# 服务器专用包
npm run build:server   # 产出 packages/addon/dist/server.mcaddon

# BDS 配置（config/default/ 目录）
#   variables.json → { "pianoBackendUrl": "http://<后端>:35050" }
#   secrets.json   → { "pianoBackendToken": "Bearer <令牌>" }
```

addon 启动时动态导入 `@minecraft/server-admin` 读配置、`@minecraft/server-net` 拉取曲目；任一步骤不可用（客户端环境/未配置）自动降级内嵌曲库。详见 `packages/addon/README.md`。

### 3. 开发

```bash
npm install
npm run build:core     # 构建共享库
npm test               # core vitest（35 用例）
npm run test:server    # server bun test（28 用例）
npm run test -w @piano/addon  # addon netSource 缓存/降级（8 用例）
npm run build          # addon 开发构建（内嵌 225 首 + copy 测试服）
npm run build:web      # 管理页
npm run build:generator # 生成器
```

#### Docker 开发模式（热重载）

```bash
# 前置：本地构建 core/web 产物（dev compose 直接挂载本地文件）
npm run build:core && npm run build:web

# 启动开发容器：挂载本地 server 源码 + core/web 产物，bun --watch 热重载
docker compose -f docker-compose.dev.yml up
# 改 server 源码自动重启；改 core/web 后重新 npm run build:* 并刷新页面
```

> 生产与开发都映射 35050，不同时跑（先 `docker compose down` 再切另一个）。

## 主要特性

- 🎹 **实时钢琴弹奏**：文本输入映射琴键，两种键盘映射（含/不含黑键）、连音/单音两种模式
- 🎵 **MIDI 播放**：内嵌或远程曲库，播放队列（顺序/循环/单曲/随机）、多钢琴独立播放、UI 同步、区块卸载自动停止
- 🧩 **DDUI 内存优化**：DDUI Manager 每个玩家/表单只创建一次实例
- 🗄️ **自托管后端**：Hono + bun:sqlite + Docker；token 鉴权（Bootstrap 令牌 env 注入、分角色令牌）；React 管理页
- 📁 **曲目存文件**：SQLite 只存 meta，完整曲目存 `data/midis/{id}.mid` 源文件，JSON 按需转换；前端直接解析 `.mid` 播放
- 🔌 **无事务一致性**：存储端口单键原子写、派生索引、崩溃自愈（core 契约测试覆盖）

## 技术要点

- 曲目 `id = crc32(.mid 内容)`，内容寻址，后端/内嵌/生成器三端同算法天然对账
- 播放列表：meta 与 items 同记录原子更新，owner/public 视图派生（读取即修复，无需索引维护）
- 双端存储驱动：addon 用世界动态属性（DPDataBase），后端用 SQLite（meta）+ 文件（内容），共享同一套 core 端口与契约测试

## 已知问题

- **DDUI 内存泄露**：Minecraft 基岩版 DDUI 表单一经创建不会被 GC；DDUI Manager 缓解（每玩家每表单仅创建一次）

## 分支

架构重构工作在 `refactor/monorepo-arch` 分支：五大阶段（core 抽取 → addon 接入 → 后端+管理页 → 生成器重构 → server-net 联调）+ 双目标构建。
