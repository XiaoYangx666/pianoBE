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
config/default/variables.json    → { "pianoBackendUrl": "http://192.168.1.10:3000" }
config/default/secrets.json      → { "pianoBackendToken": "Bearer xxxxx" }
```

- `pianoBackendUrl`：后端地址（`variables`，普通可读配置）
- `pianoBackendToken`：令牌（`secrets`，**SecretString**：脚本环境读不到值，
  请求时由 HttpHeader 解析；因无法拼接前缀，需保存完整的 `Bearer <token>`）
- 未配置 URL 或模块不可用 → 保持内嵌曲库并输出一行警告

### 远程模式行为

- 曲目列表：启动后从 `GET /api/songs` 拉取，内存缓存 5 分钟 + 世界动态属性持久缓存（断网可读）
- 单曲：播放时按 id 拉取 `GET /api/songs/:id` 并缓存，之后离线可播
- 后端 API 鉴权与部署见 `apps/server/README.md`（Hono + bun:sqlite + Docker）

## 开发

```bash
npm run build:template   # 产出 dist/template.mcaddon（生成器底包）
npm run build            # 编译 + 拷贝到测试服
npm run test -w @piano/addon  # bun test（netSource 缓存/降级逻辑）
```
