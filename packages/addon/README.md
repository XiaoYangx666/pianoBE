# @piano/addon — 钢琴附加包

游戏内钢琴与 MIDI 播放器（bepack 构建，依赖 `@piano/core` 与 sapi-pro）。

## 游戏内演奏

- 准星对准琴键并右键即可弹奏。右键面板右侧的青色按钮打开文字演奏与 MIDI 菜单。
- 测试世界需要开启「Beta API」。行为包与资源包应同时启用。
- 每架琴的琴键显示和 MIDI 播放由同一个运行时管理。区块卸载，或附近 48 格内连续 10 秒没有玩家时，运行时释放播放实例。显示实体保存队列、播放模式和最近进度。回到附近后，正在播放的曲目从保存位置继续，暂停的曲目保持暂停。

## 采样与力度

- 每个音色只保留一档 4 秒长采样；音符长度由 MIDI Note Off（手动按键为 150ms）决定，之后通过 `SoundInstance.fade()` 在 600ms 内淡出并释放。
- Bedrock 客户端同时最多混 32 个音效（整个客户端共享）。钢琴按 28 的声部预算运行：先腾位再 `playSound`，超限时优先收掉更轻、更接近 Note Off、或谱面而非手动敲出的音，避免引擎随机截断。导入时会用同一套离线模型预计算峰值并提示超限曲目（见 `tools/voice-load-report.md`）。
- 缩短淡出时长并不能降低峰值：全库最重的曲目峰值 42 个音来自真正同时按住的音，释放从 120ms 调到 800ms 峰值仍是 42~44，所以没有把淡出时长写进 PBE2。
- 力度不是音量档位，而是真实多力度采样：三层音色按 MIDI 力度 42 / 84 切换，立式钢琴两层按 64 切换；明亮三角目前只有单层母带。
- 播放端按力度曲线调整音量（参考力度 90 = 1.0，最强约 +4.5dB），因此同一采样层内也有连续强弱。
- 采样目录为 `rp/sounds/<音色>_v{1..3}/`。重新生成：`npm run build:timbres`；如体积紧张，可用 `VORBIS_Q=1 npm run build:timbres` 进一步压缩。

## 曲库来源：内嵌 与 远程（BDS + server-net）

曲库来源分两级，启动时自动探测：

| 来源 | 启用条件 | 说明 |
|---|---|---|
| 内嵌曲库 | 默认（所有环境） | 构建时打入包的 `scripts/midis/`，懒加载播放 |
| 远程曲库 | BDS 专用服务器 + 配置文件 | 经 `@minecraft/server-admin` 读配置、`@minecraft/server-net` 从后端拉取 PBE2 曲目 |

两个模块均为**动态导入 + try/catch 探测**（`manifest` 不声明依赖）：
- 客户端/普通世界 → import 失败 → 静默使用内嵌曲库，不受影响
- BDS → 配置好 `variables.json` / `secrets.json` 即自动切换远程曲库

### BDS 配置（配置文件示例）

```
config/default/variables.json    → { "pianoBackendUrl": "http://192.168.1.10:35050" }
config/default/secrets.json      → { "pianoBackendToken": "Bearer xxxxx" }
```

- `pianoBackendUrl`：后端地址（`variables`，普通可读配置）
- `pianoBackendToken`：令牌（`secrets`，**SecretString**：脚本环境读不到值，
  请求时由 HttpHeader 解析；因无法拼接前缀，需保存完整的 `Bearer <token>`）
- 未配置 URL 或模块不可用 → 保持内嵌曲库并输出一行警告

### 远程模式行为

- 曲目列表：每次打开**现拉**（`GET /api/songs` 分页取全），游戏内不持久化完整列表，后端新上传的曲目即时可见
- 单曲：播放时按 id 拉取 `GET /api/songs/:id`，后端返回 **PBE2（Base64URL）**；缓存与淘汰统一由 `SongCache` 负责（不再有来源私有的 LRU）
- 已加载曲目在引用期间断网仍可播放；无活跃引用时按内存预算 LRU 淘汰，下次播放重新拉取
- 后端 API 鉴权与部署见 `packages/server/README.md`（Hono + bun:sqlite + Docker）

### 故障排查（BDS 控制台日志）

server 构建会在控制台输出逐步诊断（不打印令牌）：

```
[piano] 主脚本已加载，构建目标: server          ← 确认装的是服务器专用包
[piano] server 构建：20 tick 后尝试初始化远程曲库
[serverAdmin] step1 读取配置 pianoBackendUrl = "http://...:35050"
[serverAdmin] step2 获取 @minecraft/server-net 适配器
[serverAdmin] step3 已读取 secrets 令牌 / 未读取到 secrets 令牌
[serverAdmin] step4 切换到远程曲库: http://...:35050
[netSource] 拉取曲目列表: GET http://.../api/songs?pageSize=100
[netSource] 曲目列表响应状态: 200
[netSource] 曲目列表拉取成功: N 首
```

对照判断：

| 日志表现 | 含义 |
|---|---|
| 完全没有 `[piano] 主脚本已加载` | 装的是模板包（client）或脚本未运行 |
| `step1 ... (未配置)` | `variables.json` 路径/格式不对（应为 `config/default/variables.json`） |
| `step3 未读取到 secrets 令牌` | `secrets.json` 缺失或键名不对（`pianoBackendToken` 需含完整 `Bearer ` 前缀） |
| `[netSource] ... 拉取失败: ... 网络/超时/连接被拒` | 后端不可达：确认 URL 端口、BDS 与后端网络互通（容器内 BDS 需用宿主 IP） |
| `响应状态: 401/403` | 令牌错误或后端 `ALLOW_PUBLIC_READ=false` 下未带有效令牌 |

## 音乐存储：公共曲库、存储卡与播放队列

**钢琴只负责播放，存储卡负责保存，公共曲库负责提供音乐。** 钢琴自身不再保存歌曲数据：

| 概念 | 承载 | 说明 |
|---|---|---|
| 公共曲库 | 内嵌/远程只读来源 + 世界全局曲库 | 未插卡也能浏览与播放；普通玩家不能修改 |
| 世界全局曲库 | 世界动态属性 `pb.worldlib.*` | 管理员通过 `/pbe:pbe_library` 导入、浏览、删除；完整 PBE2 持久化，重启后恢复 |
| 音乐存储卡 `xypiano:music_card` | ItemStack 动态属性 | 唯一可写个人存储；不可堆叠，随背包/箱子/掉落物/交易转移；一张卡多首；支持整卡播放与顺序调整 |
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

- 主面板 → MIDI 播放器 → 队列 / 曲库 / 存储卡 / 导入；曲库 → 歌曲详情 → 删除确认。
- 曲库固定每页 5 首；搜索框自动查询，支持 `关键词`、`p5`、`关键词 p5`。
- 从播放器进入曲库为管理模式（点击进详情）；从播放队列「添加歌曲」进入为添加模式（点击直接入队，可连续添加）。
- 存储卡管理保留名称、容量、歌曲数、重命名、弹出，以及整卡播放/入队与顺序调整；单曲管理统一回到曲库。
- 管理员全局曲库使用独立命令 `/pbe:pbe_library`，不需要钢琴或存储卡；普通玩家仍通过现有公共曲库搜索与播放这些歌曲。
- 钢琴设置拆成主表单 + 粒子设置 / 文字设置 / 曲谱配置 三个子表单。
- 子页面按 ESC 或「关闭」只回退一层；只有根页面才关闭整个界面（由 SAPI-Pro DDUI 统一处理）。

管理员设置（`/pbe:pbe_setting`）：

- `allowPlayerImport`：允许普通玩家导入
- `cardStorageBytes`：每张存储卡容量上限（默认 65536，4 KiB ~ 1 MiB）

## 游戏内 MIDI 导入

- 普通入口：钢琴面板 / MIDI 播放器的「导入 MIDI」，只写入当前卡槽内的存储卡。
- 管理员入口：`/pbe:pbe_library` →「导入全局歌曲」，无需插卡，写入世界全局曲库。
- 打开存储卡导入时检查卡槽；未插卡会提示并禁止导入。导入过程中绑定打开页面时的卡片身份；拔卡或换卡会拒绝写入，避免写错卡。
- 两个入口复用同一套分段装配、PBE2 结构/CRC32/音符数/时长校验、容量与权限检查。
- 生成器曲目条目上的「码」按钮把 PBE2 切成 ≤4800 字符的分段；游戏内逐段粘贴，支持乱序、去重、断点续传。
- 提交前重新校验权限、频率、PBE2 结构/CRC32/解压长度/音符数/时长和目标容量；分片先写、元数据最后提交，中断不会留下半成品曲目。
- 管理员设置：`/pbe:pbe_setting`（SAPI-Pro ConfigForm，一次性管理员表单保持原生表单）。`allowPlayerImport` 默认 `false`。

## 开发

```bash
npm run build:template   # 产出 dist/template.mcaddon（生成器底包）
npm run build            # 编译 + 拷贝到测试服
npm run test -w @piano/addon  # bun test（架构边界、MIDI、生命周期、UI 回归等）
npm run verify:addon-build    # client/server 构建 + MIDI 路径与 server-only 隔离检查
```

### 仍需 Minecraft 实机确认（脚本测试无法覆盖）

1. 显示实体 `minecraft:inventory` 在 1.26.50 稳定版下是否随区块正常保存/恢复；`private` 是否完全阻止玩家直接打开该容器。
2. ItemStack 与世界动态属性的单值长度与总量上限：存储卡默认 64 KiB、全局曲库默认 8 MiB，按 20k 字符分片；实机写入是否被引擎拒绝（超限时应报可见错误而不是丢数据）。
3. 拆琴 → 存储卡退还 → 重新放置的完整链路（含区块边界、爆炸、活塞、创造模式）。
4. 卡槽插入/取出/背包满/卡片被替换/多人同时操作时的真实交互与消息提示。
5. 插卡视觉：目前只写了同步属性 `xypiano:card_inserted`，模型上的实体卡外观还需要资源包骨骼/贴图配合。

## 音色包与生成器

- `npm run build`：开发构建，包含全部音色，并复制到本地游戏开发包目录。
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
