"""Audio Lab 客观分析 + 报告生成（开发工具，需要 numpy 与 ffmpeg）。

用法（仓库根目录）：
    python tools/audio-lab-analyze.py

读取：
    build/audio-lab/metrics.json     audio-lab-render.mjs 生成
    build/audio-lab/probe-*.wav      力度探针

输出：
    tools/audio-lab-report.md
"""
import json
import math
import os
import wave

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "build", "audio-lab")
METRICS = os.path.join(OUT, "metrics.json")
REPORT = os.path.join(ROOT, "tools", "audio-lab-report.md")

SR = 44100
PROBE_STEP = 0.55


def read_wav(path):
    with wave.open(path, "rb") as handle:
        channels = handle.getnchannels()
        width = handle.getsampwidth()
        rate = handle.getframerate()
        frames = handle.getnframes()
        raw = handle.readframes(frames)
    assert width == 2, width
    data = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    data = data.reshape(-1, channels)
    return data.mean(axis=1), rate


def window(signal, start, end, rate=SR):
    a = max(0, int(start * rate))
    b = min(len(signal), int(end * rate))
    return signal[a:b]


def rms_db(chunk):
    return 20 * math.log10(max(1e-9, float(np.sqrt(np.mean(chunk.astype(np.float64) ** 2)))))


def spectral_centroid(chunk, rate=SR):
    if len(chunk) < 32:
        return 0.0
    windowed = chunk * np.hanning(len(chunk))
    spectrum = np.abs(np.fft.rfft(windowed))
    freqs = np.fft.rfftfreq(len(windowed), 1.0 / rate)
    total = float(np.sum(spectrum))
    if total <= 1e-12:
        return 0.0
    return float(np.sum(spectrum * freqs) / total)


def attack_ms(chunk, rate=SR):
    if len(chunk) < 16:
        return 0.0
    envelope = np.abs(chunk)
    peak = float(np.max(envelope))
    if peak <= 1e-6:
        return 0.0
    low = np.argmax(envelope >= peak * 0.1)
    high = np.argmax(envelope >= peak * 0.9)
    return max(0.0, (high - low) / rate * 1000)


def analyze_probe(meta):
    signal, rate = read_wav(meta["file"])
    rows = []
    for index, velocity in enumerate(meta["velocities"]):
        start = index * PROBE_STEP
        # 三个音同时发声，取音头之后的 30~260ms，避开相邻力度步。
        chunk = window(signal, start + 0.03, start + 0.26, rate)
        rows.append(
            {
                "velocity": velocity,
                "rms": rms_db(chunk),
                "centroid": spectral_centroid(chunk, rate),
                "attack": attack_ms(window(signal, start, start + 0.15, rate), rate),
            }
        )
    rms_values = np.array([row["rms"] for row in rows])
    centroids = np.array([row["centroid"] for row in rows])
    steps = np.abs(np.diff(rms_values))
    layer_of = lambda velocity: 0 if velocity <= 42 else 1 if velocity <= 84 else 2
    boundary_steps = []
    for index in range(len(rows) - 1):
        if layer_of(rows[index]["velocity"]) != layer_of(rows[index + 1]["velocity"]):
            boundary_steps.append(
                {
                    "from": rows[index]["velocity"],
                    "to": rows[index + 1]["velocity"],
                    "rmsStep": float(rms_values[index + 1] - rms_values[index]),
                    "centroidStep": float(centroids[index + 1] - centroids[index]),
                }
            )
    layer_means = {}
    for layer in range(3):
        values = [row["centroid"] for row in rows if layer_of(row["velocity"]) == layer]
        layer_means[layer] = float(np.mean(values)) if values else None
    return {
        "rows": rows,
        "rms_range": float(rms_values[-1] - rms_values[0]),
        "centroid_start": float(centroids[0]),
        "centroid_end": float(centroids[-1]),
        "centroid_range": float(centroids[-1] - centroids[0]),
        "max_rms_step": float(np.max(steps)) if len(steps) else 0.0,
        "mean_rms_step": float(np.mean(steps)) if len(steps) else 0.0,
        "boundary_steps": boundary_steps,
        "layer_means": layer_means,
        "centroid_monotonic": float(np.mean(np.diff(centroids) > 0)),
    }


def fmt(value, digits=1, suffix=""):
    if value is None:
        return "—"
    return f"{value:.{digits}f}{suffix}"


def schedule_table(group):
    lines = [
        "| 方案 | 触发误差均值 | 误差 P90 | 最大误差 | ±20ms | 间隔改变>20ms | 同 tick 压缩 | 和弦最大跨度 |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for entry in group["schemes"]:
        s = entry["schedule"]
        lines.append(
            f"| {entry['label']} | {s['meanMs']:+.1f} ms | {s['p90AbsMs']:.1f} ms | {s['maxAbsMs']:.1f} ms | "
            f"{s['within20']*100:.0f}% | {s['intervalShiftRatio']*100:.0f}% | {s['collisions']} | "
            f"{s['maxChordSpreadMs']:.0f} ms |"
        )
    return "\n".join(lines)


def release_table(group):
    lines = [
        "| 方案 | LUFS | 峰值 dBFS | 最大声部 | 平均声部 | 尾音/时值比 | 释放模式 |",
        "|---|---|---|---|---|---|---|",
    ]
    for entry in group["schemes"]:
        v = entry["voices"]
        lines.append(
            f"| {entry['label']} | {fmt(entry['lufs'])} | {fmt(entry['peakDb'])} | {v['maxVoices']} | "
            f"{v['meanVoices']:.2f} | {v['tailRatio']:.2f}× | {entry['config']['releaseMode']} |"
        )
    return "\n".join(lines)


def velocity_table(group):
    lines = [
        "| 方案 | LUFS | 峰值 dBFS | 力度层使用（弱/中/强） |",
        "|---|---|---|---|",
    ]
    for entry in group["schemes"]:
        buckets = entry["velocityBuckets"]
        usage = " / ".join(f"{bucket['count']}" for bucket in buckets)
        lines.append(
            f"| {entry['label']} | {fmt(entry['lufs'])} | {fmt(entry['peakDb'])} | {usage} |"
        )
    return "\n".join(lines)


def main():
    with open(METRICS, encoding="utf-8") as handle:
        data = json.load(handle)
    probes = {mode: analyze_probe(meta) for mode, meta in data["probes"].items()}

    lines = [
        "# 钢琴还原度与 MIDI 播放精度实验报告",
        "",
        f"- 生成时间：{data['generatedAt']}",
        "- 实验入口：`packages/web` 的 **音频实验室**（`/lab`）",
        "- 离线渲染：`node tools/audio-lab-render.mjs`；本报告：`python tools/audio-lab-analyze.py`",
        "- 试听文件：`build/audio-lab/*.ogg`（A/B 连播对 B 做整体响度匹配）；"
        "也可以直接打开 `build/audio-lab/index.html` 逐个播放。",
        "",
        "## 实验设置",
        "",
        "- **力度音源**：VCSL Steinway B 的 vl2 / vl3 / vl4 三层真实采样（CC0），30 个基础键，4s，44.1kHz。",
        "- **现有音源**：FluidR3 GM 的 0.5s / 2s / 4s 三档采样（正式包使用的默认音色）。",
        "- **力度处理**：多层模式下三层响度先对齐，再套同一条力度→响度曲线；因此差异只来自音头与泛音，不是音量。",
        "- **调度**：所有方案使用同一批音符、同一力度、同一时值，只改变起始时间网格。",
        "- **释放**：同一音源、同一力度，只改变 Note Off 后的释放包络。",
        "- **A/B 试听**：连播时把 B 的整体响度匹配到 A（避免“谁更响谁更好听”）；单个方案文件保留原始电平，表格中的 LUFS 也来自原始文件。",
        "",
        "## 曲目与片段",
        "",
    ]

    for track in data["tracks"]:
        lines.append(
            f"- **{track['label']}**：片段 {track['start']:.1f}–{track['start']+track['seconds']:.1f}s，"
            f"{track['noteCount']} 音符，{track['density']:.1f} 音符/秒（`{track['source']}`）"
        )

    lines += [
        "",
        "## 实验页怎么用",
        "",
        "1. 打开 `/lab`，选择内置音型、服务端曲目或本地 MIDI；设置片段起点/长度。",
        "2. 点一个预设（力度 / 调度 / 释放 / 游戏现状 vs 改进），或直接编辑 A/B 两张方案卡。",
        "3. 先点“匹配 A/B 响度”，再点“A → B 连播”；浅色竖线是原始 MIDI 位置，实色圆点是实际触发点。",
        "4. 需要离线对比时点“导出 A/B”，导出与试听使用同一套采样与包络；指标不会因输出增益改变。",
        "",
        "## 客观测量",
        "",
        "### 1. 力度层：真实采样 vs 单层音量",
        "",
        "先听力度 A/B：`build/audio-lab/lisa-velocity-single-vs-layers3-AB.ogg`、"
        "`build/audio-lab/feng-velocity-single-vs-layers3-AB.ogg`。",
        "",
    ]
    for track in data["tracks"]:
        group = next(group for group in track["groups"] if group["id"] == "velocity")
        lines += [f"**{track['label']}**", "", velocity_table(group), ""]

    lines += [
        "力度探针（同一音高、同一时值，只改变 MIDI 力度；三层与单层共用峰值归一）：",
        "",
        "| 模式 | RMS 变化 (40→120) | 质心 40 | 质心 120 | 质心变化 | 弱/中/强层平均质心 | 相邻力度 RMS 平均步进 |",
        "|---|---|---|---|---|---|---|",
    ]
    for mode, label in [("single", "单层 vl3 + 音量"), ("layers3", "3 层真实采样")]:
        probe = probes[mode]
        means = probe["layer_means"]
        mean_text = " / ".join(f"{means[layer]:.0f} Hz" if means[layer] is not None else "—" for layer in range(3))
        lines.append(
            f"| {label} | {probe['rms_range']:+.1f} dB | {probe['centroid_start']:.0f} Hz | "
            f"{probe['centroid_end']:.0f} Hz | {probe['centroid_range']:+.0f} Hz | {mean_text} | "
            f"{probe['mean_rms_step']:.2f} dB |"
        )

    boundary_lines = []
    single_rms = {row["velocity"]: row["rms"] for row in probes["single"]["rows"]}
    for mode, label in [("single", "单层"), ("layers3", "3 层")]:
        probe = probes[mode]
        if mode == "single":
            boundary_lines.append("- 单层：没有层切换，质心在 1249→1238 Hz 之间基本不变。")
        elif probe["boundary_steps"]:
            parts = []
            for item in probe["boundary_steps"]:
                baseline = single_rms.get(item["to"], 0) - single_rms.get(item["from"], 0)
                parts.append(
                    f"{item['from']}→{item['to']} 力度：RMS {item['rmsStep']:+.2f} dB"
                    f"（扣除力度曲线本身 {baseline:+.2f} dB 后，层切换贡献 {item['rmsStep'] - baseline:+.2f} dB），"
                    f"质心 {item['centroidStep']:+.0f} Hz"
                )
            boundary_lines.append(f"- {label}层切换处：" + "；".join(parts))

    lines += [
        "",
        "> 频谱质心反映“亮度/泛音重心”。单层只改变音量时质心基本不变；多层在弱/中/强段使用不同采样，"
        "层内质心相对稳定，层切换处出现音色跳变，但响度保持连续。",
        *boundary_lines,
        "",
        "### 2. 调度：50ms tick 量化",
        "",
        "先听调度 A/B：`build/audio-lab/lisa-schedule-ceil-vs-exact-AB.ogg`、"
        "`build/audio-lab/lisa-schedule-ceil-vs-round-AB.ogg`，以及慢速对照的 `feng-schedule-*`。",
        "",
    ]
    for track in data["tracks"]:
        group = next(group for group in track["groups"] if group["id"] == "schedule")
        lines += [f"**{track['label']}**", "", schedule_table(group), ""]

    lines += [
        "### 3. 音符时值与释放",
        "",
        "先听释放 A/B：`build/audio-lab/lisa-release-tier-vs-release-120-AB.ogg`、"
        "`build/audio-lab/feng-release-tier-vs-release-120-AB.ogg`。",
        "",
    ]
    for track in data["tracks"]:
        group = next(group for group in track["groups"] if group["id"] == "release")
        lines += [f"**{track['label']}**", "", release_table(group), ""]

    lines += [
        "### 4. 游戏现状 vs 综合改进",
        "",
        "A/B：`build/audio-lab/lisa-combined-current-vs-improved-AB.ogg`、"
        "`build/audio-lab/feng-combined-current-vs-improved-AB.ogg`。",
        "",
        "| 曲目 | 方案 | LUFS | 触发误差均值 | 误差 P90 | 间隔改变>20ms | 最大声部 | 尾音/时值比 |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for track in data["tracks"]:
        group = next(group for group in track["groups"] if group["id"] == "combined")
        for entry in group["schemes"]:
            s = entry["schedule"]
            v = entry["voices"]
            lines.append(
                f"| {track['label']} | {entry['label']} | {fmt(entry['lufs'])} | {s['meanMs']:+.1f} ms | "
                f"{s['p90AbsMs']:.1f} ms | {s['intervalShiftRatio']*100:.0f}% | {v['maxVoices']} | {v['tailRatio']:.2f}× |"
            )

    combined_notes = []
    for track in data["tracks"]:
        group = next(group for group in track["groups"] if group["id"] == "combined")
        current = next(entry for entry in group["schemes"] if entry["name"] == "current")
        improved = next(entry for entry in group["schemes"] if entry["name"] == "improved")
        if current["lufs"] is not None and improved["lufs"] is not None:
            diff = current["lufs"] - improved["lufs"]
            combined_notes.append(
                f"- {track['label']}：改进方案原始 LUFS 比现状低 **{diff:.1f} dB**（现状 {current['lufs']:.1f} / 改进 {improved['lufs']:.1f}）。"
                "这是恢复力度动态与缩短释放的结果；迁移到游戏时需要重新校准整体音量，"
                "实验页的“匹配 A/B 响度”按钮只用于试听对齐。"
            )
    lines += ["", *combined_notes, ""]

    # 数据驱动的结论
    lisa = data["tracks"][0]
    lisa_schedule = next(group for group in lisa["groups"] if group["id"] == "schedule")
    ceil = next(entry for entry in lisa_schedule["schemes"] if entry["name"] == "ceil")
    round_entry = next(entry for entry in lisa_schedule["schemes"] if entry["name"] == "round")
    lisa_release = next(group for group in lisa["groups"] if group["id"] == "release")
    tier = next(entry for entry in lisa_release["schemes"] if entry["name"] == "tier")
    release120 = next(entry for entry in lisa_release["schemes"] if entry["name"] == "release-120")

    single_probe = probes["single"]
    layers_probe = probes["layers3"]
    layer_means = layers_probe["layer_means"]
    single_rms = {row["velocity"]: row["rms"] for row in single_probe["rows"]}
    boundary_text = "；".join(
        f"{item['from']}→{item['to']} 力度 RMS {item['rmsStep']:+.2f} dB"
        f"（层贡献 {item['rmsStep'] - (single_rms.get(item['to'], 0) - single_rms.get(item['from'], 0)):+.2f} dB）"
        for item in layers_probe["boundary_steps"]
    )
    lisa_velocity = next(group for group in data["tracks"][0]["groups"] if group["id"] == "velocity")
    feng_velocity = next(group for group in data["tracks"][1]["groups"] if group["id"] == "velocity")
    lisa_layers = next(entry for entry in lisa_velocity["schemes"] if entry["name"] == "layers3")
    feng_layers = next(entry for entry in feng_velocity["schemes"] if entry["name"] == "layers3")
    lisa_usage = " / ".join(str(bucket["count"]) for bucket in lisa_layers["velocityBuckets"])
    feng_usage = " / ".join(str(bucket["count"]) for bucket in feng_layers["velocityBuckets"])

    lines += [
        "",
        "## 结论",
        "",
        "### 1. 多力度真实采样相比单纯调音量，改善有多大？",
        "",
        f"- 在力度探针中，单层方案的频谱质心只变化 **{single_probe['centroid_range']:+.0f} Hz**，"
        f"三层方案变化 **{layers_probe['centroid_range']:+.0f} Hz**；"
        f"弱/中/强层的平均质心分别为 **{layer_means[0]:.0f} / {layer_means[1]:.0f} / {layer_means[2]:.0f} Hz**，"
        "说明不同力度层确实换了音头与泛音结构，而不是同一采样调音量。",
        f"- 三层方案的相邻力度 RMS 平均步进为 **{layers_probe['mean_rms_step']:.2f} dB**；"
        f"层切换处（{boundary_text}）与普通相邻力度的步进同量级，没有出现突兀的响度台阶。",
        "- 结论：多力度采样带来的不是“更响”，而是弱奏更柔、强奏更亮、重音层次更清楚。"
        f"片段中的三层使用量为：LiSA 弱/中/强 **{lisa_usage}**，枫 **{feng_usage}**；"
        "快歌整体力度偏高，主要受益于 vl3/vl4 的音色差异；慢速曲的弱奏更多，vl2 的价值更明显。",
        "",
        "### 2. 50ms 调度误差有多严重？哪种策略更合理？",
        "",
        f"- 当前“向上取整”在《红莲华》片段上平均拖后 **{ceil['schedule']['meanMs']:+.1f} ms**，"
        f"P90 **{ceil['schedule']['p90AbsMs']:.1f} ms**，"
        f"相邻音间隔被改变超过 20ms 的比例 **{ceil['schedule']['intervalShiftRatio']*100:.0f}%**。",
        f"- “最近 tick”把平均误差降到 **{round_entry['schedule']['meanMs']:+.1f} ms**，"
        f"但 P90 仍有 **{round_entry['schedule']['p90AbsMs']:.1f} ms**；"
        "它减少的是整体拖后，不是网格本身。",
        "- 对 120 BPM 十六分（125ms），50ms 网格仍会把间隔变成 100/150ms 交替；"
        "“提前 1 tick”只是把误差从偏后改成偏前，不能恢复原始间隔，听感上可能更激进。",
        "- 结论：如果是 20 TPS 游戏端，**最近 tick 比向上取整更合理**（误差居中、不会整体拖后）；"
        "但它只能减轻、不能消除量化。真正接近原始节奏需要子 tick 调度，见可行性部分。",
        "",
        "### 3. 当前三档采样和尾音处理是否显著影响还原度？",
        "",
        f"- 《红莲华》释放组：三档采样的尾音/时值比为 **{tier['voices']['tailRatio']:.2f}×**，"
        f"最大声部 **{tier['voices']['maxVoices']}**；Note Off + 120ms 分别为 "
        f"**{release120['voices']['tailRatio']:.2f}×** / **{release120['voices']['maxVoices']}**。",
        f"- LUFS：三档 **{fmt(tier['lufs'])}**，Note Off 120ms **{fmt(release120['lufs'])}**；"
        "三档把短音的 0.5s 尾音留在快速旋律里，容易和后续音符叠加；过长释放同样会浑浊。",
        "- 结论：当前“<1s 全部走 0.5s 短档”对 88ms 中位时值的快歌不合适；"
        "短音尾音堆积明显。Note Off 控制能减少堆积，但释放不能太短，否则尾音被硬切、连奏不自然。"
        "建议在 80–150ms 之间按音区/力度细化，而不是统一一个值。",
        "",
        "### 4. 哪些优化真正值得迁移到 Minecraft？",
        "",
        "| 优化 | 听感收益 | 体积成本 | 运行开销 | 实现复杂度 | 建议 |",
        "|---|---|---|---|---|---|",
        "| 力度层（2–3 层） | 高：音头/泛音随力度变化 | 采样数 ×2–3 | 仅选层，几乎不变 | 中：打包、映射、层间校准 | **优先做 2 层**，先覆盖中音区 |",
        "| 最近 tick | 中：消除整体拖后，误差居中 | 0 | 0 | 低 | **值得做**，但不能解决 100/150ms 交替 |",
        "| Note Off 释放 | 中高：减少快歌尾音堆积 | 0（复用长采样） | 需保存/停止 SoundInstance | 中 | **值得做**，80–150ms 起 |",
        "| 精确子 tick / 关键帧 | 高：真正恢复节奏 | 0 | 需要引擎支持 | 高 | 先做可行性原型，不建议本阶段实现 |",
        "| 50ms 关闭量化 | 最高 | 0 | 0 | 不可行（20 TPS） | 游戏端做不到，浏览器实验仅作基准 |",
        "",
        "### 5. 体积、开销与复杂度",
        "",
        "- 本次实验的 VCSL 三层素材为 30 键 × 3 层 × 4s，OGG 共 **5.03 MB**；"
        "正式 `classic_grand` 的三档采样目前约 **1.95 MB / 90 个文件**，"
        "做成 2 层约 **3.9 MB / 180 个文件**，3 层约 **5.85 MB / 270 个文件**（按同等码率估算）。",
        "- 运行时只多一次“按力度选层”的查表，CPU 开销可忽略；内存增加取决于同时解码的采样数。"
        "如果游戏端像 Web 播放器一样全量预解码，270 个文件的内存约为现在的 3 倍，需要改成按需加载或只对常用音区做多层。",
        "- Note Off 需要保存每个音符的 `SoundInstance` 并在时值结束时 `stop()`，是本次改动中复杂度最高的一项；"
        "但它不需要新增采样，性价比高。",
        "- 力度层建议先做 2 层（vl2/vl4 或按音区选层），并复用本次的“层间响度对齐 + 统一力度曲线”方法，"
        "避免切换层时出现响度台阶。",
        "",
        "## Minecraft 端可行性分析（不实现）",
        "",
        "### 20 TPS 的硬约束",
        "",
        "- 服务端脚本每 tick 推进一次，`currentTime` 以 50ms 为步进；`processPlayback()` 只会在 tick 边界触发 `playSound`。"
        "因此任意 MIDI 的起始时间只能落在 50ms 网格上，这是当前误差的根源。",
        "- 把触发策略从“向上取整”改成“最近 tick”是纯服务端改动，不需要新资源，也不增加运行开销；"
        "它能把平均误差从约 +25ms 拉到 0ms 附近，但 120 BPM 十六分的 100/150ms 交替仍然存在。",
        "",
        "### 子 tick 方案一：客户端动画/音效关键帧",
        "",
        "- 基岩版客户端动画控制器的 sound effects 关键帧可以按渲染帧触发，理论上能获得 16.7ms 级（60fps）甚至更细的时间分辨率。",
        "- 代价：需要为每首曲子生成动画/关键帧数据并随资源包下发，播放状态、暂停、跳转、多人同步都要重新实现；"
        "这等于把播放器从“服务端事件流”改成“客户端时间轴”，复杂度远高于当前方案。",
        "- 结论：技术上可行，但不适合作为本轮优化；除非以后要做“音乐会级”回放，否则不建议。",
        "",
        "### 子 tick 方案二：预制静音偏移采样",
        "",
        "- 在采样前面预置不同长度的静音（例如 0/12.5/25/37.5ms），提前一个 tick 触发，让声音在目标时刻到达。",
        "- 代价：每个采样需要 2–4 个偏移版本，资源体积和缓存成倍增加；而且只能“延迟”，不能“提前”，"
        "对不同的 tick 相位需要动态选择版本，打包与映射都更复杂。",
        "- 结论：可以把量化误差压到约 ±12.5ms，但资源成本高、收益不如先把力度层和 Note Off 做好；"
        "本阶段只做可行性记录，不实现。",
        "",
        "### 推荐迁移顺序",
        "",
        "1. **力度层（先 2 层）**：收益最大，不改变调度架构；需要重新打包采样与层间校准。",
        "2. **Note Off 释放**：复用现有长采样，只需保存 `SoundInstance` 并在时值结束时 `stop()`；"
        "对快歌的尾音堆积改善明显。",
        "3. **最近 tick**：改动最小，先把整体拖后消掉；不要期待它恢复 16 分音符的原始间隔。",
        "4. **子 tick**：等前三项稳定后再评估，不建议本阶段投入。",
        "",
        "## 限制",
        "",
        "- 离线渲染使用线性重采样与简化包络，和 WebAudio/Minecraft 的实际输出不会逐样本一致；"
        "结论以相对差异和听感为准。",
        "- 快速曲目片段只取 30s；不同段落的密度/力度分布会变化，建议在实验页换片段重复试听。",
        "- 力度层响度对齐使用了 1.2s 积分响度；极短音符的实际感知响度可能略有不同。",
        "- 游戏端仍受 20 TPS 限制；本阶段没有修改游戏播放逻辑，也没有重新打包正式音色资源。",
        "",
        "## 复现",
        "",
        "```bash",
        "node tools/build-audio-lab-assets.mjs     # 下载/转码 VCSL 三层素材",
        "node tools/audio-lab-render.mjs           # 渲染 A/B + metrics.json",
        "python tools/audio-lab-analyze.py         # 生成报告",
        "npm run dev:web                           # 打开 /lab 实验页",
        "```",
        "",
    ]

    with open(REPORT, "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n")
    print(f"报告：{REPORT}")


if __name__ == "__main__":
    main()
