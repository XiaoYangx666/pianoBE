import { useEffect, useMemo, useRef, useState } from "react";
import {
    Button,
    ImportCodeDialog,
    PageHeader,
    Tag,
    notifications,
    usePlayerState,
} from "@piano/ui";
import { AudioWaveform } from "lucide-react";
import {
    cancelAmtSessionDispose,
    clearModelAssets,
    downloadModelAssets,
    isModelDownloaded,
    scheduleAmtSessionDispose,
    transcribeAudio,
    type AssetDownloadProgress,
    type TranscribeOutput,
    type TranscribeProgress,
} from "../amt/transcribe";
import { midiFileToEntry } from "../convert";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { appPlayer } from "../player";
import { useGenerator } from "../store/generator";
import type { SongEntry } from "../types";
import { LicenseDisclosure } from "./convert/LicenseDisclosure";
import { ModelSettings } from "./convert/ModelSettings";
import { ProgressPanel } from "./convert/ProgressPanel";
import { ResultPanel, type PreviewMode } from "./convert/ResultPanel";
import { SourcePanel } from "./convert/SourcePanel";
import { baseName } from "./convert/format";

type Phase = "idle" | "converting" | "done";

function ErrorNotice({ message, onRetry }: { message: string; onRetry: () => void }) {
    return (
        <div className="rounded-md border px-3.5 py-3 text-[12px] pb-edge-danger pb-tint-danger">
            <div className="font-semibold">无法完成操作</div>
            <div className="mt-1 break-words leading-relaxed text-ore-dim">{message}</div>
            <button
                type="button"
                onClick={onRetry}
                className="mt-2 text-[11.5px] font-medium text-brand underline-offset-2 hover:underline"
            >
                重试
            </button>
        </div>
    );
}

/** 音频转 MIDI 工作台：选择音频 → 准备模型 → 转换 → 结果。 */
export function ConvertPage() {
    const addMidiFiles = useGenerator((state) => state.addMidiFiles);
    const scoreChunks = useGenerator((state) => state.scoreChunks);
    const isMobile = useMediaQuery("(max-width: 47.99em)");

    const [file, setFile] = useState<File | null>(null);
    const [fileDuration, setFileDuration] = useState<number | null>(null);
    const [name, setName] = useState("");
    const [lowLoad, setLowLoad] = useState(true);
    const [phase, setPhase] = useState<Phase>("idle");
    const [progress, setProgress] = useState<TranscribeProgress | null>(null);
    const [result, setResult] = useState<TranscribeOutput | null>(null);
    const [elapsedMs, setElapsedMs] = useState<number | null>(null);
    const [error, setError] = useState("");
    const [errorKind, setErrorKind] = useState<"convert" | "download">("convert");

    const [modelReady, setModelReady] = useState<boolean | null>(null);
    const [downloading, setDownloading] = useState(false);
    const [downloadProgress, setDownloadProgress] = useState<AssetDownloadProgress | null>(null);

    const [previewMode, setPreviewMode] = useState<PreviewMode>("midi");
    const [midiEntry, setMidiEntry] = useState<SongEntry | null>(null);
    const [previewBusy, setPreviewBusy] = useState(false);
    const [added, setAdded] = useState<"mine" | "addon" | null>(null);
    const [codeOpen, setCodeOpen] = useState(false);
    const [codeChunks, setCodeChunks] = useState<string[]>([]);
    const [codeBytes, setCodeBytes] = useState<number | undefined>(undefined);
    const [codeBusy, setCodeBusy] = useState(false);

    const abortRef = useRef<AbortController | null>(null);
    const playerState = usePlayerState(appPlayer);

    useEffect(() => {
        isModelDownloaded()
            .then(setModelReady)
            .catch(() => setModelReady(false));
    }, []);

    // 离开页面 / 后台超过一分钟后释放内存中的推理 session，缓存保留
    useEffect(() => {
        cancelAmtSessionDispose();
        const onVisibilityChange = () => {
            if (document.visibilityState === "hidden") scheduleAmtSessionDispose();
            else cancelAmtSessionDispose();
        };
        document.addEventListener("visibilitychange", onVisibilityChange);
        return () => {
            document.removeEventListener("visibilitychange", onVisibilityChange);
            scheduleAmtSessionDispose();
        };
    }, []);

    // 只读取音频元数据，不解码整段 PCM
    useEffect(() => {
        if (!file) {
            setFileDuration(null);
            return;
        }
        const url = URL.createObjectURL(file);
        const audio = new Audio();
        audio.preload = "metadata";
        let cancelled = false;
        const onLoaded = () => {
            if (!cancelled && Number.isFinite(audio.duration)) setFileDuration(audio.duration);
        };
        audio.addEventListener("loadedmetadata", onLoaded);
        audio.src = url;
        return () => {
            cancelled = true;
            audio.removeEventListener("loadedmetadata", onLoaded);
            audio.src = "";
            URL.revokeObjectURL(url);
        };
    }, [file]);

    useEffect(() => {
        if (phase !== "converting") return;
        const started = performance.now();
        const timer = setInterval(() => setElapsedMs(performance.now() - started), 200);
        return () => clearInterval(timer);
    }, [phase]);

    const resultPlayerNotes = useMemo(
        () =>
            result
                ? result.notes.map((note) => ({
                      pitch: note.pitch,
                      start: note.start,
                      end: note.end,
                  }))
                : [],
        [result]
    );

    const audioActive =
        playerState.status !== "idle" && playerState.sourceLabel === "原音频试听";
    const midiActive =
        playerState.status !== "idle" && Boolean(midiEntry && playerState.songId === midiEntry.id);
    const active = previewMode === "midi" ? midiActive : audioActive;
    const playing = active && playerState.status === "playing";
    const currentTime = active ? playerState.currentTime : 0;
    const canStart = Boolean(file) && modelReady === true && phase !== "converting" && !downloading;

    const selectFile = (files: File[]) => {
        const next = files[0];
        if (!next) return;
        abortRef.current?.abort();
        abortRef.current = null;
        appPlayer.stop();
        setFile(next);
        setName(baseName(next.name));
        setFileDuration(null);
        setPhase("idle");
        setProgress(null);
        setResult(null);
        setElapsedMs(null);
        setError("");
        setMidiEntry(null);
        setPreviewMode("midi");
        setAdded(null);
        setCodeOpen(false);
        setCodeChunks([]);
        setCodeBytes(undefined);
    };

    const downloadModel = async () => {
        if (downloading) return;
        setDownloading(true);
        setError("");
        setDownloadProgress({ message: "准备下载…", percent: 0 });
        try {
            await downloadModelAssets(setDownloadProgress);
            setModelReady(true);
            notifications.show({
                title: "转录模型已下载",
                message: "已保存到浏览器缓存，转换时不会再联网",
                color: "teal",
            });
        } catch (err) {
            setErrorKind("download");
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setDownloading(false);
        }
    };

    const clearModel = async () => {
        await clearModelAssets();
        setModelReady(false);
        setDownloadProgress(null);
        notifications.show({
            title: "已清除模型缓存",
            message: "下次转换前需要重新下载",
            color: "gray",
        });
    };

    const start = async () => {
        if (!file) return;
        if (!modelReady) {
            setPhase("idle");
            setProgress(null);
            notifications.show({
                title: "请先下载模型",
                message: "音频转 MIDI 需要先下载转录模型与推理运行时",
                color: "yellow",
            });
            return;
        }
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        appPlayer.stop();
        setPhase("converting");
        setResult(null);
        setProgress({ stage: "decode", message: "解码音频…", percent: 2 });
        setElapsedMs(0);
        setError("");
        setAdded(null);
        setCodeOpen(false);
        setCodeChunks([]);
        setCodeBytes(undefined);
        setMidiEntry(null);
        const startedAt = performance.now();
        try {
            const output = await transcribeAudio(file, {
                lowLoad,
                signal: controller.signal,
                onProgress: setProgress,
            });
            setElapsedMs(performance.now() - startedAt);
            setResult(output);
            setFileDuration(output.duration);
            setPhase("done");
            notifications.show({
                title: "转换完成",
                message: `${name} · ${output.notes.length.toLocaleString()} 个音符`,
                color: "teal",
            });
        } catch (err) {
            if ((err as Error)?.name === "AbortError") {
                notifications.show({ title: "已取消转换", message: "音频和模型状态都已保留", color: "gray" });
                setPhase("idle");
                setProgress(null);
                setElapsedMs(null);
            } else {
                setErrorKind("convert");
                setError(err instanceof Error ? err.message : String(err));
                setPhase("idle");
                setProgress(null);
            }
        } finally {
            if (abortRef.current === controller) abortRef.current = null;
        }
    };

    const cancel = () => {
        abortRef.current?.abort();
    };

    const ensureMidiEntry = async (): Promise<SongEntry | null> => {
        if (!result) return null;
        if (midiEntry) return midiEntry;
        const entry = await midiFileToEntry(
            new File([result.midi as unknown as BlobPart], `${name}.mid`, { type: "audio/midi" })
        );
        setMidiEntry(entry);
        return entry;
    };

    const startPlayback = async (time?: number) => {
        if (!result || !file) return;
        setPreviewBusy(true);
        try {
            if (previewMode === "midi") {
                const entry = await ensureMidiEntry();
                if (!entry) return;
                await appPlayer.playMidi(entry);
            } else {
                await appPlayer.playAudio(file, name, result.duration, resultPlayerNotes);
            }
            if (time != null) appPlayer.seek(time);
        } catch (err) {
            notifications.show({
                title: "试听失败",
                message: err instanceof Error ? err.message : String(err),
                color: "red",
            });
        } finally {
            setPreviewBusy(false);
        }
    };

    const togglePlay = async () => {
        if (active) {
            if (playerState.status === "ended") {
                await startPlayback();
                return;
            }
            if (playing) appPlayer.pause();
            else appPlayer.resume();
            return;
        }
        await startPlayback();
    };

    const seekTo = async (time: number) => {
        if (active) {
            appPlayer.seek(time);
            return;
        }
        await startPlayback(time);
    };

    const toggleSourceAudio = async () => {
        if (!file) return;
        if (audioActive) {
            appPlayer.stop();
            return;
        }
        try {
            await appPlayer.playAudio(file, name, fileDuration ?? undefined, resultPlayerNotes);
        } catch (err) {
            notifications.show({
                title: "原音频播放失败",
                message: err instanceof Error ? err.message : String(err),
                color: "red",
            });
        }
    };

    const changePreviewMode = (mode: PreviewMode) => {
        if (mode === previewMode) return;
        appPlayer.stop();
        setPreviewMode(mode);
    };

    const rename = (next: string) => {
        if (next === name) return;
        setName(next);
        setMidiEntry(null);
        if (midiActive) appPlayer.stop();
    };

    const download = () => {
        if (!result) return;
        const blob = new Blob([result.midi as unknown as BlobPart], { type: "audio/midi" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `${name.trim() || "transcription"}.mid`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
    };

    const addToLibrary = async (toAddon: boolean) => {
        if (!result) return;
        const midiFile = new File([result.midi as unknown as BlobPart], `${name.trim() || "transcription"}.mid`, {
            type: "audio/midi",
        });
        await addMidiFiles([midiFile], { addToAddon: toAddon });
        setAdded(toAddon ? "addon" : "mine");
    };

    const openImportCode = async () => {
        if (!result || codeBusy) return;
        setCodeBusy(true);
        try {
            const entry = await ensureMidiEntry();
            if (!entry) return;
            const chunks = scoreChunks(entry);
            if (chunks.length === 0) throw new Error("没有可导出的曲目数据");
            setCodeChunks(chunks);
            setCodeBytes(entry.data?.byteLength);
            setCodeOpen(true);
        } catch (err) {
            notifications.show({
                title: "生成导入码失败",
                message: err instanceof Error ? err.message : String(err),
                color: "red",
            });
        } finally {
            setCodeBusy(false);
        }
    };

    return (
        <div className="mx-auto flex w-full max-w-[1040px] flex-col px-4 pb-16 pt-4 md:px-0 md:pt-0">
            <PageHeader
                eyebrow="MIDI Convert"
                title="音频转 MIDI"
                description="把 mp3 / m4a / wav 等音频在本地转成 MIDI，完成后可直接试听、下载或加入曲库。"
                actions={<Tag tone="brand">本地推理</Tag>}
            />

            {phase === "done" && result ? (
                <>
                    <ResultPanel
                        result={result}
                        notes={resultPlayerNotes}
                        name={name}
                        elapsedMs={elapsedMs}
                        sourceName={file?.name ?? ""}
                        sourceSize={file?.size ?? 0}
                        previewMode={previewMode}
                        onPreviewModeChange={changePreviewMode}
                        active={active}
                        playing={playing}
                        currentTime={currentTime}
                        previewBusy={previewBusy}
                        onTogglePlay={() => void togglePlay()}
                        onStop={() => appPlayer.stop()}
                        onSeek={(time) => void seekTo(time)}
                        onRename={rename}
                        onDownload={download}
                        onAddMine={() => void addToLibrary(false)}
                        onAddAddon={() => void addToLibrary(true)}
                        added={added}
                        importCodeBusy={codeBusy}
                        onOpenImportCode={() => void openImportCode()}
                        onReconvert={() => void start()}
                        isMobile={isMobile}
                    />
                    <LicenseDisclosure modelReady={modelReady} onClearModel={() => void clearModel()} />
                </>
            ) : (
                <div className="mt-4 flex flex-col gap-4 md:mt-6 md:gap-5">
                    <SourcePanel
                        file={file}
                        duration={fileDuration}
                        busy={phase === "converting"}
                        previewActive={audioActive}
                        onSelect={selectFile}
                        onPreview={() => void toggleSourceAudio()}
                    />

                    {phase === "converting" ? (
                        <ProgressPanel
                            message={progress?.message ?? "准备中…"}
                            percent={progress?.percent ?? 0}
                            elapsedMs={elapsedMs}
                            onCancel={cancel}
                        />
                    ) : (
                        file && (
                            <>
                                <ModelSettings
                                    modelReady={modelReady}
                                    downloading={downloading}
                                    downloadProgress={downloadProgress}
                                    onDownload={() => void downloadModel()}
                                    onClear={() => void clearModel()}
                                    lowLoad={lowLoad}
                                    onLowLoadChange={setLowLoad}
                                />

                                {error && (
                                    <ErrorNotice
                                        message={error}
                                        onRetry={() =>
                                            void (errorKind === "download" ? downloadModel() : start())
                                        }
                                    />
                                )}

                                <div className="flex flex-col gap-2 border-t border-ore-divider pt-4 sm:flex-row sm:items-center">
                                    <div className="min-w-0 text-[11px] text-ore-dim">
                                        将保存为 <span className="font-medium text-ore-text">{name}</span>
                                    </div>
                                    <div className="flex items-center gap-2 sm:ml-auto">
                                        <Button
                                            type="button"
                                            size="md"
                                            disabled={!canStart}
                                            onClick={() => void start()}
                                            className="w-full sm:w-auto"
                                        >
                                            <AudioWaveform size={14} />
                                            开始转换
                                        </Button>
                                    </div>
                                </div>
                            </>
                        )
                    )}

                    <LicenseDisclosure modelReady={modelReady} onClearModel={() => void clearModel()} />
                </div>
            )}

            <ImportCodeDialog
                opened={codeOpen}
                onClose={() => setCodeOpen(false)}
                songName={name}
                chunks={codeChunks}
                bytes={codeBytes}
            />
        </div>
    );
}
