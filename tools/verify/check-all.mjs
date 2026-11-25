import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const addonDir = join(root, "packages/addon");
const studioDir = join(root, "packages/studio");
const coreDir = join(root, "packages/core");
const vfxDir = join(root, "packages/vfx");
const assemblyDir = join(root, "packages/assembly");
const serverDir = join(root, "packages/server");

const isWin = process.platform === "win32";
const binExt = isWin ? ".cmd" : "";
const tscBin = join(root, "node_modules", ".bin", `tsc${binExt}`);
const bepackBin = join(root, "node_modules", ".bin", `bepack${binExt}`);
const viteBin = join(root, "node_modules", ".bin", `vite${binExt}`);
const fastMode = process.argv.includes("--fast");

function runStep(name, cmd, args, cwd = root) {
    return new Promise((resolveStep, rejectStep) => {
        const started = Date.now();
        const useCmdShim = isWin && cmd.toLowerCase().endsWith(".cmd");
        const child = useCmdShim
            ? spawn("cmd.exe", ["/d", "/s", "/c", cmd, ...args], {
                  cwd,
                  stdio: ["ignore", "pipe", "pipe"],
              })
            : spawn(cmd, args, {
                  cwd,
                  stdio: ["ignore", "pipe", "pipe"],
              });

        const chunks = [];
        child.stdout.on("data", (d) => chunks.push(d));
        child.stderr.on("data", (d) => chunks.push(d));
        child.on("error", (err) => rejectStep({ name, error: err, output: Buffer.concat(chunks).toString("utf8") }));
        child.on("close", (code) => {
            const elapsed = ((Date.now() - started) / 1000).toFixed(1);
            const output = Buffer.concat(chunks).toString("utf8").trim();
            if (code === 0) {
                console.log(`✓ [${elapsed}s] ${name}`);
                resolveStep({ name, elapsed, output });
            } else {
                rejectStep({
                    name,
                    code: code ?? 1,
                    elapsed,
                    output,
                });
            }
        });
    });
}

async function runPool(factories, concurrency = 4) {
    let index = 0;
    const workers = Array.from({ length: Math.min(concurrency, factories.length) }, async () => {
        while (index < factories.length) {
            const current = index++;
            await factories[current]();
        }
    });
    await Promise.all(workers);
}

async function main() {
    const started = Date.now();
    console.log(`[check] Mode: ${fastMode ? "fast (typecheck + unit tests)" : "full (parallel build, pack & verify)"}`);

    // Phase 1: Workspace libraries in topological order
    await runStep("Build @piano/core", tscBin, ["-p", "packages/core/tsconfig.json"]);
    await runStep("Build @piano/vfx", tscBin, ["-p", "packages/vfx/tsconfig.json"]);
    await Promise.all([
        runStep("Build @piano/plugins", tscBin, ["-p", "plugins/tsconfig.json"]),
        runStep("Build @piano/assembly", tscBin, ["-p", "packages/assembly/tsconfig.json"]),
    ]);

    // Phase 2: Typechecks, VFX/plugin packing & addon builds (capped concurrency prevents CPU starvation)
    const phase2 = [
        () => runStep("Typecheck @piano/web", tscBin, ["--noEmit", "-p", "packages/web/tsconfig.json"]),
        () => runStep("Typecheck @piano/server", tscBin, ["--noEmit", "-p", "packages/server/tsconfig.json"]),
        () => runStep("Typecheck @piano/studio", tscBin, ["--noEmit", "-p", "packages/studio/tsconfig.json"]),
    ];

    if (fastMode) {
        phase2.push(
            () => runStep("Test @piano/core", "bun", ["test"], coreDir),
            () => runStep("Test @piano/studio", "bun", ["test"], studioDir),
        );
    } else {
        phase2.push(
            () => runStep("Verify VFX assets", "node", ["tools/assets/build-vfx-lab.mjs", "--check"]),
            async () => {
                await Promise.all([
                    runStep("Pack VFX plugins", "bun", ["tools/plugins/pack-plugin.mjs", "--all"]),
                    runStep("Pack official libraries", "bun", ["tools/plugins/pack-official-libraries.mjs"]),
                    runStep("Pack official timbres", "bun", ["tools/plugins/pack-official-timbres.mjs"]),
                ]);
                await runStep("Validate all .pbeplugin archives", "bun", ["tools/plugins/validate-plugin.mjs", "--all"]);
            },
            async () => {
                await Promise.all([
                    runStep("Sync VFX assets", "node", ["tools/assets/sync-vfx-assets.mjs"]),
                    runStep("Sync stage props", "bun", ["tools/assets/sync-stage-props.mjs"]),
                ]);
                await runStep(
                    "Build addon template",
                    bepackBin,
                    ["build", "--skip-copy", "--pack", "--mode", "template"],
                    addonDir,
                );
                await runStep("Strip template timbres", "node", ["tools/build/strip-template-timbres.mjs"]);
                await runStep("Strip template VFX (bare)", "bun", ["tools/build/strip-template-vfx.mjs"]);
                await runStep(
                    "Build server addon",
                    bepackBin,
                    ["build", "--config", "bepack.server.config.ts", "--skip-copy"],
                    addonDir,
                );
                await runStep(
                    "Verify server addon build",
                    "node",
                    ["../../tools/verify/verify-addon-build.mjs", "server"],
                    addonDir,
                );
                await runStep("Build client addon", bepackBin, ["build", "--skip-copy"], addonDir);
                await runStep(
                    "Verify client addon build",
                    "node",
                    ["../../tools/verify/verify-addon-build.mjs", "client"],
                    addonDir,
                );
            },
        );
    }

    await runPool(phase2, 4);

    // Run CPU-intensive VFX simulation suite uncontended so multi-minute songs stay within default 5s timeout
    await runStep("Test @piano/vfx", "bun", ["test"], vfxDir);

    // Phase 3: Unit/integration tests & downstream builds
    const phase3 = [
        () => runStep("Test @piano/assembly", "bun", ["test"], assemblyDir),
        () => runStep("Test @piano/server", "bun", ["test"], serverDir),
        // --isolate：各测试文件独立全局，避免 mock.module 污染后续文件
        () => runStep("Test @piano/addon", "bun", ["test", "--isolate"], addonDir),
    ];

    if (!fastMode) {
        phase3.unshift(
            () => runStep("Test @piano/core", "bun", ["test"], coreDir),
            () => runStep("Test @piano/studio", "bun", ["test"], studioDir),
        );
        phase3.push(
            async () => {
                await runStep("Sync @piano/studio assets", "bun", ["scripts/sync.mjs"], studioDir);
                await runStep("Build @piano/studio", viteBin, ["build"], studioDir);
            },
            () => runStep("Verify exported VFX stage props", "bun", ["tools/verify/verify-stage-props.mjs"]),
        );
    }

    await runPool(phase3, 3);
    console.log(`\n[check] All checks passed in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

main().catch((err) => {
    console.error(`\n[check] Failed at: ${err?.name ?? "unknown"} (exit ${err?.code ?? 1})`);
    if (err?.output) console.error(err.output);
    else if (err?.error) console.error(err.error);
    else console.error(err);
    process.exit(err?.code ?? 1);
});
