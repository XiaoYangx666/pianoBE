import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const addonDir = join(root, "packages/addon");

const steps = [
    { name: "Build @piano/core", cmd: "npm run build:core", cwd: root },
    { name: "Build @piano/vfx", cmd: "npm run build:vfx", cwd: root },
    { name: "Build @piano/plugins", cmd: "npm run build:plugins", cwd: root },
    { name: "Build @piano/assembly", cmd: "npm run build -w @piano/assembly", cwd: root },
    { name: "Typecheck @piano/web", cmd: "npx tsc --noEmit -p packages/web/tsconfig.json", cwd: root },
    { name: "Typecheck @piano/generator", cmd: "npx tsc --noEmit -p packages/generator/tsconfig.json", cwd: root },
    { name: "Typecheck @piano/server", cmd: "npm run typecheck -w @piano/server", cwd: root },
    { name: "Typecheck @piano/studio", cmd: "npx tsc --noEmit -p packages/studio/tsconfig.json", cwd: root },
    { name: "Verify VFX assets", cmd: "node tools/assets/build-vfx-lab.mjs --check", cwd: root },
    { name: "Pack built-in .pbeplugin archives", cmd: "npm run pack:plugins", cwd: root },
    { name: "Validate built-in .pbeplugin archives", cmd: "npm run validate:plugins", cwd: root },
    { name: "Run core, vfx & assembly tests", cmd: "npm test", cwd: root },
    { name: "Run server tests", cmd: "npm run test:server", cwd: root },
    { name: "Run addon tests", cmd: "npm test -w @piano/addon", cwd: root },
    { name: "Verify client & server addon builds", cmd: "npm run verify:addon-build", cwd: root },
    { name: "Build the bare generator template", cmd: "npm run build:template:bare", cwd: root },
    { name: "Build @piano/studio", cmd: "npm run build -w @piano/studio", cwd: root },
    { name: "Verify exported VFX stage props", cmd: "bun tools/verify/verify-stage-props.mjs", cwd: root },
    {
        name: "Restore client addon build & verify client",
        cmd: "npx bepack build --skip-copy && node ../../tools/verify/verify-addon-build.mjs client",
        cwd: addonDir,
    },
];

const started = Date.now();
for (const [index, step] of steps.entries()) {
    console.log(`\n=== ${index + 1}/${steps.length} ${step.name} ===`);
    const result = spawnSync(step.cmd, {
        cwd: step.cwd,
        stdio: "inherit",
        shell: true,
    });
    if (result.status !== 0) {
        console.error(`\n[check] Failed at: ${step.name} (exit ${result.status ?? 1})`);
        process.exit(result.status ?? 1);
    }
}

console.log(`\n[check] All ${steps.length} checks passed in ${((Date.now() - started) / 1000).toFixed(1)}s`);
