import { spawn } from "node:child_process";
import { availableParallelism } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const typedLibraries = ["core", "vfx", "assembly", "plugins"];
const applications = ["addon", "server", "studio", "web"];
const testPackages = ["core", "assembly", "addon", "server", "studio"];

function packageDir(name) {
    return name === "plugins" ? "plugins" : "packages/" + name;
}

function runStep(name, command, args, { stream = false } = {}) {
    return new Promise((resolveStep, rejectStep) => {
        const started = performance.now();
        if (stream) console.log("\n[run] " + name);
        const child = spawn(command, args, {
            cwd: root,
            stdio: stream ? "inherit" : ["ignore", "pipe", "pipe"],
        });
        const chunks = [];
        child.stdout?.on("data", (chunk) => chunks.push(chunk));
        child.stderr?.on("data", (chunk) => chunks.push(chunk));
        child.on("error", (error) => rejectStep(new Error(name, { cause: error })));
        child.on("close", (code, signal) => {
            if (code !== 0) {
                const output = Buffer.concat(chunks).toString("utf8").trim();
                rejectStep(new Error(name + " (exit " + (code ?? signal) + ")" + (output ? "\n" + output : "")));
                return;
            }
            const elapsed = ((performance.now() - started) / 1000).toFixed(1);
            console.log("✓ [" + elapsed + "s] " + name);
            resolveStep();
        });
    });
}

async function runParallel(steps) {
    const results = await Promise.allSettled(steps.map((step) => step()));
    const errors = results.filter((result) => result.status === "rejected").map((result) => result.reason);
    if (errors.length) throw new AggregateError(errors);
}

const typecheck = (name) => runStep("Typecheck @piano/" + name, "bun", [
    "check", "--no-script", "-p", packageDir(name), "--customConditions", "piano-source",
    "--noEmit", "--incremental", "false", "--rootDir", ".", "--threads", "2",
    ...(typedLibraries.includes(name) ? ["--types", "node"] : []),
]);

const test = (name, script = "test") => runStep(script + " @piano/" + name, "bun", [
    "run", "--cwd", packageDir(name), script,
]);

const verifyVfxAssets = () => runStep("Verify VFX assets", process.execPath, [
    "tools/assets/build-vfx-lab.mjs", "--check",
]);

async function runChecks({ types = false, tests = false } = {}) {
    const steps = [
        ...(types ? [...typedLibraries, ...applications].map((name) => () => typecheck(name)) : []),
        ...(tests ? testPackages.map((name) => () => test(name)) : []),
    ];
    if (!tests) return runParallel(steps);
    if (availableParallelism() >= 8) return runParallel([() => test("vfx"), ...steps]);

    // Give the full-song simulations the CPU on smaller machines.
    const errors = [];
    for (const phase of [() => test("vfx"), () => runParallel(steps)]) {
        try {
            await phase();
        } catch (error) {
            errors.push(...(error instanceof AggregateError ? error.errors : [error]));
        }
    }
    if (errors.length) throw new AggregateError(errors);
}

function npmRun(name, script, ...args) {
    return runStep(name, process.execPath, [process.env.npm_execpath, "run", script, ...args], { stream: true });
}

async function buildRelease() {
    await npmRun("Build core", "build:core");
    await npmRun("Build VFX", "build:vfx");
    await runParallel([
        () => npmRun("Build plugin library", "build:plugins"),
        () => npmRun("Build assembly library", "build:assembly"),
        () => npmRun("Pack official plugins", "pack:plugins"),
    ]);
    await npmRun("Build addon artifacts", "build:release", "-w", "@piano/addon");
    await npmRun("Build Studio with the new template and plugins", "build:studio");
}

async function verifyRelease() {
    await runParallel([
        verifyVfxAssets,
        () => npmRun("Verify addon artifacts", "verify:addon-build"),
        () => test("assembly", "test:artifacts"),
        () => test("server", "test:artifacts"),
        () => runStep("Validate packed plugins", "bun", [
            "tools/plugins/validate-plugin.mjs", "--all", "--packed",
        ], { stream: true }),
        () => runStep("Verify exported stage props", "bun", [
            "tools/verify/verify-stage-props.mjs", "--no-write",
        ], { stream: true }),
    ]);
}

async function checkVfx() {
    await test("vfx");
    await runParallel([
        ...["vfx", "plugins", "web", "studio"].map((name) => () => typecheck(name)),
        verifyVfxAssets,
        () => runStep("Validate built-in VFX plugins from source", "bun", [
            "--conditions=piano-source", "tools/plugins/validate-plugin.mjs", "--all", "--source",
        ]),
    ]);
}

const mode = process.argv[2] ?? "check";
const workflows = {
    check: () => runChecks({ types: true, tests: true }),
    test: () => runChecks({ tests: true }),
    typecheck: () => runChecks({ types: true }),
    "check:vfx": checkVfx,
    "build:release": buildRelease,
    "verify:release": verifyRelease,
};

const started = performance.now();
try {
    if (!Object.hasOwn(workflows, mode)) throw new Error("Unknown workflow: " + mode);
    await workflows[mode]();
    console.log("\n[" + mode + "] Completed in " + ((performance.now() - started) / 1000).toFixed(1) + "s");
} catch (error) {
    for (const failure of error instanceof AggregateError ? error.errors : [error]) {
        console.error("\n[" + mode + "] " + failure.message);
        if (failure.cause) console.error(failure.cause);
    }
    process.exitCode = 1;
}
