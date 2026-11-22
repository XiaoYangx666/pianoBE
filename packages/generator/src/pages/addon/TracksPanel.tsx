import { useCallback, useMemo, useRef, useState } from "react";
import {
    Button,
    Dialog,
    FileDropzone,
    PianoKeys,
    SongBadge,
    SongRow,
    Textfield,
    VirtualSongList,
    notifications,
    type RowPlayState,
} from "@piano/ui";
import { Check, FileArchive, Info, ListPlus, Music2, Upload } from "lucide-react";
import type { TemplateInfo } from "../../addon/template";
import type { StoredSong } from "../../music/localLibrary";
import { formatSongDuration, type SongEntry } from "../../types";

export interface TracksPanelProps {
    songs: readonly SongEntry[];
    myMusic: readonly StoredSong[];
    template: TemplateInfo | null;
    activeId: string | null;
    rowHeight: number;
    rowState: (id: string) => RowPlayState;
    onDropFiles: (files: File[]) => void;
    onAddMidiFiles: (files: File[]) => void;
    onImportSongBundles: (files: File[]) => void;
    onTogglePreview: (song: SongEntry) => void;
    onOpenCode: (song: SongEntry) => void;
    onRenameSong: (target: { id: string; name: string }) => void;
    onRemoveSong: (id: string) => void;
    onClearSongs: () => void;
    onAddToAddon: (song: StoredSong) => void;
}

export function TracksPanel({
    songs,
    myMusic,
    template,
    activeId,
    rowHeight,
    rowState,
    onDropFiles,
    onAddMidiFiles,
    onImportSongBundles,
    onTogglePreview,
    onOpenCode,
    onRenameSong,
    onRemoveSong,
    onClearSongs,
    onAddToAddon,
}: TracksPanelProps) {
    const [pickerOpen, setPickerOpen] = useState(false);
    const [pickerQuery, setPickerQuery] = useState("");
    const [dragActive, setDragActive] = useState(false);
    const midiRef = useRef<HTMLInputElement>(null);
    const songBundleRef = useRef<HTMLInputElement>(null);

    const playDisabled = !template;
    const addonIds = useMemo(() => new Set(songs.map((song) => song.id)), [songs]);
    const pickerItems = useMemo(() => {
        const keyword = pickerQuery.trim().toLowerCase();
        return myMusic.filter(
            (song) =>
                !addonIds.has(song.id) &&
                (!keyword || song.name.toLowerCase().includes(keyword) || song.id === keyword)
        );
    }, [addonIds, myMusic, pickerQuery]);

    const renderTrackRow = useCallback(
        (song: SongEntry, index: number) => (
            <SongRow
                index={index + 1}
                title={song.name}
                duration={formatSongDuration(song.duration)}
                meta={[<span key="notes">{(song.noteCount ?? 0).toLocaleString()} 音符</span>]}
                badges={
                    song.isOriginal ? (
                        <SongBadge>模板</SongBadge>
                    ) : song.fromLibrary ? (
                        <SongBadge tone="brand">曲库</SongBadge>
                    ) : (
                        <SongBadge tone="success">新导入</SongBadge>
                    )
                }
                active={activeId === song.id}
                playState={rowState(song.id)}
                onPlay={() => onTogglePreview(song)}
                playDisabled={playDisabled}
                onOpenCode={() => onOpenCode(song)}
                onRename={() => onRenameSong({ id: song.id, name: song.name })}
                onRemove={() => onRemoveSong(song.id)}
                removeLabel="从制作清单移除"
            />
        ),
        [activeId, onOpenCode, onRemoveSong, onRenameSong, onTogglePreview, playDisabled, rowState]
    );

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <div className="flex items-center gap-1.5">
                        <span className="text-[13px] font-semibold">制作清单</span>
                        <button
                            type="button"
                            aria-label="制作清单说明"
                            title="删除曲目后，可在「导出」里重新加载模板恢复"
                            className="grid h-6 w-6 place-items-center rounded-md text-ore-dimmer transition-colors hover:bg-[var(--pb-hover)] hover:text-ore-text"
                            onClick={() =>
                                notifications.show({
                                    title: "制作清单",
                                    message: "模板自带的曲目会自动出现。删除后可在「导出」里重新加载模板恢复。",
                                    color: "gray",
                                })
                            }
                        >
                            <Info size={13} />
                        </button>
                    </div>
                    <p className="mt-0.5 text-[11px] text-ore-dim">模板曲目会自动出现</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                    <input
                        ref={midiRef}
                        type="file"
                        accept=".mid,.midi"
                        multiple
                        hidden
                        onChange={(event) => {
                            const files = Array.from(event.target.files ?? []);
                            event.target.value = "";
                            if (files.length > 0) onAddMidiFiles(files);
                        }}
                    />
                    <input
                        ref={songBundleRef}
                        type="file"
                        accept=".pbe3,.pbesong,.zip"
                        multiple
                        hidden
                        onChange={(event) => {
                            const files = Array.from(event.target.files ?? []);
                            event.target.value = "";
                            if (files.length > 0) onImportSongBundles(files);
                        }}
                    />
                    {songs.length > 0 && (
                        <>
                            <Button
                                type="button"
                                color="ghost"
                                size="sm"
                                className="hover:bg-[var(--pb-danger-soft)] hover:text-[color:var(--pb-danger)]"
                                onClick={() => {
                                    if (window.confirm("确定清空当前曲目列表？")) onClearSongs();
                                }}
                            >
                                清空
                            </Button>
                            <Button
                                type="button"
                                color="secondary"
                                size="sm"
                                onClick={() => setPickerOpen(true)}
                            >
                                <ListPlus size={13} /> 从我的音乐添加
                            </Button>
                            <Button
                                type="button"
                                color="secondary"
                                size="sm"
                                onClick={() => songBundleRef.current?.click()}
                            >
                                <FileArchive size={13} /> 导入 PBE3 / 曲目包
                            </Button>
                            <Button type="button" size="sm" onClick={() => midiRef.current?.click()}>
                                <Upload size={13} /> 导入 MIDI
                            </Button>
                        </>
                    )}
                </div>
            </div>

            {songs.length === 0 ? (
                <>
                    <div
                        className={[
                            "mt-1 max-w-[560px] rounded-lg border p-5 transition-colors",
                            dragActive
                                ? "border-brand bg-[var(--pb-brand-tint)]"
                                : "border-ore-border bg-ore-raised",
                        ].join(" ")}
                        onDragOver={(event) => {
                            event.preventDefault();
                            setDragActive(true);
                        }}
                        onDragLeave={() => setDragActive(false)}
                        onDrop={(event) => {
                            event.preventDefault();
                            setDragActive(false);
                            onDropFiles(Array.from(event.dataTransfer.files));
                        }}
                    >
                        <div className="flex items-start gap-3.5">
                            <PianoKeys playing className="h-10 w-12 p-1.5" />
                            <div className="min-w-0">
                                <span className="inline-flex items-center gap-1.5 rounded-[4px] pb-tint-brand px-1.5 py-px text-[10px] font-semibold uppercase tracking-[0.12em]">
                                    开始制作
                                </span>
                                <div className="mt-1.5 text-[14.5px] font-semibold">从第一首曲子开始</div>
                                <p className="mt-1 max-w-[380px] text-[11.5px] leading-relaxed text-ore-dim">
                                    支持导入 `.mid`、`.pbe3` 曲目及附带 `.pbeplugin` 的特效曲目包。
                                </p>
                            </div>
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2">
                            <Button type="button" size="sm" onClick={() => midiRef.current?.click()}>
                                <Upload size={13} /> 导入 MIDI
                            </Button>
                            <Button
                                type="button"
                                color="secondary"
                                size="sm"
                                onClick={() => songBundleRef.current?.click()}
                            >
                                <FileArchive size={13} /> 导入 PBE3 / 曲目包
                            </Button>
                            <Button
                                type="button"
                                color="secondary"
                                size="sm"
                                onClick={() => setPickerOpen(true)}
                            >
                                <ListPlus size={13} /> 从我的音乐添加
                            </Button>
                        </div>
                        <div className="mt-3 text-[10.5px] text-ore-dimmer">
                            也可以把 .mid / .pbe3 / .pbesong / .pbeplugin 拖到这里
                        </div>
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10.5px] text-ore-dimmer">
                        <span className="text-ore-dim">接下来</span>
                        <span>检查插件</span>
                        <span aria-hidden="true">→</span>
                        <span>选择音色</span>
                        <span aria-hidden="true">→</span>
                        <span>添加曲谱</span>
                        <span aria-hidden="true">→</span>
                        <span>导出 .mcaddon</span>
                    </div>
                </>
            ) : (
                <>
                    <FileDropzone
                        compact
                        className="max-w-[520px]"
                        accept={[".mid", ".midi", ".pbe3", ".pbesong", ".zip", ".pbeplugin"]}
                        title="拖入 MIDI / PBE3 / 特效曲目包"
                        description="自动匹配所需 VFX 插件，附带插件会先弹出信任确认"
                        icon={<Music2 size={16} />}
                        onDrop={onDropFiles}
                    />
                    <VirtualSongList
                        className="h-[clamp(280px,calc(100dvh-360px),720px)] -mx-1 px-1"
                        items={songs as SongEntry[]}
                        rowHeight={rowHeight}
                        gap={0}
                        getKey={(song) => song.id}
                        renderItem={renderTrackRow}
                    />
                </>
            )}

            <Dialog opened={pickerOpen} onClose={() => setPickerOpen(false)} title="从我的音乐添加" size="lg">
                <div className="flex flex-col gap-3">
                    <Textfield
                        placeholder="搜索我的音乐…"
                        value={pickerQuery}
                        onInput={(event) => {
                            const target = event.target as unknown as { value?: unknown };
                            if (typeof target?.value === "string") setPickerQuery(target.value);
                        }}
                    />
                    {pickerItems.length === 0 ? (
                        <div className="px-4 py-10 text-center text-[12.5px] text-ore-dim">
                            {myMusic.length === 0
                                ? "我的音乐还是空的，先去音乐库导入或从在线曲库添加"
                                : "没有可添加的曲目（都已在附加包里）"}
                        </div>
                    ) : (
                        <VirtualSongList
                            className="h-[min(360px,50vh)] rounded-md border border-ore-divider p-1"
                            items={pickerItems}
                            rowHeight={54}
                            gap={0}
                            getKey={(song) => song.id}
                            renderItem={(song, index) => (
                                <div className="flex h-full items-center gap-3 border-b border-ore-divider/60 px-2 last:border-b-0">
                                    <span className="w-5 shrink-0 text-center text-[11px] tabular-nums text-ore-dimmer">
                                        {index + 1}
                                    </span>
                                    <div className="min-w-0 flex-1">
                                        <div className="truncate text-[12.5px] font-medium">{song.name}</div>
                                        <div className="mt-0.5 text-[11px] text-ore-dim">
                                            {formatSongDuration(song.duration)} · {(song.noteCount ?? 0).toLocaleString()} 音符
                                        </div>
                                    </div>
                                    <Button type="button" size="sm" color="secondary" onClick={() => onAddToAddon(song)}>
                                        <Check size={13} /> 加入
                                    </Button>
                                </div>
                            )}
                        />
                    )}
                </div>
            </Dialog>
        </div>
    );
}
