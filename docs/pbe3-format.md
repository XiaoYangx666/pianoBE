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

## 8. 旧格式与版本兼容

PBE2 编解码已完全移除。仓库中不再保留 PBE2 代码、测试样本或 `@piano/core/pbe2` 入口。

普通曲目仍保持 PBE3 版本 1；带曲目演出区块的数据使用版本 3。`@piano/core` 仅接受版本 1 与版本 3，不保留实验性的版本 2 兼容分支。通过 `attachPbe3Performance(bytes, [])`（或 `attachSongPerformance(bytes, [])`）可将带演出的曲目剥离为纯净的版本 1（还原原音符载荷，不修改普通曲目编码）。

## 9. 演出区块（版本 3）

版本 3 在调色板后、音符载荷前写入演出区块。`@piano/core` 仅负责演出区块的结构校验与符号/颜色表编解码，**不耦合具体 VFX 特效清单、画笔纹理编号或运行时语义**。现有音符 CRC、压缩和跳转索引只覆盖音符流。

| 字段 | 编码 |
| --- | --- |
| 区块长度 | `u16`，小端序（上限 `MAX_PERFORMANCE_BYTES = 16,384` 字节） |
| 区块校验 | `u32` CRC32，小端序 |
| 符号表 | `u8` 符号数（1–255）+ 每项 `u8 len`（1–32）+ ASCII/UTF-8 字符串（`^[a-z][a-z0-9_-]{0,31}$`） |
| 颜色表 | `u8` 颜色数（1–255）+ 每项 `u8 × 3` RGB |
| 提示列表 | 读到区块末尾，1–256 条提示 |

每个提示依次写入：
1. 相对上一条提示的 40 Hz `timeDelta`（VarInt）
2. `u8` 标志 `flags`：
   - bit 7 (`0x80`)：`0` 为持续渐变 `set`，`1` 为瞬时触发 `flash`
   - bit 6 (`0x40`)：`hasColor2`（是否存在副色索引）
   - bit 5 (`0x20`)：`hasBrush`（是否存在画笔符号索引）
   - bit 4 (`0x10`)：`hasVariant`（是否存在变体符号索引）
   - bit 3 (`0x08`)：`hasSpace`（是否存在空间高度与运动修饰字节）
   - bits 0–2 (`0x07`)：`slot`（0–7，允许同特效并行占用的独立通道槽位）
3. `u8` 特效名索引（指向曲目内部符号表，例如 `"starfield"`、`"shockwave"`、`"key_style"`）
4. `u8` 强度（0–100%；对 `key_style` 而言，`level = 0` 表示解除覆盖恢复钢琴默认弹奏粒子）
5. `u8` 缩放（50–170%）
6. `u8` 主色索引（指向颜色表；编码器支持 `PERFORMANCE_PALETTES` 命名色板或 `#RRGGBB`，按首次出现顺序去重）
7. 若 `hasColor2 = 1`：`u8` 副色索引
8. 若 `hasBrush = 1`：`u8` 画笔符号索引（如 `"star"`、`"petal"`、`"silk"`、`"comet"`）
9. 若 `hasVariant = 1`：`u8` 变体符号索引（特效内部变体，或 `key_style` 的显式弹奏粒子样式名如 `"stardust"`、`"snow"`、`"glimmer"`、`"none"`）
10. 若 `hasSpace = 1`：`u8` 空间与运动字节 `((motionId & 0x03) << 2) | (zoneId & 0x03)`（高位 bits 4–7 必须为 `0`；对应 `PERFORMANCE_MOTIONS` 与 `PERFORMANCE_ZONES`）
11. 若 `flash = 0`（`set`）：40 Hz `fade`（VarInt）；持续通道按 `(effect, slot)` 独立插值强度、缩放与主/副 RGB 颜色。

相同时间的提示按源文件顺序处理，所有提示和渐变终点均位于曲目时长内。运行时引擎遇到未知 `effect` 名时安全跳过而不影响歌曲或其它通道播放；遇到未知 `brush` 时回退到该特效默认画笔；遇到未知 `variant` 时回退到默认行为。单曲总大小上限仍为 2 MiB。
