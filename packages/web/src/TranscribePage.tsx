import { useEffect, useMemo, useRef, useState } from "react";
import {
    Button,
    FileDropzone,
    ImportCodeDialog,
    NoteRoll,
    PageHeader,
    Segmented,
    Spinner,
    Tag,
    Textfield,
    notify,
    usePlayerState,
    type PlayerNote,
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
    QrCode,
    Save,
    Search,
    ServerCog,
    Upload,
    Video,
    Volume2,
    X,
} from "lucide-react";
import {
    api,
    formatDuration,
    type BiliSearchItem,
    type ImportCode,
    type TranscribeJob,
    type TranscribeStatus,
} from "./api";
import { appPlayer, midiPlayer, parseMidi } from "./midiPlayer";

const AUDIO_ACCEPT = [".mp3", ".m4a", ".wav", ".flac", ".ogg", ".aac", ".opus", ".mp4"];

const STAGE_LABEL: Record<TranscribeJob["stage"], string> = {
    queued: "排队中",
    downloading: "下载音频",
    analyzing: "分析音频",
    transcribing: "转录音符",
    finalizing: "生成 MIDI",
    done: "转换完成",
    error: "转换失败",
};

function formatPlay(play: number): string {
    if (play >= 10000) return `${(play / 10000).toFixed(1)} 万`;
    return String(play);
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 读取本地音频时长（用于服务端估算转录进度）；不支持时返回 undefined */
function readAudioDuration(file: File): Promise<number | undefined> {
    return new Promise((resolve) => {
        const url = URL.createObjectURL(file);
        const audio = new Audio();
        let settled = false;
        const finish = (value: number | undefined) => {
            if (settled) return;
            settled = true;
            URL.revokeObjectURL(url);
            resolve(value);
        };
        audio.onloadedmetadata = () =>
            finish(Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : undefined);
        audio.onerror = () => finish(undefined);
        audio.src = url;
        // 某些格式不会触发 loadedmetadata，5 秒后放弃等待
        window.setTimeout(() => finish(undefined), 5000);
    });
}

/** 服务端音频转 MIDI：转录结果先预览，确认后再手动保存进曲目库。 */
export function TranscribePage() {
    const [status, setStatus] = useState<TranscribeStatus | null>(null);
    const [tab, setTab] = useState<"upload" | "bilibili">("upload");

    const [file, setFile] = useState<File | null>(null);
    const [name, setName] = useState("");

    const [keyword, setKeyword] = useState("");
    const [searching, setSearching] = useState(false);
    const [results, setResults] = useState<BiliSearchItem[]>([]);
    const [page, setPage] = useState(1);

    const [job, setJob] = useState<TranscribeJob | null>(null);
    const [busy, setBusy] = useState(false);
    const [uploadRatio, setUploadRatio] = useState(0);
    const [, setTick] = useState(0);

    const [editName, setEditName] = useState("");
    const [saving, setSaving] = useState(false);
    const [codeBusy, setCodeBusy] = useState(false);
    const [code, setCode] = useState<ImportCode | null>(null);
    const [playBusy, setPlayBusy] = useState(false);

    const [audioLoading, setAudioLoading] = useState(false);
    const [resultNotes, setResultNotes] = useState<PlayerNote[]>([]);

    const player = usePlayerState(appPlayer);
    const audioActive = player.sourceLabel === "原音频试听" && player.status !== "idle";

    const unsubscribeRef = useRef<(() => void) | null>(null);

    useEffect(() => {
        api.transcribeStatus()
            .then(setStatus)
            .catch((error) => setStatus({ available: false, message: (error as Error).message } as TranscribeStatus));
        // 清理旧版本留下的任务恢复键：进入页面不应自动显示上次的转换结果
        try {
            localStorage.removeItem("piano_transcribe_job");
        } catch {
            // 隐私模式忽略
        }
        return () => {
            unsubscribeRef.current?.();
        };
    }, []);

    // 任务进行中每 0.5 秒刷新一次已用时长（下载/排队阶段没有进度事件）
    useEffect(() => {
        if (!busy) return;
        const timer = setInterval(() => setTick((value) => value + 1), 500);
        return () => clearInterval(timer);
    }, [busy]);

    useEffect(() => {
        if (job) setEditName(job.name);
    }, [job?.id, job?.name]);

    // 转录完成后加载音符，供结果卡片里的钢琴卷帘与「原音频试听」共用
    useEffect(() => {
        if (!job?.midiReady) {
            setResultNotes([]);
            return;
        }
        let cancelled = false;
        api.getTranscribeMidi(job.id)
            .then((buffer) => {
                if (cancelled) return;
                setResultNotes(
                    parseMidi(buffer).map((note) => ({
                        pitch: note.midi,
                        start: note.time,
                        end: note.time + note.duration,
                        velocity: note.velocity,
                    }))
                );
            })
            .catch(() => {
                if (!cancelled) setResultNotes([]);
            });
        return () => {
            cancelled = true;
        };
    }, [job?.id, job?.midiReady]);

    const available = status?.available ?? null;
    const directInput = useMemo(() => /BV[0-9A-Za-z]{10}|av\d+/i.test(keyword), [keyword]);

    const follow = (created: TranscribeJob) => {
        unsubscribeRef.current?.();
        setJob(created);
        setBusy(created.stage !== "done" && created.stage !== "error");
        unsubscribeRef.current = api.subscribeTranscribeJob(created.id, {
            onUpdate: (next) => {
                setJob(next);
                if (next.stage === "done" || next.stage === "error") {
                    setBusy(false);
                    unsubscribeRef.current?.();
                    unsubscribeRef.current = null;
                    if (next.stage === "done") {
                        notify({
                            title: "转换完成",
                            message: `${next.name} · ${next.noteCount.toLocaleString()} 音符`,
                            color: "teal",
                        });
                    } else {
                        notify({ title: "转换失败", message: next.error ?? "未知错误", color: "red" });
                    }
                }
            },
            onError: (error) => {
                setBusy(false);
                notify({ title: "进度连接中断", message: error.message, color: "red" });
            },
        });
    };

    const resetJob = async () => {
        unsubscribeRef.current?.();
        unsubscribeRef.current = null;
        appPlayer.stopAudio();
        setCode(null);
        setUploadRatio(0);
        setBusy(false);
        const previous = job;
        setJob(null);
        if (previous) {
            try {
                await api.deleteTranscribeJob(previous.id);
            } catch {
                // 任务可能已被清理，忽略
            }
        }
    };

    const startUpload = async () => {
        if (!file || busy) return;
        await resetJob();
        setBusy(true);
        setUploadRatio(0);
        try {
            const durationSec = await readAudioDuration(file);
            const created = await api.createTranscribeJob(file, {
                name: name.trim() || undefined,
                durationSec,
                onUploadProgress: setUploadRatio,
            });
            setUploadRatio(1);
            follow(created);
        } catch (error) {
            setBusy(false);
            notify({ title: "上传失败", message: (error as Error).message, color: "red" });
        }
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

    const transcribeBili = async (input: string, songName?: string) => {
        if (busy) return;
        await resetJob();
        setBusy(true);
        try {
            const created = await api.createBilibiliJob(
                input,
                page,
                songName ?? (name.trim() || undefined)
            );
            follow(created);
        } catch (error) {
            setBusy(false);
            notify({ title: "转换失败", message: (error as Error).message, color: "red" });
        }
    };

    const commitName = async () => {
        if (!job) return;
        const clean = editName.trim();
        if (!clean || clean === job.name) {
            setEditName(job.name);
            return;
        }
        try {
            const next = await api.renameTranscribeJob(job.id, clean);
            setJob(next);
            setEditName(next.name);
        } catch (error) {
            setEditName(job.name);
            notify({ title: "重命名失败", message: (error as Error).message, color: "red" });
        }
    };

    const saveToLibrary = async () => {
        if (!job || job.savedSong || saving) return;
        setSaving(true);
        try {
            const next = await api.saveTranscribeJob(job.id, editName.trim() || undefined);
            setJob(next);
            setEditName(next.name);
            notify({ title: "已加入曲目库", message: next.name, color: "teal" });
        } catch (error) {
            notify({ title: "保存失败", message: (error as Error).message, color: "red" });
        } finally {
            setSaving(false);
        }
    };

    const openCode = async () => {
        if (!job || codeBusy) return;
        setCodeBusy(true);
        try {
            let current = job;
            const clean = editName.trim();
            if (clean && clean !== job.name) {
                current = await api.renameTranscribeJob(job.id, clean);
                setJob(current);
                setEditName(current.name);
            }
            const result = await api.getTranscribeCode(current.id);
            setCode(result);
        } catch (error) {
            notify({ title: "生成导入码失败", message: (error as Error).message, color: "red" });
        } finally {
            setCodeBusy(false);
        }
    };

    const playMidi = async () => {
        if (!job || playBusy) return;
        setPlayBusy(true);
        try {
            const buffer = await api.getTranscribeMidi(job.id);
            await midiPlayer.play(job.id, buffer, editName.trim() || job.name, (job.midiDuration ?? 0) / 40);
        } catch (error) {
            notify({ title: "播放失败", message: (error as Error).message, color: "red" });
        } finally {
            setPlayBusy(false);
        }
    };

    const toggleAudio = async () => {
        if (!job) return;
        if (audioActive) {
            appPlayer.stopAudio();
            return;
        }
        setAudioLoading(true);
        try {
            const blob = await api.getTranscribeAudio(job.id);
            await appPlayer.playAudio(
                blob,
                editName.trim() || job.name,
                job.durationSec ?? 0,
                resultNotes
            );
        } catch (error) {
            notify({ title: "加载原音频失败", message: (error as Error).message, color: "red" });
        } finally {
            setAudioLoading(false);
        }
    };

    const elapsedSeconds = job
        ? Math.max(
              0,
              Math.round(
                  (job.stage === "done" || job.stage === "error"
                      ? job.elapsedMs
                      : Date.now() - job.createdAt) / 1000
              )
          )
        : 0;
    const percent = job ? job.percent : busy ? Math.round(uploadRatio * 10) : 0;
    const determinate = percent >= 0;
    const done = job?.stage === "done";
    const failed = job?.stage === "error";

    return (
        <div className="flex flex-col gap-4">
            <PageHeader
                eyebrow="Server Transcription"
                title="音频转 MIDI"
                description="服务端使用 AMT 钢琴转录模型：上传音频，或直接粘贴 B 站视频链接解析音频。转换结果先在这里试听、改名、生成导入码，确认后再手动加入曲目库。"
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
                    <span>
                        {status.threads} 线程{status.eco ? " · 低负载" : ""}
                    </span>
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
                        setResults([]);
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
                                onClick={() => void startUpload()}
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
                                        if (directInput) void transcribeBili(keyword);
                                        else void search();
                                    }
                                }}
                            />
                            {directInput ? (
                                <Button
                                    type="button"
                                    size="sm"
                                    disabled={busy || available === false}
                                    onClick={() => void transcribeBili(keyword)}
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
                                            onClick={() => void transcribeBili(item.bvid, item.title)}
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
                        {job ? STAGE_LABEL[job.stage] : uploadRatio > 0 ? "上传音频" : "准备中"}
                        <span className="ml-auto text-[11px] tabular-nums text-ore-dim">
                            {job ? `${elapsedSeconds}s` : `${Math.round(uploadRatio * 100)}%`}
                        </span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--pb-hover)]">
                        {determinate ? (
                            <div
                                className="h-full rounded-full bg-brand transition-[width] duration-300"
                                style={{ width: `${Math.max(2, percent)}%` }}
                            />
                        ) : (
                            <div className="h-full w-1/3 animate-pulse rounded-full bg-brand" />
                        )}
                    </div>
                    <div className="mt-1.5 text-[11.5px] leading-relaxed text-ore-dim">
                        {job?.message ?? "正在上传音频…"}
                        {job && job.stage === "transcribing" && job.durationSec ? (
                            <span className="ml-1 tabular-nums">
                                {Math.min(job.audioTime ?? 0, job.durationSec).toFixed(0)} /{" "}
                                {job.durationSec.toFixed(0)}s
                            </span>
                        ) : null}
                    </div>
                    <div className="mt-2 flex items-center gap-2 text-[10.5px] text-ore-dimmer">
                        <span>转换结果不会自动加入曲目库。</span>
                        <button
                            type="button"
                            className="ml-auto inline-flex items-center gap-1 rounded border border-ore-border px-2 py-0.5 transition-colors hover:bg-[var(--pb-hover)] hover:text-ore-text"
                            onClick={() => void resetJob()}
                        >
                            <X size={11} /> 取消
                        </button>
                    </div>
                </div>
            )}

            {failed && job && (
                <div className="rounded-lg border px-3.5 py-3 text-xs leading-relaxed pb-edge-danger pb-tint-danger">
                    <div className="font-semibold">转换失败</div>
                    <div className="mt-1 text-ore-dim">{job.error ?? "未知错误"}</div>
                    <Button
                        type="button"
                        color="secondary"
                        size="sm"
                        className="mt-2.5"
                        onClick={() => void resetJob()}
                    >
                        关闭
                    </Button>
                </div>
            )}

            {done && job && (
                <div className="rounded-lg border border-ore-border bg-ore-raised p-4">
                    <div className="flex flex-wrap items-center gap-2.5">
                        <span className="grid h-8 w-8 place-items-center rounded-md pb-tint-success">
                            <Check size={16} />
                        </span>
                        <div className="min-w-0 flex-1">
                            <div className="truncate text-[13px] font-semibold">
                                {job.savedSong ? "已保存到曲目库" : "转换完成"}
                            </div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-ore-dim">
                                <span>{job.noteCount.toLocaleString()} 音符</span>
                                <span>·</span>
                                <span>{formatDuration(job.midiDuration ?? 0)}</span>
                                {job.dataSize != null && (
                                    <>
                                        <span>·</span>
                                        <span>{formatBytes(job.dataSize)}</span>
                                    </>
                                )}
                                <span>·</span>
                                <span>耗时 {(job.elapsedMs / 1000).toFixed(1)}s</span>
                            </div>
                        </div>
                        {job.savedSong ? (
                            <Tag tone="success">已保存</Tag>
                        ) : (
                            <Button type="button" size="sm" loading={saving} onClick={() => void saveToLibrary()}>
                                <Save size={13} /> 保存到曲目库
                            </Button>
                        )}
                    </div>

                    <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
                        <Textfield
                            className="min-w-0 flex-1"
                            label="曲目名称"
                            value={editName}
                            disabled={Boolean(job.savedSong)}
                            onInput={(event) => {
                                const target = event.target as unknown as { value?: unknown };
                                if (typeof target?.value === "string") setEditName(target.value);
                            }}
                            onBlur={() => void commitName()}
                            onKeyDown={(event: React.KeyboardEvent) => {
                                if (event.key === "Enter") void commitName();
                            }}
                        />
                        <div className="flex flex-wrap items-center gap-2">
                            <Button
                                type="button"
                                size="sm"
                                color="secondary"
                                loading={playBusy}
                                onClick={() => void playMidi()}
                            >
                                <Play size={13} /> 试听 MIDI
                            </Button>
                            <Button
                                type="button"
                                size="sm"
                                color="secondary"
                                loading={audioLoading}
                                onClick={() => void toggleAudio()}
                            >
                                <Volume2 size={13} /> {audioActive ? "收起原音频" : "试听原音频"}
                            </Button>
                            <Button
                                type="button"
                                size="sm"
                                color="secondary"
                                loading={codeBusy}
                                onClick={() => void openCode()}
                            >
                                <QrCode size={13} /> 生成导入码
                            </Button>
                            <Button
                                type="button"
                                size="sm"
                                color="ghost"
                                onClick={() => void resetJob()}
                            >
                                关闭
                            </Button>
                        </div>
                    </div>

                    <div className="mt-3 rounded-md border border-ore-divider bg-[var(--pb-soft)] p-2">
                        <NoteRoll
                            notes={resultNotes}
                            duration={(job.midiDuration ?? 0) / 40}
                            currentTime={
                                audioActive || player.songId === job.id ? player.currentTime : 0
                            }
                            height={160}
                            onSeek={(time) => appPlayer.seek(time)}
                        />
                    </div>

                    {job.savedSong && (
                        <div className="mt-2.5 flex flex-wrap items-center gap-x-2 text-[10.5px] text-ore-dimmer">
                            <Music2 size={11} />
                            <span>曲目库 ID：{job.savedSong.id}</span>
                            <a
                                href="/"
                                className="inline-flex items-center gap-1 rounded border border-ore-border px-2 py-0.5 transition-colors hover:bg-[var(--pb-hover)] hover:text-ore-text"
                            >
                                <Music2 size={11} /> 打开曲目库
                            </a>
                        </div>
                    )}

                    {job.source.kind === "bilibili" && job.source.bvid && (
                        <div className="mt-2 text-[10.5px] leading-relaxed text-ore-dimmer">
                            来源：{job.source.title}
                            {job.source.pageCount > 1 ? `（P${job.source.page}）` : ""} ·{" "}
                            {job.source.bvid} · {job.source.quality} ·{" "}
                            {Math.round(job.source.bandwidth / 1000)} kbps
                        </div>
                    )}
                </div>
            )}

            <ImportCodeDialog
                opened={Boolean(code)}
                onClose={() => setCode(null)}
                songName={code?.name ?? ""}
                chunks={code?.chunks ?? []}
                bytes={code?.bytes}
            />
        </div>
    );
}
