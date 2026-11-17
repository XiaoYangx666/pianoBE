import { Player, ScriptEventSource, system } from "@minecraft/server";
import { parseVfxOptions, planVfxScene, VFX_SCENES, type VfxCue, type VfxOptions, type VfxScene } from "@domain/piano/vfxLab";
import { inspectInstrument, instrumentDestroyed, instrumentKey, resolveInstrument, type InstrumentLocation } from "@platform/assembly";
import { spawnVfxEmitter } from "@platform/vfxParticle";

interface Preview {
    location: InstrumentLocation;
    scene: VfxScene;
    cues: VfxCue[];
    cursor: number;
    start: number;
    live: { expires: number; particles: number }[];
}

const maxPianos = 4;
const previews = new Map<string, Preview>();
let timer: number | undefined;
let sent = 0;
let failures = 0;
let peakCalls = 0;
let peakMs = 0;

function update() {
    const tick = system.currentTick;
    const started = Date.now();
    let calls = 0;
    for (const [key, preview] of previews) {
        preview.live = preview.live.filter(entry => entry.expires > tick);
        if (preview.cursor < preview.cues.length && tick % 20 === 0 && inspectInstrument(preview.location) !== "complete") {
            preview.cursor = preview.cues.length;
        }
        const cue = preview.cues[preview.cursor];
        if (cue && tick - preview.start >= cue.tick) {
            preview.cursor++;
            for (const emitter of cue.emitters) {
                calls++;
                try {
                    spawnVfxEmitter(preview.location, emitter, (tick - preview.start) / 20);
                    preview.live.push({ expires: tick + Math.ceil(emitter.lifetime * 20) + 2, particles: emitter.particles });
                    sent++;
                } catch (error) {
                    failures++;
                    console.warn("[piano-vfx] 粒子发射失败", error);
                    preview.cursor = preview.cues.length;
                    break;
                }
            }
        }
        if (preview.cursor >= preview.cues.length && !preview.live.length) previews.delete(key);
    }
    peakCalls = Math.max(peakCalls, calls);
    if (calls) peakMs = Math.max(peakMs, Date.now() - started);
    if (!previews.size && timer !== undefined) {
        system.clearRun(timer);
        timer = undefined;
    }
}

function startPreview(location: InstrumentLocation, scene: VfxScene, options: VfxOptions) {
    const key = instrumentKey(location.dimension, location.pos);
    const previous = previews.get(key);
    if (!previous && previews.size >= maxPianos) throw new Error("已有 4 架琴占用预览预算，请等待粒子消退");
    const live = previous?.live ?? [];
    const start = live.reduce((latest, entry) => Math.max(latest, entry.expires), system.currentTick + 1);
    previews.set(key, { location, scene, cues: planVfxScene(scene, options), cursor: 0, start, live });
    timer ??= system.runInterval(update);
    return (start - system.currentTick - 1) / 20;
}

function status() {
    let active = 0;
    let emitters = 0;
    let particles = 0;
    for (const preview of previews.values()) {
        if (preview.cursor < preview.cues.length) active++;
        for (const entry of preview.live) {
            emitters++;
            particles += entry.particles;
        }
    }
    return `预览 ${active} / ${previews.size} 架占用 · 估算存活上限 ${emitters} 发射批次 / ${particles} 粒子 · 已提交 ${sent} · 失败 ${failures} · 峰值 ${peakCalls} 调用/刻，${peakMs} ms/发射刻`;
}

export function registerVfxLab() {
    instrumentDestroyed.subscribe(location => {
        const preview = previews.get(instrumentKey(location.dimension, location.pos));
        if (preview) preview.cursor = preview.cues.length;
    });
    system.afterEvents.scriptEventReceive.subscribe(event => {
        if (event.id !== "pbe:vfx" || event.sourceType !== ScriptEventSource.Entity || !(event.sourceEntity instanceof Player)) return;
        const player = event.sourceEntity;
        const [, action = "help", json = ""] = event.message.trim().match(/^(\S+)(?:\s+([\s\S]*))?$/) ?? [];
        const say = (message: string) => player.sendMessage(`[PianoBE VFX Lab] ${message}`);
        try {
            if (action === "status") { say(status()); return; }
            if (action === "help") {
                say(`瞄准钢琴后运行 /scriptevent pbe:vfx <${VFX_SCENES.join("|")}|stop|reset> [JSON]。status 查看开销。`);
                return;
            }
            const scene = VFX_SCENES.find(value => value === action);
            if (!scene && action !== "stop" && action !== "reset") throw new Error("未知指令，使用 help 查看用法");
            const hit = player.getBlockFromViewDirection({ maxDistance: 12 });
            const location = hit && resolveInstrument(hit.block);
            if (!location || inspectInstrument(location) !== "complete") throw new Error("请瞄准 12 格以内的完整钢琴方块");
            const key = instrumentKey(location.dimension, location.pos);
            const previous = previews.get(key);
            if (action === "stop") {
                if (previous) previous.cursor = previous.cues.length;
                say(previous ? "已停止后续发射，现存粒子会自行淡出" : "这架琴没有预览");
                return;
            }
            if (!scene && !previous) throw new Error("这架琴没有可重置的预览");
            const next = scene ?? previous!.scene;
            const wait = startPreview(location, next, scene ? parseVfxOptions(json) : {});
            say(wait > 0 ? `${next} 将在现有粒子淡出后开始（最多 ${wait.toFixed(1)} 秒）` : `开始 ${next}`);
        } catch (error) {
            say(error instanceof Error ? error.message : String(error));
        }
    });
}
