# @piano/server — PianoBE 后端曲库管理服务

Hono + bun:sqlite 的单进程服务：托管 API、前端管理页（同源，免 CORS）与 Docker 部署。

## 快速开始（本地）

```bash
# 构建共享库与前端
npm run build:core
npm run build:web

# 本地运行（.env 在仓库根目录：cp .env.example .env）
cd packages/server
bun src/index.ts
# 或：npm run start:server
```

> 配置全部走根目录 `.env`（见 `.env.example`），bun 启动时自动加载，无需手动 export。
> 首次启动未设置 `BOOTSTRAP_TOKEN` 时，会自动生成一个管理员令牌并打印到控制台。
> 用该令牌登录管理页（或直接作为 `Authorization: Bearer <token>` 调用 API）。

## Docker 部署

```bash
# 根目录 compose（Dockerfile / docker-compose.yml / .env 均在仓库根）。
# 镜像构建时在容器内编译 core/web 产物，无需本地预构建。
docker compose up -d
# 访问 http://<host>:35050（对外映射 35050 → 容器内 3000）
# 数据落在 ./packages/server/data/（挂载卷），忘记令牌改 .env 重启即可重置

# Docker 开发模式（热重载，挂载本地源码/产物）
docker compose -f docker-compose.dev.yml up
```

> 镜像只包含后端依赖树（core / server / web）：addon 是预构建产物，不进入
> 镜像，sapi-pro、@minecraft/* 等 addon 依赖也不会被安装。

## 数据存储

- **SQLite**（`DB_PATH`）：仅存曲目 **meta**（id/name/duration/noteCount/dataSize）、播放列表、令牌
- **文件**（`MIDIS_DIR`，默认 `./data/midis/`）：曲目完整内容存为 `{id}.mid` 原始源文件
- 游戏播放器需要曲目时从 `.mid` 按需编码为 **PBE2**（Raw DEFLATE，内存 LRU 最近 32 首）；管理页前端直接拉 `.mid` 字节解析播放
- 曲目 `id = crc32(.mid 内容)` 内容寻址，重复上传幂等

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `3000` | 监听端口 |
| `DB_PATH` | `./data/piano.db` | SQLite 文件路径（meta/播放列表/令牌） |
| `MIDIS_DIR` | `./data/midis` | 曲目内容目录（存 `{id}.mid` 源文件） |
| `BOOTSTRAP_TOKEN` | 自动生成 | 管理员引导令牌（重启可重置） |
| `ALLOW_PUBLIC_READ` | `false` | `true` 时曲目/公开列表读接口免令牌 |
| `WEB_ROOT` | 无 | 前端构建产物目录（不存在则不托管） |
| `AMT_CLI` | `./amt/amt-cli[.exe]` | AMT Rust CLI 路径（也可在 PATH 中查找） |
| `AMT_MODEL` | `./amt/run4_best.onnx` | ONNX 模型路径 |
| `AMT_DECODER` | `native` | `native` 内置解码（mp3/m4a/flac/wav/ogg）；`ffmpeg` 外部解码 |
| `AMT_THREADS` | `4` | 转录线程数 |
| `AMT_ECO` | `false` | `true` 时使用单线程低负载模式 |
| `AMT_TIMEOUT_MS` | `600000` | 单次转录超时（毫秒） |
| `BILI_SESSDATA` | 无 | B 站登录 Cookie；普通 64K/132K/192K 音轨不需要 |

## 令牌与角色

- 令牌即身份：`Authorization: Bearer <token>`，服务端存 SHA-256 哈希，明文只在创建时返回一次
- 角色：`read`（只读）/ `write`（读写）/ `admin`（读写 + 令牌管理）
- 曲目/列表的 `owner` 记录为令牌身份；播放列表的改名/删改仅 owner 或 admin 可操作
- 前端与外部服务共用同一套 API 与令牌

## API 速查

```
GET    /api/health                    健康检查（公开）
GET    /api/songs?q=&page=&pageSize=  曲目列表（meta）
GET    /api/songs/:id/raw             原始 .mid 字节（前端解析播放）
GET    /api/songs/:id                 游戏播放数据（PBE2，Base64URL 字段 data）
POST   /api/songs                     上传 .mid（原始字节存 data/midis/，X-File-Name 头给文件名）
PATCH  /api/songs/:id                 改曲名 { name }
DELETE /api/songs/:id                 删除曲目（含 .mid 文件）
GET    /api/playlists?owner=&public=1 播放列表列表
GET    /api/playlists/:id             列表详情（meta + items）
POST   /api/playlists                 { name } 创建（owner=令牌身份）
PATCH  /api/playlists/:id             { name?, public? }（owner/admin）
PUT    /api/playlists/:id/items       { items: string[] } 整体替换（owner/admin）
POST   /api/playlists/:id/play        播放计数（每令牌每日一次）
DELETE /api/playlists/:id             删除（owner/admin）
GET    /api/tokens                    令牌列表（admin）
POST   /api/tokens                    { label, role } 创建，返回明文一次（admin）
DELETE /api/tokens/:id                吊销（admin）
GET    /api/transcribe/status         AMT 是否就绪（CLI/模型/解码器）
POST   /api/transcribe                上传音频（原始字节，X-File-Name 头）→ 转录并写入曲库
GET    /api/transcribe/bilibili/search?q=  按关键词搜索 B 站视频
POST   /api/transcribe/bilibili       { input: BV/URL, page?, name? } → 下载音频、转录并写入曲库
```

### 音频转 MIDI（AMT）

服务端直接调用 muscriptor 的 Rust `amt-cli`（无浏览器、无 Python），音频解码、
CQT、ONNX 推理和 MIDI 写出都在 CLI 内完成；转录结果作为普通曲目写入曲库，
管理页「音频转 MIDI」可直接试听。

```bash
# 同步 CLI + onnxruntime.dll + 模型到 packages/server/amt/
# PowerShell:
$env:AMT_DIR="E:\Project\muscriptor\Automated-Music-Transcription"; npm run sync:amt -w @piano/server
# bash:
AMT_DIR=/path/to/Automated-Music-Transcription npm run sync:amt -w @piano/server
```

B 站解析流程：`finger/spi` 取匿名 buvid → `view` 取 cid/title → `playurl`（DASH）
选最高码率音轨 → 带 Referer 下载 fMP4（`.m4s`）→ 直接交给 `amt-cli`。
普通音轨无需登录；杜比 / Hi-Res 需 `BILI_SESSDATA`。接口请求在进程内串行并限速
1 秒/次，转录任务默认排队串行执行（内存占用约 150 MB/任务）。

> Docker / Linux 部署需要自行编译 Linux 版 `amt-cli`（或挂载一个可执行文件），
> 并通过 `AMT_CLI` / `AMT_MODEL` 指向它；Windows 版 `.exe` 不能在容器里运行。

## 一致性设计

- 无显式事务：单记录 = 单行原子写（SQLite 单语句自带原子性）
- 播放列表 meta 与 items 同记录（JSON 列），不存在跨记录索引，崩溃无残留
- 曲目内容寻址（id = crc32），重复上传幂等
- 存储端口契约测试与内存驱动共用同一套用例（`packages/core/tests/conformance.ts`）

## 测试

```bash
npm run test:server   # bun test：SQLite 端口契约 + API 全流程
```
