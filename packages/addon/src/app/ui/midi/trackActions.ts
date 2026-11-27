import { DDUI } from "sapi-pro";
import {
    attachSongPerformance,
    defaultPerformanceId,
    formatBytes,
    musicSourceLabel,
    readSongHeader,
    type MusicRef,
    type PerformanceDescriptor,
} from "@piano/core";
import { vfxRegistry } from "@piano/vfx";
import type { PianoRuntime } from "@app/PianoRuntime";

export interface TrackActionArgs {
    piano: PianoRuntime;
    ref: MusicRef;
}

function formatDuration(duration: number): string {
    const seconds = Math.max(0, Math.floor(duration / 40));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

interface PerformanceOption {
    id: string;
    name: string;
    author?: string;
    available: boolean;
    cues?: PerformanceDescriptor["cues"];
    legacyNumber: number;
}

function isPerformanceAvailable(desc: PerformanceDescriptor): boolean {
    const effects = desc.requiredEffects ?? (desc.cues ? [...new Set(desc.cues.map((c) => c.effect))] : []);
    if (!effects.length) return true;
    return effects.every((id) => vfxRegistry.hasEffect(id));
}

export function withDefaultQueuePerformance(piano: PianoRuntime, ref: MusicRef): MusicRef {
    if (ref.performanceId !== undefined || ref.performance !== undefined) return ref;
    const localEntries = piano.performanceEntries?.(ref);
    const entries = localEntries?.length ? localEntries : ref.performanceEntries ?? [];
    const entry = entries.find((entry) => entry.id !== "plain" && isPerformanceAvailable(entry));
    return entry ? { ...ref, performanceId: entry.id } : ref;
}

/** 歌曲详情：展示元信息，使用稳定演出标识选择演奏方式。 */
export const TrackActionsPage = DDUI.page<TrackActionArgs>("歌曲详情", (ui, args) => {
    const { piano, ref } = args;
    const player = ui.player;
    const status = ui.string("");
    ui.subscribe(piano.disposedSignal, () => ui.close());

    const alive = () => piano.isAlive() && player.isValid;
    const fail = (error: unknown) => status.setData(`§c${(error as Error)?.message ?? error}`);

    const canCopy = ui.boolean(ref.source === "library" && Boolean(piano.cardAccess), { clientWritable: false });
    const canDelete = ui.boolean(ref.source === "card", { clientWritable: false });

    const descriptorSource: PerformanceDescriptor[] = (() => {
        const entries = piano.performanceEntries?.(ref) ?? ref.performanceEntries ?? [];
        if (entries.length > 0) return entries.filter((entry) => entry.id !== "plain");
        const legacy = piano.performances?.(ref) ?? ref.performances ?? [];
        return legacy.map((cues, index) => ({
            id: `${ref.id}:perf:${index + 1}`,
            name: `附加演出 ${index + 1}`,
            songId: ref.id,
            cues,
        }));
    })();

    const options: PerformanceOption[] = [
        { id: "plain", name: "普通演奏", available: true, legacyNumber: -1 },
        ...descriptorSource.map((entry, index) => ({
            id: entry.id,
            name: entry.name,
            author: entry.author,
            available: isPerformanceAvailable(entry),
            cues: entry.cues,
            legacyNumber: entry.id === defaultPerformanceId(ref.id) ? 0 : index + 1,
        })),
    ];

    const initialIndex = (() => {
        if (ref.performanceId) {
            const idx = options.findIndex((o) => o.id === ref.performanceId);
            if (idx >= 0) return idx;
        }
        if (ref.performance === -1) return 0;
        if (typeof ref.performance === "number" && ref.performance > 0 && options[ref.performance]) {
            return ref.performance;
        }
        const firstAvailable = options.findIndex((option, index) => index > 0 && option.available);
        return Math.max(0, firstAvailable);
    })();

    const mode = ui.number(initialIndex);
    const showModes = ui.boolean(options.length > 1, { clientWritable: false });
    const selectedOption = (): PerformanceOption => options[mode.getData()] ?? options[0];

    const chosen = (): MusicRef => {
        const opt = selectedOption();
        return {
            ...ref,
            performanceId: opt.id,
            performance: opt.legacyNumber,
        };
    };

    if (descriptorSource.length === 0) {
        void Promise.resolve(piano.readBytes(ref))
            .then((bytes) => {
                if (!bytes || !alive() || ui.closed) return;
                const embedded = readSongHeader(bytes).performance;
                if (embedded?.length) {
                    options.push({
                        id: defaultPerformanceId(ref.id),
                        name: "曲目默认演出",
                        available: isPerformanceAvailable({ id: defaultPerformanceId(ref.id), name: "曲目默认演出", cues: embedded }),
                        cues: embedded,
                        legacyNumber: 0,
                    });
                    showModes.setData(true);
                }
            })
            .catch(() => {});
    }

    ui.label(`§b${ref.name}`);
    ui.label(`§7来源：§f${musicSourceLabel(ref.source)}`);
    ui.label(`§7时长：§f${formatDuration(ref.duration)}`);
    ui.label(`§7音符：§f${ref.noteCount !== undefined ? ref.noteCount : "未知"}`);
    ui.label(`§7大小：§f${ref.bytes !== undefined ? formatBytes(ref.bytes) : "未知"}`);
    ui.label(status);
    ui.dropdown(
        "演奏方式",
        mode,
        options.map((opt, index) => ({
            label: opt.available ? opt.name : `${opt.name} (缺少插件)`,
            value: index,
        })),
        { visible: showModes },
    );

    ui.button("▶ 立即播放", () => {
        if (!alive()) return ui.close();
        void piano
            .getMidiPlayer()
            .playNow(chosen())
            .then(() => status.setData("§a开始播放"))
            .catch(fail);
    });

    ui.button("＋ 加入播放队列", () => {
        if (!alive()) return ui.close();
        const result = piano.getMidiPlayer().addToQueue(chosen());
        status.setData(result === "added" ? "§a已加入播放队列" : "§e队列中已有这首歌");
    });

    ui.button(
        "复制到存储卡",
        () => {
            if (!alive()) return ui.close();
            const card = piano.cardAccess;
            if (!card) {
                status.setData("§c卡槽为空，先插入一张音乐存储卡");
                return;
            }
            const opt = selectedOption();
            void Promise.all([
                Promise.resolve(piano.readBytes(ref)),
                opt.id === "plain"
                    ? Promise.resolve(undefined)
                    : opt.cues
                      ? Promise.resolve(opt.cues)
                      : piano.resolvePerformanceCues?.(ref, opt.id) ?? Promise.resolve(undefined),
            ])
                .then(([bytes, cues]) => {
                    if (!bytes) throw new Error("源曲目已不可用");
                    const storage = card.storage();
                    const selected = opt.id === "plain"
                        ? attachSongPerformance(bytes, [])
                        : cues
                          ? attachSongPerformance(bytes, cues)
                          : bytes;
                    const entry = storage.save(selected, ref.name, {
                        id: opt.id,
                        name: opt.name,
                        author: opt.author,
                    });
                    card.refreshLore();
                    status.setData(`§a已复制到存储卡：${entry.name}`);
                })
                .catch(fail);
        },
        { visible: canCopy },
    );

    ui.button(
        "删除歌曲",
        () => {
            if (!alive()) return ui.close();
            ui.push(ConfirmDeletePage, { piano, ref });
        },
        { visible: canDelete },
    );

    ui.closeButton();
});

const ConfirmDeletePage = DDUI.page<TrackActionArgs>("确认删除", (ui, args) => {
    const { piano, ref } = args;
    const status = ui.string("");
    ui.label("§e确定从存储卡删除：");
    ui.label(`§f${ref.name}`);
    ui.label(status);
    ui.button("确认删除", () => {
        const card = piano.cardAccess;
        if (!card) return status.setData("§c存储卡已不在卡槽中");
        if (ref.cardUid && card.uid && ref.cardUid !== card.uid) {
            return status.setData("§c存储卡已被替换，已取消删除");
        }
        const removed = card.storage().remove(ref.id);
        if (removed) {
            card.refreshLore();
            status.setData("§a已删除");
            ui.back();
            return;
        }
        status.setData("§e曲目已不存在");
    });
    ui.button("取消", () => ui.back());
});
