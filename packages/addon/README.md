# @piano/addon — 钢琴附加包

游戏内钢琴与 MIDI 播放器（bepack 构建，依赖 `@piano/core` 与 sapi-pro）。

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
