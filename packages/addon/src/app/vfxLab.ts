import { Player, ScriptEventSource, system } from "@minecraft/server";
import { parseVfxOptions, planVfxScene, VFX_EFFECTS, VFX_SCENES,
    type VfxCue, type VfxOptions, type VfxScene } from "@domain/piano/vfxLab";
import { VFX_MAX_PIANOS, VfxBudget } from "@domain/piano/vfxBudget";
import { quietFeatures, simulatedVfxNotes, VfxMusic, type MusicFeatures } from "@domain/piano/vfxMusic";
import { isVfxEffect, validateEffectOptions, validateVfxPreset, vfxInput, VFX_PRESETS, VfxPresetPlayer,
    type VfxBatch, type VfxInput, type VfxPreset } from "@domain/piano/vfxPreset";
import { inspectInstrument, instrumentDestroyed, instrumentKey, resolveInstrument, type InstrumentLocation } from "@platform/assembly";
import { spawnVfxEmitter } from "@platform/vfxParticle";
import { loadVfxPresets, saveVfxPreset } from "@platform/storage/vfxPresets";
import { pianoWorld } from "./PianoWorld";

type Request = { scene: VfxScene; options: VfxOptions } | { preset: VfxPreset; input: VfxInput; name: string };
interface Preview {
    location: InstrumentLocation;
    request: Request;
    producer?: {
        update(tick: number, elapsed: number): VfxBatch[];
        detach?(): void;
    };
    ended: boolean;
    start: number;
    duration: number;
    budget: VfxBudget;
    features: Readonly<MusicFeatures>;
}

const previews = new Map<string, Preview>();
let timer: number | undefined;
let sent = 0;
let failures = 0;
let dropped = 0;
let peakCalls = 0;
let peakMs = 0;

function stop(preview: Preview) {
    preview.ended = true;
    preview.producer?.detach?.();
    preview.producer = undefined;
    preview.budget.clearPending();
}

function createProducer(preview: Preview): NonNullable<Preview["producer"]> | undefined {
    const { request, location } = preview;
    if ("scene" in request) {
        const cues: VfxCue[] = planVfxScene(request.scene, request.options);
        let cursor = 0;
        preview.duration = (cues.at(-1)?.tick ?? 0) + 1;
        return { update: (_tick, elapsed) => {
            const cue = cues[cursor];
            if (!cue || cue.tick > elapsed) return [];
            cursor++;
            return [{ priority: 2, emitters: cue.emitters }];
        } };
    }
    const player = new VfxPresetPlayer(request.preset);
    const music = new VfxMusic();
    preview.duration = player.duration;
    const { input } = request;
    const piano = input === "live" ? pianoWorld.get(location) : undefined;
    if (input === "live" && !piano) return;
    const cleanups = piano ? [
        piano.noteSignal.subscribe(note => {
            if (note.tick !== undefined && note.velocity !== undefined && note.source && note.hasVelocity !== undefined) {
                music.note({ midi: note.midi, duration: note.duration, tick: note.tick, velocity: note.velocity,
                    source: note.source, hasVelocity: note.hasVelocity, songTime: note.songTime });
            }
        }),
        piano.transportSignal.subscribe(event => {
            music.transport(event);
            if (event.type !== "resume" && event.type !== "start") {
                preview.budget.clearPending();
                player.reset(system.currentTick - preview.start);
            }
        }),
        piano.onDispose(() => stop(preview)),
    ] : [];
    return {
        detach: () => cleanups.forEach(cleanup => cleanup()),
        update(tick, elapsed) {
            if (input !== "live" && input !== "solo") {
                for (const note of simulatedVfxNotes(tick, elapsed, input)) music.note(note);
            }
            if (elapsed % 4 !== 0) return [];
            preview.features = input === "solo" ? quietFeatures : music.sample(tick);
            return player.update(elapsed, preview.features, input === "solo");
        },
    };
}

function update() {
    const tick = system.currentTick;
    const started = Date.now();
    let calls = 0;
    for (const [key, preview] of previews) {
        preview.budget.expire(tick);
        const elapsed = tick - preview.start;
        if (!preview.ended && (elapsed === 0 || tick % 20 === 0) && inspectInstrument(preview.location) !== "complete") stop(preview);
        if (!preview.ended && elapsed >= 0) {
            try {
                preview.producer ??= createProducer(preview);
                if (!preview.producer || elapsed >= preview.duration) stop(preview);
                else {
                    const before = preview.budget.dropped;
                    preview.budget.enqueue(preview.producer.update(tick, elapsed));
                    dropped += preview.budget.dropped - before;
                }
                preview.budget.dispatch(tick, emitter => {
                    calls++;
                    spawnVfxEmitter(preview.location, emitter, elapsed / 20);
                    sent++;
                });
            } catch (error) {
                failures++;
                console.warn("[piano-vfx] 预览失败", error);
                stop(preview);
            }
        }
        if (preview.ended && !preview.budget.active) previews.delete(key);
    }
    peakCalls = Math.max(peakCalls, calls);
    if (calls) peakMs = Math.max(peakMs, Date.now() - started);
    if (!previews.size && timer !== undefined) {
        system.clearRun(timer);
        timer = undefined;
    }
}

function startPreview(location: InstrumentLocation, request: Request) {
    const key = instrumentKey(location.dimension, location.pos);
    const previous = previews.get(key);
    if (!previous && previews.size >= VFX_MAX_PIANOS) throw new Error("已有 4 架琴占用预览预算，请等待粒子消退");
    if (previous) stop(previous);
    const budget = previous?.budget ?? new VfxBudget();
    const start = budget.nextAvailableTick(system.currentTick + 1);
    previews.set(key, { location, request, start, duration: 0, ended: false, budget, features: quietFeatures });
    timer ??= system.runInterval(update);
    return (start - system.currentTick - 1) / 20;
}

function status() {
    let active = 0;
    let emitters = 0;
    let reserved = 0;
    for (const preview of previews.values()) {
        if (!preview.ended) active++;
        emitters += preview.budget.active;
        reserved += preview.budget.reserved;
    }
    return `预览 ${active} / ${previews.size} 架占用 · 发射批次 ${emitters} · 预留粒子 ${reserved} · 已提交 ${sent} · 预算丢弃 ${dropped} 批 · 失败 ${failures} · 峰值 ${peakCalls} 调用/刻，${peakMs} ms/发射刻`;
}

function words(message: string): [string, string] {
    const [, head = "", rest = ""] = message.trim().match(/^(\S+)(?:\s+([\s\S]*))?$/) ?? [];
    return [head, rest];
}

export function registerVfxLab() {
    instrumentDestroyed.subscribe(location => {
        const preview = previews.get(instrumentKey(location.dimension, location.pos));
        if (preview) stop(preview);
    });
    system.afterEvents.scriptEventReceive.subscribe(event => {
        if (event.id !== "pbe:vfx" || event.sourceType !== ScriptEventSource.Entity || !(event.sourceEntity instanceof Player)) return;
        const player = event.sourceEntity;
        const [action, args] = words(event.message);
        const say = (message: string) => player.sendMessage(`[PianoBE VFX Lab] ${message}`);
        try {
            if (action === "help" || !action) {
                say("list [分类] · preview <特效> [JSON] · preset <预设> [输入] · compose <输入> <JSON> · save <名称> <JSON> · remove <名称> · status · reset · stop");
                say("输入 live / phrase / note / chord / dense / solo");
                return;
            }
            if (action === "list") {
                const entries = Object.entries(VFX_EFFECTS).filter(([, def]) => !args || def.category === args);
                for (const [name, def] of entries) say(`${def.category} / ${name} · ${def.mode} · ${def.options.join(", ")}`);
                if (!args) say(`内置预设 ${Object.keys(VFX_PRESETS).join(", ")} · 自定义 ${[...loadVfxPresets().keys()].join(", ") || "无"}`);
                return;
            }
            if (action === "save" || action === "remove") {
                const [name, body] = words(args);
                saveVfxPreset(name, action === "save" ? validateVfxPreset(JSON.parse(body)) : undefined);
                say(action === "save" ? `已保存 ${name}` : `已移除 ${name}`);
                return;
            }
            const hit = player.getBlockFromViewDirection({ maxDistance: 12 });
            const location = hit && resolveInstrument(hit.block);
            const previous = location && previews.get(instrumentKey(location.dimension, location.pos));
            if (action === "status") {
                say(status());
                if (previous && "input" in previous.request) {
                    const { density, activity, velocity, pitch, sustain } = previous.features;
                    say(`${previous.request.name} / ${previous.request.input} · 密度 ${density.toFixed(2)} · 活跃 ${activity.toFixed(2)} · 力度 ${velocity.toFixed(2)} · 音高 ${pitch.toFixed(2)} · 延音 ${sustain.toFixed(2)}`);
                }
                return;
            }
            if (!location || inspectInstrument(location) !== "complete") throw new Error("请瞄准 12 格以内的完整钢琴方块");
            if (action === "stop") {
                if (previous) stop(previous);
                say(previous ? "已停止后续发射，现存粒子会自行淡出" : "这架琴没有预览");
                return;
            }
            const [name, detail] = words(args);
            const scene = VFX_SCENES.find(value => value === action);
            let request: Request;
            if (action === "reset" && previous) {
                request = "scene" in previous.request ? { scene: previous.request.scene, options: {} } : previous.request;
            } else if (scene) {
                request = { scene, options: parseVfxOptions(args) };
            } else if (action === "preview" && isVfxEffect(name)) {
                request = { input: "solo", name, preset: { seconds: 9, layers: [{ effect: name,
                    options: validateEffectOptions(name, detail ? JSON.parse(detail) : {}) }] } };
            } else if (action === "preset") {
                const preset = Object.hasOwn(VFX_PRESETS, name) ? VFX_PRESETS[name] : loadVfxPresets().get(name);
                if (!preset) throw new Error(`未知预设 ${name}`);
                request = { preset, name, input: vfxInput(detail || "live") };
            } else if (action === "compose") {
                request = { preset: validateVfxPreset(JSON.parse(detail)), name: "compose", input: vfxInput(name) };
            } else {
                throw new Error("未知指令或预览，使用 help 查看用法");
            }
            const wait = startPreview(location, request);
            const label = "scene" in request ? request.scene : `${request.name} / ${request.input}`;
            say(wait > 0 ? `${label} 将在现有粒子淡出后开始（约 ${wait.toFixed(1)} 秒）` : `开始 ${label}`);
        } catch (error) {
            say(error instanceof Error ? error.message : String(error));
        }
    });
}
