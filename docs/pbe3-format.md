# PBE3 曲目格式

PBE3 是 PianoBE 当前唯一的运行时曲目格式。它替代 PBE2，核心变化只有两个：

1. **力度调色板**：歌曲级力度表，每个音只存索引；恒定力度时 `velocityBits = 0`。
2. **keyDuration**：把“琴键实际按下时长”和“声音持续时长”分开存储。

PBE3 不包含左右手/轨道、独立 CC64 踏板事件、段落/循环点、速度表。

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
4       1     version = 1
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

- 编码器最多保留 **8 个力度级别**。如果歌曲实际使用的力度超过 8 种，会按 0~127 均匀量化为 8 级，再按最接近的值映射。这样做的代价约为平均 1 dB 音量误差，换取明显更小的文件。
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
- 只有压缩后比原始事件流小至少 8 字节时才启用压缩。
- `checksum` 始终是**未压缩事件流**的 CRC32。
- 解码时先校验 `uncompressedLength` 安全上限（32 MiB），再解压并校验 CRC32。

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
| PBE3 | 2,645,823 B（2.52 MiB） |

PBE3 比 PBE2 **小 10.8%**，同时额外携带了 keyDuration。

默认参数：

- 力度：最多 8 级，平均音量误差约 1 dB。
- keyDuration：25ms 网格，视觉上不可感知。
- soundDuration：25ms 网格；游戏内声音释放本身按 50ms tick 调度，25ms 足够。

## 8. 旧格式

PBE2 编解码只保留在 `packages/core/src/pbe2/`，用于：

- 迁移脚本；
- 回归测试样本（`packages/core/tests/fixtures/*.pbe2`）。

它不再从 `@piano/core` 根入口导出，也不会进入 addon 运行时 bundle。需要显式访问时使用子路径：

```ts
import { decodePbe2 } from "@piano/core/pbe2";
```
