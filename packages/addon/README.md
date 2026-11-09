# @piano/addon — 钢琴附加包

游戏内钢琴与 MIDI 播放器（bepack 构建，依赖 `@piano/core` 与 sapi-pro）。

## 游戏内演奏

- 准星对准琴键并右键即可弹奏。右键面板右侧的青色按钮打开文字演奏与 MIDI 菜单。
- 测试世界需要开启「Beta API」。行为包与资源包应同时启用。
- 每架琴的琴键显示和 MIDI 播放由同一个运行时管理。区块卸载，或附近 48 格内连续 10 秒没有玩家时，运行时释放播放实例。显示实体保存队列、播放模式和最近进度。回到附近后，正在播放的曲目从保存位置继续，暂停的曲目保持暂停。

## 曲库来源：内嵌 与 远程（BDS + server-net）

曲库来源分两级，启动时自动探测：

| 来源 | 启用条件 | 说明 |
|---|---|---|
| 内嵌曲库 | 默认（所有环境） | 构建时打入包的 `scripts/midis/`，懒加载播放 |
| 远程曲库 | BDS 专用服务器 + 配置文件 | 经 `@minecraft/server-admin` 读配置、`@minecraft/server-net` 从后端拉取曲目 JSON |

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
- 单曲：播放时按 id 拉取 `GET /api/songs/:id`，**仅内存 LRU 缓存最近 10 首**（不落动态属性/存档，重启即空），已缓存歌曲断网可播
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

## 开发

```bash
npm run build:template   # 产出 dist/template.mcaddon（生成器底包）
npm run build            # 编译 + 拷贝到测试服
npm run test -w @piano/addon  # bun test（netSource 缓存/降级逻辑）
```

## 音色包与生成器

- `npm run build`：开发构建，包含全部音色，并复制到本地游戏开发包目录。
- `npm run build:template`：生成供生成器使用的精简基础模板，只保留经典 P-88；
  可选音色由生成器按用户勾选合并，不再把整套音色塞进模板。
- `npm run build:timbres`：重新下载/裁剪/转码音色采样，并生成
  `rp/sounds/sound_definitions.json`。
- `npm run verify:timbres`：验证“只选默认 / 默认 + 某个音色”的导出结果，
  检查采样目录、音效定义和 `scripts/piano/timbres.js` 是否一致。

生成器导出时会覆写 `bp/scripts/piano/timbres.js`，游戏内设置只显示该包实际
包含的音色；经典 P-88 始终保留，因此至少有一套音色可用。
