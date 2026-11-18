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
    view: { type: "string", default: "stage" },
    piano: { type: "string", default: "grand" },
    direction: { type: "string", default: "south" },
    time: { type: "string", multiple: true },
    flat: { type: "boolean", default: false },
} });
const project = fileURLToPath(new URL("../../", import.meta.url));
const output = resolve(values.out);
const origin = values.url ?? "http://127.0.0.1:5189";
const definitions = values.presets ? JSON.parse(await readFile(values.presets, "utf8")) : undefined;
const fixtures = values.time?.map(seconds => [`t-${Number(seconds).toFixed(2)}`, Number(seconds)]) ??
    [["quiet", 3.75], ["climax", 8.7], ["release", 11.4]];
if (fixtures.some(([, time]) => !Number.isFinite(time) || time < 0 || time > 12)) {
    throw new Error("Capture times must be in the 0–12 s fixture");
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
    for (const preset of values.preset ?? ["galaxy", "neon", "stage"]) {
        for (const [label, time] of fixtures) {
            const options = { preset, time, view: values.view, piano: values.piano, direction: values.direction, deck: !values.flat };
            const stats = await page.evaluate(options => window.pianoVfxLab.render(options),
                { ...options, preset: definitions?.[preset] ?? preset });
            const image = `${preset}-${label}.png`;
            await page.locator("canvas").screenshot({ path: join(output, image) });
            report.push({ ...options, image, ...stats });
            console.log(`${image} · ${stats.particles} live · ${stats.reserved} reserved`);
        }
    }
    if (failures.length) throw new Error(failures.join("\n"));
    await writeFile(join(output, "metrics.json"), JSON.stringify(report, null, 2) + "\n");
} finally {
    await browser?.close();
    server?.kill();
}
