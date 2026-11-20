import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium } from "playwright-core";

const { values } = parseArgs({ options: {
    out: { type: "string", default: "build/vfx-lab" },
    url: { type: "string" },
    browser: { type: "string" },
    preset: { type: "string", multiple: true },
    presets: { type: "string" },
    song: { type: "string" },
    view: { type: "string", default: "stage" },
    piano: { type: "string", default: "grand" },
    direction: { type: "string", default: "south" },
    time: { type: "string", multiple: true },
    video: { type: "boolean", default: false },
    flat: { type: "boolean", default: false },
} });
const project = fileURLToPath(new URL("../../", import.meta.url));
const output = resolve(values.out);
const origin = values.url ?? "http://127.0.0.1:5189";
const definitions = values.presets ? JSON.parse(await readFile(values.presets, "utf8")) : undefined;
const songFile = values.song ? join(project, "midis/library", `${values.song}.pbe3`) : undefined;
const songBase64 = songFile ? (await readFile(songFile)).toString("base64") : undefined;
const presets = values.song ? [values.song] : values.preset ?? ["galaxy", "neon", "stage"];
const fixtures = values.time?.map(seconds => [`t-${Number(seconds).toFixed(2)}`, Number(seconds)]) ??
    (values.song ? [["intro", 8], ["verse", 30], ["build", 75], ["chorus", 144], ["interlude", 180],
        ["bridge", 200], ["final", 240], ["outro", 280]] :
    presets.length === 1 && ["secret", "secret-native"].includes(presets[0])
        ? [["intro", 5.1], ["develop", 43.2], ["gather", 71.6], ["fracture", 72.8],
            ["climax", 75.05], ["coda", 82.3], ["end", 86.1]] :
        [["quiet", 3.75], ["climax", 8.7], ["release", 11.4]]);
if (fixtures.some(([, time]) => !Number.isFinite(time) || time < 0)) {
    throw new Error("Capture times must be finite and nonnegative");
}
if (values.video && (presets.length !== 1 || presets[0] !== "secret")) {
    throw new Error("--video requires --preset secret");
}
await mkdir(output, { recursive: true });

const server = values.url ? undefined : spawn(process.execPath,
    [join(project, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", "5189", "--strictPort"],
    { cwd: join(project, "packages/web"), stdio: "inherit", windowsHide: true });
let browser;
try {
    for (let attempt = 0; ; attempt++) {
        try {
            if (server?.exitCode != null) throw new Error(`Vite stopped with status ${server.exitCode}`);
            const response = await fetch(new URL("/vfx-lab?capture", origin));
            if (response.ok) break;
        } catch (error) {
            if (attempt >= 40 || server?.exitCode != null) throw error;
        }
        if (attempt >= 40) throw new Error(`VFX Lab is unavailable at ${origin}`);
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    browser = await chromium.launch({
        ...(values.browser ? { executablePath: values.browser } : { channel: "chrome" }),
        args: ["--enable-unsafe-swiftshader", "--disable-gpu-sandbox"],
    });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const failures = [];
    page.on("pageerror", error => failures.push(String(error)));
    await page.goto(new URL("/vfx-lab?capture", origin).toString());
    await page.waitForFunction(() => window.pianoVfxLab || document.querySelector(".vfx-capture p"), undefined, { timeout: 20_000 });
    const initError = await page.locator(".vfx-capture p").textContent({ timeout: 50 }).catch(() => undefined);
    if (initError) throw new Error(initError);
    const report = [];
    for (const preset of presets) {
        const duration = values.song
            ? await page.evaluate(base64 => window.pianoVfxLab.songDuration(base64), songBase64)
            : ["secret", "secret-native"].includes(preset) ? await page.evaluate(() => window.pianoVfxLab.scoreDuration()) : 12;
        for (const [label, time] of fixtures) {
            if (time > duration) throw new Error(`Capture time ${time} exceeds ${preset} duration (${duration}s)`);
            const options = { preset, time, view: values.view, piano: values.piano, direction: values.direction, deck: !values.flat };
            const stats = await page.evaluate(options => window.pianoVfxLab.render(options),
                { ...options, preset: values.song ? "galaxy" : definitions?.[preset] ?? preset,
                    ...(values.song ? { songBase64 } : {}) });
            const image = `${preset}-${label}.png`;
            await page.locator("canvas").screenshot({ path: join(output, image) });
            report.push({ ...options, image, ...stats });
            console.log(`${image} · ${stats.particles} live · ${stats.reserved} reserved`);
        }
    }
    if (values.video) {
        await page.evaluate(options => window.pianoVfxLab.render(options), {
            preset: "secret", time: 0, view: values.view, piano: values.piano,
            direction: values.direction, deck: !values.flat,
        });
        const fullRun = await page.evaluate(async fixtures => {
            const lab = window.pianoVfxLab;
            const duration = await lab.scoreDuration();
            const canvas = document.querySelector("canvas");
            const stream = canvas.captureStream(30);
            const recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8", videoBitsPerSecond: 6_000_000 });
            const chunks = [];
            const captures = [];
            const ordered = [...fixtures].sort((a, b) => a[1] - b[1]);
            let peakReserved = 0;
            let peakParticles = 0;
            let dropped = 0;
            recorder.ondataavailable = event => chunks.push(event.data);
            const finished = new Promise((resolve, reject) => {
                recorder.onstop = resolve;
                recorder.onerror = event => reject(event.error);
            });
            async function replay() {
                const start = performance.now();
                return new Promise((resolve, reject) => {
                    function frame(now) {
                        try {
                            const time = Math.min(duration, (now - start) / 1000);
                            const stats = lab.advance(time);
                            peakReserved = Math.max(peakReserved, stats.reserved);
                            peakParticles = Math.max(peakParticles, stats.particles);
                            dropped = stats.dropped;
                            while (ordered.length && time >= ordered[0][1]) {
                                const [label] = ordered.shift();
                                captures.push({ label, time, image: canvas.toDataURL(), stats });
                            }
                            if (time < duration) requestAnimationFrame(frame);
                            else resolve();
                        } catch (error) { reject(error); }
                    }
                    requestAnimationFrame(frame);
                });
            }
            recorder.start(1000);
            await replay();
            recorder.stop();
            await finished;
            stream.getTracks().forEach(track => track.stop());
            const data = await new Promise(resolve => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.readAsDataURL(new Blob(chunks, { type: "video/webm" }));
            });
            return { data, captures, duration, peakReserved, peakParticles, dropped };
        }, fixtures);
        const { data, captures, ...stats } = fullRun;
        const writeDataUrl = (name, url) => writeFile(join(output, name), Buffer.from(url.split(",")[1], "base64"));
        await writeDataUrl("secret-full.webm", data);
        const scenes = [];
        for (const { label, time, image, stats } of captures) {
            const file = `secret-live-${label}.png`;
            await writeDataUrl(file, image);
            scenes.push({ label, time, file, ...stats });
        }
        await writeFile(join(output, "playback.json"), JSON.stringify({ ...stats, scenes }, null, 2) + "\n");
    }
    if (failures.length) throw new Error(failures.join("\n"));
    await writeFile(join(output, "metrics.json"), JSON.stringify(report, null, 2) + "\n");
} finally {
    await browser?.close();
    server?.kill();
}
