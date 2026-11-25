import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { PerformanceCue } from "@piano/core";
import {
    createPerformanceProgram,
    createSingleEffectProgram,
    createThemeProgram,
    DEFAULT_KEY_PARTICLE_SETTINGS,
    hostTickAt,
    timelineTickAt,
    getKeyParticleStyleLabel,
    keyParticleOrigin,
    hasAvailablePerformanceEffects,
    normalizeKeyParticlePalette,
    placeVfxEmitter,
    placeVfxStageProp,
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
    type ResolvedVfxStageProp,
    type SingleEffectConfig,
    type TimelineTick,
    type VfxInstrument,
    type VfxNoteEvent,
    type VfxProgram,
    type VfxTheme,
} from "@piano/vfx";
import { createCast, type PianoModel } from "./models";
import { loadParticles, particleStep } from "./particles";
import { createDeck } from "./deck";
import { loadStageProps } from "./stageProps";

export type Direction = keyof typeof VFX_RIGHT_OFFSETS;
export type View = "stage" | "performer" | "orbit";
export interface Track {
    notes: Map<TimelineTick, VfxNoteEvent[]>;
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
    stageProp?: string;
    keyParticle?: {
        style: KeyParticleStyleId;
        label: string;
        colors: readonly string[];
        glimmer: boolean;
        overridden: boolean;
    };
}

export async function createStage(canvas: HTMLCanvasElement) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const [cast, particles, props] = await Promise.all([
        createCast(), loadParticles(), loadStageProps(),
    ]).catch(error => {
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
    const propFill = new THREE.PointLight(0xfff2df, 5.5, 9, 1.65);
    propFill.visible = false;
    const stageLights = Array.from({ length: 3 }, () => new THREE.PointLight(0xffffff, 0, 10, 1.6));
    scene.add(propFill, ...stageLights, ...[...props.values()].map(prop => prop.node));
    let framing: "default" | "tall" | "water" = "default";
    let activeProp: ResolvedVfxStageProp | undefined;
    let propStart = 0;

    function renderableProp(prop: ResolvedVfxStageProp | undefined) {
        const asset = prop && props.get(prop.id);
        if (!asset || (prop?.animation !== undefined && !asset.animations.has(prop.animation))) return undefined;
        return asset;
    }
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
    let keyParticleSettings: { particleStyle: number; particlePalette: number } = { ...DEFAULT_KEY_PARTICLE_SETTINGS };

    function buildProgram(): VfxProgram {
        if (track.performance && hasAvailablePerformanceEffects(track.performance)) {
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
        } else if (framing === "tall") {
            orbit.target.set(0, 5.05, -0.48);
            camera.position.set(7.4, 7.2, 19.35);
        } else if (framing === "water") {
            orbit.target.set(0, 3.2, -0.83);
            camera.position.set(6.15, 5.6, 14.15);
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
            // Web seek rebuilds the deterministic preview sandbox; the Addon keeps
            // already-spawned particles alive on its real host clock instead.
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
                const timelineTick = timelineTickAt(tick / 20);
                const hostTick = hostTickAt(tick);
                budget.expire(hostTick);
                const tickNotes = track.notes.get(timelineTick) ?? [];
                for (const note of tickNotes) {
                    music.note(note);
                    if (showKeyParticles) {
                        const override = engine!.keyParticleOverride(note.songTime ?? tick / 20, features);
                        const resolved = resolveKeyParticle(note.midi, keyParticleSettings, right, override);
                        for (const emitter of resolved.emitters) {
                            const origin = keyParticleOrigin(center, right, note.midi, emitter.onKey, instrument);
                            if (origin) particles.spawn("key", emitter.particle, origin, emitter.variables);
                        }
                    }
                }
                if (tick % 4 === 0) features = music.sample(timelineTick);
                const prop = engine!.stageProp(tick / 20, features);
                const nativeStageProp = renderableProp(prop) ? prop?.channelKey : undefined;
                budget.enqueue(engine!.update(tick / 20, features, music.recent(timelineTick), { emitFlashes: true, nativeStageProp }));
                budget.dispatch(hostTick, emitter => {
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
        const prop = engine!.stageProp(time, features);
        const asset = renderableProp(prop);
        if (activeProp) props.get(activeProp.id)!.node.visible = false;
        if (rebuild || prop?.id !== activeProp?.id || prop?.animation !== activeProp?.animation) propStart = time;
        activeProp = asset ? prop : undefined;
        propFill.visible = Boolean(asset?.preview?.fillLight);
        if (prop && asset) {
            const { position, yaw } = placeVfxStageProp(center, right, stage, prop);
            asset.node.visible = true;
            asset.node.position.set(position.x, position.y, position.z);
            asset.node.scale.set(prop.size, prop.size, -prop.size);
            asset.node.rotation.y = -THREE.MathUtils.degToRad(yaw + prop.turn);
            if (prop.animation !== undefined) asset.pose?.(prop.animation, time - propStart);
            else if (propStart === time) asset.pose?.(undefined, 0);
            if (propFill.visible) propFill.position.set(position.x + 1.8, position.y + 2.7, position.z + 2.5);
        }
        const litStage = particles.active.filter(({ particle }) => particle === "sinner_pool" || particle === "sinner_spot_pool");
        const nextFraming = asset?.preview?.tall ? "tall" : litStage.length > 0 ? "water" : "default";
        if (nextFraming !== framing) {
            framing = nextFraming;
            if (view === "stage") setView(view);
        }
        for (const light of stageLights) light.intensity = 0;
        for (const { instance } of litStage) {
            const position = instance.global_space.position;
            const side = position.x * right.x + position.z * right.z;
            const light = stageLights[side < -1 ? 1 : side > 1 ? 2 : 0];
            const variables = instance.Molang.global_variables as Record<string, number>;
            const age = instance.view_age;
            const fade = Math.max(0, Math.min(1, age / 0.32, ((variables["variable.vfx_life"] ?? 1.08) - age) / 0.49));
            const gain = fade * (variables["variable.vfx_opacity"] ?? 0) * (light === stageLights[0] ? 19 : 11);
            if (gain <= 0) continue;
            const color = new THREE.Color(variables["variable.vfx_red"], variables["variable.vfx_green"], variables["variable.vfx_blue"]);
            light.color.lerp(color, gain / (light.intensity + gain));
            light.intensity += gain;
            light.position.set(position.x, light === stageLights[0] ? 4.3 : 1.55, position.z);
        }
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
        setKeyParticleSettings(settings: { particleStyle: number; particlePalette: number }) {
            keyParticleSettings = {
                particleStyle: settings.particleStyle,
                particlePalette: normalizeKeyParticlePalette(settings.particleStyle, settings.particlePalette),
            };
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
                keyParticleSettings,
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
                stageProp: activeProp?.id,
                keyParticle: {
                    style: resolvedKey.style,
                    label: getKeyParticleStyleLabel(resolvedKey.style),
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
                const { map, emissiveMap } = material as THREE.MeshStandardMaterial;
                map?.dispose();
                if (emissiveMap !== map) emissiveMap?.dispose();
                material.dispose();
            }
            key.shadow.map?.dispose();
            renderer.dispose();
        },
    };
}

export type Stage = Awaited<ReturnType<typeof createStage>>;
