import { Player, ScriptEventSource, system } from "@minecraft/server";
import {
    PERFORMANCE_MOTIONS, PERFORMANCE_ZONES, isValidPerformanceSymbol, resolvePerformanceColor,
    type PerformanceMotion, type PerformanceZone,
} from "@piano/core";
import { pianoWorld } from "@app/PianoWorld";
import {
    deriveAccentHex, getKeyParticleStyleLabel, getVfxEffect, getVfxTheme, getVfxThemeIds,
    isValidBrush, listVfxEffects, parseVfxInput, validateEffectCustomParams, validateVfxTheme,
    type SingleEffectConfig, type VfxCategory,
} from "@piano/vfx";
import { inspectInstrument, resolveInstrument } from "@platform/assembly";
import { loadVfxThemes, saveVfxTheme } from "@platform/storage/vfxPresets";
import {
    activeKeyParticleOverride, getVfxSession, getVfxStatus, startLabPreview, stopLocationVfx,
    summarizeSessionChannels, type LabRequest,
} from "./runtime";

function words(message: string): [string, string] {
    const [, head = "", rest = ""] = message.trim().match(/^(\S+)(?:\s+([\s\S]*))?$/) ?? [];
    return [head, rest];
}

function parseDrawOptions(effect: string, raw: string): SingleEffectConfig {
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("参数需要是 JSON 对象");
    const color = parsed.color !== undefined ? resolvePerformanceColor(String(parsed.color)) : "#68E4FF";
    const color2 = parsed.color2 !== undefined ? resolvePerformanceColor(String(parsed.color2)) : deriveAccentHex(color);

    let brush: string | undefined;
    if (parsed.brush !== undefined) {
        if (typeof parsed.brush !== "string" || (parsed.brush !== "default" && !isValidBrush(parsed.brush))) {
            throw new Error(`未知画笔 ${String(parsed.brush)}`);
        }
        if (parsed.brush !== "default") brush = parsed.brush;
    }

    let variant: string | undefined;
    const rawVariant = parsed.variant ?? parsed.style;
    if (rawVariant !== undefined) {
        if (!isValidPerformanceSymbol(rawVariant)) throw new Error(`无效变体 ${String(rawVariant)}`);
        variant = rawVariant;
    }

    let zone: PerformanceZone | undefined;
    if (parsed.zone !== undefined) {
        if (typeof parsed.zone !== "string" || !Object.hasOwn(PERFORMANCE_ZONES, parsed.zone)) {
            throw new Error(`未知高度区域 ${String(parsed.zone)}`);
        }
        zone = parsed.zone as PerformanceZone;
    }

    let motion: PerformanceMotion | undefined;
    if (parsed.motion !== undefined) {
        if (typeof parsed.motion !== "string" || !Object.hasOwn(PERFORMANCE_MOTIONS, parsed.motion)) {
            throw new Error(`未知运动修饰 ${String(parsed.motion)}`);
        }
        motion = parsed.motion as PerformanceMotion;
    }

    const level = parsed.level !== undefined ? Number(parsed.level) : 85;
    if (!Number.isFinite(level) || level < 1 || level > 100) throw new Error("level 需要在 1 到 100 之间");
    const scale = parsed.scale !== undefined ? Number(parsed.scale) : 100;
    if (!Number.isFinite(scale) || scale < 50 || scale > 170) throw new Error("scale 需要在 50 到 170 之间");
    const seconds = parsed.seconds !== undefined ? Number(parsed.seconds) : 12;
    if (!Number.isFinite(seconds) || seconds < 2 || seconds > 180) throw new Error("seconds 需要在 2 到 180 之间");
    const params = validateEffectCustomParams(effect, parsed.params);

    return { effect, color, color2, brush, variant, zone, motion, ...(params ? { params } : {}), level, scale, seconds };
}

export function registerVfxCommands() {
    system.afterEvents.scriptEventReceive.subscribe(event => {
        if (event.id !== "pbe:vfx" || event.sourceType !== ScriptEventSource.Entity || !(event.sourceEntity instanceof Player)) return;
        const player = event.sourceEntity;
        const [action, args] = words(event.message);
        const say = (message: string) => player.sendMessage(`[PianoBE VFX] ${message}`);

        try {
            if (action === "help" || !action) {
                say("list [分类] · draw <特效> [输入] [JSON] · theme <主题> [输入] · compose <输入> <JSON> · save/remove <名称> · status · reset · stop");
                say("输入：live / phrase / note / chord / dense / solo");
                return;
            }

            if (action === "list") {
                const category = args.trim() as VfxCategory | "";
                const validCategories: readonly string[] = ["", "atmosphere", "curve", "stage", "keys", "accent", "control"];
                if (!validCategories.includes(category)) {
                    throw new Error("分类需为 atmosphere / curve / stage / keys / accent / control");
                }
                const entries = listVfxEffects(category || undefined);
                for (const def of entries) {
                    const brushText = def.defaultBrush ? ` · 画笔 ${def.defaultBrush}` : "";
                    const variantText = def.variants?.length ? ` · 变体 ${def.variants.join("/")}` : "";
                    const paramNames = def.parameters ? Object.keys(def.parameters) : [];
                    const paramText = paramNames.length ? ` · 参数 ${paramNames.join("/")}` : "";
                    say(`${def.category} / ${def.id} (${def.label}) · ${def.trigger}${brushText}${variantText}${paramText}`);
                }
                if (!category) {
                    const builtinThemes = getVfxThemeIds().join(", ") || "无";
                    say(`内置主题 ${builtinThemes} · 自定义 ${[...loadVfxThemes().keys()].join(", ") || "无"}`);
                }
                return;
            }

            if (action === "save" || action === "remove") {
                const [name, body] = words(args);
                saveVfxTheme(name, action === "save" ? validateVfxTheme(JSON.parse(body)) : undefined);
                say(action === "save" ? `已保存 ${name}` : `已移除 ${name}`);
                return;
            }

            const hit = player.getBlockFromViewDirection({ maxDistance: 12 });
            const location = hit && resolveInstrument(hit.block);
            const previous = location ? getVfxSession(location) : undefined;

            if (action === "status") {
                say(getVfxStatus());
                const statusPiano = previous && "piano" in previous.request
                    ? previous.request.piano
                    : location ? pianoWorld.get(location) : undefined;
                const keyOverride = previous && !previous.ended
                    ? (statusPiano ? activeKeyParticleOverride(statusPiano) : previous.engine?.keyParticleOverride(0))
                    : undefined;
                const keyText = keyOverride?.style
                    ? ` · 弹奏粒子 ${getKeyParticleStyleLabel(keyOverride.style)}`
                    : "";
                if (previous && "midi" in previous.request) {
                    const channels = summarizeSessionChannels(previous, previous.request.midi.position);
                    const activeText = channels.length
                        ? ` · 活跃通道 ${channels.map(c => `${c.effect}:${c.slot}(${c.level}%)`).join(", ")}`
                        : "";
                    const modeLabel = previous.request.kind === "songTheme"
                        ? `主题 ${previous.request.theme}`
                        : "曲目演出";
                    say(`${modeLabel} · ${previous.request.midi.position.toFixed(2)} 秒${activeText}${keyText}`);
                } else if (previous && !("auto" in previous.request)) {
                    const { density, activity, velocity, pitch, sustain } = previous.features;
                    say(`${previous.request.name} / ${previous.request.input} · 密度 ${density.toFixed(2)} · 活跃 ${activity.toFixed(2)} · 力度 ${velocity.toFixed(2)} · 音高 ${pitch.toFixed(2)} · 延音 ${sustain.toFixed(2)}${keyText}`);
                }
                return;
            }

            if (!location || inspectInstrument(location) !== "complete") throw new Error("请瞄准 12 格以内的完整钢琴方块");

            if (action === "stop") {
                const stopped = stopLocationVfx(location);
                say(stopped ? "已停止后续发射，现存粒子会自行淡出" : "这架琴没有预览");
                return;
            }

            const [name, detail] = words(args);
            let request: LabRequest;

            if (action === "reset" && previous) {
                if ("midi" in previous.request) {
                    void previous.request.midi.restart();
                    return;
                }
                if ("auto" in previous.request) throw new Error("该模式不可重播");
                request = previous.request;
            } else if (action === "draw") {
                if (!getVfxEffect(name)) throw new Error(`未知特效 ${name}`);
                const trimmed = detail.trim();
                let inputName = "live";
                let jsonRaw = "";
                if (trimmed.startsWith("{")) {
                    jsonRaw = trimmed;
                } else if (trimmed) {
                    const [maybeInput, maybeJson] = words(trimmed);
                    inputName = maybeInput;
                    jsonRaw = maybeJson;
                }
                request = {
                    single: parseDrawOptions(name, jsonRaw),
                    input: parseVfxInput(inputName),
                    name,
                };
            } else if (action === "theme") {
                const input = parseVfxInput(detail || "live");
                const theme = getVfxTheme(name) ?? loadVfxThemes().get(name);
                if (!theme) throw new Error(`未知主题 ${name}`);
                request = { theme, name, input };
            } else if (action === "compose") {
                request = { theme: validateVfxTheme(JSON.parse(detail)), name: "compose", input: parseVfxInput(name) };
            } else {
                throw new Error("未知指令，使用 help 查看用法");
            }

            const wait = startLabPreview(location, request);
            const label = `${request.name} / ${request.input}`;
            say(wait > 0 ? `${label} 将在现有粒子淡出后开始（约 ${wait.toFixed(1)} 秒）` : `开始 ${label}`);
        } catch (error) {
            say(error instanceof Error ? error.message : String(error));
        }
    });
}
