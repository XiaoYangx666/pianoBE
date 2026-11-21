import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { PerformanceCue } from "@piano/core";
import {
    createPerformanceProgram,
    createSingleEffectProgram,
    createThemeProgram,
    KEY_PARTICLE_STYLE_LABELS,
    keyParticleOrigin,
    placeVfxEmitter,
    quietFeatures,
    resolveKeyParticle,
    VFX_RIGHT_OFFSETS,
    VfxBudget,
    VfxEngine,
    VfxMusic,
    vfxStageFrame,
    type ActiveChannelSummary,
    type KeyParticleStyleId,
    type MusicFeatures,
    type SingleEffectConfig,
    type VfxInstrument,
    type VfxNoteEvent,
    type VfxProgram,
    type VfxTheme,
} from "@piano/vfx";
import { createCast, type PianoModel } from "./models";
import { loadParticles, particleStep } from "./particles";
import { createDeck } from "./deck";

export type Direction = keyof typeof VFX_RIGHT_OFFSETS;
export type View = "stage" | "performer" | "orbit";
export interface Track {
    notes: Map<number, VfxNoteEvent[]>;
    duration: number;
    performance?: readonly PerformanceCue[];
}
export type StageMode =
    | { kind: "theme"; theme: VfxTheme }
    | { kind: "single"; config: SingleEffectConfig };

export interface PreviewStats {
    groups: Record<string, { particles: number; reserved: number; rate: number }>;
    particles: number;
    reserved: number;
    dropped: number;
    features: MusicFeatures;
    frameMs: number;
    draws: number;
    activeChannels: ActiveChannelSummary[];
    keyParticle?: {
        style: KeyParticleStyleId;
        label: string;
        colors: readonly string[];
        glimmer: boolean;
        overridden: boolean;
    };
}

const DEFAULT_KEY_PARTICLE_SETTINGS = { particleStyle: 3, particlePalette: 0 };

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
    let mode: StageMode;
    let engine: VfxEngine | undefined;
    let budget = new VfxBudget();
    let music = new VfxMusic();
    let features: Readonly<MusicFeatures> = quietFeatures;
    let frame = -1;
    let simTime = 0;
    let lastDrawMs = 0;
    let emissions: { tick: number; group: string }[] = [];
    let anchors: { tick: number; x: number; y: number; z: number }[] = [];
    let lastPositions = new Map<object, THREE.Vector3>();
    let path: number[] = [];
    let sampleDebug = false;
    let showKeyParticles = true;

    function buildProgram(): VfxProgram {
        if (track.performance) {
            return createPerformanceProgram(track.performance, track.duration);
        }
        const seconds = Math.max(45, track.duration + 2);
        if (mode.kind === "single") {
            return createSingleEffectProgram({
                ...mode.config,
                seconds: mode.config.seconds ?? seconds,
            });
        }
        return createThemeProgram(mode.theme, { seconds: mode.theme.seconds ?? seconds });
    }

    function setView(next: View) {
        view = next;
        orbit.enabled = view === "orbit";
        if (view === "performer") {
            const right = VFX_RIGHT_OFFSETS[direction];
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
        const rebuild = !engine || seek || target < frame || target - frame > 120;
        const instrument: VfxInstrument = model === "grand" ? "grand" : "upright";
        if (rebuild) {
            particles.reset();
            music.clear();
            budget = new VfxBudget();
            features = quietFeatures;
            // 回看最近 ~11s 以重建进入当前时刻时仍在空中飘荡的粒子轨迹
            const firstTick = Math.max(0, Math.floor(target / 2) - 220);
            frame = firstTick * 2 - 1;
            engine = new VfxEngine(buildProgram(), instrument);
            if (firstTick > 0) engine.seek(firstTick / 20, true);
            emissions = [];
            anchors = [];
            lastPositions.clear();
            path = [];
        }
        const stage = vfxStageFrame(instrument);
        const right = VFX_RIGHT_OFFSETS[direction];
        for (; frame < target;) {
            frame++;
            const tick = frame / 2;
            if (frame > 0) particles.step();
            if (Number.isInteger(tick)) {
                budget.expire(tick);
                const tickNotes = track.notes.get(tick) ?? [];
                for (const note of tickNotes) {
                    music.note(note);
                    if (showKeyParticles) {
                        const override = engine!.keyParticleOverride(note.songTime ?? tick / 20, features);
                        const resolved = resolveKeyParticle(note.midi, DEFAULT_KEY_PARTICLE_SETTINGS, right, override);
                        for (const emitter of resolved.emitters) {
                            const origin = keyParticleOrigin(center, right, note.midi, emitter.onKey, instrument);
                            if (origin) particles.spawn("key", "draw_point", origin, emitter.variables);
                        }
                    }
                }
                if (tick % 4 === 0) features = music.sample(tick);
                budget.enqueue(engine!.update(tick / 20, tick, features, music.recent(), { emitFlashes: true }));
                budget.dispatch(tick, emitter => {
                    const placement = placeVfxEmitter(center, right, stage, emitter, tick / 20);
                    particles.spawn(emitter.group, emitter.particle, placement.position, placement.variables);
                    emissions.push({ tick, group: emitter.group });
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
                    if (previous && previous.distanceToSquared(point) > 0.00001 && previous.distanceToSquared(point) < 2) {
                        path.push(...previous.toArray(), ...point.toArray());
                    }
                    positions.set(particle, point);
                }
                lastPositions = positions;
                path = path.slice(-2400);
            }
        }
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
            nextMode: StageMode,
            input: Track,
            piano: PianoModel,
            facing: Direction,
            time: number,
        ) {
            mode = nextMode;
            track = input;
            const rotated = direction !== facing;
            model = piano;
            direction = facing;
            const right = VFX_RIGHT_OFFSETS[facing];
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
            engine?.triggerFlash();
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
            const groups: PreviewStats["groups"] = {};
            const bucket = (name: string) => groups[name] ??= { particles: 0, reserved: 0, rate: 0 };
            let count = 0;
            for (const { group, instance } of particles.active) {
                count += instance.particles.length;
                if (group) bucket(group).particles += instance.particles.length;
            }
            for (const [group, total] of budget.reservations()) bucket(group).reserved = total;
            for (const { group } of emissions) bucket(group).rate++;
            const resolvedKey = resolveKeyParticle(
                60,
                DEFAULT_KEY_PARTICLE_SETTINGS,
                VFX_RIGHT_OFFSETS[direction],
                engine?.keyParticleOverride(simTime, features),
            );
            return {
                groups,
                particles: count,
                reserved: budget.reserved,
                dropped: budget.dropped,
                features,
                frameMs: lastDrawMs,
                draws: renderer.info.render.calls,
                activeChannels: engine?.activeSummary(simTime, features) ?? [],
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
            budget.clearPending();
            music.clear();
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
