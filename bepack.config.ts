import { defineConfig } from "bepack";
import { cp } from "fs/promises";
import { join, dirname } from "path";

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
            description: "钢琴附加包",
            dependencies: {
                "@minecraft/server": "beta",
                "@minecraft/server-ui": "beta",
            },
        },
        rp: {
            root: "rp",
            uuid: "efbe8777-707f-42de-a238-97b05684685e",
            moduleUuid: "36d4f042-edf0-4be3-8d48-8165de3057ad",
            name: "钢琴资源包",
            description: "钢琴资源包",
            pbr: true,
        },
    },
    pack: {
        outDir: "dist",
    },
    hooks: {
        afterBuild: async (ctx) => {
            if (!ctx.paths.scriptOutFile) {
                ctx.logger.error("scripts目录不存在");
                return;
            }
            const scriptsDir = dirname(ctx.paths.scriptOutFile);
            await cp("./midis/js/", join(scriptsDir, "midis"), {
                recursive: true,
                force: true,
            });
            return "midi copy success";
        },
    },
});
