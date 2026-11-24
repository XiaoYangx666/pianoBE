import {
    DEFAULT_PIANO_TIMBRE,
    PIANO_TIMBRES,
    encodeSong,
    songToNoteEvents,
} from "@piano/core";
import { midiBufferToSong } from "@piano/core/convert";
import { SampledMidiPlayer, type NoteEvent } from "@piano/core/player";
import type { LoadedTimbrePack, TemplateInfo, TimbreIndexEntry } from "@piano/assembly";
import type { PbePluginArchive } from "@piano/vfx/package";
import { AppPlayer } from "@piano/ui";
import { extractTimbrePacksFromArchive } from "../adapters/timbres";

const PREVIEW_TIMBRE_KEY = "pbe:preview-timbre";
const NORMALIZE_KEY = "pbe:normalize-loudness";

/** Built-in expressive piano phrase for instant timbre auditioning when idle. */
const TIMBRE_DEMO_EVENTS: NoteEvent[] = [
    // Soft low chord + warm ascending arpeggio
    { midi: 48, time: 0.0, duration: 1.5, velocity: 0.42 },
    { midi: 55, time: 0.06, duration: 1.4, velocity: 0.48 },
    { midi: 64, time: 0.12, duration: 1.35, velocity: 0.54 },
    { midi: 67, time: 0.3, duration: 0.85, velocity: 0.6 },
    { midi: 71, time: 0.5, duration: 0.85, velocity: 0.66 },
    { midi: 72, time: 0.72, duration: 1.1, velocity: 0.74 },
    // Expressive Fmaj7 -> G9 -> C cadence
    { midi: 41, time: 1.45, duration: 1.5, velocity: 0.64 },
    { midi: 53, time: 1.48, duration: 1.3, velocity: 0.66 },
    { midi: 60, time: 1.52, duration: 1.2, velocity: 0.72 },
    { midi: 64, time: 1.66, duration: 0.9, velocity: 0.78 },
    { midi: 69, time: 1.84, duration: 1.0, velocity: 0.84 },
    { midi: 43, time: 2.35, duration: 1.4, velocity: 0.62 },
    { midi: 55, time: 2.38, duration: 1.3, velocity: 0.65 },
    { midi: 62, time: 2.42, duration: 1.1, velocity: 0.7 },
    { midi: 67, time: 2.58, duration: 0.95, velocity: 0.76 },
    { midi: 71, time: 2.75, duration: 0.95, velocity: 0.8 },
    // Final bright tonic chord
    { midi: 48, time: 3.1, duration: 1.8, velocity: 0.56 },
    { midi: 60, time: 3.12, duration: 1.75, velocity: 0.62 },
    { midi: 64, time: 3.15, duration: 1.7, velocity: 0.66 },
    { midi: 72, time: 3.18, duration: 1.7, velocity: 0.72 },
    { midi: 84, time: 3.32, duration: 1.55, velocity: 0.52 },
];

export type TimbreArchiveLoader = (timbreId: string) => Promise<PbePluginArchive | null>;

export function readStoredPreviewTimbreId(): string {
    try {
        const saved = localStorage.getItem(PREVIEW_TIMBRE_KEY);
        if (saved && PIANO_TIMBRES.some((item) => item.id === saved)) return saved;
    } catch {
        // ignore storage errors
    }
    return PIANO_TIMBRES[0].id;
}

export function readStoredNormalizeLoudness(): boolean {
    try {
        return localStorage.getItem(NORMALIZE_KEY) === "1";
    } catch {
        return false;
    }
}

class StudioMidiPlayer extends SampledMidiPlayer {
    private currentNotes: NoteEvent[] = [];
    private template: TemplateInfo | null = null;
    private timbrePacks = new Map<string, LoadedTimbrePack>();
    private activeTimbreId: string = readStoredPreviewTimbreId();

    constructor() {
        super();
        const initialMeta =
            PIANO_TIMBRES.find((t) => t.id === this.activeTimbreId) ?? PIANO_TIMBRES[0];
        super.setTimbre(initialMeta.value);
        super.setNormalizeLoudness(readStoredNormalizeLoudness());

        this.sampleSource = async (dir: string, fileName: string) => {
            const path = `sounds/${dir}/${fileName}.ogg`;

            // 1. 已加载的可选音色包（classic_grand / bright_grand / upright / electric_piano）
            for (const pack of this.timbrePacks.values()) {
                const hit = pack.files.get(path);
                if (hit) return hit.slice().buffer;
            }

            // 2. 本地模板内嵌标准钢琴采样
            if (this.template) {
                const file = await this.template.addon.read(`${this.template.rpPath}${path}`);
                if (file) return file.bytes.slice().buffer;
            }

            // 3. 静态目录回退（服务器模式或模板尚未就绪）
            const webFile = fileName.replace(/#/g, "sharp");
            try {
                const res = await fetch(`./piano/${dir}/${webFile}.ogg`);
                if (res.ok) return await res.arrayBuffer();
            } catch {
                // ignore network fallback error
            }
            return null;
        };
    }

    getNotes(): readonly NoteEvent[] {
        return this.currentNotes;
    }

    getTimbreId(): string {
        return this.activeTimbreId;
    }

    setTemplate(template: TemplateInfo | null): void {
        this.template = template;
        this.clearSampleCache();
    }

    registerTimbreArchive(archive: PbePluginArchive): void {
        if (archive.timbres.length === 0) return;
        for (const pack of extractTimbrePacksFromArchive(archive)) {
            this.timbrePacks.set(pack.meta.id, pack);
        }
    }

    override setNormalizeLoudness(enabled: boolean): void {
        super.setNormalizeLoudness(enabled);
        try {
            localStorage.setItem(NORMALIZE_KEY, enabled ? "1" : "0");
        } catch {
            // ignore
        }
    }

    async switchTimbre(
        id: string,
        timbreIndex: readonly TimbreIndexEntry[],
        resolveArchive?: TimbreArchiveLoader,
    ): Promise<void> {
        if (id !== "piano" && !this.timbrePacks.has(id) && resolveArchive) {
            const archive = await resolveArchive(id);
            if (archive) this.registerTimbreArchive(archive);
        }

        const indexMeta = timbreIndex.find((item) => item.id === id);
        const packMeta = this.timbrePacks.get(id)?.meta;
        const coreMeta = PIANO_TIMBRES.find((item) => item.id === id);
        const value =
            packMeta?.value ?? indexMeta?.value ?? coreMeta?.value ?? DEFAULT_PIANO_TIMBRE;

        const wasPlaying = this.getState().status === "playing";
        const resumeAt = wasPlaying ? this.getPlaybackTime() : 0;

        this.activeTimbreId = packMeta?.id ?? indexMeta?.id ?? coreMeta?.id ?? PIANO_TIMBRES[0].id;
        super.setTimbre(value);
        try {
            localStorage.setItem(PREVIEW_TIMBRE_KEY, this.activeTimbreId);
        } catch {
            // ignore
        }

        if (wasPlaying) {
            await this.warmup().catch(() => {});
            this.seek(resumeAt);
        } else {
            void this.warmup().catch(() => {});
        }
    }

    async previewTimbreDemo(
        id: string,
        timbreIndex: readonly TimbreIndexEntry[],
        resolveArchive?: TimbreArchiveLoader,
    ): Promise<void> {
        await this.switchTimbre(id, timbreIndex, resolveArchive);
        if (this.getState().status === "playing") return;
        const label =
            this.timbrePacks.get(id)?.meta.label ??
            timbreIndex.find((t) => t.id === id)?.label ??
            PIANO_TIMBRES.find((t) => t.id === id)?.label ??
            id;
        this.currentNotes = TIMBRE_DEMO_EVENTS;
        await this.playSong(`timbre-demo:${id}`, `音色试听 · ${label}`, 4.9, TIMBRE_DEMO_EVENTS);
    }

    /** 扩展中心临时试听未安装音色包样音，不改变播放器当前已选的常驻音色。 */
    async auditionTimbreDemo(
        id: string,
        timbreIndex: readonly TimbreIndexEntry[],
        resolveArchive?: TimbreArchiveLoader,
    ): Promise<void> {
        if (id !== "piano" && !this.timbrePacks.has(id) && resolveArchive) {
            const archive = await resolveArchive(id);
            if (archive) this.registerTimbreArchive(archive);
        }
        const indexMeta = timbreIndex.find((item) => item.id === id);
        const packMeta = this.timbrePacks.get(id)?.meta;
        const coreMeta = PIANO_TIMBRES.find((item) => item.id === id);
        const value = packMeta?.value ?? indexMeta?.value ?? coreMeta?.value ?? DEFAULT_PIANO_TIMBRE;
        const label = packMeta?.label ?? indexMeta?.label ?? coreMeta?.label ?? id;

        super.setTimbre(value);
        await this.warmup().catch(() => {});
        this.currentNotes = TIMBRE_DEMO_EVENTS;
        await this.playSong(`timbre-demo:${id}`, `样音试听 · ${label}`, 4.9, TIMBRE_DEMO_EVENTS);
    }

    async playBytes(
        id: string,
        name: string,
        bytes: Uint8Array,
        kind: "pbe3" | "mid" = "pbe3",
    ): Promise<void> {
        // 确保临时试听其他未安装音色后，正常播放歌曲仍恢复为用户当前已启用的音色。
        const activeMeta =
            this.timbrePacks.get(this.activeTimbreId)?.meta ??
            PIANO_TIMBRES.find((t) => t.id === this.activeTimbreId);
        super.setTimbre(activeMeta?.value ?? DEFAULT_PIANO_TIMBRE);

        const pbe3 = kind === "mid" ? encodeSong(midiBufferToSong(bytes, name)) : bytes;
        const events = songToNoteEvents(pbe3);
        const lastEnd = events.reduce((max, n) => Math.max(max, n.time + n.duration), 0);
        this.currentNotes = events;
        const durationSec = Math.max(lastEnd, 0.5);
        await this.playSong(id, name, durationSec, events);
    }
}

class StudioAppPlayer extends AppPlayer {
    constructor(private readonly studioMidi: StudioMidiPlayer) {
        super(studioMidi);
    }

    setTemplate(template: TemplateInfo | null): void {
        this.studioMidi.setTemplate(template);
    }

    registerTimbreArchive(archive: PbePluginArchive): void {
        this.studioMidi.registerTimbreArchive(archive);
    }

    async setTimbre(
        id: string,
        timbreIndex: readonly TimbreIndexEntry[],
        resolveArchive?: TimbreArchiveLoader,
    ): Promise<void> {
        await this.studioMidi.switchTimbre(id, timbreIndex, resolveArchive);
    }

    async previewTimbreDemo(
        id: string,
        timbreIndex: readonly TimbreIndexEntry[],
        resolveArchive?: TimbreArchiveLoader,
    ): Promise<void> {
        this.stopAudio();
        await this.studioMidi.previewTimbreDemo(id, timbreIndex, resolveArchive);
    }

    async auditionTimbreDemo(
        id: string,
        timbreIndex: readonly TimbreIndexEntry[],
        resolveArchive?: TimbreArchiveLoader,
    ): Promise<void> {
        this.stopAudio();
        await this.studioMidi.auditionTimbreDemo(id, timbreIndex, resolveArchive);
    }

    setNormalizeLoudness(enabled: boolean): void {
        this.studioMidi.setNormalizeLoudness(enabled);
    }

    async toggleSong(
        id: string,
        name: string,
        loadBytes: () => Promise<Uint8Array>,
        kind: "pbe3" | "mid" = "pbe3",
    ): Promise<void> {
        const st = this.studioMidi.getState();
        if (st.songId === id && st.status === "playing") {
            this.pause();
            return;
        }
        if (st.songId === id && st.status === "paused") {
            this.resume();
            return;
        }
        this.stopAudio();
        const bytes = await loadBytes();
        await this.studioMidi.playBytes(id, name, bytes, kind);
    }

    async playBytes(
        id: string,
        name: string,
        bytes: Uint8Array,
        kind: "pbe3" | "mid" = "pbe3",
    ): Promise<void> {
        this.stopAudio();
        await this.studioMidi.playBytes(id, name, bytes, kind);
    }
}

const studioMidi = new StudioMidiPlayer();
export const studioPlayer = new StudioAppPlayer(studioMidi);
