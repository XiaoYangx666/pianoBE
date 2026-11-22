import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const addonDir = join(root, "packages/addon");

const steps = [
    { name: "1/12 Build @piano/core", cmd: "npm run build:core", cwd: root },
    { name: "2/12 Build @piano/vfx", cmd: "npm run build:vfx", cwd: root },
    { name: "3/12 Build @piano/plugins", cmd: "npm run build:plugins", cwd: root },
    { name: "4/12 Typecheck @piano/web", cmd: "npx tsc --noEmit -p packages/web/tsconfig.json", cwd: root },
    { name: "5/12 Typecheck @piano/generator", cmd: "npx tsc --noEmit -p packages/generator/tsconfig.json", cwd: root },
    { name: "6/12 Verify VFX assets", cmd: "node tools/assets/build-vfx-lab.mjs --check", cwd: root },
    { name: "7/12 Pack built-in .pbeplugin archives", cmd: "npm run pack:plugins", cwd: root },
    { name: "8/12 Validate built-in .pbeplugin archives", cmd: "npm run validate:plugins", cwd: root },
    { name: "9/12 Run core & vfx tests", cmd: "npm test", cwd: root },
    { name: "10/12 Run addon tests", cmd: "npm test -w @piano/addon", cwd: root },
    { name: "11/12 Verify client & server addon builds", cmd: "npm run verify:addon-build", cwd: root },
    {
        name: "12/12 Restore client addon build & verify client",
        cmd: "npx bepack build --skip-copy && node ../../tools/verify/verify-addon-build.mjs client",
        cwd: addonDir,
    },
];

const started = Date.now();
for (const step of steps) {
    console.log(`\n=== ${step.name} ===`);
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

console.log(`\n[check] All 12 checks passed in ${((Date.now() - started) / 1000).toFixed(1)}s`);
