import { describe, expect, test } from "bun:test";
import type { LibraryRecord } from "@piano/core";
import type { StudioPlugin, StudioSong } from "../src/adapters/types";
import { createLatestTracker, createMutationQueue } from "../src/store/concurrency";
import {
    computeAddonSongIds,
    defaultAddonPlan,
    deriveLocalSnapshot,
    deriveServerSnapshot,
} from "../src/store/derived";

function makePlugin(overrides: Partial<StudioPlugin> = {}): StudioPlugin {
    return {
        id: "pianobe.timbre.classic_grand",
        name: "经典三角钢琴",
        version: "1.0.0",
        author: "PianoBE",
        description: "",
        source: "builtin",
        visibility: "public",
        installed: true,
        enabled: true,
        trusted: true,
        hasExecutableCode: false,
        requiresPackDeploy: true,
        compatible: true,
        sizeBytes: 1024,
        dependencies: [],
        missingDependencies: [],
        provides: { timbres: ["classic_grand"] },
        contents: {
            songs: 0,
            performances: 0,
            libraries: 0,
            timbres: 1,
            effects: 0,
            themes: 0,
            keyStyles: 0,
            particles: 0,
            stageProps: 0,
        },
        status: "active",
        ...overrides,
    };
}

function makeSong(id: string, libraries: string[] = ["user-default"]): StudioSong {
    return {
        id,
        name: `Song ${id}`,
        duration: 160,
        noteCount: 10,
        bytes: 128,
        libraries,
        performanceEntries: [],
    };
}

describe("Studio store concurrency & derived state", () => {
    test("createMutationQueue serializes concurrent writes and recovers from failures", async () => {
        const queue = createMutationQueue();
        const events: string[] = [];

        const first = queue.enqueue(async () => {
            events.push("start-1");
            await new Promise((r) => setTimeout(r, 15));
            events.push("end-1");
            return 1;
        });

        const failing = queue
            .enqueue(async () => {
                events.push("start-2-fail");
                throw new Error("boom");
            })
            .catch(() => "recovered");

        const third = queue.enqueue(async () => {
            events.push("start-3");
            events.push("end-3");
            return 3;
        });

        expect(await first).toBe(1);
        expect(await failing).toBe("recovered");
        expect(await third).toBe(3);
        expect(events).toEqual(["start-1", "end-1", "start-2-fail", "start-3", "end-3"]);
    });

    test("createLatestTracker discards stale refresh responses", () => {
        const tracker = createLatestTracker();
        const req1 = tracker.next();
        const req2 = tracker.next();
        expect(tracker.isLatest(req1)).toBe(false);
        expect(tracker.isLatest(req2)).toBe(true);
    });

    test("deriveLocalSnapshot keeps installed timbres auditionable independently of addon export", () => {
        const enabledTimbre = makePlugin({ installed: true, enabled: true });
        const songA = makeSong("s1", ["user-default"]);
        const songB = makeSong("s2", ["user-default"]);
        const libs: LibraryRecord[] = [
            { id: "user-default", name: "默认曲库", kind: "user", songIds: ["s1", "s2"] },
        ];
        const plan = {
            ...defaultAddonPlan(),
            selectedLibraryIds: ["user-default", "deleted-lib"],
            extraSongIds: ["s2", "ghost-song"],
            excludedSongIds: ["s1", "ghost-excluded"],
            selectedTimbreIds: ["piano", "classic_grand"],
        };

        const activeSnap = deriveLocalSnapshot(
            { songs: [songA, songB], libraries: libs, plugins: [enabledTimbre] },
            plan,
            "classic_grand",
        );
        expect(activeSnap.previewTimbreId).toBe("classic_grand");
        expect(activeSnap.previewResetToPiano).toBe(false);
        expect(activeSnap.installedTimbreIds).toEqual(["piano", "classic_grand"]);
        expect(activeSnap.selectedTimbreIds).toEqual(["piano", "classic_grand"]);
        expect(activeSnap.selectedPluginIds).toEqual(["pianobe.timbre.classic_grand"]);
        expect(activeSnap.cleanedPlan.selectedLibraryIds).toEqual(["user-default"]);
        expect(activeSnap.cleanedPlan.extraSongIds).toEqual(["s2"]);
        expect(activeSnap.cleanedPlan.excludedSongIds).toEqual(["s1"]);
        expect(activeSnap.selectedSongIds).toEqual(["s2"]);

        // Excluding the timbre from addon export keeps it installed & auditionable in the web player
        const excludedFromExportSnap = deriveLocalSnapshot(
            { songs: [songA, songB], libraries: libs, plugins: [enabledTimbre] },
            { ...plan, selectedTimbreIds: ["piano"] },
            "classic_grand",
        );
        expect(excludedFromExportSnap.installedTimbreIds).toEqual(["piano", "classic_grand"]);
        expect(excludedFromExportSnap.selectedTimbreIds).toEqual(["piano"]);
        expect(excludedFromExportSnap.selectedPluginIds).toEqual([]);
        expect(excludedFromExportSnap.previewTimbreId).toBe("classic_grand");
        expect(excludedFromExportSnap.previewResetToPiano).toBe(false);

        // Uninstalling the timbre plugin falls previewTimbreId back to "piano"
        const uninstalledSnap = deriveLocalSnapshot(
            {
                songs: [songA, songB],
                libraries: libs,
                plugins: [makePlugin({ installed: false, enabled: false })],
            },
            plan,
            "classic_grand",
        );
        expect(uninstalledSnap.previewTimbreId).toBe("piano");
        expect(uninstalledSnap.previewResetToPiano).toBe(true);
        expect(uninstalledSnap.installedTimbreIds).toEqual(["piano"]);
        expect(uninstalledSnap.selectedTimbreIds).toEqual(["piano"]);
    });

    test("deriveServerSnapshot keeps installed timbre auditionable when excluded from BDS deployment", () => {
        const installedServerSnap = deriveServerSnapshot(
            [],
            [],
            [makePlugin({ installed: true, enabled: false })],
            {
                supported: true,
                status: "active",
                templateReady: true,
                targetConfigHash: "00000001",
                enabledPlugins: [],
                deployedPlugins: [],
                loadedPlugins: [],
                enabledTimbres: ["piano"],
                availableTimbres: [],
                scores: [],
                issues: [],
                warnings: [],
                bdsConfig: {
                    bdsDir: "",
                    bdsWorld: "",
                    bdsBpName: "bp",
                    bdsRpName: "rp",
                    bdsPackMode: "development",
                    packName: "",
                    packDescription: "",
                },
            },
            "classic_grand",
        );
        expect(installedServerSnap.installedTimbreIds).toEqual(["piano", "classic_grand"]);
        expect(installedServerSnap.previewTimbreId).toBe("classic_grand");
        expect(installedServerSnap.previewResetToPiano).toBe(false);

        const snap = deriveServerSnapshot(
            [],
            [],
            [makePlugin({ installed: false, enabled: false })],
            {
                supported: true,
                status: "active",
                templateReady: true,
                targetConfigHash: "00000001",
                enabledPlugins: [],
                deployedPlugins: [],
                loadedPlugins: [],
                enabledTimbres: ["piano"],
                availableTimbres: [],
                scores: [],
                issues: [],
                warnings: [],
                bdsConfig: {
                    bdsDir: "",
                    bdsWorld: "",
                    bdsBpName: "bp",
                    bdsRpName: "rp",
                    bdsPackMode: "development",
                    packName: "",
                    packDescription: "",
                },
            },
            "classic_grand",
        );
        expect(snap.previewTimbreId).toBe("piano");
        expect(snap.previewResetToPiano).toBe(true);
        expect(computeAddonSongIds([makeSong("a", ["l1"])], [], {
            selectedLibraryIds: ["l1"],
            extraSongIds: [],
            excludedSongIds: [],
        })).toEqual(["a"]);
    });
});
