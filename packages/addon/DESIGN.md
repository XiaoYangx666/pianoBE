# PianoBE Addon Design

本文记录 addon 的长期架构约束。重点不是“文件在哪”，而是**谁拥有什么、谁可以依赖谁、哪些行为不能随意改**。

## 1. 模块分层

```text
data        静态内容：内嵌 MIDI、生成数据
  ↑
domain      纯业务逻辑：MIDI 状态机、队列、键位、几何、设置、输入解析、乐器定义
  ↑
runtime     通用运行时机制：PianoScope（只依赖 Tabletop 核心）
  ↑
platform    Minecraft 宿主适配：实体、方块、显示、粒子、存储、服务器通信
  ↑
app         业务协调与组装：PianoWorld、PianoRuntime、输入路由、UI、启动
```

依赖规则：

- `domain/**` 不得依赖 `@minecraft/server`、`@minecraft/server-ui`、`sapi-pro`、`@begame/tabletop/minecraft`、`runtime`、`platform`、`app`。
- `runtime/**` 不得依赖 Minecraft，也不得依赖 `app`、`platform`；可以依赖 `@begame/tabletop` 核心。
- `platform/**` 集中处理宿主适配，可以依赖 `domain`、`runtime`、`data` 和 Minecraft/Tabletop 平台 API，但不得依赖 `app`。
- `app/**` 负责组装和业务协调，可以依赖所有层，也可以直接使用必要的 Minecraft 平台 API；UI 与方块/实体事件入口是明确允许的例外，不要求为每个 MC 调用建立 Port/Adapter。
- `data/**` 只放静态数据/生成数据，不得反向依赖 `domain`、`runtime`、`platform`、`app`。

因此 `platform` 不是“唯一允许访问 Minecraft API 的层”。边界保护的是依赖方向（尤其 `platform` 不反向依赖 `app`、`domain` 不接触宿主），而不是形式上的绝对隔离。

- `src/midis/index.ts` 是构建钩子的固定入口：`bepack` 的 `afterBuild` 会把仓库根目录 `midis/js/` 覆盖到 preserve-modules 输出中的 `packages/addon/src/midis/`（与 `app/midiManager.ts` 的相对导入一致），所以这个生成入口保留在 `src/midis/`，不随其他数据移入 `data/`。

自动检查：`tests/architecture.test.ts` 使用 TypeScript 编译器 API 解析真实模块图（包括路径别名、re-export、type-only import 和动态 import），并检查依赖方向与循环依赖。

## 2. 核心对象与所有权

| 对象 | 所有者 | 职责 |
| --- | --- | --- |
| `PianoScope` | `runtime/scope.ts` | 基于 Tabletop `RuntimeScope` 的钢琴专用包装；负责资源登记、命名诊断、非抛出式销毁。 |
| `PianoRuntime` | `app/PianoRuntime.ts` | 单台钢琴的运行时：播放、设置、显示协调、文字、粒子、checkpoint。 |
| `PianoWorld` | `app/PianoWorld.ts` | 钢琴注册表、发现、交互路由、距离卸载、sweep、verify。 |
| `PianoDisplay` | `platform/display.ts` | 持久显示实体的创建、恢复、绑定、去重、属性写入、设置/播放数据持久化。 |
| `MidiPlayer` | `domain/playback/player.ts` | 播放状态机、队列推进、暂停/恢复/seek/结束；通过注入的 `MidiLoader` 加载曲目。 |
| `MidiManager` | `domain/playback/midiManager.ts` | 曲目元信息注册、分页查询、按 id 加载。 |
| `midiManager` 单例 | `app/midiManager.ts`（由 `app/midi.ts` re-export） | 组合内嵌/远程 MIDI 源；只在 app 层初始化。 |
| UI 表单 | `app/ui/**` | 玩家级 DDUI 表单按需创建、活动表单防重入、异步交互保护；可直接依赖 `PianoWorld`/`PianoRuntime`。 |
| 存储驱动 | `platform/storage/**` | 动态属性播放列表存储；不依赖 UI。 |
| 服务器适配 | `platform/server/**` | `server-net` 传输、远程 MIDI/播放列表读取；不依赖 app。 |
| 服务器初始化 | `app/serverAdmin.ts` | 读取 secrets/variables，切换 `midiManager` 与播放列表 facade；属于组装逻辑。 |

`PianoWorld → PianoRuntime` 是单向依赖。`PianoRuntime` 不导入 `PianoWorld`。

## 3. 生命周期

### 放置 / 发现

1. 方块组件解析乐器装配，发布 `instrumentPlaced`。
2. `PianoWorld.get()` 创建或复用 `PianoRuntime`。
3. `PianoRuntime.ensureVisual()` 恢复或创建持久显示实体，并创建临时文字资源。

### 创建 / 销毁

| 对象 | 创建 | 销毁 |
| --- | --- | --- |
| `PianoRuntime` | `PianoWorld.get()`：放置、附近方块 tick、实体恢复、玩家交互时按坐标懒创建 | `PianoWorld.unload()`：乐器拆除、结构不完整、区块卸载、离开视野 200 tick、朝向/类型变化、运行时异常 |
| `MidiPlayer` | `PianoRuntime.getMidiPlayer()` 首次访问时懒创建，归 `PianoRuntime` 的 `PianoScope` 所有 | `PianoRuntime.dispose()` 时由 scope 调用 `midi.end()`；`dispose(false)` 会先 checkpoint，重载后从显示实体恢复 |
| 钢琴 UI 包装（`PianoPanelSession`） | 每次打开面板时新建，关闭后释放 | 表单关闭或 `PianoRuntime.disposedSignal` 触发时 `dispose()` |
| MIDI UI 包装（`MidiPlayerPanelSession`） | 每次打开播放器时新建，只引用运行时已有的 `MidiPlayer` | 表单关闭后 `dispose()`，解绑 MIDI 信号 |
| `PianoViewModel` | 首次打开面板时按钢琴创建，生命周期跟随 `PianoRuntime` | 汇总 `noteSignal` 的 active MIDI notes，共享 `activeKeys`；钢琴销毁时释放 |
| `MidiPlayerViewModel` | 首次打开 MIDI 面板时按 `MidiPlayer` 创建，生命周期跟随播放器 | 共享只读 MIDI 文本/进度；播放器 `end()` 时释放 |

`PianoRuntime` 是唯一持有实际钢琴状态的运行时；UI 包装每次打开重建，不会创建第二架钢琴、显示实体或 `MidiPlayer`。
共享的只读 UI 状态（键位、MIDI 文本/进度）由 `PianoViewModel` / `MidiPlayerViewModel` 持有，关闭表单只解绑显示。

### 运行

- `PianoWorld` 每 20 tick sweep 一次：更新附近玩家、检查装配完整性、处理距离卸载。
- `PianoRuntime.verify()` 按 `VERIFY_INTERVAL` 检查装配完整性。
- `PianoRuntime.tick()` 推进 MIDI 状态机、更新键位/灯光和 LCD。
- 播放状态机通过 `MidiOutput` 回调发声；状态机本身不直接调用 Minecraft。

### 卸载

- 运行时释放 **不等于** 删除钢琴显示实体。
- `PianoRuntime.dispose(false)`：checkpoint 播放记录、释放临时文字/MIDI、保留显示实体和设置。
- `PianoRuntime.dispose(true)`：真正拆除时删除所属显示实体。
- `PianoDisplay.recover()` 负责锚点动态属性、朝向检查、重复实体处理、数据迁移。
- `PianoScope` 只负责订阅、定时器、文字、显示/MIDI 清理等运行时资源；不决定业务状态，也不删除物理钢琴。

### 销毁顺序

1. 停止/释放运行时（播放、文字、显示协调）。
2. 再处理物理装配/显示实体。
3. 全局方块事件订阅由 addon 生命周期持有，不随单台钢琴销毁。

## 4. 持久实体与临时资源

- **持久显示实体**：`xypiano:piano_display` / `xypiano:grand_display`，是钢琴外观的一部分，不因玩家离开而删除。它持有键位属性、灯光、设置和播放记录。
- **临时运行时资源**：`NativeTextSurface`、MIDI 播放器、定时器、订阅、`PianoScope` 子作用域。它们随 `PianoRuntime.dispose()` 回收。
- 不采用棋牌盒的 Anchor / Visual 分离：钢琴显示实体不是可随时删除的派生投影，键位和灯光就是乐器外观本身。

## 5. MIDI 边界

```text
MidiManager / MidiSource
        ↓ 注入 MidiLoader
MidiPlayer 状态机（domain）
        ↓ MidiOutput.note / playing
PianoRuntime
        ↓
Minecraft playSound / 粒子 / 显示
```

- `MidiPlayer` 不依赖 `@app/midi` 全局单例；构造时接收 `MidiLoader`。
- 曲目加载、队列、暂停、恢复、seek、结束事件保持原有行为。
- `getInfo()` 不再携带 `Dimension`/`Vector3`；UI 只消费播放状态与进度。
- 异步加载使用 generation 校验；运行时销毁后旧请求不会继续产生副作用。

## 6. UI、存储与服务器

- UI 业务控制保留在 `app/ui/**`，允许直接使用 Minecraft UI API 和 `PianoWorld`/`PianoRuntime`。
- MIDI 播放器主界面固定 6 个按钮：播放/暂停、点歌、上一首、下一首、播放模式、歌单；队列与播放列表合并进“歌单”，避免继续增加主界面按钮。
- 点歌列表固定“上一页/下一页 + 搜索/页码”，点击歌曲加入队尾；队列已有该曲目时直接跳到已有项，不重复添加。
- 可复用的平台操作（显示、方块、粒子、存储、网络）放在 `platform/**`。
- `platform/**` 不反向依赖 `app`；服务器初始化这种跨模块编排放在 `app/serverAdmin.ts`。
- `__PIANO_TARGET__` 双构建语义保持不变：client 构建通过 `compile.define` 折叠并裁剪 server 分支；server 构建保留 `server-admin`/`server-net` 动态加载。
- 内嵌 MIDI 由构建钩子从仓库根目录 `midis/js/` 拷贝到 preserve-modules 输出中的 `packages/addon/src/midis/`，与 `app/midiManager.ts` 的 `../midis/index.js` 相对导入一致；远程曲库仍通过 `midiManager.setSource()` 切换。server 构建跳过该拷贝，使用远程源/空内嵌源。

### Observable 归属

| 归属 | 创建时机 | 销毁时机 | 内容 |
| --- | --- | --- | --- |
| `PianoViewModel`（per-piano） | 第一次打开钢琴面板 | `PianoRuntime.disposedSignal` | `activeKeys`；订阅 `PianoRuntime.noteSignal` |
| `MidiPlayerViewModel`（per-piano） | 第一次打开 MIDI 面板 | `MidiPlayer.disposedSignal`（`end()`） | 只读 MIDI 文本/进度/播放模式 + `invalid` |
| `PianoPanelSession`（per-player） | 每次打开钢琴面板 | 表单关闭 / `dispose()` | 输入、键位映射、八度、音色、曲谱页、状态与文字行 |
| `MidiPlayerPanelSession`（per-player） | 每次打开 MIDI 面板 | 表单关闭 / `dispose()` | 玩家自己的 `progressSlider`；只读字段引用共享 view model |
| `PianoSettingsForm` | 每次打开设置 | `close()` 并显式解绑字段订阅 | 设置字段与 `hasScreen` |
| `PianoScoreForm` / `MidiImportForm` | 每次打开对应表单 | 表单关闭 | 搜索/分页/导入进度等玩家会话状态 |

共享只读 Observable 在表单关闭后保留，表单只增减绑定；不要把它们重新挪回玩家会话。`retain()` / `release()` 只控制播放状态刷新订阅，不销毁 view model。

## 7. 有意保留的保护措施

以下机制不要因为“看起来多余”而删除：

- `PianoDisplay.recover()` 的锚点、朝向、重复实体、数据迁移逻辑。
- `PianoRuntime.dispose(false)` 与 `dispose(true)` 的区分。
- `unloadedSettings` 的暂存与重试保存。
- `PianoWorld` 的 sweep、verify、距离卸载宽限。
- MIDI 异步加载的 generation 校验。
- UI 的失效检测、异步打开保护和活动表单防重入；不再依赖实例复用规避内存泄漏。
- 从队列等子页面返回 MIDI 播放器时必须重新走 `openMidiPlayer()`/`setBlock()`，不能只调用 `show()`：`close()` 会释放本会话的 view model 引用，旧运行时也可能已被卸载或替换；子页面 `onBack` 只捕获 player/block。
- 装配完整性三态（`complete` / `incomplete` / `unloaded`）、放置回滚、精准采集掉落抑制。
- 方块事件、爆炸聚合、显示实体去重。

## 8. 明确不采用的方案

- 不采用 `GameSession`、回合、席位、决策系统：钢琴是连续实时乐器，不是棋牌对局。
- 不采用 Anchor / Visual 分离：显示实体是钢琴外观和持久状态的一部分。
- 不为每个类/接口创建文件，不引入 DI 容器或大型事件总线。
- 不为了“无 MC import”重写现有 UI 或方块组件。

## 9. 验证

自动检查：

```sh
npx tsc -p packages/addon/tsconfig.json --noEmit
cd packages/addon && bun test
cd packages/addon && npx bepack build --skip-copy
cd packages/addon && node ../../tools/verify-addon-build.mjs client
cd packages/addon && npx bepack build --config bepack.server.config.ts --skip-copy
cd packages/addon && node ../../tools/verify-addon-build.mjs server
```

构建布局约束：preserve-modules 输出把入口相关模块放在 `bp/scripts/` 根层，路径别名模块保留 `packages/addon/src/**` 结构。`tools/verify-addon-build.mjs` 会同时校验源码导入、构建钩子目标目录和实际产物的相对解析，避免 MIDI 路径偏移导致运行时曲库为空。生成器覆写音色开关时使用 `bp/scripts/packages/addon/src/domain/piano/timbres.js`，路径由 `packages/generator/src/timbres.ts` 的 `TIMBRES_SCRIPT_PATH` 统一提供，并由同一脚本校验模板产物。

测试覆盖：

- `tests/architecture.test.ts`：依赖方向、循环依赖、`PianoRuntime` 不依赖 `PianoWorld`、负向违规检测。
- `tests/midiPlayerUI.test.ts`：播放器→队列→返回后的重新订阅、重复进出不累积订阅、关闭/运行时结束解除订阅、钢琴拆除/运行时替换/玩家失效时不重开旧界面。
- `tests/buildLayout.test.ts`：内嵌 MIDI 源码导入、构建钩子目标与产物入口的一致性。
- `tests/pianoScope.test.ts`：清理失败不阻断其它清理、子作用域级联、幂等销毁。
- `tests/pianoPlayback.test.ts`：MIDI 恢复、暂停/恢复、销毁后旧加载不复活、销毁后不再发声、多台钢琴状态隔离。
- `tests/pianoDisplayLifecycle.test.ts`：运行时释放保留显示实体、真正拆除删除实体、重复实体恢复。
- `tests/instrument.test.ts`：装配完整性、放置/销毁、回滚。
- `tests/pianoDisplay.test.ts`、`pianoRay.test.ts`、`pianoSettings.test.ts`、`pianoTimbres.test.ts`、`netSource.test.ts`、`remotePlaylist.test.ts`。

无法可靠自动覆盖、需要实机验证的场景：

- 真实客户端上的 DDUI 表单行为与写权限。
- 区块卸载/重载时显示实体的恢复与去重。
- 数字钢琴/三角钢琴的 LCD 朝向、键位动画、灯光。
- 精准采集、爆炸、活塞/命令破坏的掉落与清理。
- BDS 上 `server-admin`/`server-net` 的 secrets/variables 与远程曲库初始化。

实机建议步骤：

1. 放置数字钢琴，确认显示、LCD、按键发声。
2. 放置三角钢琴，确认多方块装配、LCD、菜单、粒子。
3. 离开 200 tick 以上再返回，确认运行时重载、显示不重复、设置/播放记录保留。
4. 卸载/重载区块，确认显示恢复且旧重复实体被清理。
5. 精准采集、爆炸、活塞/命令破坏，确认模块掉落与显示清理正确。
6. BDS server 构建：配置 variables/secrets，确认远程曲库加载与播放列表切换。
