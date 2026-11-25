import { useEffect, useMemo, useRef, useState } from "react";
import {
    AudioWaveform,
    Check,
    CloudDownload,
    Download,
    FileCode2,
    Link2,
    Play,
    QrCode,
    Save,
    Search,
    Trash2,
    X,
} from "lucide-react";
import {
    TIME_SCALE,
    computeMusicFingerprint,
    encodeSong,
    planImportChunks,
    readAllSongNotes,
    readSongHeader,
} from "@piano/core";
import { midiBufferToSong } from "@piano/core/convert";
import {
    Button,
    FileDropzone,
    ImportCodeDialog,
    NoteRoll,
    PageHeader,
    Segmented,
    SongBadge,
    Textfield,
    notify,
    usePlayerState,
} from "@piano/ui";
import {
    clearModelAssets,
    downloadModelAssets,
    isModelDownloaded,
    transcribeAudio,
    type AssetDownloadProgress,
    type TranscribeOutput,
    type TranscribeProgress,
} from "../amt/transcribe";
import { serverApi } from "../adapters/serverAdapter";
import { studioPlayer } from "../audio/player";
import { useStudio } from "../store/studio";

function formatDur(sec: number): string {
    const s = Math.max(0, Math.floor(sec));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function ToolsPage() {
    const mode = useStudio((s) => s.mode);
    const libraries = useStudio((s) => s.libraries);
    const saveConvertedMidi = useStudio((s) => s.saveConvertedMidi);
    const importFiles = useStudio((s) => s.importFiles);

    const writableLibraries = useMemo(() => libraries.filter((l) => !l.readonly), [libraries]);
    const [targetLibraryId, setTargetLibraryId] = useState("");
    const [toolTab, setToolTab] = useState<"amt" | "inspect">("amt");
    const playerState = usePlayerState(studioPlayer);

    // Local AMT state
    const [audioFile, setAudioFile] = useState<File | null>(null);
    const [songName, setSongName] = useState("");
    const [modelReady, setModelReady] = useState<boolean | null>(null);
    const [dlProgress, setDlProgress] = useState<AssetDownloadProgress | null>(null);
    const [amtProgress, setAmtProgress] = useState<TranscribeProgress | null>(null);
    const [localOutput, setLocalOutput] = useState<TranscribeOutput | null>(null);
    const [localBusy, setLocalBusy] = useState(false);
    const abortRef = useRef<AbortController | null>(null);

    // Server AMT state
    const [serverAmtStatus, setServerAmtStatus] = useState<{
        available: boolean;
        bilibili?: boolean;
        queued?: number;
        active?: number;
        queueLimit?: number;
        queueFull?: boolean;
    } | null>(null);
    const [serverAmtTab, setServerAmtTab] = useState<"upload" | "bilibili">("upload");
    const [biliQuery, setBiliQuery] = useState("");
    const [biliResults, setBiliResults] = useState<
        Array<{ bvid: string; title: string; author: string; duration: number; play: number }>
    >([]);
    const [biliBusy, setBiliBusy] = useState(false);
    const [serverJobId, setServerJobId] = useState<string | null>(null);
    const [serverJobState, setServerJobState] = useState<{
        stage: string;
        progress: number;
        message?: string;
        error?: string;
        result?: { noteCount: number; duration: number };
    } | null>(null);
    const [serverBusy, setServerBusy] = useState(false);
    const serverJobActive =
        serverJobState !== null && serverJobState.stage !== "done" && serverJobState.stage !== "error";

    // MIDI / PBE3 inspector state
    const [inspected, setInspected] = useState<{
        name: string;
        pbe3: Uint8Array;
        id: string;
        fingerprint: string;
        duration: number;
        noteCount: number;
        performances: number;
        chunks: string[];
    } | null>(null);
    const [codeDialog, setCodeDialog] = useState<{
        name: string;
        chunks: string[];
        bytes: number;
    } | null>(null);

    useEffect(() => {
        if (mode === "local") {
            isModelDownloaded()
                .then(setModelReady)
                .catch(() => setModelReady(false));
        } else {
            serverApi
                .getTranscribeStatus()
                .then(setServerAmtStatus)
                .catch(() => setServerAmtStatus({ available: false }));
        }
    }, [mode]);

    useEffect(() => {
        if (!serverJobId) return;
        let cancelled = false;
        const timer = window.setInterval(async () => {
            try {
                const job = await serverApi.getTranscribeJob(serverJobId);
                if (cancelled) return;
                setServerJobState({
                    stage: job.stage,
                    progress: job.progress,
                    message: job.message,
                    error: job.error,
                    result: job.result,
                });
                if (job.stage === "done" || job.stage === "error") {
                    window.clearInterval(timer);
                    void serverApi
                        .getTranscribeStatus()
                        .then(setServerAmtStatus)
                        .catch(() => {});
                }
            } catch {
                window.clearInterval(timer);
            }
        }, 1200);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [serverJobId]);

    const handleDownloadModel = async () => {
        setLocalBusy(true);
        try {
            await downloadModelAssets((p) => setDlProgress(p));
            setModelReady(true);
            notify({ title: "音频转录模型已就绪", color: "teal" });
        } catch (err) {
            notify({
                title: "模型下载失败",
                message: err instanceof Error ? err.message : String(err),
                color: "red",
            });
        } finally {
            setLocalBusy(false);
            setDlProgress(null);
        }
    };

    const handleLocalTranscribe = async () => {
        if (!audioFile) return;
        const ctrl = new AbortController();
        abortRef.current = ctrl;
        setLocalBusy(true);
        setLocalOutput(null);
        try {
            const out = await transcribeAudio(audioFile, {
                lowLoad: true,
                signal: ctrl.signal,
                onProgress: (p) => setAmtProgress(p),
            });
            setLocalOutput(out);
            notify({
                title: "音频转 MIDI 完成",
                message: `识别出 ${out.notes.length} 个音符`,
                color: "teal",
            });
        } catch (err) {
            notify({
                title: "转录中断或失败",
                message: err instanceof Error ? err.message : String(err),
                color: "red",
            });
        } finally {
            setLocalBusy(false);
            abortRef.current = null;
        }
    };

    const startServerJob = (jobId: string) => {
        setServerJobId(jobId);
        setServerJobState({ stage: "queued", progress: -1, message: "已提交，等待处理…" });
        void serverApi.getTranscribeStatus().then(setServerAmtStatus).catch(() => {});
    };

    const handleServerUploadTranscribe = async () => {
        if (!audioFile || serverBusy || serverJobActive) return;
        const title = songName.trim() || audioFile.name.replace(/\.[^.]+$/, "");
        setServerBusy(true);
        try {
            const { jobId } = await serverApi.startTranscribeUpload(audioFile, title);
            startServerJob(jobId);
        } catch (err) {
            notify({
                title: "提交服务端转录失败",
                message: err instanceof Error ? err.message : String(err),
                color: "red",
            });
        } finally {
            setServerBusy(false);
        }
    };

    const handleBiliTranscribe = async (input: string, songNameHint?: string) => {
        const value = input.trim();
        if (!value || serverBusy || serverJobActive) return;
        setServerBusy(true);
        try {
            const { jobId } = await serverApi.startTranscribeBilibili(
                value,
                songNameHint ?? (biliQuery === value ? undefined : biliQuery.trim()),
            );
            startServerJob(jobId);
        } catch (err) {
            notify({
                title: "提交 B 站转录失败",
                message: err instanceof Error ? err.message : String(err),
                color: "red",
            });
        } finally {
            setServerBusy(false);
        }
    };

    const handleCancelServerJob = async () => {
        const id = serverJobId;
        setServerJobId(null);
        setServerJobState(null);
        if (!id) return;
        try {
            await serverApi.cancelTranscribeJob(id);
        } catch {
            // 任务可能已过期，忽略
        }
        void serverApi.getTranscribeStatus().then(setServerAmtStatus).catch(() => {});
    };

    const handleSearchBili = async () => {
        if (!biliQuery.trim()) return;
        setBiliBusy(true);
        try {
            const res = await serverApi.searchBilibili(biliQuery.trim());
            setBiliResults(res.items);
        } catch (err) {
            notify({
                title: "搜索失败",
                message: err instanceof Error ? err.message : String(err),
                color: "red",
            });
        } finally {
            setBiliBusy(false);
        }
    };

    const handleInspectFile = async (file: File) => {
        try {
            const raw = new Uint8Array(await file.arrayBuffer());
            const cleanName = file.name.replace(/\.(mid|midi|pbe3)$/i, "");
            const isPbe3 =
                file.name.toLowerCase().endsWith(".pbe3") ||
                (raw.length >= 4 && raw[0] === 0x50 && raw[1] === 0x42 && raw[2] === 0x45 && raw[3] === 0x33);
            const pbe3 = isPbe3 ? raw : encodeSong(midiBufferToSong(raw, cleanName));
            const header = readSongHeader(pbe3);
            const notes = readAllSongNotes(pbe3);
            const chunks = planImportChunks(pbe3);
            setInspected({
                name: header.name || cleanName,
                pbe3,
                id: header.id,
                fingerprint: computeMusicFingerprint(pbe3),
                duration: header.duration,
                noteCount: notes.length,
                performances: header.performance?.length ? 1 : 0,
                chunks,
            });
        } catch (err) {
            notify({
                title: "解析失败",
                message: err instanceof Error ? err.message : String(err),
                color: "red",
            });
        }
    };

    const directBiliInput = useMemo(() => /BV[0-9A-Za-z]{10}|av\d+/i.test(biliQuery), [biliQuery]);

    const rollNotes = useMemo(() => {
        if (!localOutput) return [];
        return localOutput.notes.map((n) => ({
            pitch: n.pitch,
            start: n.start,
            end: n.end,
            velocity: n.velocity / 127,
        }));
    }, [localOutput]);

    return (
        <div className="flex flex-col gap-5">
            <PageHeader
                eyebrow="Audio & Format Workbench"
                title="音乐工具"
                description="音频转 MIDI 转录（本地浏览器推理 / 服务器与 B 站音视频转录）、PBE3 解析与存储卡导入码生成。"
            />

            <Segmented
                value={toolTab}
                onChange={(v) => setToolTab(v as "amt" | "inspect")}
                options={[
                    { value: "amt", label: "音频转 MIDI" },
                    { value: "inspect", label: "MIDI / PBE3 检查与导入码" },
                ]}
            />

            {toolTab === "amt" ? (
                mode === "local" ? (
                    <div className="flex flex-col gap-4 rounded-xl border border-ore-border bg-ore-raised p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                                <div className="text-[14px] font-semibold">浏览器本地钢琴转录 (ONNX)</div>
                                <p className="mt-0.5 text-[12px] text-ore-dim">
                                    音频解码与模型推理全部在浏览器本地完成，不会上传音频文件。
                                </p>
                            </div>
                            <div className="flex items-center gap-2">
                                {modelReady ? (
                                    <>
                                        <SongBadge tone="brand">
                                            <Check size={11} className="mr-1 inline" /> 模型已缓存
                                        </SongBadge>
                                        <Button
                                            type="button"
                                            color="ghost"
                                            size="sm"
                                            onClick={() =>
                                                void clearModelAssets().then(() => setModelReady(false))
                                            }
                                        >
                                            <Trash2 size={13} /> 清理缓存
                                        </Button>
                                    </>
                                ) : (
                                    <Button
                                        type="button"
                                        size="sm"
                                        loading={localBusy}
                                        onClick={() => void handleDownloadModel()}
                                    >
                                        <CloudDownload size={14} /> 下载本地转录模型
                                    </Button>
                                )}
                            </div>
                        </div>

                        {dlProgress && (
                            <div className="text-[12px] text-ore-dim">
                                {dlProgress.message} ({dlProgress.percent.toFixed(0)}%)
                            </div>
                        )}

                        <FileDropzone
                            accept={[".mp3", ".m4a", ".wav", ".flac", ".ogg", ".aac", ".mp4"]}
                            multiple={false}
                            title={audioFile ? `已选择音频：${audioFile.name}` : "选择或拖拽音频文件"}
                            onDrop={(files) => {
                                const f = files[0];
                                if (!f) return;
                                setAudioFile(f);
                                setSongName(f.name.replace(/\.[^.]+$/, ""));
                                setLocalOutput(null);
                            }}
                        />

                        {audioFile && (
                            <div className="flex flex-wrap items-end gap-3">
                                <div className="min-w-[200px] flex-1">
                                    <Textfield
                                        label="输出曲目名称"
                                        value={songName}
                                        onInput={(e) => {
                                            const t = e.target as unknown as { value?: unknown };
                                            if (typeof t?.value === "string") setSongName(t.value);
                                        }}
                                    />
                                </div>
                                <Button
                                    type="button"
                                    disabled={!modelReady || localBusy}
                                    loading={localBusy}
                                    onClick={() => void handleLocalTranscribe()}
                                >
                                    <AudioWaveform size={14} /> 开始转录
                                </Button>
                                {localBusy && (
                                    <Button
                                        type="button"
                                        color="secondary"
                                        onClick={() => abortRef.current?.abort()}
                                    >
                                        取消
                                    </Button>
                                )}
                            </div>
                        )}

                        {amtProgress && (
                            <div className="rounded-lg border border-ore-divider bg-ore-sunken px-3 py-2 text-[12px]">
                                {amtProgress.message} · {amtProgress.percent.toFixed(0)}%
                            </div>
                        )}

                        {localOutput && (
                            <div className="flex flex-col gap-3 border-t border-ore-divider pt-3">
                                <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
                                    <span>
                                        识别完成：{localOutput.notes.length} 音符 ·{" "}
                                        {formatDur(localOutput.duration)}
                                    </span>
                                    <div className="flex flex-wrap gap-2">
                                        <Button
                                            type="button"
                                            color="secondary"
                                            size="sm"
                                            onClick={() =>
                                                void studioPlayer.playBytes(
                                                    "amt-preview",
                                                    songName || "转录预览",
                                                    localOutput.midi,
                                                    "mid",
                                                )
                                            }
                                        >
                                            <Play size={13} /> 试听结果
                                        </Button>
                                        <Button
                                            type="button"
                                            size="sm"
                                            onClick={() =>
                                                void saveConvertedMidi(
                                                    songName || "转录曲目",
                                                    localOutput.midi,
                                                    targetLibraryId || undefined,
                                                )
                                            }
                                        >
                                            <Save size={13} /> 保存到音乐库
                                        </Button>
                                        {writableLibraries.length > 0 && (
                                            <select
                                                value={targetLibraryId}
                                                onChange={(e) => setTargetLibraryId(e.target.value)}
                                                aria-label="目标曲库"
                                                className="h-8 rounded border border-[var(--pb-control-border)] bg-ore-sunken px-2 text-[12px]"
                                            >
                                                <option value="">默认曲库</option>
                                                {writableLibraries.map((lib) => (
                                                    <option key={lib.id} value={lib.id}>
                                                        {lib.name}
                                                    </option>
                                                ))}
                                            </select>
                                        )}
                                    </div>
                                </div>
                                <NoteRoll notes={rollNotes} duration={localOutput.duration} />
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="flex flex-col gap-4 rounded-xl border border-ore-border bg-ore-raised p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                                <div className="text-[14px] font-semibold">服务端音频转录</div>
                                <p className="mt-0.5 text-[12px] text-ore-dim">
                                    上传音频或检索 B 站视频交给后端异步转录，完成后预览并一键入库。
                                </p>
                            </div>
                            <SongBadge
                                tone={serverAmtStatus?.available && !serverAmtStatus.queueFull ? "brand" : "default"}
                            >
                                {!serverAmtStatus?.available
                                    ? "服务端未启用转录组件"
                                    : serverAmtStatus.queueFull
                                      ? "转录队列已满"
                                      : `服务端转录就绪${
                                            serverAmtStatus.queued
                                                ? ` · 排队 ${serverAmtStatus.queued}/${serverAmtStatus.queueLimit ?? 10}`
                                                : ""
                                        }`}
                            </SongBadge>
                        </div>

                        <Segmented
                            value={serverAmtTab}
                            onChange={(v) => setServerAmtTab(v as "upload" | "bilibili")}
                            options={[
                                { value: "upload", label: "上传音频" },
                                { value: "bilibili", label: "B 站搜索转录" },
                            ]}
                        />

                        {serverAmtTab === "upload" ? (
                            <>
                                <FileDropzone
                                    accept={[".mp3", ".m4a", ".wav", ".flac", ".ogg", ".aac", ".mp4"]}
                                    multiple={false}
                                    title={audioFile ? `已选择：${audioFile.name}` : "拖拽或选择音频文件"}
                                    onDrop={(files) => {
                                        const f = files[0];
                                        if (f) {
                                            setAudioFile(f);
                                            setSongName(f.name.replace(/\.[^.]+$/, ""));
                                        }
                                    }}
                                />
                                {audioFile && (
                                    <div className="flex flex-wrap items-end gap-3">
                                        <div className="min-w-[200px] flex-1">
                                            <Textfield
                                                label="曲名"
                                                value={songName}
                                                onInput={(e) => {
                                                    const t = e.target as unknown as { value?: unknown };
                                                    if (typeof t?.value === "string") setSongName(t.value);
                                                }}
                                            />
                                        </div>
                                        <Button
                                            type="button"
                                            loading={serverBusy}
                                            disabled={serverJobActive || Boolean(serverAmtStatus?.queueFull)}
                                            onClick={() => void handleServerUploadTranscribe()}
                                        >
                                            <AudioWaveform size={14} /> 提交转录任务
                                        </Button>
                                    </div>
                                )}
                            </>
                        ) : (
                            <div className="flex flex-col gap-3">
                                <div className="flex gap-2">
                                    <input
                                        type="search"
                                        value={biliQuery}
                                        onChange={(e) => setBiliQuery(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key !== "Enter") return;
                                            if (directBiliInput) void handleBiliTranscribe(biliQuery);
                                            else void handleSearchBili();
                                        }}
                                        placeholder="粘贴 BV 号 / 视频链接，或输入关键词搜索..."
                                        className="h-9 flex-1 rounded-md border border-[var(--pb-control-border)] bg-ore-sunken px-3 text-[13px] outline-none focus:border-brand"
                                    />
                                    {directBiliInput ? (
                                        <Button
                                            type="button"
                                            loading={serverBusy}
                                            disabled={serverJobActive || Boolean(serverAmtStatus?.queueFull)}
                                            onClick={() => void handleBiliTranscribe(biliQuery)}
                                        >
                                            <Link2 size={14} /> 直接转录
                                        </Button>
                                    ) : (
                                        <Button
                                            type="button"
                                            color="secondary"
                                            loading={biliBusy}
                                            disabled={!biliQuery.trim()}
                                            onClick={() => void handleSearchBili()}
                                        >
                                            <Search size={14} /> 搜索
                                        </Button>
                                    )}
                                </div>
                                <p className="text-[11px] text-ore-dim">
                                    支持 BV 号、av 号或视频链接直接转录；关键词请先搜索再选择结果。
                                </p>
                                <div className="flex max-h-[280px] flex-col divide-y divide-ore-divider overflow-y-auto rounded-lg border border-ore-divider">
                                    {biliResults.map((item) => (
                                        <div
                                            key={item.bvid}
                                            className="flex items-center justify-between gap-3 px-3 py-2 text-[12.5px]"
                                        >
                                            <div className="min-w-0 flex-1">
                                                <div className="truncate font-medium">
                                                    {item.title.replace(/<[^>]+>/g, "")}
                                                </div>
                                                <div className="text-[11px] text-ore-dim">
                                                    {item.author} · {formatDur(item.duration)} · {item.bvid}
                                                </div>
                                            </div>
                                            <Button
                                                type="button"
                                                size="sm"
                                                color="secondary"
                                                disabled={serverBusy || serverJobActive || Boolean(serverAmtStatus?.queueFull)}
                                                onClick={() => {
                                                    const clean = item.title.replace(/<[^>]+>/g, "");
                                                    void handleBiliTranscribe(item.bvid, clean);
                                                }}
                                            >
                                                转录
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {serverJobId && serverJobState && (
                            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ore-divider bg-ore-sunken px-3.5 py-2.5 text-[12.5px]">
                                <div>
                                    状态：<span className="font-semibold">{serverJobState.stage}</span> ·{" "}
                                    {serverJobState.progress >= 0
                                        ? `${Math.round(serverJobState.progress * 100)}%`
                                        : "处理中…"}
                                    {serverJobState.message && (
                                        <span className="ml-2 text-ore-dim">{serverJobState.message}</span>
                                    )}
                                    {serverJobState.error && (
                                        <span className="ml-2 text-red-400">{serverJobState.error}</span>
                                    )}
                                </div>
                                <div className="flex gap-2">
                                    {serverJobState.stage === "done" && (
                                        <>
                                            <Button
                                                type="button"
                                                size="sm"
                                                color="secondary"
                                                onClick={() =>
                                                    void serverApi.downloadTranscribeMidi(serverJobId).then((mid) =>
                                                        studioPlayer.playBytes("server-amt", "转录试听", mid, "mid"),
                                                    )
                                                }
                                            >
                                                <Play size={13} /> 试听
                                            </Button>
                                            <Button
                                                type="button"
                                                size="sm"
                                                color="secondary"
                                                onClick={() => {
                                                    if (!serverJobId) return;
                                                    void serverApi
                                                        .getTranscribeCode(serverJobId)
                                                        .then(setCodeDialog)
                                                        .catch((err) =>
                                                            notify({
                                                                title: "生成导入码失败",
                                                                message:
                                                                    err instanceof Error ? err.message : String(err),
                                                                color: "red",
                                                            }),
                                                        );
                                                }}
                                            >
                                                <QrCode size={13} /> 导入码
                                            </Button>
                                            <Button
                                                type="button"
                                                size="sm"
                                                onClick={() =>
                                                    void serverApi.saveTranscribeJob(serverJobId).then(() =>
                                                        useStudio.getState().refresh(),
                                                    )
                                                }
                                            >
                                                <Save size={13} /> 入库
                                            </Button>
                                        </>
                                    )}
                                    <Button
                                        type="button"
                                        size="sm"
                                        color="ghost"
                                        onClick={() => void handleCancelServerJob()}
                                    >
                                        <X size={13} /> {serverJobActive ? "取消任务" : "关闭"}
                                    </Button>
                                </div>
                            </div>
                        )}
                    </div>
                )
            ) : (
                <div className="flex flex-col gap-4 rounded-xl border border-ore-border bg-ore-raised p-4">
                    <div className="flex items-center gap-2 text-[14px] font-semibold">
                        <FileCode2 size={16} className="text-brand" />
                        MIDI / PBE3 解析与存储卡导入码生成
                    </div>
                    <FileDropzone
                        accept={[".mid", ".midi", ".pbe3"]}
                        multiple={false}
                        title="检查 MIDI / PBE3 文件"
                        description="选择或拖拽单个 .mid / .pbe3 文件查看音乐指纹、音符统计并生成玩家存储卡导入码"
                        onDrop={(files) => {
                            if (files[0]) void handleInspectFile(files[0]);
                        }}
                    />
                    {inspected && (
                        <div className="flex flex-col gap-3 rounded-lg border border-ore-divider bg-ore-sunken p-4 text-[12.5px]">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="text-[14px] font-semibold">{inspected.name}</div>
                                <div className="flex flex-wrap gap-2">
                                    <Button
                                        type="button"
                                        color="secondary"
                                        size="sm"
                                        onClick={() =>
                                            void studioPlayer.playBytes(
                                                `inspect:${inspected.id}`,
                                                inspected.name,
                                                inspected.pbe3,
                                                "pbe3",
                                            )
                                        }
                                    >
                                        <Play size={13} />{" "}
                                        {playerState.songId === `inspect:${inspected.id}` ? "试听中" : "试听"}
                                    </Button>
                                    <Button
                                        type="button"
                                        color="secondary"
                                        size="sm"
                                        onClick={() =>
                                            setCodeDialog({
                                                name: inspected.name,
                                                chunks: inspected.chunks,
                                                bytes: inspected.pbe3.byteLength,
                                            })
                                        }
                                    >
                                        <QrCode size={13} /> 查看存储卡导入码 ({inspected.chunks.length} 段)
                                    </Button>
                                    <Button
                                        type="button"
                                        size="sm"
                                        onClick={() => {
                                            const f = new File([inspected.pbe3.slice().buffer], `${inspected.name}.pbe3`);
                                            void importFiles([f], targetLibraryId || undefined);
                                        }}
                                    >
                                        <Download size={13} /> 导入当前曲库
                                    </Button>
                                </div>
                            </div>
                            <div className="grid gap-2 sm:grid-cols-4">
                                <div>ID: <code>{inspected.id}</code></div>
                                <div>指纹: <code>{inspected.fingerprint}</code></div>
                                <div>时长: {formatDur(inspected.duration / TIME_SCALE)}</div>
                                <div>
                                    音符 {inspected.noteCount} · 内嵌演出 {inspected.performances}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            <ImportCodeDialog
                opened={Boolean(codeDialog)}
                onClose={() => setCodeDialog(null)}
                songName={codeDialog?.name ?? ""}
                chunks={codeDialog?.chunks ?? []}
                bytes={codeDialog?.bytes}
            />
        </div>
    );
}
