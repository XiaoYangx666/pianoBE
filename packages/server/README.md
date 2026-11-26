# @piano/server — PianoBE 后端曲库管理服务

Hono + bun:sqlite 的单进程服务：托管 API、前端管理页（同源，免 CORS）与 Docker 部署。

## 快速开始（本地源码运行）

```bash
# 构建共享库与服务器版前端
npm run build:core
npm run build:vfx
npm run build:assembly
npm run build:studio:server

# 本地运行（--dir 可指定运行根目录；不传则以当前目录作为运行根目录）
cd packages/server
bun src/index.ts --dir ./run
# 或：npm run start:server
```

> 配置读取运行目录 `.env`（或环境变量，见仓库根 `.env.example`），bun 启动时自动加载。
> 首次启动未设置 `BOOTSTRAP_TOKEN` 时，会自动生成一个管理员令牌并打印到控制台。
> 用该令牌登录管理页（或直接作为 `Authorization: Bearer <token>` 调用 API）。

## 运行目录模型（MC Server 风格）

无论是单文件发行版还是从仓库源码启动，运行根目录（当前目录或 `--dir` / `PIANOBE_HOME` 指定目录）统一组织为：

```text
<运行目录>/
├── pianobe-server(.exe)   # 单文件可执行程序（内嵌精简管理页 + 零插件 server.mcaddon）
├── .env                   # 端口、令牌、BDS_DIR、PLUGIN_REGISTRY_URL 等配置
├── plugins/               # 直接放入或删除 .pbeplugin（启动或点「刷新目录」自动同步，待手动启用）
├── data/                  # piano.db、scores/、自定义 server-template.mcaddon、网页下载的 amt/
└── logs/                  # server.log 及轮转日志文件
```

- **外置插件**：把 `.pbeplugin` 放进 `plugins/` 后，在管理页扩展中心点「刷新目录」（或重启服务）即可看到新发现的插件，由管理员手动点击启用/信任；从 `plugins/` 删除文件后自动清理对应记录。若配置了 `PLUGIN_REGISTRY_URL`（如面向玩家网页版的 `/plugins/index.json`），还可在扩展中心直接从远程源一键下载。
- **可选音色**：已全部统一为 `.pbeplugin` 音色插件，不再保留旧版散装 `timbres/` 开关；启用对应音色插件即可装配进 BDS。

## Docker 部署

```bash
# 根目录 compose（Dockerfile / docker-compose.yml / .env 均在仓库根）。
# 镜像构建时在容器内编译 core/web 产物，无需本地预构建；
# AMT（音频转录）由 npm 依赖 amt-cli 在构建时自动下载，无需预先同步。
docker compose up -d
# 访问 http://<host>:35050（对外映射 35050 → 容器内 3000）
# 数据落在 ./packages/server/data/（挂载卷），忘记令牌改 .env 重启即可重置

# Docker 开发模式（热重载，挂载本地源码/产物）
docker compose -f docker-compose.dev.yml up
```

> 运行阶段是 Debian（glibc），`bun install --production` 会安装 `amt-cli`
> （Linux x64 二进制 + `libonnxruntime.so` + int8 模型）；安装失败时镜像仍可构建，
> 只是转录接口会返回「AMT 不可用」。
> 构建时 apt 默认走南大镜像（替换 `deb.debian.org`），海外机器可用
> `docker build --build-arg DEBIAN_MIRROR=https://deb.debian.org` 还原。
> 镜像只包含后端依赖树（core / server / web）：addon 是预构建产物，不进入
> 镜像，sapi-pro、@minecraft/* 等 addon 依赖也不会被安装。

## 数据存储

- **SQLite**（`DB_PATH`）：曲目 meta（id/name/duration/noteCount/dataSize）、完整曲目内容（`song_files` 表的 mid/pbe3/json BLOB）与令牌
- 游戏播放器需要曲目时直接读 `song_files.pbe3`；缺少 pbe3 时从 mid 按需编码（内存 LRU 最近 32 首）
- 管理页前端直接拉 `/raw` 字节解析播放
- 曲目 `id = crc32(.mid 内容)` 内容寻址，重复上传幂等
- 曲目内容只存在于 SQLite，不再读取 `data/midis` 等旧版文件目录；备份只需 `piano.db`（WAL 模式下用 `.backup` 或连 `-wal` 一起拷）
- 删除曲目会立即释放数据库记录，磁盘空间通过 `VACUUM` 回收

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `3000` | 监听端口 |
| `PIANOBE_HOME` | `.` | 运行根目录（也可通过 `--dir <path>` 传入） |
| `DATA_DIR` | `<home>/data` | 数据目录（`piano.db`、`scores/`、覆盖模板、托管 `amt/`） |
| `DB_PATH` | `<data>/piano.db` | SQLite 文件路径（曲目 meta/内容/令牌） |
| `PLUGINS_DIR` | `<home>/plugins` | 外置插件目录（`.pbeplugin`） |
| `PLUGIN_REGISTRY_URL` | 无 | 可选远程插件清单 URL（如 `https://.../plugins/index.json`） |
| `BOOTSTRAP_TOKEN` | 自动生成 | 管理员引导令牌（重启可重置） |
| `ALLOW_PUBLIC_READ` | `false` | `true` 时曲目读接口免令牌 |
| `WEB_ROOT` | 自动探测 | 前端构建产物目录（单文件优先内嵌 `web/`，源码优先 `studio/dist-server`） |
| `AMT_CLI` | 自动探测 | 显式指定 `amt-cli` 路径（优先级最高） |
| `AMT_MODEL` | 自动探测 | ONNX 模型路径 |
| `NPM_REGISTRY` | `https://registry.npmmirror.com` | 网页一键下载 `amt-cli` 时使用的 npm 源 |
| `AMT_DECODER` | `native` | `native` 内置解码（mp3/m4a/flac/wav/ogg）；`ffmpeg` 外部解码 |
| `AMT_THREADS` | `4` | 转录线程数 |
| `AMT_CONCURRENCY` | `1` | 同时运行的转录任务数 |
| `AMT_MAX_QUEUE` | `10` | 最多排队的转录任务数，超过返回 429（入队时强制校验） |
| `AMT_MAX_AUDIO_SECONDS` | `600` | 单个音频/视频最大时长（秒）；B 站视频在下载前直接拒绝 |
| `AMT_MAX_DOWNLOAD_BYTES` | `209715200` | B 站音频下载字节上限（默认 200 MB） |
| `AMT_ECO` | `false` | `true` 时使用单线程低负载模式 |
| `AMT_TIMEOUT_MS` | `600000` | 单次转录超时（毫秒） |
| `BILI_SESSDATA` | 无 | B 站登录 Cookie；普通 64K/132K/192K 音轨不需要 |
| `BDS_DIR` | 无 | BDS 根目录；配置后可在管理页一键部署 BP/RP |
| `BDS_WORLD` | `server.properties` 的 `level-name` | 目标世界目录名 |
| `BDS_BP_NAME` | `pianoServerBP` | 行为包部署目录名 |
| `BDS_RP_NAME` | `pianoServerRP` | 资源包部署目录名 |
| `BDS_PACK_MODE` | `development` | `development` 部署到 `development_behavior_packs` / `development_resource_packs`；`release` 部署到 `behavior_packs` / `resource_packs` |
| `BDS_PACK_NAME` | 模板名 | 自定义 manifest 包名（管理页可改） |
| `BDS_PACK_DESCRIPTION` | 模板描述 | 自定义 manifest 描述（管理页可改） |
| `LOG_FILE` | `<home>/logs/server.log` | 日志文件；设为 `off` 只输出到控制台 |
| `LOG_LEVEL` | `info` | 最低日志级别：`debug` / `info` / `warn` / `error` |
| `LOG_FORMAT` | `text` | 文件格式：`text` 或 `json`（一行一条） |
| `LOG_MAX_BYTES` | `10485760` | 单个日志文件上限（字节） |
| `LOG_MAX_FILES` | `7` | 保留的历史日志文件数 |

## 开发与生产

| | 开发 | 生产（单文件发行版） |
|---|---|---|
| 启动 | `npm run dev:server`（bun --watch） | 直接运行 `pianobe-server-<平台>` |
| 管理页 | `packages/studio` 的 `npm run dev`（完整版） | 构建时嵌入 `packages/studio/dist-server`（精简服务器版） |
| Studio 模式 | 本地工作区 + 服务器模式 | **仅服务器模式**（无本地工作区、无 ONNX/前端装配依赖） |
| 资源目录 | 优先 `studio/dist-server`、`WEB_ROOT` 可覆盖 | 嵌入可执行文件 `web/` 虚拟目录 |
| 插件与数据 | 运行目录 `plugins/`、`data/`、`logs/` | 同左（全部外置，不打入二进制） |
| 配置 | `.env` 或环境变量 | 环境变量或运行目录 `.env` |

Studio 两套构建互不覆盖：

```bash
npm run build:studio        # dist/：面向玩家的完整网页版（含模板、官方插件、浏览器转录 AMT）
npm run build:studio:server # dist-server/：精简服务器管理版（剔除本地工作区、ONNX 与前端装配依赖）
```

## 单文件发行版

```bash
npm run build:server:exe
# 产物：build/server-exe/pianobe-server-<platform>-<arch>(.exe)
```

- 单文件二进制**仅包含**：后端 API + 精简服务器管理页（`dist-server`）+ 零插件服务器底包 `server.mcaddon`
- **不内嵌** `build/plugins`、ONNX WASM、浏览器装配器与 `amt-cli`；插件、数据库、自定义曲谱、日志全部保存在运行目录外部
- 模板只带标准钢琴（`piano_v1~3`）：可选音色采样统一打包为 `.pbeplugin` 插件按需启用
- 构建用 `Bun.build` 的 AOT + `trim`，需要 **Bun canary（1.4.5-canary 及以上）**；稳定版 1.4.5 的 `--aot/--trim` 不生效
- AOT **不能交叉编译**：Windows 版需在 Windows 上执行同一脚本
- 运行：`./pianobe-server-linux-x64 --dir ./my-server`（Windows 为 `pianobe-server-win32-x64.exe`）
- AMT 四级解析顺序：`AMT_CLI`（环境变量） → `<dataDir>/amt/`（管理页「音乐工具」一键从 npm 下载） → `node_modules`（npm 依赖） → `PATH`

## Docker（单文件版）

镜像只包含 glibc 基础层 + 编译好的二进制 + 内置 AMT（约 130 MB），不装 Node/Bun：

```bash
npm run build:server:exe
docker build -f Dockerfile.server -t pianobe-server:single .
docker compose -f docker-compose.single.yml up -d
```

- 运行目录固定为 `/data`（plugins / data / logs 都在卷 `pianobe-data` 里）
- 网络显式设为 MTU 1400：宿主机链路 MTU 小于 1500 时，Bun 的 TLS 握手会被
  bridge 静默丢弃（表现为 AMT/远程插件下载超时）
- 镜像已带 `libgcc_s` / `libstdc++`，并内置 `amt-cli@0.1.1`（`/opt/amt`，`AMT_CLI` 指过去），
  启动即可转录，首次运行不需要联网下载 AMT；升级 AMT 版本时改 `Dockerfile.server` 重建镜像
- 没有内置 AMT 的旧镜像仍可在管理页一键下载（约 17 MB），但要求容器能正常访问 npm registry

## BDS 附加包部署

管理页「BDS 部署与校验」会把模板与已启用的插件/音色/曲谱重新装配，并写入 BDS：

- 默认写入 `development_behavior_packs/<BDS_BP_NAME>` 与 `development_resource_packs/<BDS_RP_NAME>`；
  需要正式目录时把 `BDS_PACK_MODE` 设为 `release`（或直接在页面切换）。
- 切换目录后，旧目录里同名且 UUID 相同的包会被移动到隐藏目录
  （`.<name>.legacy_<时间戳>`），不会直接删除；不同 UUID 的目录不会被触碰。
- `world_behavior_packs.json` / `world_resource_packs.json` 会同步更新到新版本。
- 包名与描述可在页面自定义；留空则沿用模板 manifest 的值。

也可以不打开页面，一条命令完成「构建 → 装配 → 写入 BDS」。默认是本机直连：脚本直接调用后端代码写文件，不经过 HTTP、不上传产物，也不需要令牌：

```bash
npm run deploy:bds                      # 构建 + 本地直接部署
npm run deploy:bds -- --skip-build      # 复用 packages/addon/dist/server.mcaddon
npm run deploy:bds -- --file <mcaddon>  # 指定其他产物
npm run deploy:bds -- --url http://host:35050 --token <admin 令牌>   # 远端后端（走 HTTP）
```

脚本会打印部署结果、configHash、问题与提示。部署只写文件，重启 BDS 实例或重进世界后才加载新包；命令失败时不会留下半套文件。

## 令牌与角色

- 令牌即身份：`Authorization: Bearer <token>`，服务端存 SHA-256 哈希，明文只在创建时返回一次
- 只有两种令牌：
  - `user`（普通）：读取曲库、创建/查看/取消**自己的** B 站转录任务；**不能修改曲库**
  - `admin`（管理员）：曲库增删改、插件、部署、令牌管理
- 旧库里的 `read` / `write` 读取时统一按 `user` 处理；需要曲库写权限请新建 `admin` 令牌
- 曲目的 `owner` 记录为上传令牌身份
- 前端与外部服务共用同一套 API 与令牌

### 静态资源与登录

- **没有令牌拿不到任何前端文件**：Studio 的 `index.html`、`assets/*`、`template.mcaddon`、`plugins/*`、`amt/*`、`piano/*` 全部校验访问凭证；未登录的浏览器打开 `/` 只会得到服务端内联的登录页（不引用任何静态资源）
- 登录页把令牌 POST 到 `/api/session`，服务端下发 `HttpOnly` 会话 Cookie（`pianobe_studio`，值只存令牌的 SHA-256，默认 30 天）；静态资源凭这个 Cookie 读取，吊销令牌后立即失效
- API 仍然只认 `Authorization: Bearer`，Cookie 不能调用任何 `/api/*`（避免 CSRF）；脚本/自动化也可以直接用 Bearer 读静态文件
- `POST /api/session` 返回 `{ ok, role, label }`；`DELETE /api/session` 退出登录

## API 速查

```
GET    /api/health                    健康检查（公开）
GET    /api/songs?q=&page=&pageSize=  曲目列表（meta）
GET    /api/songs/:id/raw             原始 .mid 字节（前端解析播放）
GET    /api/songs/:id/code            游戏内导入码（PBE3 分段）
GET    /api/songs/:id                 游戏播放数据（PBE3，Base64URL 字段 data）
POST   /api/songs                     上传 .mid（内容写入 SQLite，X-File-Name 头给文件名）
PATCH  /api/songs/:id                 改曲名 { name }
DELETE /api/songs/:id                 删除曲目
GET    /api/tokens                    令牌列表（admin）
POST   /api/tokens                    { label, role } 创建，返回明文一次（admin）
DELETE /api/tokens/:id                吊销（admin）
GET    /api/transcribe/status         AMT 是否就绪（CLI/模型/解码器）
POST   /api/transcribe/jobs           上传音频 → 创建转录任务（admin；不写曲库；X-File-Name/X-Audio-Duration 头）
GET    /api/transcribe/jobs/:id       任务状态（stage/percent/noteCount/…）
GET    /api/transcribe/jobs/:id/events  SSE 进度（percent 为 -1 时无法估算）
GET    /api/transcribe/jobs/:id/audio  原始音频试听（支持 Range）
GET    /api/transcribe/jobs/:id/midi   转录结果 .mid（试听）
GET    /api/transcribe/jobs/:id/code   游戏内导入码
GET    /api/transcribe/jobs/:id/song   转录结果的 PBE3（BDS 直接写入存储卡）
PATCH  /api/transcribe/jobs/:id       { name } 改任务名
POST   /api/transcribe/jobs/:id/save  显式保存到曲目库
DELETE /api/transcribe/jobs/:id       放弃任务并清理临时文件
GET    /api/transcribe/bilibili/search?q=  按关键词搜索 B 站视频
POST   /api/transcribe/jobs/bilibili  { input: BV/URL, page?, name? } → 后台下载并创建任务
```

转录任务权限：普通令牌（`user`）可以创建 B 站任务，并且只能查看/改名/取消
自己发起的任务；任务产物接口不再跟随 `ALLOW_PUBLIC_READ` 公开。上传音频与
`POST /api/transcribe/jobs/:id/save`（写入曲库）要求管理员令牌。

### 音频转 MIDI（AMT）

服务端直接调用 muscriptor 的 Rust `amt-cli`（无浏览器、无 Python），音频解码、
CQT、ONNX 推理和 MIDI 写出都在 CLI 内完成。转录以「任务」形式进行：原音频与
MIDI 暂存在临时目录，管理页可试听、改名、生成导入码，确认后才写入曲目库；
任务 30 分钟无更新自动清理。进度来自 `amt-cli --events` 的实时音符事件，
按「已解码音频时间 / 总时长」估算百分比（总时长未知时显示不确定进度）。

CLI、ONNX Runtime 与 int8 模型来自 npm 包 [`amt-cli`](https://www.npmjs.com/package/amt-cli)。单文件二进制用户在「音乐工具」页点击「一键下载 AMT 组件」（支持国内镜像 `npmmirror` 与 npm 官方源）即可自动拉取并热重载生效；克隆仓库开发也可直接 `npm install` 后开箱使用：

```bash
npm install     # 安装依赖（含 amt-cli 与当前平台二进制，约 40 MB）
npm run start:server
```

解析顺序为：`AMT_CLI`（环境变量） → `<dataDir>/amt/`（网页一键下载） → `node_modules`（npm 依赖） → `PATH`；模型优先 `models/run4_int8.onnx`。npm tarball 不带执行位，服务启动解析时会自动 `chmod +x`。

B 站解析流程：`finger/spi` 取匿名 buvid → `view` 取 cid/title → `playurl`（DASH）
选最高码率音轨 → 带 Referer 下载 fMP4（`.m4s`）→ 直接交给 `amt-cli`。
普通音轨无需登录；杜比 / Hi-Res 需 `BILI_SESSDATA`。接口请求在进程内串行并限速
1 秒/次，转录任务默认排队串行执行（内存占用约 150 MB/任务）。

> Docker 镜像的运行阶段是 Debian（glibc），`bun install --production` 会从 npm
> 安装当前平台（linux-x64）的 `amt-cli`、`libonnxruntime.so` 与 int8 模型；
> Windows 版文件不会进入运行环境。

## 日志与排查

控制台和文件使用同一套格式，默认写入 `<home>/logs/server.log`：

```
2026-11-26 12:00:00.123 INFO  [http] GET /api/songs 200 12ms | req=8f3c2a1b4c5d auth=admin#3
2026-11-26 12:00:01.004 ERROR [transcribe] 转录任务失败 | job=abc stage=transcribing
    AmtTimeoutError: amt-cli 超时（600s）
    at ...
```

- **模块**：`http`、`songs`、`tokens`、`deploy`、`bilibili`、`transcribe`、`db`；可用 `[模块]` 直接过滤。
- **请求 ID**：每个请求响应头带 `x-request-id`；访问日志和异常日志都用 `req=` 关联。500 响应体里也带 `requestId`，用户报错时给这个 ID 即可定位。
- **健康检查**：成功请求只在 `LOG_LEVEL=debug` 时记录，避免每 30 秒一条把问题冲掉。
- **级别**：`LOG_LEVEL=debug/info/warn/error`；`warn` 以上通常需要人处理。
- **格式**：`LOG_FORMAT=json` 时一行一条 JSON（包含 `err.name/message/stack`），适合 `jq` 或日志采集；默认 `text` 便于直接看。
- **轮转**：`LOG_MAX_BYTES`（默认 10 MB）和 `LOG_MAX_FILES`（默认 7 个）控制文件历史。
- **脱敏**：`Bearer`、`SESSDATA`、`token=` 以及字段名含 `token/secret/password/authorization/cookie` 的内容会替换为 `***`。

常用排查：

```bash
grep 'req=8f3c2a1b4c5d' data/logs/server.log    # 按请求 ID 查完整链路
grep '\[transcribe\]' data/logs/server.log      # 转录任务阶段
grep '\[deploy\]' data/logs/server.log          # BDS 部署与加载上报
grep '\[ERROR\]' data/logs/server.log | tail    # 最近错误
docker logs --tail 200 <container>              # 控制台镜像（与文件内容一致）
```

## 一致性设计

- 无显式事务：单记录 = 单行原子写（SQLite 单语句自带原子性）
- 曲目内容寻址（id = crc32），重复上传幂等
- 存储端口契约测试与内存驱动共用同一套用例（`packages/core/tests/conformance.ts`）

## 测试

```bash
npm run test:server   # bun test：SQLite 端口契约 + API 全流程
```
