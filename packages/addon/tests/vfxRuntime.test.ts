import { expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { compilePerformanceSource, orderVfxPlugins, registerVfxPlugin, vfxRegistry, type PerformanceCue } from "@piano/vfx";
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

const { registerVfxRuntime } = await import("../src/app/vfx/runtime");

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
    noteSignal: { subscribe: () => () => {} },
    transportSignal: { subscribe: (listener: Listener<{ type: string; position: number }>) => {
        transportListeners.push(listener);
        return () => {};
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
