import { useEffect, useMemo, useState } from "react";
import {
    Button,
    FileDropzone,
    PageHeader,
    Segmented,
    Spinner,
    Tag,
    Textfield,
    notify,
} from "@piano/ui";
import {
    AudioWaveform,
    Check,
    CloudDownload,
    ExternalLink,
    Link2,
    Loader2,
    Music2,
    Play,
    Search,
    ServerCog,
    Upload,
    Video,
} from "lucide-react";
import {
    api,
    formatDuration,
    type BiliSearchItem,
    type TranscribeResult,
    type TranscribeStatus,
} from "./api";
import { midiPlayer } from "./midiPlayer";

const AUDIO_ACCEPT = [".mp3", ".m4a", ".wav", ".flac", ".ogg", ".aac", ".opus", ".mp4"];

function formatPlay(play: number): string {
    if (play >= 10000) return `${(play / 10000).toFixed(1)} 万`;
    return String(play);
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 服务端音频转 MIDI：调用 amt-cli，支持上传音频与直接解析 B 站视频。 */
export function TranscribePage() {
    const [status, setStatus] = useState<TranscribeStatus | null>(null);
    const [tab, setTab] = useState<"upload" | "bilibili">("upload");

    const [file, setFile] = useState<File | null>(null);
    const [name, setName] = useState("");

    const [keyword, setKeyword] = useState("");
    const [searching, setSearching] = useState(false);
    const [results, setResults] = useState<BiliSearchItem[]>([]);
    const [page, setPage] = useState(1);

    const [busy, setBusy] = useState(false);
    const [stage, setStage] = useState("");
    const [elapsed, setElapsed] = useState(0);
    const [result, setResult] = useState<TranscribeResult | null>(null);

    useEffect(() => {
        api.transcribeStatus()
            .then(setStatus)
            .catch((error) => setStatus({ available: false, message: (error as Error).message } as TranscribeStatus));
    }, []);

    useEffect(() => {
        if (!busy) return;
        const started = Date.now();
        setElapsed(0);
        const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 500);
        return () => clearInterval(timer);
    }, [busy]);

    const available = status?.available ?? null;
    const directInput = useMemo(() => /BV[0-9A-Za-z]{10}|av\d+/i.test(keyword), [keyword]);

    const run = async (task: () => Promise<TranscribeResult>, label: string) => {
        if (busy) return;
        setBusy(true);
        setResult(null);
        setStage(label);
        try {
            const value = await task();
            setResult(value);
            notify({
                title: "转换完成",
                message: `${value.song.name} · ${(value.song.noteCount ?? 0).toLocaleString()} 音符`,
                color: "teal",
            });
        } catch (error) {
            notify({ title: "转换失败", message: (error as Error).message, color: "red" });
        } finally {
            setBusy(false);
            setStage("");
        }
    };

    const transcribeFile = () => {
        if (!file) return;
        void run(
            () => api.transcribeAudio(file, name.trim() || undefined),
            "上传音频 → 转录音符 → 写入曲库"
        );
    };

    const search = async (value = keyword) => {
        const q = value.trim();
        if (!q || searching) return;
        setSearching(true);
        setResults([]);
        try {
            const res = await api.searchBilibili(q);
            setResults(res.items);
            if (res.items.length === 0) {
                notify({ title: "没有搜索结果", message: q, color: "gray" });
            }
        } catch (error) {
            notify({ title: "搜索失败", message: (error as Error).message, color: "red" });
        } finally {
            setSearching(false);
        }
    };

    const transcribeBili = (input: string, songName?: string) => {
        void run(
            () => api.transcribeBilibili(input, songName, page),
            "解析视频 → 下载音频 → 转录音符 → 写入曲库"
        );
    };

    const playResult = async () => {
        if (!result) return;
        try {
            const buffer = await api.getSongRaw(result.song.id);
            await midiPlayer.play(
                result.song.id,
                buffer,
                result.song.name,
                result.song.duration / 40
            );
        } catch (error) {
            notify({ title: "播放失败", message: (error as Error).message, color: "red" });
        }
    };

    return (
        <div className="flex flex-col gap-4">
            <PageHeader
                eyebrow="Server Transcription"
                title="音频转 MIDI"
                description="服务端使用 AMT 钢琴转录模型：上传音频，或直接粘贴 B 站视频链接解析音频并转为 MIDI，结果自动进入曲目库。"
                actions={
                    <Tag tone={available ? "success" : "default"}>
                        {available === null ? "检测中" : available ? "AMT 已就绪" : "AMT 未配置"}
                    </Tag>
                }
            />

            {status && !status.available && (
                <div className="rounded-md border px-3.5 py-3 text-xs leading-relaxed pb-edge-warning pb-tint-warning">
                    <div className="font-semibold">服务端 AMT 不可用</div>
                    <div className="mt-1 text-ore-dim">
                        {status.message ??
                            "请运行 npm run sync:amt 同步 amt-cli 与模型，或通过 AMT_CLI / AMT_MODEL 指定路径。"}
                    </div>
                </div>
            )}

            {status?.available && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ore-dim">
                    <span className="inline-flex items-center gap-1.5">
                        <ServerCog size={12} /> {status.decoder === "ffmpeg" ? "ffmpeg 解码" : "原生解码"}
                    </span>
                    <span>{status.threads} 线程{status.eco ? " · 低负载" : ""}</span>
                    <span className="min-w-0 truncate" title={status.cli}>
                        CLI：{status.cli}
                    </span>
                </div>
            )}

            <div className="flex flex-col gap-3 rounded-lg border border-ore-border bg-ore-raised p-3.5">
                <Segmented
                    ariaLabel="音频来源"
                    value={tab}
                    onChange={(value) => {
                        setTab(value);
                        setResult(null);
                    }}
                    options={[
                        { value: "upload", label: "上传音频" },
                        { value: "bilibili", label: "B站视频" },
                    ]}
                />

                {tab === "upload" ? (
                    <div className="flex flex-col gap-3">
                        <FileDropzone
                            accept={AUDIO_ACCEPT}
                            multiple={false}
                            disabled={busy || available === false}
                            title={file ? file.name : "拖入音频或点击选择"}
                            description={
                                file
                                    ? `${formatBytes(file.size)} · 点击可重新选择`
                                    : "支持 mp3 / m4a / wav / flac / ogg / aac，最大 100 MB"
                            }
                            icon={<Upload size={18} />}
                            onDrop={(files) => {
                                const next = files[0] ?? null;
                                setFile(next);
                                setName(next ? next.name.replace(/\.[^.]+$/, "").slice(0, 80) : "");
                                setResult(null);
                            }}
                        />
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                            <Textfield
                                className="min-w-0 flex-1"
                                label="曲目名称"
                                placeholder="留空则使用文件名"
                                value={name}
                                disabled={busy}
                                onInput={(event) => {
                                    const target = event.target as unknown as { value?: unknown };
                                    if (typeof target?.value === "string") setName(target.value);
                                }}
                            />
                            <Button
                                type="button"
                                size="sm"
                                disabled={!file || busy || available === false}
                                onClick={transcribeFile}
                            >
                                {busy ? <Loader2 size={14} className="animate-spin" /> : <AudioWaveform size={14} />}
                                开始转换
                            </Button>
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col gap-3">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                            <Textfield
                                className="min-w-0 flex-1"
                                label="视频链接 / BV 号 / 关键词"
                                placeholder="例如 BV1S64y1179w，或输入「Animenz 火花」搜索"
                                value={keyword}
                                disabled={busy}
                                onInput={(event) => {
                                    const target = event.target as unknown as { value?: unknown };
                                    if (typeof target?.value === "string") setKeyword(target.value);
                                }}
                                onKeyDown={(event: React.KeyboardEvent) => {
                                    if (event.key === "Enter") {
                                        if (directInput) transcribeBili(keyword);
                                        else void search();
                                    }
                                }}
                            />
                            {directInput ? (
                                <Button
                                    type="button"
                                    size="sm"
                                    disabled={busy || available === false}
                                    onClick={() => transcribeBili(keyword)}
                                >
                                    <Link2 size={14} /> 直接转录
                                </Button>
                            ) : (
                                <Button
                                    type="button"
                                    size="sm"
                                    color="secondary"
                                    loading={searching}
                                    disabled={!keyword.trim() || available === false}
                                    onClick={() => void search()}
                                >
                                    <Search size={14} /> 搜索
                                </Button>
                            )}
                        </div>

                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-ore-dim">
                            <span className="inline-flex items-center gap-1">
                                <Video size={12} /> 无需登录，默认使用最高码率音轨
                            </span>
                            <label className="ml-auto inline-flex items-center gap-1.5">
                                分P
                                <input
                                    type="number"
                                    min={1}
                                    value={page}
                                    disabled={busy}
                                    className="w-14 rounded border border-ore-border bg-transparent px-1.5 py-0.5 text-[11px] tabular-nums outline-none focus:border-brand"
                                    onChange={(event) => setPage(Math.max(1, Number(event.target.value) || 1))}
                                />
                            </label>
                        </div>

                        {results.length > 0 && (
                            <div className="flex max-h-[320px] flex-col overflow-y-auto rounded-md border border-ore-divider [scrollbar-gutter:stable]">
                                {results.map((item) => (
                                    <div
                                        key={item.bvid}
                                        className="flex items-center gap-3 border-b border-ore-divider px-3 py-2 last:border-b-0 hover:bg-[var(--pb-hover)]"
                                    >
                                        <div className="min-w-0 flex-1">
                                            <div className="truncate text-[12.5px] font-medium">{item.title}</div>
                                            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10.5px] text-ore-dim">
                                                <span>{item.bvid}</span>
                                                <span>{item.author}</span>
                                                <span>{item.duration}</span>
                                                <span>{formatPlay(item.play)} 播放</span>
                                            </div>
                                        </div>
                                        <Button
                                            type="button"
                                            size="sm"
                                            color="ghost"
                                            disabled={busy || available === false}
                                            onClick={() => transcribeBili(item.bvid, item.title)}
                                        >
                                            <CloudDownload size={13} /> 转录
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        )}

                        <a
                            href="https://www.bilibili.com"
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex w-fit items-center gap-1 text-[11px] text-ore-dim transition-colors hover:text-ore-text"
                        >
                            <ExternalLink size={11} /> 打开 B 站查找视频
                        </a>
                    </div>
                )}
            </div>

            {busy && (
                <div className="rounded-lg border border-ore-border bg-ore-raised p-4">
                    <div className="flex items-center gap-2.5 text-[13px] font-medium">
                        <Spinner size={15} />
                        正在转换…
                        <span className="ml-auto text-[11px] tabular-nums text-ore-dim">{elapsed}s</span>
                    </div>
                    <div className="mt-1.5 text-[11.5px] leading-relaxed text-ore-dim">{stage}</div>
                    <div className="mt-2 text-[10.5px] text-ore-dimmer">
                        服务端串行处理，长音频可能需要几十秒；完成后会自动保存到曲目库。
                    </div>
                </div>
            )}

            {result && !busy && (
                <div className="rounded-lg border border-ore-border bg-ore-raised p-4">
                    <div className="flex flex-wrap items-center gap-2.5">
                        <span className="grid h-8 w-8 place-items-center rounded-md pb-tint-success">
                            <Check size={16} />
                        </span>
                        <div className="min-w-0 flex-1">
                            <div className="truncate text-[13px] font-semibold">{result.song.name}</div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-ore-dim">
                                <span>{(result.song.noteCount ?? 0).toLocaleString()} 音符</span>
                                <span>·</span>
                                <span>{formatDuration(result.song.duration)}</span>
                                {result.song.dataSize != null && (
                                    <>
                                        <span>·</span>
                                        <span>{formatBytes(result.song.dataSize)}</span>
                                    </>
                                )}
                                <span>·</span>
                                <span>耗时 {(result.elapsedMs / 1000).toFixed(1)}s</span>
                            </div>
                        </div>
                        <Button type="button" size="sm" color="secondary" onClick={() => void playResult()}>
                            <Play size={13} /> 试听
                        </Button>
                        <a
                            href="/"
                            className="inline-flex items-center gap-1.5 rounded-md border border-ore-border px-2.5 py-1.5 text-[11.5px] text-ore-dim transition-colors hover:bg-[var(--pb-hover)] hover:text-ore-text"
                        >
                            <Music2 size={13} /> 曲目库
                        </a>
                    </div>
                    {"bvid" in result.source && (
                        <div className="mt-2 text-[10.5px] leading-relaxed text-ore-dimmer">
                            来源：{result.source.title}
                            {result.source.pageCount > 1 ? `（P${result.source.page}）` : ""} ·{" "}
                            {result.source.bvid} · {result.source.quality} ·{" "}
                            {Math.round(result.source.bandwidth / 1000)} kbps
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
