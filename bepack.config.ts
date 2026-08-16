import { defineConfig, sapiPro } from "@bepack/cli";
import { cp } from "fs/promises";
import { join } from "path";
import { platform } from "process";

export default defineConfig({
    root: ".",
    target: "latest",
    manifestFormat: 3,
    version: "1.2.0",
    name: "钢琴",
    description: "钢琴附加包",

    packs: {
        bp: {
            root: "bp",
            uuid: "04f4bc5e-60a2-49f6-840c-5a22dbb19bf7",
            moduleUuid: "f2c4ed57-79a9-4e3c-b876-f7bf697417d0",
            compile: {
                entry: "src/main.ts",
            },
            name: "钢琴",
            description: "钢琴行为包",
            dependencies: {
                "@minecraft/server": "beta",
                "@minecraft/server-ui": "beta",
                "sapi-pro": "beta",
                "@minecraft/vanilla-data": "stable",
            },
        },
        rp: {
            root: "rp",
            uuid: "efbe8777-707f-42de-a238-97b05684685e",
            moduleUuid: "36d4f042-edf0-4be3-8d48-8165de3057ad",
            name: "钢琴资源包",
            description: "钢琴资源包",
            pbr: true,
            packScope: "world",
        },
    },
    build: {
        copy: true,
    },
    pack: {
        name: "template",
        outDir: "dist",
    },
    copy: {
        defaultTarget: platform == "linux" ? "server" : "win",
        targets: {
            server: {
                type: "gameRoot",
                path: "/server/server1",
                name: {
                    bp: "pianoBP",
                    rp: "pianoRP",
                },
            },
        },
    },
    hooks: {
        afterBuild: async (ctx) => {
            if (ctx.mode == "template") return "skipped midi copy";
            if (!ctx.paths.scriptOutDir) {
                ctx.logger.error("scripts目录不存在");
                return;
            }
            await cp("./midis/js/", join(ctx.paths.scriptOutDir, "midis"), {
                recursive: true,
                force: true,
            });
            return "midi copy success";
        },
    },
    plugins: [sapiPro()],
    replace: {
        builtins: {
            NAME: true,
            DESCRIPTION: true,
            VERSION: true,
            UUID: true,
        },
    },
});
