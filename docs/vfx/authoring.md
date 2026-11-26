# VFX 创作与扩展指南

重构后的 VFX 系统在新增特效、画笔、舞台主题或曲目演出时，无需修改通用播放器 `VfxEngine` 或 `@piano/core` PBE3 编解码器；所有内置内容均以独立插件形式向 `VfxRegistry` 注册，也支持直接打包为 `.pbeplugin` 供生成器按需装配。

## 1. 新增或扩展 VFX 特效插件

1. 在 `plugins/<name>/vfx/index.ts`（内置插件目录：`atmosphere`、`curves`、`stage`、`keys`、`accents`、`themes`、`chinese`、`floral`）或独立第三方插件目录中添加插件定义：
   - 在 `plugin.json` 中填写 `id`、`name`、`version`、`apiVersion`（当前 `"1.0.0"`）、`minPianoBeVersion`、`capabilities`（`["vfx"]`）以及 `provides`（声明本插件注册的 `effects`、`themes`、`layouts`、`keyStyles`、`particles`）。
   - 在 `register(api)` 中调用 `api.registerEffect({ ... })` 注册特效，填写 `id`、`label`、`category`、`trigger`（`continuous` / `note` / `instant` / `control`）、`interval`、`priority`。
   - 如需对外开放可调几何/运动/形态控制，声明 `parameters`（支持数值 `min`/`max`/`default`/`step`、布尔 `type: "boolean"` 与枚举 `type: "enum", options`），并在 `emit({ params })` 中通过 `resolveSchemaParams(SCHEMA, params.custom)` 读取（数值参数自动在 `set` + `fade` 上平滑渐变，布尔/枚举在提示时刻切换，并继续保留音乐响应叠加）。
   - 需要跨帧平滑衔接（如前一帧长度/高度）或切换状态时声明 `createState: () => ({ ... })`，避免在播放器中维护全局字段。
   - 如需动态调整间隔或与其他特效互相让步，可选声明 `nextInterval`、`tags` 与 `yields: { tag, ticks }`。
   - 在 `emit(context)` 中调用 `@piano/vfx` 提供的 `drawPoints`、`drawStrokeSegments`、`drawGroundRing` 等原语返回 `{ priority, emitters }`。
   - 插件脚本可导入 `@piano/vfx`、`@piano/core` 和同一包内的模块。其他插件的内容通过资源 ID 引用，并在 `dependencies` 声明提供方。
2. 所有已注册的特效及其 `parameters` 会自动出现在 Web VFX Lab「单特效」、主题图层选择器、`/pbe:vfx list` 与 `.pbe3` 参数编解码中；无需修改 `@piano/core` 或任何开关表。
3. 执行 `npm run pack:plugins && npm run validate:plugins && npm run test:vfx`，会自动校验 `plugin.json` 声明一致性、打包产物安全规范、变量完备性、参数范围声明、有限性与生命周期上限。

## 2. 新增画笔或粒子贴图资源

1. 在唯一数据源 `packages/vfx/src/data/vfxAtlas.json` 中追加 `pointBrushes`（8×2 网格内最多 16 项）或 `strokeBrushes` 条目，或扩展 `tiles`。
2. 在 `tools/assets/vfx/atlas.mjs` 实现对应像素与 MER 发光层绘制函数。
3. 执行资源生成并校验：
   ```sh
   npm run assets:vfx
   node tools/assets/build-vfx-lab.mjs --check
   ```
   `packages/vfx/src/spatial/brushes.ts`、`pbe_vfx_draw_point.particle.json`（二维图集网格坐标）以及 Web VFX Lab 下拉菜单都会自动读取新画笔，无需手动同步多个索引常量。

## 3. 新增普通弹奏粒子样式

普通弹奏粒子由 `pianobe.keys` 插件（或其它自定义 VFX 插件）注册，多数样式复用宿主图集 `vfx_lab`。新增样式只需要在 `plugins/keys/vfx/index.ts` 的 `KEYS_PARTICLE_STYLES` 添加一条（并同步更新 `plugins/keys/plugin.json` 的 `provides.keyStyles`），在同一个定义里声明渲染方式与配色能力：

```ts
my_style: {
    label: "我的键上粒子",
    value: 8,              // 出现在钢琴设置中；不写则仅作为 key_style 变体
    render: "point",       // point = draw_point；stream = key_stream；drift = key_drift
    particle: "key_blue_tears", // 可选：覆盖渲染原语，使用插件或宿主提供的粒子文档
    brush: "star",         // vfxAtlas 点画笔
    alpha: 0.9,
    color: { mode: "free" }, // free / limited / fixed；fixed 使用 colors
    draw: { count: 3, life: 0.6, size: 0.05, aspect: 1, velocity: [0, 1.2, 0], twinkle: 0.5 },
},
```

- `render: "point"` 使用共享 `pbe:vfx_draw_point`；`aspect` 可做非等比尺寸，`colorRandom` 可让每个粒子在双色间随机。
- `render: "stream"` 默认使用加法混合、竖向拉伸和 `rotate_y` Billboard 的 `pbe:vfx_key_stream`；魔法流光通过 `particle: "magic_trail"` 使用原始拖尾粒子 `pbe:vfx_magic_trail`。
- `render: "drift"` 使用普通透明混合、`lookat_xyz` Billboard 与自然飘落运动的 `pbe:vfx_key_drift`（樱吹雪、雪晶）。
- `particle` 可覆盖上述默认原语；魔法流光使用 `pbe:vfx_magic_trail` 的原始长拖尾，蓝眼泪使用 `pbe:vfx_key_blue_tears`，两者以 `plugins/keys/textures/particle/piano_fx` 的原始贴图恢复旧版观感。
- 配色策略集中在样式定义里：`free` 使用四套全局预设；`limited` 自带专属调色板；`fixed` 由样式提供自然色，玩家设置直接隐藏配色项。演出编排中的显式 `colors` 仍是创作者覆盖，对任何样式都优先生效。

标签、设置下拉、`key_style` 变体、颜色选项和变量校验都会自动派生，不需要再改粒子文档或 UI 样式名判断。运行 `npm run test:vfx` 会按实际 `render` 对应的粒子文档验证变量。

## 4. 新增或编辑舞台主题

1. 在 `plugins/themes/vfx/index.ts` 中的 `BUILTIN_THEMES` 添加条目并更新 `plugins/themes/plugin.json` 的 `provides.themes`（也可在 Web VFX Lab 的「主题编排」面板实时调整并点击「导出 JSON」，或随自定义 `.pbeplugin` 通过 `api.registerTheme(id, theme)` 注册）。
2. 每个图层按需配置：`effect`、`slot`（同特效多轨槽位）、`color`、`color2`、`brush`、`variant`、`zone`、`motion`、`params`（该特效声明的专属参数）、`level`（固定数值或 `{ input, from, to }` 音乐特征映射）、`scale` 与瞬时特效门限 `gate`。
3. 游戏内舞台设置菜单会从 `VfxRegistry` 动态读取已注册主题（`listPianoStageThemes()`），无需再到 `settings.ts` 手动登记硬编码列表。
4. 运行 `npm run test:vfx` 确认 4 架钢琴错峰演奏 0 丢弃、单架峰值 ≤ 275 粒子。

## 5. 为新曲目创作独立演出编排

制作定制曲目演出不需要新增专用播放器、修改运行时或改动 Core：

1. 在 `midis/performances/<songId>.json` 编写提示序列（`op`: `"set"`、`"flash"` 或 `"blackout"`，`effect`: 任意已注册特效名，可选 `slot`、`brush`、`variant`、`zone`、`motion`、`params`、`fade`；其中数值型 `params` 在同一 `(effect, slot)` 通道上会随 `set` + `fade` 平滑渐变，未重复写出的参数沿用当前通道状态）：
   - 提示既可写在顶层 `cues`，也可直接内嵌在各 `sections[i].cues` 中；编译器 `compilePerformanceSource` 会自动合并并按 `at` 时间稳定排序，无需手动维护全局顺序。
   - 使用 `{ "at": 80.75, "op": "blackout", "fade": 0.7, "except": ["starfield"] }` 可一键将当前所有激活通道淡出至 `level: 0`（并保留上一次的颜色/变体设置），免去逐通道重复清场。
   ```json
   {
     "at": 32,
     "op": "set",
     "effect": "double_helix",
     "color": "aurora",
     "level": 85,
     "scale": 100,
     "fade": 2,
     "params": {
       "radius": 2.8,
       "height": 3.5,
       "angularSpeed": 180,
       "particleSize": 0.06
     }
   }
   ```
2. 执行导出命令生成 `build/performances/<songId>-performance.pbe3`。可在曲目 ID 后传入另一份编排 JSON 路径，输出文件名会使用该 JSON 的文件名。公共曲库原 PBE3 不会被替换。
   ```sh
   npm run midi -- export-performance <songId>
   ```
3. 在 `/vfx-lab` 导入演出 PBE3 预览。普通歌曲可直接分发 PBE3。需要随曲分发专属资源时，可用现有 `.pbesong` 或 ZIP 放入一个或多个 PBE3 和所需的 `.pbeplugin`。生成器会单独询问是否信任随包插件。

### 曲目归并与播放

- 生成器按音符时间、音高、力度、键长、声长和总时长判断音乐是否相同。曲名、源 ID、压缩方式和演出提示不参与比较。已有音乐正文和默认编排继续有效，新增编排附在同一条目。重复编排只保留一份，同名不同音乐可以并存。
- 附加包曲库保存一份 PBE3 音符数据，额外编排写入曲库索引。世界公共曲库和存储卡按既有 ID 追加编排，沿用同一分片提交和容量检查。对同 ID 的不同音乐拒绝写入，对已有不同 ID 保留来源引用。生成器导入这类冲突时会给不同音乐分配新 ID。
- 在游戏的「歌曲详情」选择「普通演奏」「曲目默认」或「附加演出」。队列保存播放方式，所有编排共用同一份音符。缺失的特效提示会跳过，缺失的画笔使用特效默认画笔。整首都没有可用的演出特效时，舞台回到该琴的默认设置，音乐继续播放。
- PBE3 线格式和旧默认编排都兼容。旧 PBE2 仍需从源 MIDI 重新导入。带附加编排的导出包需要新版模板。

### 插件依赖与引用

- `dependencies` 是直接依赖的插件 ID 数组。例如 `"dependencies": ["pianobe.stage"]`。装配按依赖顺序进行，缺失依赖和循环依赖都会报错。
- 特效、主题、布局、琴键样式和粒子继续使用稳定的已发布 ID。不同插件不能注册相同类型的同一 ID 或写入同一个资源路径。舞台道具使用 `插件 ID:道具 ID`，画笔使用宿主图集定义。
- 插件可以引用自己的内容、宿主资源或直接声明的依赖资源。粒子文档可引用直接依赖的贴图，特效可引用直接依赖的舞台道具。曲目以特效 ID 关联插件，生成器会同时匹配默认编排和附加编排，并选入其依赖。
- `npm run validate:plugins` 校验内置注册、资源路径、声明依赖和公共曲库的演出引用。测试第三方插件时把它和直接、间接依赖一起传给 `bun tools/plugins/validate-plugin.mjs`。

## 6. 让插件自带 3D 舞台道具

在 `plugin.json` 保留 `vfx`，加入 `vfx.stageProps` 能力和 `stageProps` 数组。例如插件 `my.stage` 可以声明以下道具。

```json
{
    "capabilities": ["vfx", "vfx.stageProps"],
    "stageProps": [{
        "id": "lantern",
        "geometry": "stage_props/lantern.geo.json",
        "texture": "stage_props/lantern.png",
        "merTexture": "stage_props/lantern_mer.png",
        "animations": "stage_props/lantern.animation.json"
    }]
}
```

- `geometry` 是单个 Bedrock `minecraft:geometry` 模型，支持立方体和 `poly_mesh`。PNG 贴图尺寸需与模型声明一致。可选的 `merTexture` 使用 Bedrock MER 通道，绿色通道控制发光。
- 可选的 `animations` 使用 Bedrock 动画 JSON。第一版支持绑定到模型骨骼的数值位移、旋转和缩放，以及线性关键帧。可声明循环或停在最后一帧。例如 `animation.sway` 通过 `animation: "sway"` 选择。
- 从特效的 `resolveStageProp(params, instrument)` 返回 `{ id: "my.stage:lantern", offset: { x: 0, y: 2, z: 0 }, turn: 45, size: 1, animation: "sway" }`。位置相对钢琴舞台坐标，`turn` 是偏航角度，`size` 是统一缩放。返回 `undefined` 时让出道具位置。
- 每架琴只显示一个道具。可在 `emit({ nativeStageProp })` 中控制粒子轮廓回退。宿主成功显示该通道的道具时，`nativeStageProp` 才为真。
- 封包后在生成器中选择该插件，从当前版本零插件模板导出。Web VFX Lab 会自动发现仓库 `plugins/*` 下的插件源码和道具资源。可选的道具级 `preview` 支持 `tall`、`fillLight` 和 `fullGlow`，分别用于高景别、补光和以颜色贴图模拟全表面发光。

## 7. 发布前回归检查项

- [ ] `npm run check` 通过，包含客户端和服务器 Addon 构建、零插件模板、道具导出和 BP/RP 引用闭环验证
- [ ] `npm run check:vfx` 9 项 VFX 专项检查通过
- [ ] `npm run build:web` 与 `npm run build:generator` 成功
- [ ] 需要验证生成器的曲谱、音色和曲库组合装配时，执行 `npm run build:template` 和 `bun tools/verify/verify-generator.mjs`
