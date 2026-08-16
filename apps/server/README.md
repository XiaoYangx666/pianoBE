# @piano/server — PianoBE 后端曲库管理服务

Hono + bun:sqlite 的单进程服务：托管 API、前端管理页（同源，免 CORS）与 Docker 部署。

## 快速开始（本地）

```bash
# 构建共享库与前端
npm run build:core
npm run build:web

# 启动（默认 3000 端口）
BOOTSTRAP_TOKEN=my-admin-token npm run start:server
# 或：cd apps/server && PORT=3000 DB_PATH=./data/piano.db WEB_ROOT=../web/dist bun src/index.ts
```

首次启动未设置 `BOOTSTRAP_TOKEN` 时，会自动生成一个管理员令牌并打印到控制台。
用该令牌登录管理页（或直接作为 `Authorization: Bearer <token>` 调用 API）。

## Docker 部署

```bash
cd apps/server
BOOTSTRAP_TOKEN=你的管理员令牌 docker compose up -d --build
# 数据落在 ./data/piano.db（挂载卷），忘记令牌改 .env 重启即可重置
```

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `3000` | 监听端口 |
| `DB_PATH` | `./data/piano.db` | SQLite 文件路径 |
| `BOOTSTRAP_TOKEN` | 自动生成 | 管理员引导令牌（重启可重置） |
| `ALLOW_PUBLIC_READ` | `false` | `true` 时曲目/公开列表读接口免令牌 |
| `WEB_ROOT` | 无 | 前端构建产物目录（不存在则不托管） |

## 令牌与角色

- 令牌即身份：`Authorization: Bearer <token>`，服务端存 SHA-256 哈希，明文只在创建时返回一次
- 角色：`read`（只读）/ `write`（读写）/ `admin`（读写 + 令牌管理）
- 曲目/列表的 `owner` 记录为令牌身份；播放列表的改名/删改仅 owner 或 admin 可操作
- 前端与外部服务共用同一套 API 与令牌

## API 速查

```
GET    /api/health                    健康检查（公开）
GET    /api/songs?q=&page=&pageSize=  曲目列表（meta）
GET    /api/songs/:id                 完整曲目 JSON（server-net 拉取用）
POST   /api/songs                     上传 .mid（原始字节，X-File-Name 头给文件名）
DELETE /api/songs/:id                 删除曲目
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
```

## 一致性设计

- 无显式事务：单记录 = 单行原子写（SQLite 单语句自带原子性）
- 播放列表 meta 与 items 同记录（JSON 列），不存在跨记录索引，崩溃无残留
- 曲目内容寻址（id = crc32），重复上传幂等
- 存储端口契约测试与内存驱动共用同一套用例（`packages/core/tests/conformance.ts`）

## 测试

```bash
npm run test:server   # bun test：SQLite 端口契约 + API 全流程
```
