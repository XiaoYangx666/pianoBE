import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { createSecretScore, readSongHeader, SECRET_CHAPTERS, songToNoteEvents, TIME_SCALE } from "@piano/core";
import { grandDefinition } from "../../../../addon/src/domain/instrument/definition";
import { RightOffsets } from "../../../../addon/src/domain/geometry/offsets";
import { VfxBudget } from "../../../../addon/src/domain/piano/vfxBudget";
import { SecretCinemaPlayer } from "../../../../addon/src/domain/piano/secretCinema";
import { placeVfxEmitter, vfxStageFrame } from "../../../../addon/src/domain/piano/vfxStage";
import secretUrl from "../../../../../midis/library/e1563b03.pbe3?url";
import { createEnsemble } from "../models";
import { ParticleField } from "./field";
import { parseEffect, type ParticleEffect } from "./particles";
import { BillboardRenderer, type Instance } from "./renderer";
import "./replay.css";

const PARTICLES = ["dust", "filament", "sweep", "note", "shock"] as const;
const CENTER = { x: 0, y: 0, z: 0 };
const RIGHT = RightOffsets.south;

type Stats = { particles: number; reserved: number; dropped: number; dispatches: number };

async function loadEffects() {
    const entries = await Promise.all(PARTICLES.map(async name => {
        const response = await fetch(`/replay/particles/pbe_vfx_cinema_${name}.particle.json`);
        if (!response.ok) throw new Error(`缺少粒子资源：${name} (${response.status})`);
        return [`cinema_${name}`, parseEffect(await response.json())] as const;
    }));
    return Object.fromEntries(entries) as Record<string, ParticleEffect>;
}

async function loadScore() {
    const response = await fetch(secretUrl);
    if (!response.ok) throw new Error(`读取曲目失败：${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const header = readSongHeader(bytes);
    const score = createSecretScore(songToNoteEvents(bytes), header.duration / TIME_SCALE);
    return { score, duration: header.duration / TIME_SCALE, title: header.name ?? "Secret" };
}

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, "0")}`;

/**
 * Plays the Secret staging exactly as the addon scripts it: 20 Hz emitter
 * batches from SecretCinemaPlayer, rendered from the real Bedrock particle
 * documents through Molang, instead of a hand-written shader approximation.
 */
export default function ReplayPage() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const seekRef = useRef<(seconds: number) => void>(() => undefined);
    const playingRef = useRef(true);
    const [playing, setPlaying] = useState(true);
    const [duration, setDuration] = useState(0);
    const [position, setPosition] = useState(0);
    const [title, setTitle] = useState("Secret");
    const [stats, setStats] = useState<Stats>({ particles: 0, reserved: 0, dropped: 0, dispatches: 0 });
    const [missing, setMissing] = useState<string[]>([]);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        let live = true;
        let frame = 0;
        const cleanups: (() => void)[] = [];

        const init = async () => {
            const [{ score, duration, title }, effects] = await Promise.all([loadScore(), loadEffects()]);
            if (!live) return;
            const texture = await new THREE.TextureLoader().loadAsync("/replay/secret_cinema.png");
            if (!live) return;
            texture.flipY = false;
            texture.minFilter = THREE.LinearFilter;
            texture.magFilter = THREE.LinearFilter;
            setDuration(duration);
            setTitle(title);

            const scene = new THREE.Scene();
            scene.background = new THREE.Color(0x04060b);
            scene.fog = new THREE.FogExp2(0x04060b, 0.028);
            const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 120);
            camera.position.set(0.3, 3.8, 9.6);
            const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
            renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
            renderer.outputEncoding = THREE.sRGBEncoding;
            const controls = new OrbitControls(camera, canvas);
            controls.target.set(0, 1.0, -0.1);
            controls.enableDamping = true;
            controls.dampingFactor = 0.08;
            controls.minDistance = 1.5;
            controls.maxDistance = 30;

            const linear = (hex: number) => new THREE.Color(hex).convertSRGBToLinear();
            scene.add(new THREE.GridHelper(24, 24, linear(0x16232e), linear(0x0a1219)));
            const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60),
                new THREE.MeshBasicMaterial({ color: linear(0x050b11) }));
            floor.rotation.x = -Math.PI / 2;
            floor.position.y = -0.01;
            scene.add(floor);
            const piano = await createEnsemble("grand", true);
            scene.add(piano.group);
            scene.add(new THREE.HemisphereLight(0x6b7fa8, 0x0a0f14, 0.85));
            const key = new THREE.DirectionalLight(0xffe0b8, 1.0);
            key.position.set(4, 7, 5);
            scene.add(key);
            const warmth = new THREE.PointLight(0xffc27a, 1, 16);
            warmth.position.set(0, 2.4, 0);
            scene.add(warmth);
            const posePiano = () => {
                const frame = score.at(simTime);
                piano.pose(simTime, frame.activity, frame.pitch);
                warmth.intensity = 0.35 + frame.light * 1.4;
            };

            const field = new ParticleField();
            const billboards = new BillboardRenderer(texture);
            scene.add(billboards.mesh);
            const stage = vfxStageFrame(grandDefinition);
            const instances: Instance[] = [];
            const absent = new Set<string>();
            let budget = new VfxBudget();
            let player = new SecretCinemaPlayer(score, grandDefinition, 0, true);
            let simTime = 0;
            let simTick = 0;
            let dispatches = 0;
            const spawn = (emitter: Parameters<typeof placeVfxEmitter>[3]) => {
                const name = emitter.particle ?? emitter.effect;
                const effect = effects[name];
                if (!effect) {
                    absent.add(name);
                    return;
                }
                const placed = placeVfxEmitter(CENTER, RIGHT, stage, emitter, 0);
                field.spawn(effect, placed.variables, [placed.position.x, placed.position.y, placed.position.z],
                    emitter.particles);
                dispatches++;
            };
            const seek = (seconds: number) => {
                simTime = Math.max(0, Math.min(duration, seconds));
                simTick = Math.floor(simTime * 20);
                player = new SecretCinemaPlayer(score, grandDefinition, simTime, false);
                budget = new VfxBudget();
                field.clear();
                dispatches = 0;
                setPosition(simTime);
                posePiano();
            };
            seekRef.current = seek;

            /** Advance without rAF so the replay can be inspected from a background tab. */
            const advance = (seconds: number) => {
                const target = Math.floor(Math.min(duration, simTime + seconds) * 20);
                simTime = Math.min(duration, simTime + seconds);
                let aged = 0;
                while (simTick < target) {
                    simTick++;
                    budget.expire(simTick);
                    budget.enqueue(player.update(simTick / 20));
                    budget.dispatch(simTick, spawn);
                    field.update(0.05);
                    aged += 0.05;
                }
                field.update(Math.max(0, seconds - aged));
                posePiano();
                field.sample(instances);
                billboards.setInstances(instances);
                setStats({ particles: field.particles.length, reserved: budget.reserved, dropped: budget.dropped, dispatches });
                setPosition(simTime);
                if (absent.size) setMissing([...absent]);
                renderer.render(scene, camera);
                return { time: simTime, particles: field.particles.length, reserved: budget.reserved,
                    dropped: budget.dropped, dispatches };
            };
            (window as any).__replay = {
                seek, advance,
                snapshot() {
                    renderer.render(scene, camera);
                    return canvas.toDataURL("image/png");
                },
                inspect() {
                    const counts: Record<string, number> = {};
                    for (const particle of field.particles) {
                        counts[particle.effect.id] = (counts[particle.effect.id] ?? 0) + 1;
                    }
                    const sizes = instances.map(instance => instance.size[0]);
                    const alphas = instances.map(instance => instance.color[3]);
                    return { time: simTime, counts, reserved: budget.reserved, dropped: budget.dropped, dispatches,
                        drawn: instances.length,
                        size: sizes.length ? [Math.min(...sizes), Math.max(...sizes)] : [],
                        alpha: alphas.length ? [Math.min(...alphas), Math.max(...alphas)] : [],
                        small: instances.filter(instance => instance.size[0] < 0.16).slice(0, 4),
                    };
                },
            };
            const startAt = Number(new URLSearchParams(window.location.search).get("t"));
            if (Number.isFinite(startAt) && startAt > 0) seek(startAt);

            const resize = () => {
                const width = canvas.clientWidth || window.innerWidth;
                const height = canvas.clientHeight || window.innerHeight;
                renderer.setSize(width, height, false);
                camera.aspect = width / height;
                camera.updateProjectionMatrix();
            };
            resize();
            window.addEventListener("resize", resize);
            cleanups.push(() => window.removeEventListener("resize", resize));

            let last = performance.now();
            let sampled = 0;
            let reported = 0;
            const loop = (now: number) => {
                frame = requestAnimationFrame(loop);
                const delta = Math.min(0.1, (now - last) / 1000);
                last = now;
                if (playingRef.current && simTime < duration) {
                    simTime = Math.min(duration, simTime + delta);
                    const target = Math.floor(simTime * 20);
                    while (simTick < target) {
                        simTick++;
                        budget.expire(simTick);
                        budget.enqueue(player.update(simTick / 20));
                        budget.dispatch(simTick, spawn);
                    }
                    field.update(delta);
                    posePiano();
                    if (simTime >= duration) {
                        playingRef.current = false;
                        setPlaying(false);
                    }
                }
                if (now - sampled > 1000 / 30) {
                    field.sample(instances);
                    billboards.setInstances(instances);
                    sampled = now;
                }
                if (now - reported > 120) {
                    setStats({ particles: field.particles.length, reserved: budget.reserved, dropped: budget.dropped, dispatches });
                    setPosition(simTime);
                    if (absent.size) setMissing([...absent]);
                    reported = now;
                }
                controls.update();
                renderer.render(scene, camera);
            };
            frame = requestAnimationFrame(loop);
            setMissing([...absent]);
            setLoading(false);

            cleanups.push(() => {
                cancelAnimationFrame(frame);
                controls.dispose();
                renderer.dispose();
                texture.dispose();
                delete (window as any).__replay;
            });
        };

        init().catch(cause => {
            if (live) {
                setError(cause instanceof Error ? cause.message : String(cause));
                setLoading(false);
            }
        });
        return () => {
            live = false;
            seekRef.current = () => undefined;
            for (const cleanup of cleanups) cleanup();
        };
    }, []);

    const toggle = () => {
        if (!playingRef.current && duration && position >= duration - 0.05) seekRef.current(0);
        playingRef.current = !playingRef.current;
        setPlaying(playingRef.current);
    };

    const jump = (seconds: number) => {
        seekRef.current(seconds);
    };

    return (
        <div className="replay">
            <canvas ref={canvasRef} className="replay-canvas" />
            <div className="replay-head">
                <strong>粒子回放</strong>
                <span>{title}</span>
                <em>真实 particle JSON · Molang · 20 Hz 调度</em>
            </div>
            <div className="replay-panel">
                <div className="replay-row">
                    <button type="button" onClick={toggle} disabled={loading}>{playing ? "暂停" : "播放"}</button>
                    <span className="replay-time">{clock(position)} / {clock(duration)}</span>
                </div>
                <input className="replay-range" type="range" min={0} max={duration || 0} step={0.05}
                    value={Math.min(duration, position)}
                    onChange={event => jump(Number(event.target.value))} disabled={loading} />
                <div className="replay-chapters">
                    {SECRET_CHAPTERS.map(chapter => (
                        <button type="button" key={chapter.title} onClick={() => jump(chapter.time)}>{chapter.title}</button>
                    ))}
                </div>
                <dl className="replay-stats">
                    <div><dt>粒子</dt><dd>{stats.particles}</dd></div>
                    <div><dt>预留</dt><dd>{stats.reserved}</dd></div>
                    <div><dt>丢弃</dt><dd>{stats.dropped}</dd></div>
                    <div><dt>发射器</dt><dd>{stats.dispatches}</dd></div>
                </dl>
                {missing.length > 0 && <p className="replay-warn">缺少粒子：{missing.join(", ")}</p>}
            </div>
            {loading && <div className="replay-overlay">加载曲目与粒子…</div>}
            {error && <div className="replay-overlay replay-error">{error}</div>}
        </div>
    );
}
