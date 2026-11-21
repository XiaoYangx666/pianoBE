# PBE3 曲目格式

PBE3 是 PianoBE 当前唯一的运行时曲目格式。它替代 PBE2，核心变化只有两个：

1. **力度调色板**：歌曲级力度表，每个音只存索引；恒定力度时 `velocityBits = 0`。
2. **keyDuration**：把“琴键实际按下时长”和“声音持续时长”分开存储。

PBE3 音符流不包含左右手/轨道、独立 CC64 踏板事件或速度表。版本 3 可额外携带舞台演出提示（版本 2 为旧版格式，仅保留解码兼容）。

## 1. 数值约定

- 所有时间与时长字段统一使用 **1/40 秒 tick**（25ms），与音符起始时间同一网格。
- 力度使用 MIDI 标准 **0~127**。
- 多字节整数为 **小端序**（little-endian）。
- 变长整数使用 **无符号 LEB128 VarInt**。
- 字符串 = `u16` 字节长度 + UTF-8 内容。

## 2. 文件头

```text
offset  size  field
0       4     magic = "PBE3" (0x50 0x42 0x45 0x33)
4       1     version = 1（普通曲目）或 3（含演出；2 为旧版）
5       1     flags
6       ...   id      (string)
...     ...   name    (string)
...     4     duration            u32, 1/40s
...     4     noteCount           u32
...     4     uncompressedLength  u32
...     4     checksum            u32, 未压缩事件流的 CRC32
...     1     paletteCount        u8, 1~128
...     N     palette             paletteCount 个 u8，升序、去重，值 0~127
...     1     velocityBits        u8, 0~7
...     ...   performance        仅版本 2/3，见第 9 节
...     ...   event payload       压缩或未压缩的事件流
```

### flags

| bit | 含义 |
|---:|---|
| 0 | 事件流使用 Raw DEFLATE 压缩 |

其它位保留，必须为 0。

### 力度调色板

- `palette` 按力度值升序排列，不重复。
- `paletteCount = 1` 时 `velocityBits = 0`，事件流中不写力度位流，所有音都使用 `palette[0]`。
- 否则：

```text
velocityBits = ceil(log2(paletteCount))
```

- 编码器最多保留 **8 个力度级别**。如果歌曲实际使用的力度超过 8 种，会按 **1~127** 均匀量化为 8 级，再按最接近的值映射。这样做的代价约为平均 1 dB 音量误差，换取明显更小的文件。
- `velocityBits` 必须与 `paletteCount` 匹配，否则解码报错。

## 3. 事件流

事件流按时间分组。同一时刻开始的音（和弦）属于同一组。

```text
group:
  timeDelta      VarInt   相对上一组的 tick 差
  noteCount      VarInt   本组音符数（必须 > 0）
  velocityBits   bitstream
                 ceil(noteCount * velocityBits / 8) 字节
                 每组独立、字节对齐、LSB-first
  notes:
    midiAndFlag  u8
                 bit 7: hasKeyDuration
                 bit 0~6: MIDI 音高 0~127
    soundDuration VarInt   声音持续时长（1/40s tick，至少 1）
    keyDuration   VarInt   仅 hasKeyDuration = 1 时存在（1/40s tick）
```

### 力度位流

- 每个音对应一个 `velocityBits` 位宽的调色板索引。
- 位序为 **LSB-first**：第 0 个音占最低位。
- 每组结束后补 0 到字节边界，**不跨组共享位流**。
- 解码时先读出本组全部索引，再按顺序读音符。

### keyDuration

- `soundDuration` 是踏板延音烘焙后的声音时长。
- `keyDuration` 是琴键实际按下时长。
- 两者相等时 `hasKeyDuration = 0`，不写 `keyDuration`，解码时默认等于 `soundDuration`。
- 编码约束：`1 ≤ keyDuration ≤ soundDuration`。

### 例子：Secret 的高音跑动

```text
time = 2760 tick (69.000s)
midi = 102
soundDuration = 164 tick (4.10s，踏板延音)
keyDuration = 4 tick (0.10s，手实际按下)
velocity = 100
```

琴键显示使用 `keyDuration`，声音释放使用 `soundDuration`，两者不再混用。

## 4. 压缩与校验

- 编码器默认使用 `fflate` 的 Raw DEFLATE（level 9）。
- 只有压缩后比原始事件流至少小 9 字节时才启用压缩。
- `checksum` 始终是**未压缩事件流**的 CRC32。
- 解码时先校验 `uncompressedLength` 安全上限（32 MiB），再使用固定大小的输出缓冲区解压并校验 CRC32。

## 5. 跳转索引

PBE3 文件本身**不存储**跳转索引。加载时由 `buildPbe3SeekIndex` 顺序扫描事件流生成：

```text
Pbe3SeekIndexEntry {
  ticks: number      // 组起始时间
  offset: number     // 组头在事件流中的字节偏移
  noteIndex: number  // 该组之前已经过的音符数
}
```

默认每 5 秒（200 tick）记录一个索引项。播放器使用 `Pbe3EventCursor` 跳转：

1. 二分找到 `ticks <= target` 的最近索引项；
2. 从该组头开始顺序跳过目标时刻之前的音符；
3. 保留目标时刻及之后的音符。

## 6. 编解码入口

格式实现集中在：

- `packages/core/src/pbe3/codec.ts`：编码/解码
- `packages/core/src/pbe3/seekIndex.ts`：跳转索引与播放光标
- `packages/core/src/pbe3/songCache.ts`：加载/缓存
- `packages/core/src/music/validate.ts`：写入校验
- `packages/core/src/songCodec.ts`：对外统一门面

外部模块应使用门面，而不是直接依赖 `pbe3/*`：

```ts
encodeSong(song)
decodeSong(bytes)
readSongHeader(bytes)
readAllSongNotes(bytes)
songToNoteEvents(bytes)
renameSong(bytes, name)
validateSong(bytes, limits)
createSongCursor(loadedSong)
```

## 7. 体积与质量

当前 606 首曲库（1,050,077 个音）：

| 格式 | 总体积 |
|---|---:|
| PBE2 | 2,965,449 B（2.83 MiB） |
| PBE3 | 2,648,259 B（2.53 MiB） |

PBE3 比 PBE2 **小 10.7%**，同时额外携带了 keyDuration。

默认参数：

- 力度：最多 8 级，平均音量误差约 1 dB。
- keyDuration：25ms 网格，视觉上不可感知。
- soundDuration：25ms 网格；游戏内声音释放本身按 50ms tick 调度，25ms 足够。

## 8. 旧格式

PBE2 编解码已完全移除。仓库中不再保留 PBE2 代码、测试样本或 @piano/core/pbe2 入口；旧 .pbe2 文件只在 Git 历史中可见。

版本 1 的 PBE3 数据仍使用原解码路径。解码器接受版本 1、2、3：版本 2 的演出区块为每条提示内联 RGB（仅保留解码兼容），版本 3 起改用区块内颜色表 + 索引，编码器始终写版本 3。需要发给旧版客户端时，可用 `attachSongPerformance(bytes, [])` 导出同一份音符和原压缩载荷的版本 1。

## 9. 演出区块

版本 3 在调色板后、音符载荷前写入以下字段。现有音符 CRC、压缩和跳转索引只覆盖音符流。

| 字段 | 编码 |
| --- | --- |
| 区块长度 | u16，小端序 |
| 区块校验 | u32 CRC32，小端序 |
| 颜色表 | `u8` 数量（1–255）+ 每项 `u8 × 3` RGB |
| 提示列表 | 读到区块末尾，1–256 条，每区块最多 5,374 字节 |

每个提示依次写入：
1. 相对上一条的 40 Hz `timeDelta`（VarInt）
2. `u8` 标志 `flags`：
   - bit 7 (`0x80`)：`0` 为持续渐变 `set`，`1` 为瞬时触发 `flash`
   - bit 6 (`0x40`)：`hasColor2`（是否存在副色索引）
   - bit 5 (`0x20`)：`hasStyle`（是否存在样式修饰字节）
   - bits 3–4 (`0x18`)：保留，必须为 `0`
   - bits 0–2 (`0x07`)：`slot`（0–7，同一绘制方法允许并行占用的独立通道槽位）
3. `u8` 内置绘制方法 `methodId`（1–255；当前已注册 33 种，对应 `PERFORMANCE_METHODS`，含 `25: key_style` 弹奏粒子替换通道）
4. `u8` 强度（0–100%；对 `key_style` 而言，`level = 0` 表示解除覆盖恢复默认弹奏粒子，`level > 0` 表示启用覆盖并以 `color` / `color2` 作为 88 键渐变配色）
5. `u8` 缩放（50–170%）
6. `u8` 主色索引（指向颜色表；打包工具支持 `PERFORMANCE_PALETTES` 色板名或 `#RRGGBB`，编码时按首次出现顺序去重）
7. 若 `hasStyle = 1`：`u8` 样式修饰 `(motionId << 6) | (zoneId << 4) | brushId`（`PERFORMANCE_MOTIONS`、`PERFORMANCE_ZONES`、`PERFORMANCE_BRUSHES`；当方法为 `key_style` 时，`brush` 依次映射默认保留样式 / `blue_tears` / `stardust` / `sakura_drift` / `snow` / `neon_note` / `prism_shards` / `magic_trail` / `pulse_ring`，`motion` 中 `gentle` 仅保留琴键微光 `key_glimmer`，`reverse` 则完全关闭主弹奏粒子与琴键微光）
8. 若 `hasColor2 = 1`：`u8` 副色索引
9. 若 `flash = 0`（`set`）：40 Hz `fade`（VarInt）；持续通道按 `(method, slot)` 独立插值强度、缩放与主/副 RGB 颜色。

相同时间的提示按源文件顺序处理。提示和渐变终点均位于曲目时长内。

内置绘制方法由 `PERFORMANCE_METHODS`（33 种：`starfield`、`petal_fall`、`firefly_rise`、`aurora_veil`、`wing_curtain`、`wing_ribbons`、`double_helix`、`orbit_halo`、`silk_streams`、`wave_ribbon`、`vortex_column`、`lissajous_weave`、`light_pillars`、`crown_fan`、`stage_truss`、`magic_circle`、`portal_arch`、`key_notes`、`key_fountain`、`key_constellation`、`floor_sweep`、`shockwave`、`prism_rewind`、`firework_bloom`、`key_style`、`hanabi_launch`、`dandelion_drift`、`horizon_glow`、`meteor_shower`、`comet_split`、`musubi_braid`、`twilight_mist`、`starfall_impact`）定义，笔刷由 `PERFORMANCE_BRUSHES`、空间高度由 `PERFORMANCE_ZONES`、运动修饰由 `PERFORMANCE_MOTIONS` 定义。解码器遇到未知 `methodId` 时会完整跳过该条提示而不报错，遇到未知 `brushId` 时降级为 `default`，仍正常播放音符。单曲存储上限仍为 2 MiB。
