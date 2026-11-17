"""响度校准验证 + A/B 试听生成（开发工具，需要 numpy 与 ffmpeg）。

用法（仓库根目录）：
    python tools/loudness_check.py

输入：
    tools/piano_timbres_source/calibration.json   由 build-piano-timbres.mjs 生成

输出：
    tools/loudness-verification.md                验证报告
    build/loudness-ab/<音色>-A-calibrated.ogg     校准版
    build/loudness-ab/<音色>-B-raw.ogg            未校准版
    build/loudness-ab/<音色>-AB.ogg               两段连播
    build/loudness-ab/demo.mid                    试听使用的同一段 MIDI
"""
import hashlib
import json
import math
import os
import re
import struct
import subprocess
import wave

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FFMPEG = os.environ.get("FFMPEG", r"D:\ffmpeg\bin\ffmpeg.exe")
CALIBRATION = os.path.join(ROOT, "tools", "piano_timbres_source", "calibration.json")
SOUNDS = os.path.join(ROOT, "packages", "addon", "rp", "sounds")
OUT_DIR = os.path.join(ROOT, "build", "loudness-ab")
REPORT = os.path.join(ROOT, "tools", "loudness-verification.md")

SR = 48000
NOTE_ORDER = {"C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5, "F#": 6, "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11}
MIDI_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
BASE_INDEXES = [0, 3, 6, 9]
STANDARD = {"duration": 4.0, "fadeStart": 3.5, "fade": 0.5}
TIMBRE_LABELS = {
    "piano": "标准钢琴",
    "classic_grand": "经典三角",
    "bright_grand": "明亮三角",
    "upright": "原声立式",
    "electric_piano": "复古电钢",
}

# 同一段试听：音阶 → 和弦 → 低音 → 高音
DEMO = [
    (48, 0.00), (52, 0.25), (55, 0.50), (60, 0.75), (64, 1.00),
    (67, 1.25), (72, 1.50), (76, 1.75), (79, 2.00), (84, 2.25),
    (48, 3.00), (55, 3.00), (60, 3.00), (64, 3.00), (67, 3.00), (72, 3.00), (76, 3.00),
    (36, 4.00), (43, 4.00), (48, 4.00), (55, 4.00), (60, 4.00), (67, 4.00),
    (84, 5.00), (88, 5.00), (91, 5.00), (96, 5.00),
]
DENSE = [(midi, 0.0) for midi in range(48, 60)]

DECODE_CACHE = {}
PITCH_CACHE = {}


def midi_of(name):
    match = re.match(r"^([A-G]#?)(-?\d+)$", name)
    return (int(match.group(2)) + 1) * 12 + NOTE_ORDER[match.group(1)]


def note_name(midi):
    return f"{MIDI_NAMES[midi % 12]}{midi // 12 - 1}"


def shortest_diff(a, b):
    diff = a - b
    if diff > 6:
        diff -= 12
    if diff < -6:
        diff += 12
    return diff


def process_note(midi):
    """与 @piano/core 的 processNote 一致：返回基准采样名与变调比。"""
    index = midi % 12
    best_diff = 99
    for base in BASE_INDEXES:
        diff = shortest_diff(index, base)
        if abs(diff) < abs(best_diff):
            best_diff = diff
    return note_name(midi - best_diff), 2 ** (best_diff / 12)


def decode(path, seconds=12.0):
    key = (path, seconds)
    if key not in DECODE_CACHE:
        out = subprocess.run(
            [FFMPEG, "-hide_banner", "-loglevel", "error", "-i", path, "-t", str(seconds),
             "-ar", str(SR), "-ac", "2", "-f", "f32le", "-"],
            capture_output=True, check=True,
        ).stdout
        DECODE_CACHE[key] = np.frombuffer(out, dtype="<f4").reshape(-1, 2).astype(np.float32)
    return DECODE_CACHE[key]


def db(value):
    return 20 * math.log10(max(value, 1e-9))


def rms_db(audio):
    return db(math.sqrt(float(np.mean(audio.astype(np.float64) ** 2)) + 1e-20))


def side_mid(audio):
    mid = (audio[:, 0] + audio[:, 1]) / 2
    side = (audio[:, 0] - audio[:, 1]) / 2
    rms = lambda x: math.sqrt(float(np.mean(x.astype(np.float64) ** 2)) + 1e-20)
    if rms(side) < 1e-6:
        return None  # 单声道素材（例如电钢）
    return db(rms(side) / rms(mid))


def transpose_filters(transpose):
    if not transpose:
        return []
    return ["aformat=sample_rates=48000", f"asetrate=48000*{2 ** (transpose / 12):.6f}", "aresample=48000"]


def reference_note(row, temp_dir):
    """把源采样按构建期的变调链输出成 0 dB 参考，用于和构建结果对比。"""
    stem = re.sub(r"[^A-Za-z0-9]+", "_", os.path.splitext(os.path.basename(row["file"]))[0])
    digest = hashlib.md5(row["file"].encode("utf-8")).hexdigest()[:8]
    out = os.path.join(temp_dir, f"ref_{midi_of(row['note'])}_{stem}_{digest}.wav")
    filters = transpose_filters(row.get("transpose")) + ["volume=0dB"]
    subprocess.run(
        [FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-i", row["file"], "-t", "1.2",
         "-af", ",".join(filters), "-ar", str(SR), "-ac", "2", "-c:a", "pcm_s16le", out],
        check=True,
    )
    return out


def resample_pitch(audio, rate):
    if abs(rate - 1.0) < 1e-9:
        return audio
    length = int(len(audio) / rate)
    idx = np.arange(length) * rate
    left = np.interp(idx, np.arange(len(audio)), audio[:, 0])
    right = np.interp(idx, np.arange(len(audio)), audio[:, 1])
    return np.stack([left, right], axis=1).astype(np.float32)


def shape_note(audio):
    length = int(STANDARD["duration"] * SR)
    if len(audio) < length:
        audio = np.pad(audio, ((0, length - len(audio)), (0, 0)))
    audio = audio[:length].copy()
    start = int(STANDARD["fadeStart"] * SR)
    audio[start:] *= np.linspace(1.0, 0.0, length - start, dtype=np.float32)[:, None]
    return audio


def render(rows, notes, gains):
    length = int((max(t for _, t in notes) * SR) + STANDARD["duration"] * SR) + SR
    mix = np.zeros((length, 2), dtype=np.float32)
    for midi, start in notes:
        sample, pitch = process_note(midi)
        row = rows[sample]
        rate = pitch * (2 ** (row.get("transpose", 0) / 12))
        key = (row["file"], round(rate, 6))
        if key not in PITCH_CACHE:
            PITCH_CACHE[key] = shape_note(resample_pitch(decode(row["file"]), rate))
        audio = PITCH_CACHE[key] * (10 ** (gains[sample] / 20))
        at = int(start * SR)
        mix[at:at + len(audio)] += audio
    return mix


def write_wav(path, audio):
    pcm = (np.clip(audio, -1.0, 1.0) * 32767).astype("<i2")
    with wave.open(path, "wb") as f:
        f.setnchannels(2)
        f.setsampwidth(2)
        f.setframerate(SR)
        f.writeframes(pcm.tobytes())


def encode_ogg(wav_path, ogg_path):
    subprocess.run(
        [FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-i", wav_path,
         "-c:a", "libvorbis", "-q:a", "4", ogg_path],
        check=True,
    )
    os.remove(wav_path)


def vlq(value):
    out = [value & 0x7F]
    value >>= 7
    while value:
        out.insert(0, (value & 0x7F) | 0x80)
        value >>= 7
    return bytes(out)


def write_demo_midi(path):
    division, bpm = 480, 120
    events = []
    for midi, start in DEMO:
        on = int(start * bpm / 60 * division)
        off = on + int(1.5 * bpm / 60 * division)
        events.append((on, 0x90, midi, 80))
        events.append((off, 0x80, midi, 0))
    events.sort(key=lambda e: (e[0], e[1]))
    data, last = bytearray(), 0
    for tick, status, note, velocity in events:
        data += vlq(tick - last)
        last = tick
        data.append(status)
        data += bytes([note, velocity])
    data += b"\x00\xff\x2f\x00"
    track = b"MTrk" + struct.pack(">I", len(data)) + bytes(data)
    with open(path, "wb") as f:
        f.write(b"MThd" + struct.pack(">IHHH", 6, 0, 1, division) + track)


def clean_outputs():
    os.makedirs(OUT_DIR, exist_ok=True)
    for name in os.listdir(OUT_DIR):
        if name.endswith(".wav") or name.startswith("_"):
            os.remove(os.path.join(OUT_DIR, name))


def measure_curve(rows, dir_name, temp_dir):
    """构建结果与源采样的逐键宽带 RMS（变调不改变 RMS；避免 Vorbis 噪声影响 LUFS 门限）。"""
    built_curve, source_curve, gains = [], [], []
    for note in sorted(rows, key=midi_of):
        row = rows[note]
        built = f"{SOUNDS}/{dir_name}/{note}.ogg"
        reference = reference_note(row, temp_dir) if row.get("transpose") else row["file"]
        source_curve.append(rms_db(decode(reference, 1.2)))
        built_curve.append(rms_db(decode(built, 1.2)))
        gains.append(row["gain"])
    deviation = max(abs(b - s - g) for b, s, g in zip(built_curve, source_curve, gains))
    return deviation, float(np.corrcoef(built_curve, source_curve)[0, 1])


def measure_attack_stereo(rows, dir_name, temp_dir):
    """同一变调链下，构建结果与 0 dB 参考的差异应只剩下增益。"""
    attack_deviation = 0.0
    stereo_deviation = 0.0
    for note in ("A2", "C4", "A4", "C6"):
        row = rows[note]
        reference = reference_note(row, temp_dir)
        built_audio = decode(f"{SOUNDS}/{dir_name}/{note}.ogg")
        reference_audio = decode(reference)
        built_peak = db(np.max(np.abs(built_audio[: int(0.03 * SR)])))
        reference_peak = db(np.max(np.abs(reference_audio[: int(0.03 * SR)])))
        attack_deviation = max(attack_deviation, abs(built_peak - reference_peak - row["gain"]))
        built_width, reference_width = side_mid(built_audio), side_mid(reference_audio)
        if built_width is None and reference_width is None:
            continue
        stereo_deviation = max(stereo_deviation, abs((built_width or 0) - (reference_width or 0)))
    return attack_deviation, stereo_deviation


def render_ab(rows, gains, timbre_id):
    raw_gains = {note: 0.0 for note in rows}
    mix_a = render(rows, DEMO, gains)
    mix_b = render(rows, DEMO, raw_gains)
    peak_a = float(np.max(np.abs(mix_a)))
    peak_b = float(np.max(np.abs(mix_b)))
    scale = 0.89 / max(peak_a, peak_b) if max(peak_a, peak_b) > 0.89 else 1.0
    mix_a *= scale
    mix_b *= scale

    wav_a = os.path.join(OUT_DIR, f"{timbre_id}-A-calibrated.wav")
    wav_b = os.path.join(OUT_DIR, f"{timbre_id}-B-raw.wav")
    wav_ab = os.path.join(OUT_DIR, f"{timbre_id}-AB.wav")
    write_wav(wav_a, mix_a)
    write_wav(wav_b, mix_b)
    write_wav(wav_ab, np.concatenate([mix_a, np.zeros((int(0.6 * SR), 2), dtype=np.float32), mix_b]))
    for wav in (wav_a, wav_b, wav_ab):
        encode_ogg(wav, wav.replace(".wav", ".ogg"))
    return peak_a * scale


def main():
    calibration = json.load(open(CALIBRATION, encoding="utf-8"))
    clean_outputs()
    write_demo_midi(os.path.join(OUT_DIR, "demo.mid"))
    temp_dir = os.path.join(OUT_DIR, "_tmp")
    os.makedirs(temp_dir, exist_ok=True)

    lines = [
        "# 响度校准验证",
        "",
        f"- 校准数据：`{os.path.relpath(CALIBRATION, ROOT)}`",
        f"- 试听：`{os.path.relpath(OUT_DIR, ROOT)}/`（每套音色 `-A` 校准版 / `-B` 原始版，同一段 `demo.mid`）",
        "- 分析窗口 1.2s（音头 + 早期延音）；A/B 均为单档长音（4s，3.5s 起 0.5s 淡出）",
        "",
        "## 指标",
        "",
        "| 音色 | 增益 | 修正键 | 曲线最大偏差 | 曲线相关 | 音头最大偏差 | 立体声最大偏差 | A 峰值 | A×2 峰值 | 密集和弦 A / A×2 |",
        "|---|---|---|---|---|---|---|---|---|---|",
    ]

    for timbre in calibration["timbres"]:
        timbre_id = timbre["timbreId"]
        reference_layer = timbre.get("referenceLayer", 0)
        rows = {
            row["note"]: row
            for row in timbre["rows"]
            if row["layer"] == reference_layer
        }
        dir_name = f"{timbre_id}_v{reference_layer + 1}"
        gains = {note: row["gain"] for note, row in rows.items()}
        deviation, correlation = measure_curve(rows, dir_name, temp_dir)
        attack_deviation, stereo_deviation = measure_attack_stereo(rows, dir_name, temp_dir)
        peak_a = render_ab(rows, gains, timbre_id)
        dense = render(rows, DENSE, gains)
        corrected = sum(1 for row in timbre["rows"] if abs(row["correction"]) > 0.05)
        lines.append(
            f"| {TIMBRE_LABELS[timbre_id]} | {timbre['globalGain']:+.1f} dB | {corrected} | {deviation:.2f} dB | "
            f"{correlation:.4f} | {attack_deviation:.2f} dB | {stereo_deviation:.2f} dB | {db(peak_a):.1f} dBFS | "
            f"{db(peak_a * 2):.1f} dBFS | {db(np.max(np.abs(dense))):.1f} / {db(np.max(np.abs(dense * 2))):.1f} dBFS |"
        )

    lines += [
        "",
        "## 说明",
        "",
        "- 曲线最大偏差：参考层 1.2s 宽带 RMS 与「源 RMS + 校准增益」的最大差（Vorbis 编码约 0.2–0.3 dB）。",
        "- 曲线相关：校准后 RMS 曲线与原始 RMS 曲线的相关系数，越接近 1 说明自然音区走势保留得越好。",
        "- 音头最大偏差：源与构建结果前 30ms 峰值差减去增益后的残差，应为 0（增益是纯线性缩放）。",
        "- 立体声最大偏差：源与构建结果的侧/中比之差，应为 0（左右声道等量缩放）。",
        "- 混音峰值：试听片段与 12 音密集和弦的峰值；A×2 为游戏内 200% 音量，> 0 dBFS 表示会削波。",
        "- A/B 混音在两边使用同一个峰值归一系数，避免归一化掩盖响度差异。",
        "",
        "## 试听曲目",
        "",
        "`build/loudness-ab/demo.mid`：C3–C6 上行音阶 → C 大调和弦 → 低音区齐奏 → 高音区齐奏。",
    ]

    with open(REPORT, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    for name in os.listdir(temp_dir):
        os.remove(os.path.join(temp_dir, name))
    os.rmdir(temp_dir)
    print("\n".join(lines[:11]))
    print(f"\n报告：{REPORT}")


if __name__ == "__main__":
    main()
