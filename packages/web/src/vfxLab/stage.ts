import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type {
    PerformanceBrush, PerformanceCue, PerformanceMethod, PerformanceMotion, PerformanceZone, SecretScore,
} from "@piano/core";
import { grandDefinition, pianoDefinition, type InstrumentDefinition } from "../../../addon/src/domain/instrument/definition";
import { digitalPianoHitModel, grandPianoHitModel, pianoParticleOrigin } from "../../../addon/src/domain/geometry/keyRay";
import { RightOffsets } from "../../../addon/src/domain/geometry/offsets";
import {
    KEY_PARTICLE_STYLE_LABELS, keyParticleOverrideFromCue, resolveKeyParticle,
    type KeyParticleStyleId, type PianoParticleOverride,
} from "../../../addon/src/domain/piano/particleOverride";
import { VfxBudget } from "../../../addon/src/domain/piano/vfxBudget";
import { quietFeatures, VfxMusic, type MusicFeatures, type VfxKeyNote } from "../../../addon/src/domain/piano/vfxMusic";
import {
    VFX_PAINTERS, VFX_STAGE_THEMES, VfxThemePlayer, type VfxStageThemeName,
} from "../../../addon/src/domain/piano/vfxPainters";
import { VfxPresetPlayer, type VfxBatch, type VfxPreset } from "../../../addon/src/domain/piano/vfxPreset";
import { VfxPerformancePlayer } from "../../../addon/src/domain/piano/vfxPerformance";
import { SecretCinemaPlayer } from "../../../addon/src/domain/piano/secretCinema";
import { placeVfxEmitter, vfxStageFrame } from "../../../addon/src/domain/piano/vfxStage";
import type { VfxEffect } from "../../../addon/src/domain/piano/vfxLab";
import type { PianoVisualNote } from "../../../addon/src/domain/playback/visualEvent";
import { createCast, type PianoModel } from "./models";
import { loadParticles, particleStep } from "./particles";
import { createDeck } from "./deck";

export type Direction = keyof typeof RightOffsets;
export type View = "stage" | "performer" | "orbit";
export interface Track {
    duration: number;
    notes: ReadonlyMap<number, readonly PianoVisualNote[]>;
    performance?: readonly PerformanceCue[];
    nativeSecret?: SecretScore;
}

export interface PainterConfig {
    method: PerformanceMethod;
    color: string;
    color2: string;
    brush: PerformanceBrush;
    zone: PerformanceZone;
    motion: PerformanceMotion;
    level: number;
    scale: number;
}

export interface PreviewStats {
    effects: Partial<Record<VfxEffect, { particles: number; reserved: number; rate: number }>>;
    particles: number;
    reserved: number;
    dropped: number;
    features: Readonly<MusicFeatures>;
    frameMs: number;
    draws: number;
    activeChannels?: { method: PerformanceMethod; label: string; slot: number; level: number }[];
    keyParticle?: {
        style: KeyParticleStyleId;
        label: string;
        colors: readonly string[];
        glimmer: boolean;
        overridden: boolean;
    };
}

const DEFAULT_KEY_PARTICLE_SETTINGS = { particleStyle: 3, particlePalette: 0 };

class PainterPreviewPlayer {
    private nextTick = 0;
    private lastNoteTick = -1;
    private previousLength?: number;
    private previousAmplitude?: number;
    private pendingFlash = false;

    constructor(
        private config: PainterConfig,
        private readonly definition: InstrumentDefinition,
    ) {}

    setConfig(config: PainterConfig) {
        const changedMethod = this.config.method !== config.method;
        this.config = config;
        if (changedMethod) {
            this.nextTick = 0;
            this.previousLength = undefined;
            this.previousAmplitude = undefined;
            if (VFX_PAINTERS[config.method].instant) this.pendingFlash = true;
        }
    }

    triggerFlash() {
        this.pendingFlash = true;
    }

    update(tick: number, music: Readonly<MusicFeatures>, recentNotes: readonly VfxKeyNote[]): VfxBatch[] {
        if (this.config.method === "key_style") return [];
        const painter = VFX_PAINTERS[this.config.method];
        if (painter.instant) {
            if (!this.pendingFlash && tick % 45 !== 0) return [];
            this.pendingFlash = false;
        } else {
            if (tick < this.nextTick) return [];
            if (painter.category === "keys") {
                const hasFresh = recentNotes.some((note) => note.tick > this.lastNoteTick);
                if (!hasFresh) return [];
            }
        }
        const result = painter.emit({
            color: this.config.color,
            color2: this.config.color2,
            intensity: this.config.level / 100,
            scale: this.config.scale / 100,
            brush: this.config.brush,
            zone: this.config.zone,
            motion: this.config.motion,
            music,
            recentNotes,
            lastNoteTick: this.lastNoteTick,
            definition: this.definition,
            previousLength: this.previousLength,
            previousAmplitude: this.previousAmplitude,
            phase: (tick * 9) % 360,
        });
        if (!painter.instant) {
            if (painter.category === "keys") {
                for (const note of recentNotes) if (note.tick > this.lastNoteTick) this.lastNoteTick = note.tick;
            }
            this.nextTick = tick + Math.max(1, painter.interval);
        }
        if (result.nextLength !== undefined) this.previousLength = result.nextLength;
        if (result.nextAmplitude !== undefined) this.previousAmplitude = result.nextAmplitude;
        return result.emitters.length ? [{ priority: result.priority, emitters: result.emitters }] : [];
    }
}

export async function createStage(canvas: HTMLCanvasElement) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const [cast, particles] = await Promise.all([createCast(), loadParticles()]).catch(error => {
        renderer.dispose();
        throw error;
    });
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x060a14);
    scene.fog = new THREE.FogExp2(0x060a14, 0.052);
    const camera = new THREE.PerspectiveCamera(39, 1, 0.05, 120);
    const orbit = new OrbitControls(camera, canvas);
    orbit.enableDamping = true;
    orbit.minDistance = 2.3;
    orbit.maxDistance = 26;
    orbit.maxPolarAngle = Math.PI * 0.494;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(150, 150),
        new THREE.MeshStandardMaterial({ color: 0x101727, metalness: 0.12, roughness: 0.86 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.53;
    floor.receiveShadow = true;
    const deck = createDeck();
    scene.add(floor, deck, new THREE.HemisphereLight(0xb4c9f7, 0x57516d, 0.31));
    const key = new THREE.SpotLight(0xffe6d2, 4.0, 18, 0.44, 0.83, 1);
    key.position.set(1.4, 7.6, 4.0);
    key.target.position.set(0, 0.4, -0.9);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.025;
    const rim = new THREE.SpotLight(0xb9c5ff, 3.2, 17, 0.59, 1, 1);
    rim.position.set(-4.3, 5, -4.8);
    rim.target.position.set(0, 0.9, -0.5);
    const fill = new THREE.PointLight(0xc4cdff, 0.48, 11, 1.25);
    fill.position.set(4.2, 2.7, 4.5);
    scene.add(key, key.target, rim, rim.target, fill, particles.space);
    scene.add(cast.grand.group, cast.p88.group);

    const axes = new THREE.AxesHelper(2);
    axes.position.y = 0.015;
    const grid = new THREE.GridHelper(16, 16, 0x9babc9, 0x303e58);
    grid.position.y = 0.008;
    const debug = new THREE.Group();
    const anchorBuffer = new THREE.BufferAttribute(new Float32Array(26 * 6 * 3), 3).setUsage(THREE.DynamicDrawUsage);
    const pathBuffer = new THREE.BufferAttribute(new Float32Array(2400), 3).setUsage(THREE.DynamicDrawUsage);
    const anchorGeometry = new THREE.BufferGeometry().setAttribute("position", anchorBuffer);
    const pathGeometry = new THREE.BufferGeometry().setAttribute("position", pathBuffer);
    const anchorPoints = new THREE.Points(anchorGeometry, new THREE.PointsMaterial({ color: 0xffdd9d, size: 0.065 }));
    const trails = new THREE.LineSegments(pathGeometry, new THREE.LineBasicMaterial({ color: 0x54cfdd, transparent: true, opacity: 0.62 }));
    anchorPoints.frustumCulled = trails.frustumCulled = false;
    debug.add(axes, grid, anchorPoints, trails);
    debug.visible = false;
    scene.add(debug);

    let model: PianoModel = "grand";
    let direction: Direction = "south";
    let view: View = "stage";
    const center = { x: 0, y: 0, z: 0 };
    let track: Track;
    let preset: VfxPreset;
    let themeName: VfxStageThemeName | undefined;
    let painterConfig: PainterConfig | undefined;
    let player: VfxPresetPlayer | VfxPerformancePlayer | SecretCinemaPlayer | VfxThemePlayer | PainterPreviewPlayer;
    let budget: VfxBudget;
    let music: VfxMusic;
    let features: Readonly<MusicFeatures> = quietFeatures;
    let frame = -1;
    let simTime = 0;
    let lastDrawMs = 0;
    let emissions: { tick: number; effect: VfxEffect }[] = [];
    let anchors: { tick: number; x: number; y: number; z: number }[] = [];
    let lastPositions = new Map<object, THREE.Vector3>();
    let path: number[] = [];
    let sampleDebug = false;
    let showKeyParticles = true;

    function currentKeyOverride(seconds: number): PianoParticleOverride | undefined {
        if (player instanceof VfxPerformancePlayer || player instanceof SecretCinemaPlayer) {
            return player.keyParticleOverride(seconds);
        }
        if (player instanceof VfxThemePlayer || player instanceof VfxPresetPlayer) {
            return player.keyParticleOverride();
        }
        if (player instanceof PainterPreviewPlayer && painterConfig?.method === "key_style") {
            return keyParticleOverrideFromCue({
                brush: painterConfig.brush,
                motion: painterConfig.motion,
                color: painterConfig.color,
                color2: painterConfig.color2,
                intensity: painterConfig.level / 100,
                scale: painterConfig.scale / 100,
            });
        }
        return undefined;
    }

    function setView(next: View) {
        view = next;
        orbit.enabled = view === "orbit";
        if (view === "performer") {
            const right = RightOffsets[direction];
            orbit.target.set(right.z * 0.9, 1.0, -right.x * 0.9);
            camera.position.set(right.x * 2.25 - right.z * 4.0, 2.8, right.z * 2.25 + right.x * 4.0);
        } else {
            orbit.target.set(0, 1.34, -0.85);
            camera.position.set(5.75, 4.42, 10.45);
        }
        orbit.update();
    }

    function advance(time: number, seek = false) {
        simTime = time;
        const target = Math.floor(time / particleStep + 1e-7);
        const rebuild = seek || target < frame || target - frame > 120;
        const definition = model === "grand" ? grandDefinition : pianoDefinition;
        if (rebuild) {
            particles.reset();
            music = new VfxMusic();
            budget = new VfxBudget();
            features = quietFeatures;
            // Rebuild the visible history on a seek, including time for the longest batch to expire.
            const firstTick = Math.max(0, Math.floor(target / 2) - (track.nativeSecret ? 46 : 220));
            frame = firstTick * 2 - 1;
            player = track.nativeSecret
                ? new SecretCinemaPlayer(track.nativeSecret, definition, firstTick / 20, firstTick === 0)
                : track.performance
                    ? new VfxPerformancePlayer(track.performance, track.duration, definition)
                    : painterConfig
                        ? new PainterPreviewPlayer(painterConfig, definition)
                        : themeName
                            ? new VfxThemePlayer(VFX_STAGE_THEMES[themeName], definition, Math.max(45, track.duration + 2))
                            : new VfxPresetPlayer({ ...preset, seconds: preset.seconds ?? Math.max(45, track.duration + 2) });
            emissions = [];
            anchors = [];
            lastPositions.clear();
            path = [];
        }
        const stage = vfxStageFrame(definition);
        const hitModel = model === "grand" ? grandPianoHitModel : digitalPianoHitModel;
        const right = RightOffsets[direction];
        for (; frame < target;) {
            frame++;
            const tick = frame / 2;
            if (frame > 0) particles.step();
            if (Number.isInteger(tick)) {
                budget.expire(tick);
                const tickNotes = track.notes.get(tick) ?? [];
                const override = showKeyParticles && tickNotes.length ? currentKeyOverride(tick / 20) : undefined;
                for (const note of tickNotes) {
                    music.note(note);
                    if (showKeyParticles) {
                        const noteOverride = note.songTime !== undefined && (player instanceof VfxPerformancePlayer || player instanceof SecretCinemaPlayer)
                            ? currentKeyOverride(note.songTime)
                            : override;
                        const resolved = resolveKeyParticle(note.midi, DEFAULT_KEY_PARTICLE_SETTINGS, right, noteOverride);
                        if (resolved.mainParticle) {
                            const origin = pianoParticleOrigin(center, right, note.midi, false, hitModel);
                            if (origin) {
                                particles.spawnPianoParticle(
                                    resolved.mainParticle,
                                    origin,
                                    resolved.drawPointVars ?? resolved.color,
                                );
                            }
                        }
                        if (resolved.glimmer) {
                            const keyPos = pianoParticleOrigin(center, right, note.midi, true, hitModel);
                            if (keyPos) {
                                particles.spawnPianoParticle("pbe:key_glimmer", keyPos, {
                                    ...resolved.color,
                                    key_axis_x: Math.abs(right.x),
                                });
                            }
                        }
                    }
                }
                if (tick % 4 === 0) {
                    features = music.sample(tick);
                    if (player instanceof VfxPresetPlayer) budget.enqueue(player.update(tick, features));
                }
                if (player instanceof VfxThemePlayer || player instanceof PainterPreviewPlayer) {
                    budget.enqueue(player.update(tick, features, music.recent()));
                }
                if (player instanceof VfxPerformancePlayer) {
                    budget.enqueue(player.update(tick / 20, features, !rebuild || (target === 0 && !seek), music.recent()));
                }
                if (player instanceof SecretCinemaPlayer) budget.enqueue(player.update(tick / 20));
                budget.dispatch(tick, emitter => {
                    const placement = placeVfxEmitter(center, RightOffsets[direction], stage, emitter, tick / 20);
                    particles.spawn(emitter.effect, emitter.particle ?? emitter.effect, placement.position, placement.variables);
                    emissions.push({ tick, effect: emitter.effect });
                    if (sampleDebug) anchors.push({ tick, ...placement.position });
                });
                emissions = emissions.filter(entry => tick - entry.tick < 20);
                anchors = anchors.filter(entry => tick - entry.tick < 26);
            }
            if (sampleDebug && frame % 4 === 0) {
                const positions = new Map<object, THREE.Vector3>();
                for (const { instance } of particles.active) for (const particle of instance.particles) {
                    const point = instance.global_space.localToWorld(particle.position.clone());
                    const previous = lastPositions.get(particle);
                    if (previous && previous.distanceToSquared(point) > 0.00001 && previous.distanceToSquared(point) < 2)
                        path.push(...previous.toArray(), ...point.toArray());
                    positions.set(particle, point);
                }
                lastPositions = positions;
                path = path.slice(-2400);
            }
        }
        if (rebuild && (seek || target > 0) && player instanceof VfxPerformancePlayer) player.seek(time, false);
        cast[model].pose(time, features.activity, features.pitch);
    }

    function render() {
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;
        if (!width || !height) return;
        const size = renderer.getSize(new THREE.Vector2());
        if (size.x !== width || size.y !== height) {
            renderer.setSize(width, height, false);
            camera.aspect = width / height;
            camera.updateProjectionMatrix();
        }
        if (view === "orbit") orbit.update();
        if (sampleDebug) {
            (anchorBuffer.array as Float32Array).set(anchors.flatMap(({ x, y, z }) => [x, y, z]));
            (pathBuffer.array as Float32Array).set(path);
            anchorBuffer.needsUpdate = pathBuffer.needsUpdate = true;
            anchorGeometry.setDrawRange(0, anchors.length);
            pathGeometry.setDrawRange(0, path.length / 3);
        }
        const start = performance.now();
        particles.face(camera);
        renderer.render(scene, camera);
        lastDrawMs = performance.now() - start;
    }
    setView("stage");
    return {
        configure(
            next: VfxPreset,
            input: Track,
            piano: PianoModel,
            facing: Direction,
            time: number,
            extra?: { theme?: VfxStageThemeName; painter?: PainterConfig },
        ) {
            track = input;
            preset = next;
            themeName = extra?.theme;
            painterConfig = extra?.painter;
            const rotated = direction !== facing;
            model = piano;
            direction = facing;
            const right = RightOffsets[facing];
            for (const [name, ensemble] of Object.entries(cast)) {
                ensemble.group.visible = name === piano;
                ensemble.group.rotation.y = -Math.atan2(right.z, right.x);
            }
            if (rotated && view === "performer") setView(view);
            frame = Infinity;
            advance(time);
            render();
        },
        triggerFlash() {
            if (player instanceof PainterPreviewPlayer) {
                player.triggerFlash();
            }
        },
        setView,
        setDeck(visible: boolean) {
            deck.visible = visible;
            floor.position.y = visible ? -0.53 : -0.012;
        },
        setDebug(enabled: boolean) {
            if (sampleDebug === enabled) return;
            sampleDebug = debug.visible = enabled;
            frame = Infinity;
        },
        setKeyParticles(enabled: boolean) {
            if (showKeyParticles === enabled) return;
            showKeyParticles = enabled;
            frame = Infinity;
        },
        advance,
        seek: (time: number) => advance(time, true),
        render,
        stats(): PreviewStats {
            const effects: PreviewStats["effects"] = {};
            const layer = (effect: VfxEffect) => effects[effect] ??= { particles: 0, reserved: 0, rate: 0 };
            let count = 0;
            for (const { effect, instance } of particles.active) {
                count += instance.particles.length;
                if (effect) layer(effect).particles += instance.particles.length;
            }
            for (const [effect, total] of budget.reservations()) layer(effect).reserved = total;
            for (const { effect } of emissions) layer(effect).rate++;
            const resolvedKey = resolveKeyParticle(
                60,
                DEFAULT_KEY_PARTICLE_SETTINGS,
                RightOffsets[direction],
                currentKeyOverride(simTime),
            );
            return {
                effects,
                particles: count,
                reserved: budget.reserved,
                dropped: budget.dropped,
                features,
                frameMs: lastDrawMs,
                draws: renderer.info.render.calls,
                ...(player instanceof VfxPerformancePlayer ? { activeChannels: player.activeSummary(simTime) } : {}),
                keyParticle: {
                    style: resolvedKey.style,
                    label: KEY_PARTICLE_STYLE_LABELS[resolvedKey.style],
                    colors: resolvedKey.colors,
                    glimmer: resolvedKey.glimmer,
                    overridden: resolvedKey.overridden,
                },
            };
        },
        dispose() {
            particles.dispose();
            orbit.dispose();
            const materials = new Set<THREE.Material>();
            scene.traverse(object => {
                const mesh = object as THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>;
                mesh.geometry?.dispose();
                if (Array.isArray(mesh.material)) mesh.material.forEach(material => materials.add(material));
                else if (mesh.material) materials.add(mesh.material);
            });
            for (const material of materials) {
                (material as THREE.MeshStandardMaterial).map?.dispose();
                material.dispose();
            }
            key.shadow.map?.dispose();
            renderer.dispose();
        },
    };
}

export type Stage = Awaited<ReturnType<typeof createStage>>;
