import { expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { compilePerformanceSource, orderVfxPlugins, registerVfxPlugin, timelineTickAt, vfxRegistry, type PerformanceCue } from "@piano/vfx";
import { BUILTIN_PLUGINS } from "@piano/plugins";

let currentTick = 1000;
const intervals = new Map<number, () => void>();
let nextIntervalId = 1;

mock.module("@minecraft/server", () => ({
    system: {
        get currentTick() {
            return currentTick;
        },
        runInterval(callback: () => void) {
            const id = nextIntervalId++;
            intervals.set(id, callback);
            return id;
        },
        clearRun(id: number) {
            intervals.delete(id);
        },
    },
}));

const spawned: string[] = [];
mock.module("../src/platform/vfxParticle", () => ({
    spawnVfxEmitter: (_location: unknown, emitter: { group?: string }) => {
        spawned.push(emitter.group ?? "?");
    },
}));

mock.module("../src/platform/vfxProp", () => ({
    VfxPropRenderer: class {
        render() {
            return false;
        }
        clear() {}
    },
}));

mock.module("../src/domain/instrument/definition", () => ({
    vfxInstrumentFor: () => "grand",
}));

mock.module("../src/platform/assembly", () => ({
    inspectInstrument: () => "complete",
    instrumentDestroyed: { subscribe: () => () => {} },
    instrumentKey: () => "piano",
}));

type Listener<T> = (value: T) => void;
const createdListeners: Listener<unknown>[] = [];
mock.module("../src/app/PianoWorld", () => ({
    pianoWorld: {
        created: { subscribe: (listener: Listener<unknown>) => {
            createdListeners.push(listener);
            return () => {};
        } },
        get: () => undefined,
    },
}));

const { getVfxSession, registerVfxRuntime } = await import("../src/app/vfx/runtime");

for (const plugin of orderVfxPlugins(BUILTIN_PLUGINS)) {
    if (!vfxRegistry.hasPlugin(plugin.manifest.id)) registerVfxPlugin(plugin);
}

const source = JSON.parse(readFileSync(new URL("../../../midis/performances/b0cae095.json", import.meta.url), "utf8"));
const cues: readonly PerformanceCue[] = compilePerformanceSource(source, "b0cae095");

function flushTicks(count: number, startSongTime: number) {
    for (let i = 0; i < count; i++) {
        currentTick++;
        position = startSongTime + i / 20;
        for (const callback of intervals.values()) callback();
    }
}

let playing = true;
let position = 0;
const transportListeners: Listener<{ type: string; position: number }>[] = [];
const noteListeners: Listener<Record<string, unknown>>[] = [];
const midi = {
    get performance() {
        return { cues, duration: 390 };
    },
    isPlaying: () => playing,
    get position() {
        return position;
    },
    getInfo: () => ({ midiName: "火花" }),
};
const piano = {
    location: { dimension: { id: "overworld", isChunkLoaded: () => true }, pos: { x: 0, y: 0, z: 0 }, definition: {}, direction: "south" },
    settings: { stageChoreography: true, stageTheme: "off", stageKeyParticles: true },
    noteSignal: { subscribe: (listener: Listener<Record<string, unknown>>) => {
        noteListeners.push(listener);
        return () => {
            const index = noteListeners.indexOf(listener);
            if (index >= 0) noteListeners.splice(index, 1);
        };
    } },
    transportSignal: { subscribe: (listener: Listener<{ type: string; position: number }>) => {
        transportListeners.push(listener);
        return () => {
            const index = transportListeners.indexOf(listener);
            if (index >= 0) transportListeners.splice(index, 1);
        };
    } },
    settingsSignal: { subscribe: () => () => {} },
    onDispose: () => () => {},
    setParticleOverrideProvider: () => {},
    getMidiPlayer: () => midi,
};

function emitTransport(type: string, at: number) {
    position = at;
    for (const listener of transportListeners) listener({ type, position: at });
}

registerVfxRuntime();
for (const listener of createdListeners) listener(piano);

test("performance keeps emitting after seeking to the middle of the song", () => {
    emitTransport("start", 0);
    const beforeSeek = spawned.length;
    flushTicks(40, 0);
    expect(spawned.length - beforeSeek).toBeGreaterThan(0);

    emitTransport("seek", 200);
    const afterSeek = spawned.length;
    flushTicks(40, 200);
    expect(spawned.length - afterSeek).toBeGreaterThan(0);

    playing = false;
    emitTransport("stop", position);
});

test("manual notes during a performance enter the song timeline, never the host tick", () => {
    playing = true;
    piano.settings = { stageChoreography: true, stageTheme: "off", stageKeyParticles: true };
    emitTransport("start", 0);
    flushTicks(20, 12.5);

    const session = getVfxSession(piano.location)!;
    const timelineTick = timelineTickAt(session.timeline.positionSeconds);
    for (const listener of noteListeners) listener({
        midi: 64,
        duration: 0.2,
        soundDuration: 0.2,
        velocity: 100,
        source: "manual",
        hasVelocity: true,
        worldTick: currentTick,
    });

    const recent = session.music.recent(timelineTick);
    expect(recent.at(-1)?.timelineTick).toBe(timelineTick);
    expect(recent.at(-1)?.timelineTick).not.toBe(currentTick);

    playing = false;
    emitTransport("stop", position);
});

test("song themes follow the MIDI timeline through seek, pause and resume", () => {
    playing = true;
    piano.settings = { stageChoreography: false, stageTheme: "galaxy", stageKeyParticles: true };
    emitTransport("start", 0);
    flushTicks(20, 40);

    const beforeSeek = getVfxSession(piano.location)!;
    expect(beforeSeek.timeline.positionSeconds).toBeGreaterThan(40);

    emitTransport("seek", 120);
    const afterSeek = getVfxSession(piano.location)!;
    expect(afterSeek.timeline.positionSeconds).toBeCloseTo(120, 5);

    const spawnedBefore = spawned.length;
    flushTicks(20, 120);
    expect(spawned.length).toBeGreaterThan(spawnedBefore);

    const pausedAt = afterSeek.timeline.positionSeconds;
    playing = false;
    emitTransport("pause", pausedAt);
    expect(afterSeek.ended).toBe(true);

    playing = true;
    emitTransport("resume", pausedAt);
    const resumed = getVfxSession(piano.location)!;
    expect(resumed.timeline.positionSeconds).toBeCloseTo(pausedAt, 5);
    const resumedBefore = spawned.length;
    flushTicks(20, pausedAt);
    expect(spawned.length).toBeGreaterThan(resumedBefore);

    playing = false;
    emitTransport("stop", position);
    piano.settings = { stageChoreography: true, stageTheme: "off", stageKeyParticles: true };
});
