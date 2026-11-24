import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const steps = [
    { name: "1/9 Build @piano/core", cmd: "npm run build:core" },
    { name: "2/9 Build @piano/vfx", cmd: "npm run build:vfx" },
    { name: "3/9 Build @piano/plugins", cmd: "npm run build:plugins" },
    { name: "4/8 Typecheck @piano/web", cmd: "npx tsc --noEmit -p packages/web/tsconfig.json" },
    { name: "5/8 Typecheck @piano/studio", cmd: "npx tsc --noEmit -p packages/studio/tsconfig.json" },
    { name: "6/8 Verify VFX assets", cmd: "node tools/assets/build-vfx-lab.mjs --check" },
    { name: "7/8 Pack .pbeplugin archives", cmd: "npm run pack:plugins" },
    { name: "8/8 Validate plugins & cross-plugin conflicts", cmd: "npm run validate:plugins" },
    { name: "Run @piano/vfx tests", cmd: "npm run test:vfx" },
];

const started = Date.now();
for (const step of steps) {
    console.log(`\n=== ${step.name} ===`);
    const result = spawnSync(step.cmd, {
        cwd: root,
        stdio: "inherit",
        shell: true,
    });
    if (result.status !== 0) {
        console.error(`\n[check:vfx] Failed at: ${step.name} (exit ${result.status ?? 1})`);
        process.exit(result.status ?? 1);
    }
}

console.log(`\n[check:vfx] All 9 VFX checks passed in ${((Date.now() - started) / 1000).toFixed(1)}s`);
