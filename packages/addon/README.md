# @piano/addon — 钢琴附加包

游戏内钢琴与 MIDI 播放器（bepack 构建，依赖 `@piano/core` 与 sapi-pro）。

## 游戏内演奏

- 准星对准琴键并右键即可弹奏。右键面板右侧的青色按钮打开文字演奏与 MIDI 菜单。
- 行为包与资源包需要同时启用；普通客户端世界不需要开启「Beta APIs」实验。
- 每架琴的琴键显示和 MIDI 播放由同一个运行时管理。区块卸载，或附近 48 格内连续 10 秒没有玩家时，运行时释放播放实例。显示实体保存队列、播放模式和最近进度。回到附近后，正在播放的曲目从保存位置继续，暂停的曲目保持暂停。

## 采样与力度

- 每个音色只保留一档 4 秒长采样；音符长度由 MIDI Note Off（手动按键为 150ms）决定，之后通过 `SoundInstance.fade()` 在 600ms 内淡出并释放。
- Bedrock 客户端同时最多混 32 个音效（整个客户端共享）。钢琴按 28 的声部预算运行：先腾位再 `playSound`，超限时优先收掉更轻、更接近采样结束、或谱面而非手动敲出的音（同条件下保留高音），避免引擎随机截断。踏板长音在 4 秒采样放完后直接释放，不再白占名额。导入时会用同一套离线模型预计算峰值并提示超限曲目（见 `tools/voice-load-report.md`）。
- 缩短淡出时长并不能降低真实同时发声的峰值：2026-11-18 的离线模拟在 606 首曲库中测得最大同时发声 56、P95 为 35。运行时按 28 的钢琴声部预算主动回收较不重要的音；完整数据见 `tools/voice-load-report.md`。
- 力度不是音量档位，而是真实多力度采样：三层音色按 MIDI 力度 42 / 84 切换，立式钢琴两层按 64 切换；明亮三角目前只有单层母带。
- 播放端按力度曲线调整音量（参考力度 90 = 1.0，最强约 +4.5dB），因此同一采样层内也有连续强弱。
- 采样目录为 `rp/sounds/<音色>_v{1..3}/`。重新生成：`npm run build:timbres`；如体积紧张，可用 `VORBIS_Q=1 npm run build:timbres` 进一步压缩。

## 曲库来源：内嵌 与 远程（BDS + server-net）

曲库来源分两级，启动时自动探测：

| 来源 | 启用条件 | 说明 |
|---|---|---|
| 内嵌曲库 | 客户端构建（`npm run build`） | 构建时把公共曲库 PBE3 转成模块，写进 `scripts/packages/addon/src/midis/`，懒加载播放 |
| 远程曲库 | BDS + 服务器专用构建（`npm run build:server`）+ 配置文件 | manifest 声明 `@minecraft/server-net` / `@minecraft/server-admin`，启动时动态加载 `serverAdmin` 读配置并拉取 PBE3 曲目 |

远程分支只在 `__PIANO_TARGET__ === "server"` 时被 `import()`；`serverAdmin.ts` 与 `platform/server/net` 内部是**静态导入**，两个原生模块的依赖由 `bepack.server.config.ts` 写入服务器包 manifest（版本 `beta`）。客户端构建通过常量折叠 + 死代码消除裁掉整个分支，产物不含这些模块，因此普通世界不需要 server-net，也没有远程能力。

注意：**服务器专用构建不打包内嵌曲库**（`midis = []`），远程初始化失败后它没有任何曲目可用。单机/客户端测试请使用客户端包。

### BDS 配置（Agent / 维护者参考）

普通客户端包使用稳定版脚本 API，普通世界不需要开启「Beta APIs」实验。BDS 远程曲库由服务器专用构建提供，使用 `@minecraft/server-net` 与 `@minecraft/server-admin`；服主无需手工照下面步骤操作，优先把 [Server README 的 Agent 安装提示词](../server/README.md#服主安装交给-agent)交给能访问 BDS 文件系统的 Agent。

Agent 或维护者需要核对以下配置：

1. 从最终部署包的 `manifest.json` 读取 `type: "script"` 模块 UUID，在 BDS 的 `config/` 下创建对应目录，并为该模块配置 `permissions.json`。
2. 在该模块的 `allowed_modules` 中允许 `@minecraft/server-net` 与 `@minecraft/server-admin`，保留已有模块权限。不要为了 PianoBE 覆盖其他脚本模块的权限配置。[Microsoft Learn：BDS 脚本权限](https://learn.microsoft.com/en-us/minecraft/creator/documents/bedrockserver/scripting)。
3. 配置后端地址与专用游戏令牌：

```json
// config/default/variables.json
{ "pianoBackendUrl": "http://192.168.1.10:35050" }

// config/default/secrets.json
{ "pianoBackendToken": "Bearer <user-token>" }
```

- `pianoBackendUrl`：BDS 能够访问的后端地址，不能想当然地使用另一容器或另一台机器上的 `localhost`。
- `pianoBackendToken`：完整的 `Bearer <token>`。建议创建独立的 `user` 令牌供游戏端读取曲库和上报加载状态；不要把管理页面使用的 `admin` 令牌写入世界配置。
- `secrets.json` 中的值是 `SecretString`，脚本不会读取明文；`HttpHeader` 会在发送请求时解析它，因此必须保存完整的 Bearer 字符串。
- 未配置 URL 或模块不可用时，服务器专用构建没有内嵌曲库可回退，会记录警告；客户端构建仍使用内嵌曲库。

### 远程模式行为

- 曲目列表：每次打开按页**现拉**（`GET /api/songs?page=…&pageSize=…`，搜索走服务端 `q`），游戏内不持久化完整列表，后端新上传的曲目即时可见；「一键添加」等批量操作才用 `metaAll` 分页取全
- 单曲：播放时按 id 拉取 `GET /api/songs/:id`，后端返回 **PBE3（Base64URL）**；缓存与淘汰统一由 `SongCache` 负责（不再有来源私有的 LRU）
- 已加载曲目在引用期间断网仍可播放；无活跃引用时按内存预算 LRU 淘汰，下次播放重新拉取
- 后端 API 鉴权与部署见 `packages/server/README.md`（Hono + bun:sqlite + Docker）

### 游戏内在线转录（仅服务器专用包）

MIDI 播放器提供「在线转录」入口：输入 BV 号或完整视频链接，后端异步转录。任务归玩家所有，
关闭页面、离开钢琴、拔出存储卡或拆除钢琴都不会中断；重新打开页面即可恢复进度或查看结果。

- 仅 `__PIANO_TARGET__ === "server"` 构建包含入口、管理器与网络代码，客户端产物会被裁掉；入口由通用的 `menuActions` 注册表挂载，普通版不注册也不显示
- BDS 用普通令牌（`user`）即可创建转录任务；只有显式“保存到曲库”需要管理员令牌
- 需要管理员开放玩家导入（`allowPlayerImport`），与 MIDI 导入共用权限；**开始转录不要求存储卡**
- 存储卡只在玩家主动“导入存储卡”时参与，写入的是当时操作的钢琴与当前卡
- 每个玩家同时最多一个任务，已完成但未导入的结果同样占用名额；不持久化、不支持离线恢复或任务历史
- 完成后向玩家发送一次游戏内通知；页面展示曲名、时长、音符数与数据大小，可选择“导入存储卡”或“丢弃结果”
- 导入复用现有存储卡写入与容量校验，并在异步取回结果后重新确认玩家、钢琴、权限与卡 UID；换卡/拔卡会中止本次导入并保留结果，可换卡重试
- 玩家退出、主动取消或导入成功后才释放任务并尽力清理远程结果；清理失败交给服务端 TTL 回收
- 后端默认拒绝超过 10 分钟的视频/音频（`AMT_MAX_AUDIO_SECONDS`），超长视频会在下载前报错

### 故障排查（BDS 控制台日志）

运行时日志统一为 `[PBE][模块][级别] 消息 | 字段`。默认只输出 `info/warn/error`，
逐页/逐曲目的细节在 `debug`；同一个 `warn/error` 在 10 秒内重复出现只保留一条，
并带 `repeated=N`。现场排查时可临时打开细节日志：

```
/scriptevent pbe:log debug
/scriptevent pbe:log info     # 恢复默认
```

server 构建的启动日志（不打印令牌）：

```
[PBE][app][INFO] 主脚本已加载 | target=server          ← 确认装的是服务器专用包
[PBE][server][INFO] 已切换到远程曲库 | url=http://...:35050
[PBE][transcribe][INFO] 在线转录已启用
```

远程拉取细节（`debug` 级别）：
```
[PBE][net][DEBUG] 拉取曲目页 | page=1 url=http://.../api/songs?pageSize=100&page=1
[PBE][net][WARN] 拉取曲目页失败 | page=1 url=http://.../api/songs?... status=401
[PBE][net][DEBUG] 拉取单曲 | song=<id> url=http://.../api/songs/<id>
```

对照判断：

| 日志表现 | 含义 |
|---|---|
| 完全没有 `[PBE][app][INFO] 主脚本已加载` | 装的是模板包（client）或脚本未运行 |
| `Module [@minecraft/server-net] is unrecognized` | 装的包里 manifest 没声明该原生模块（常见于客户端/服务器构建混装），或客户端/单机环境装了服务器专用包——客户端不提供 server-net |
| `[PBE][server][WARN] 未配置后端地址` | `variables.json` 路径/格式不对（应为 `config/default/variables.json`），或键名不是 `pianoBackendUrl` |
| `[PBE][app][WARN] 远程曲库初始化失败` | 后端连接初始化异常；堆栈里会带具体错误。单机请改装客户端包，BDS 请用 `dist/server.mcaddon` |
| `[PBE][playback][WARN] 曲目已失效，已从队列移除` | 当前没有可用曲库来源：服务器包内嵌曲库为空且远程未启用，或该曲目只残留在队列里 |
| `[PBE][net][WARN] 拉取曲目页/单曲失败` + `status=401/403` | 令牌错误，或后端 `ALLOW_PUBLIC_READ=false` 下未带有效令牌 |
| `[PBE][net][WARN] 请求失败（网络/超时/连接被拒）` | 后端不可达：确认 URL 端口、BDS 与后端网络互通（容器内 BDS 需用宿主 IP） |
| `[PBE][server][WARN] 上报加载状态失败` | 后端 `/api/addon/loaded` 不可达或令牌无效；部署哈希不会更新 |

## 音乐存储：公共曲库、存储卡与播放队列

**钢琴只负责播放，存储卡负责保存，公共曲库负责提供音乐。** 钢琴自身不再保存歌曲数据：

| 概念 | 承载 | 说明 |
|---|---|---|
| 公共曲库 | 内嵌/远程只读来源 + 世界全局曲库 | 未插卡也能浏览与播放；普通玩家不能修改 |
| 世界全局曲库 | 世界动态属性 `pb.worldlib.*` | 管理员通过 `/pbe:pbe_library` 导入、浏览、删除；完整 PBE3 持久化，重启后恢复 |
| 音乐存储卡 `pbe:music_card` | ItemStack 动态属性 | 唯一可写个人存储；不可堆叠，随背包/箱子/掉落物/交易转移；一张卡多首；支持整卡播放与顺序调整 |
| 钢琴卡槽 | 显示实体 `minecraft:inventory`（1 格） | 真实 ItemStack；手持卡右键钢琴插入，蹲下 + 空手右键取出，背包满时掉在脚下，绝不吞卡 |
| 播放队列 | 每架钢琴的 `MidiPlayer` | 只保存带来源的曲目引用（存储卡 / 公共曲库）+ 内容指纹 + 卡身份，不复制正文 |

- 手持音乐卡右键钢琴 = 插入；卡槽已有卡时拒绝，不会覆盖或交换。播放器里的「存储卡」入口只有在**确实插卡时**才打开。
- 主钢琴面板只保留演奏与三个入口（MIDI 播放器 / 钢琴设置 / 快捷键），导入与存储卡不再占用主菜单。
- 拆琴：运行时安全结束并销毁队列，卡槽里的实体卡单独退还；钢琴物品不携带歌曲数据。
- 区块卸载/运行时重建：卡在显示实体容器里；`PianoDisplay.recover()` 只迁移卡槽物品，不会复制。
- 容量严格按“实际写入的 Base64 分片 + 键名 + 元数据 JSON（UTF-8）”计算；歌曲放不下直接拒绝并提示需要/可用/还差多少字节，不截断。管理员降低上限后，已超额数据仍可读取、播放与删除，但禁止继续增长。
- 队列条目带来源、CRC 指纹与卡 UID；取出存储卡后，当前已加载歌曲继续播放，后续卡来源条目显示 `⚠` 并安全跳过。换卡后即使 id/内容相同也不会误用另一张卡。
- 存储卡播放顺序保存在卡片元数据 `pb.cardmeta.order`，只记录歌曲 id；新增歌曲追加末尾，删除歌曲自动从顺序中移除。存储卡页支持「播放整张存储卡」「整卡加入播放队列」「调整歌曲顺序」，整卡播放不清空原队列。
- 世界全局曲库默认总容量 8 MiB、最多 500 首；启动时扫描一次元数据建立内存索引，搜索/分页只查索引，不重复扫描世界动态属性。同 id 且内容一致视为幂等重复，同 id 不同内容拒绝覆盖。
- 缓存预算：公共曲库共享 `SongCache` 为 1 MiB，每架钢琴本地播放缓存为 256 KiB。预算只影响淘汰，不限制单曲大小；正在播放的曲目持有引用，不会被淘汰。
- 不兼容旧方案：钢琴内置歌曲、手持存储卡导入、旧世界导入曲库均已移除，不会自动迁移；旧播放快照仍会尽量保留可识别条目。

## 界面与表单栈

- 主面板 → MIDI 播放器 → 队列 / 曲库 / 存储卡 / 导入（服务器专用包另有「在线转录」）；曲库 → 歌曲详情 → 删除确认。
- 曲库固定每页 5 首；搜索框自动查询，支持 `关键词`、`p5`、`关键词 p5`。
- 从播放器进入曲库为管理模式（点击进详情）；从播放队列「添加歌曲」进入为添加模式（点击直接入队，可连续添加）。
- 存储卡管理保留名称、容量、歌曲数、重命名、弹出、整卡播放/入队、顺序调整；单曲管理统一回到曲库。服务器专用包的「在线转录」在 MIDI 播放器主界面，不需要先插卡。
- 管理员全局曲库使用独立命令 `/pbe:pbe_library`，不需要钢琴或存储卡；普通玩家仍通过现有公共曲库搜索与播放这些歌曲。
- 钢琴设置拆成主表单 + 粒子设置 / 文字设置 / 曲谱配置 三个子表单。
- 面向键盘并靠近琴前时，面板手弹会驱动角色双手。播放 MIDI 时可在钢琴设置里单独关闭弹奏动画，默认开启。
- 点琴凳可坐下。P-88 琴凳放在琴前一格时，点琴的任意一半对应的地面都会对齐键盘中央。
- 子页面按 ESC 或「关闭」只回退一层；只有根页面才关闭整个界面（由 SAPI-Pro DDUI 统一处理）。

管理员设置（`/pbe:pbe_setting`）：

- `allowPlayerImport`：允许普通玩家导入
- `cardStorageBytes`：每张存储卡容量上限（默认 65536，4 KiB ~ 1 MiB）

## 游戏内 MIDI 导入

- 普通入口：钢琴面板 / MIDI 播放器的「导入 MIDI」，只写入当前卡槽内的存储卡。
- 管理员入口：`/pbe:pbe_library` →「导入全局歌曲」，无需插卡，写入世界全局曲库。
- 打开存储卡导入时检查卡槽；未插卡会提示并禁止导入。导入过程中绑定打开页面时的卡片身份；拔卡或换卡会拒绝写入，避免写错卡。
- 两个入口复用同一套分段装配、PBE3 结构/CRC32/音符数/时长校验、容量与权限检查。
- 生成器曲目条目上的「码」按钮把 PBE3 切成 ≤4800 字符的分段；游戏内逐段粘贴，支持乱序、去重、断点续传。
- 提交前重新校验权限、频率、PBE3 结构/CRC32/解压长度/音符数/时长和目标容量；分片先写、元数据最后提交，中断不会留下半成品曲目。
- 管理员设置：`/pbe:pbe_setting`（SAPI-Pro ConfigForm，一次性管理员表单保持原生表单）。`allowPlayerImport` 默认 `false`。

## 开发

```bash
npm run build:template   # 产出 dist/template.mcaddon（生成器底包）
npm run build            # 生成 dist/dev.mcaddon（含内嵌曲库与本地插件）
npm run deploy:dev       # 构建并复制开发包到本地 Minecraft
npm run build:server     # 服务器专用构建（不含内嵌曲库）→ dist/server.mcaddon
npm run test:addon           # 源码测试（架构边界、MIDI、生命周期、UI 回归等）
npm run build:release        # 生成发布产物，最后写入客户端 bp/scripts
npm run verify:addon-build   # 检查现有客户端脚本、template.mcaddon 和 server.mcaddon
```

> 两种构建共用 `packages/addon/bp/` 目录并各自重写 `scripts/` 与 `manifest.json`。
> 不要在交替构建后手动挑文件拷贝，也不要只拷 `bp/` 的一部分：脚本与 manifest 不匹配时
> 会出现「服务器脚本 + 客户端 manifest」的混装包（表现为 `@minecraft/server-net` unrecognized）。
> 部署时始终使用 `dist/` 下对应的 `.mcaddon`。

### 仍需 Minecraft 实机确认（脚本测试无法覆盖）

1. 显示实体 `minecraft:inventory` 在最低支持版本 1.26.60 下是否随区块正常保存/恢复；`private` 是否完全阻止玩家直接打开该容器。
2. ItemStack 与世界动态属性的单值长度与总量上限：存储卡默认 64 KiB、全局曲库默认 8 MiB，按 20k 字符分片；实机写入是否被引擎拒绝（超限时应报可见错误而不是丢数据）。
3. 拆琴 → 存储卡退还 → 重新放置的完整链路（含区块边界、爆炸、活塞、创造模式）。
4. 卡槽插入/取出/背包满/卡片被替换/多人同时操作时的真实交互与消息提示。
5. 插卡视觉：目前只写了同步属性 `pbe:card_inserted`，模型上的实体卡外观还需要资源包骨骼/贴图配合。

## 音色包与生成器

- `npm run build` 生成包含全部音色的开发用 `dev.mcaddon`。使用 `npm run deploy:dev` 更新本地游戏开发包目录。
- [VFX Lab](../../docs/vfx/README.md)：瞄准钢琴后运行 `/scriptevent pbe:vfx demo`，可独立预览三种粒子素材和组合演出。
- `npm run build:template`：生成供生成器使用的精简基础模板，只保留标准钢琴；
  可选音色由生成器按用户勾选合并，不再把整套音色塞进模板。
- `npm run build:timbres`：重新下载/裁剪/转码音色采样，并生成
  `rp/sounds/sound_definitions.json`。Salamander（明亮三角）的母带不随仓库分发，放在
  `tools/piano_source/`；存在时会对齐其它钢琴音色的逐键响度，缺少时默认跳过。
  重建标准钢琴时会同步 web 试听页使用的采样副本。
- `npm run verify:timbres`：验证“只选默认 / 默认 + 某个音色”的导出结果，
  检查采样目录、音效定义和 `scripts/packages/addon/src/domain/piano/timbres.js` 是否一致。

生成器导出时会覆写 `bp/scripts/packages/addon/src/domain/piano/timbres.js`，游戏内设置只显示该包实际
包含的音色；标准钢琴始终保留，因此至少有一套音色可用。

音色均为第三方免费采样：标准钢琴来自 FluidR3 GM，经典三角来自 VCSL 施坦威 B（CC0），
明亮三角来自 Salamander Grand Piano V3（Alexander Holm，CC BY 3.0），原声立式来自 FreePats KW（CC0），
复古电钢来自 FreePats FM Piano #1（CC0）；完整来源与授权见 `rp/THIRD_PARTY_NOTICES.md`。
