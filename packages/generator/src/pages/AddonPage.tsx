import { useCallback, useMemo, useState } from "react";
import { ImportCodeDialog, PageHeader, TabBar, TabButton, type RowPlayState, usePlayingSongId } from "@piano/ui";
import { matchSongPlugins } from "../addon/plugins";
import { PluginsPanel } from "../components/PluginsPanel";
import { RenameSongDialog } from "../components/RenameSongDialog";
import { ScorePreviewModal } from "../components/ScorePreviewModal";
import { TrustPluginsDialog } from "../components/TrustPluginsDialog";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { previewPlayer } from "../music/player";
import type { ScoreEntry } from "../scores/scores";
import { useGenerator } from "../store/generator";
import type { SongEntry } from "../types";
import { ExportPanel } from "./addon/ExportPanel";
import { ScoresPanel } from "./addon/ScoresPanel";
import { TimbresPanel } from "./addon/TimbresPanel";
import { TracksPanel } from "./addon/TracksPanel";

const ROW_HEIGHT = 50;

export function AddonPage() {
    const isMobile = useMediaQuery("(max-width: 47.99em)");
    const template = useGenerator((state) => state.template);
    const templateVersion = useGenerator((state) => state.templateVersion);
    const songs = useGenerator((state) => state.songs);
    const myMusic = useGenerator((state) => state.myMusic);
    const scores = useGenerator((state) => state.scores);
    const timbres = useGenerator((state) => state.timbres);
    const selectedTimbres = useGenerator((state) => state.selectedTimbres);
    const plugins = useGenerator((state) => state.plugins);
    const selectedPlugins = useGenerator((state) => state.selectedPlugins);
    const pluginsReady = useGenerator((state) => state.pluginsReady);
    const pendingTrustPlugins = useGenerator((state) => state.pendingTrustPlugins);
    const previewTimbreId = useGenerator((state) => state.previewTimbreId);
    const pendingPreviewId = useGenerator((state) => state.pendingPreviewId);
    const addonName = useGenerator((state) => state.addonName);
    const addonDesc = useGenerator((state) => state.addonDesc);
    const randomUuid = useGenerator((state) => state.randomUuid);
    const addMidiFiles = useGenerator((state) => state.addMidiFiles);
    const importSongBundleFiles = useGenerator((state) => state.importSongBundleFiles);
    const importPluginFiles = useGenerator((state) => state.importPluginFiles);
    const addToAddon = useGenerator((state) => state.addToAddon);
    const togglePreview = useGenerator((state) => state.togglePreview);
    const removeSong = useGenerator((state) => state.removeSong);
    const renameSong = useGenerator((state) => state.renameSong);
    const clearSongs = useGenerator((state) => state.clearSongs);
    const toggleTimbre = useGenerator((state) => state.toggleTimbre);
    const togglePlugin = useGenerator((state) => state.togglePlugin);
    const selectZeroPlugins = useGenerator((state) => state.selectZeroPlugins);
    const autoSelectRequiredPlugins = useGenerator((state) => state.autoSelectRequiredPlugins);
    const confirmTrustPlugins = useGenerator((state) => state.confirmTrustPlugins);
    const dismissTrustPlugins = useGenerator((state) => state.dismissTrustPlugins);
    const uninstallPlugin = useGenerator((state) => state.uninstallPlugin);
    const setPreviewTimbre = useGenerator((state) => state.setPreviewTimbre);
    const selectedTimbreSize = useGenerator((state) => state.selectedTimbreSize);
    const setAddonName = useGenerator((state) => state.setAddonName);
    const setAddonDesc = useGenerator((state) => state.setAddonDesc);
    const setRandomUuid = useGenerator((state) => state.setRandomUuid);
    const applyTemplate = useGenerator((state) => state.applyTemplate);
    const exporting = useGenerator((state) => state.exporting);
    const exportAddon = useGenerator((state) => state.exportAddon);
    const importScorePackFiles = useGenerator((state) => state.importScorePackFiles);
    const importScorePageFiles = useGenerator((state) => state.importScorePageFiles);
    const removeScore = useGenerator((state) => state.removeScore);
    const scoreChunks = useGenerator((state) => state.scoreChunks);

    const [tab, setTab] = useState<"tracks" | "plugins" | "timbres" | "scores" | "export">("tracks");
    const [code, setCode] = useState<{ name: string; chunks: string[]; bytes?: number } | null>(null);
    const [previewScore, setPreviewScore] = useState<ScoreEntry | null>(null);
    const [renameTarget, setRenameTarget] = useState<{ id: string; name: string } | null>(null);

    const pluginMatch = useMemo(
        () => matchSongPlugins(songs, plugins, selectedPlugins),
        [songs, plugins, selectedPlugins]
    );
    const selectedPluginBytes = useMemo(
        () => plugins.filter((item) => selectedPlugins.includes(item.id)).reduce((sum, item) => sum + item.size, 0),
        [plugins, selectedPlugins]
    );
    const vfxReady =
        pluginMatch.missingEffects.length === 0 && pluginMatch.disabledRequiredEffects.length === 0;

    const handleWorkspaceDrop = useCallback(
        (files: File[]) => {
            const midis = files.filter((file) => /\.(mid|midi)$/i.test(file.name));
            const bundles = files.filter((file) => /\.(pbe3|pbesong|zip)$/i.test(file.name));
            const pluginFiles = files.filter((file) => /\.pbeplugin$/i.test(file.name));
            if (midis.length > 0) void addMidiFiles(midis, { addToAddon: true });
            if (bundles.length > 0) void importSongBundleFiles(bundles);
            if (pluginFiles.length > 0) void importPluginFiles(pluginFiles);
        },
        [addMidiFiles, importPluginFiles, importSongBundleFiles]
    );

    const activeId = usePlayingSongId(previewPlayer);
    const extraTimbreBytes = selectedTimbreSize();

    const rowState = useCallback(
        (id: string): RowPlayState =>
            pendingPreviewId === id ? "pending" : activeId === id ? "playing" : "idle",
        [activeId, pendingPreviewId]
    );

    const openCode = useCallback(
        (entry: SongEntry) => {
            const chunks = scoreChunks(entry);
            if (chunks.length === 0) return;
            setCode({ name: entry.name, chunks, bytes: entry.data?.byteLength });
        },
        [scoreChunks]
    );

    const rowHeight = isMobile ? 54 : ROW_HEIGHT;

    return (
        <div className="mx-auto flex w-full max-w-[1040px] flex-col px-4 pt-4 md:px-0 md:pt-0">
            <div className="hidden md:block">
                <PageHeader
                    title="附加包制作"
                    description="整理曲目、VFX 插件、音色与曲谱，导出可直接安装的 .mcaddon。"
                />
            </div>

            <div className="border-b border-ore-divider md:mt-5">
                <TabBar className="gap-5 md:gap-6">
                    <TabButton type="button" selected={tab === "tracks"} onClick={() => setTab("tracks")}>
                        曲目 <span className="text-[10.5px] tabular-nums text-ore-dimmer">{songs.length}</span>
                    </TabButton>
                    <TabButton type="button" selected={tab === "plugins"} onClick={() => setTab("plugins")}>
                        插件{" "}
                        <span className="text-[10.5px] tabular-nums text-ore-dimmer">{selectedPlugins.length}</span>
                        {!vfxReady && (
                            <span
                                className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-[color:var(--pb-warning)]"
                                title="存在缺少或未启用的曲目特效"
                            />
                        )}
                    </TabButton>
                    <TabButton type="button" selected={tab === "timbres"} onClick={() => setTab("timbres")}>
                        音色 <span className="text-[10.5px] tabular-nums text-ore-dimmer">{selectedTimbres.length}</span>
                    </TabButton>
                    <TabButton type="button" selected={tab === "scores"} onClick={() => setTab("scores")}>
                        曲谱 <span className="text-[10.5px] tabular-nums text-ore-dimmer">{scores.length}</span>
                    </TabButton>
                    <TabButton type="button" selected={tab === "export"} onClick={() => setTab("export")}>
                        导出
                    </TabButton>
                </TabBar>
            </div>

            <div className="mt-4 pb-2 md:mt-5">
                {tab === "tracks" && (
                    <TracksPanel
                        songs={songs}
                        myMusic={myMusic}
                        template={template}
                        activeId={activeId}
                        rowHeight={rowHeight}
                        rowState={rowState}
                        onDropFiles={handleWorkspaceDrop}
                        onAddMidiFiles={(files) => void addMidiFiles(files, { addToAddon: true })}
                        onImportSongBundles={(files) => void importSongBundleFiles(files)}
                        onTogglePreview={(song) => void togglePreview(song)}
                        onOpenCode={openCode}
                        onRenameSong={setRenameTarget}
                        onRemoveSong={removeSong}
                        onClearSongs={clearSongs}
                        onAddToAddon={addToAddon}
                    />
                )}

                {tab === "plugins" && (
                    <PluginsPanel
                        plugins={plugins}
                        selectedPlugins={selectedPlugins}
                        match={pluginMatch}
                        ready={pluginsReady}
                        onTogglePlugin={togglePlugin}
                        onAutoMatch={autoSelectRequiredPlugins}
                        onZeroPlugins={selectZeroPlugins}
                        onImportPluginFiles={(files) => void importPluginFiles(files)}
                        onImportSongBundles={(files) => void importSongBundleFiles(files)}
                        onUninstallPlugin={(id) => void uninstallPlugin(id)}
                    />
                )}

                {tab === "timbres" && (
                    <TimbresPanel
                        timbres={timbres}
                        selectedTimbres={selectedTimbres}
                        previewTimbreId={previewTimbreId}
                        template={template}
                        onToggleTimbre={toggleTimbre}
                        onSetPreviewTimbre={(id) => void setPreviewTimbre(id)}
                    />
                )}

                {tab === "scores" && (
                    <ScoresPanel
                        scores={scores}
                        template={template}
                        onPreviewScore={setPreviewScore}
                        onRemoveScore={removeScore}
                        onImportScorePackFiles={(files) => void importScorePackFiles(files)}
                        onImportScorePageFiles={(files, requestTitle) =>
                            void importScorePageFiles(files, requestTitle)
                        }
                    />
                )}

                {tab === "export" && (
                    <ExportPanel
                        template={template}
                        templateVersion={templateVersion}
                        addonName={addonName}
                        addonDesc={addonDesc}
                        randomUuid={randomUuid}
                        songsCount={songs.length}
                        selectedPluginsCount={selectedPlugins.length}
                        selectedPluginBytes={selectedPluginBytes}
                        vfxReady={vfxReady}
                        selectedTimbresCount={selectedTimbres.length}
                        extraTimbreBytes={extraTimbreBytes}
                        scoresCount={scores.length}
                        exporting={exporting}
                        onSetAddonName={setAddonName}
                        onSetAddonDesc={setAddonDesc}
                        onSetRandomUuid={setRandomUuid}
                        onApplyTemplate={(file) => void applyTemplate(file)}
                        onExportAddon={() => void exportAddon()}
                    />
                )}
            </div>

            <ScorePreviewModal
                score={previewScore}
                template={template}
                opened={Boolean(previewScore)}
                onClose={() => setPreviewScore(null)}
            />

            <ImportCodeDialog
                opened={Boolean(code)}
                onClose={() => setCode(null)}
                songName={code?.name ?? ""}
                chunks={code?.chunks ?? []}
                bytes={code?.bytes}
            />

            <RenameSongDialog
                opened={Boolean(renameTarget)}
                initialName={renameTarget?.name ?? ""}
                onClose={() => setRenameTarget(null)}
                onConfirm={(name) => {
                    if (renameTarget) void renameSong(renameTarget.id, name);
                }}
            />

            <TrustPluginsDialog
                plugins={pendingTrustPlugins}
                onConfirm={(approvedIds) => void confirmTrustPlugins(approvedIds)}
                onCancel={dismissTrustPlugins}
            />
        </div>
    );
}
