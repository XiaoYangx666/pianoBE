import { Button, FileDropzone } from "@piano/ui";
import { AudioWaveform, FileAudio, Play, ShieldCheck, Square } from "lucide-react";
import { formatBytes, formatDuration } from "./format";

export interface SourcePanelProps {
    file: File | null;
    duration: number | null;
    busy?: boolean;
    previewActive?: boolean;
    onSelect: (files: File[]) => void;
    onPreview: () => void;
}

const AUDIO_ACCEPT = [".mp3", ".m4a", ".wav", ".flac", ".ogg", ".aac", ".opus", ".mp4"];

/** 上传与原音频试听合并在同一个区域。 */
export function SourcePanel({
    file,
    duration,
    busy = false,
    previewActive = false,
    onSelect,
    onPreview,
}: SourcePanelProps) {
    if (!file) {
        return (
            <div className="flex flex-col gap-2">
                <FileDropzone
                    accept={AUDIO_ACCEPT}
                    multiple={false}
                    title="拖入音频或点击选择"
                    description="支持 mp3 / m4a / wav / flac / ogg / aac；音频只在本机处理"
                    icon={<AudioWaveform size={24} />}
                    onDrop={onSelect}
                />
                <p className="flex items-center gap-1.5 text-[11px] text-ore-dim">
                    <ShieldCheck size={12} className="text-ore-dimmer" />
                    音频只在本机浏览器处理，不会上传到服务器。
                </p>
            </div>
        );
    }

    const meta = `${duration != null ? `${formatDuration(duration)} · ` : ""}${formatBytes(file.size)}`;

    return (
        <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <FileDropzone
                    className="min-w-0 flex-1"
                    compact
                    accept={AUDIO_ACCEPT}
                    multiple={false}
                    disabled={busy}
                    title={file.name}
                    description={`${meta} · 点击更换音频`}
                    icon={<FileAudio size={18} />}
                    onDrop={onSelect}
                />
                <Button
                    type="button"
                    size="sm"
                    color="secondary"
                    className="shrink-0"
                    disabled={busy}
                    onClick={onPreview}
                >
                    {previewActive ? <Square size={12} /> : <Play size={12} />}
                    {previewActive ? "停止原音频" : "试听原音频"}
                </Button>
            </div>
            <p className="flex items-center gap-1.5 text-[11px] text-ore-dim">
                <ShieldCheck size={12} className="text-ore-dimmer" />
                原音频在底部播放器中播放；音频只在本机处理，不会上传。
            </p>
        </div>
    );
}
