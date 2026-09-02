import { defineConfig, sapiPro } from "@bepack/cli";
import { cp } from "fs/promises";
import { join } from "path";
import { platform } from "process";

export default defineConfig({
    root: ".",
    target: "latest",
    manifestFormat: 3,
    version: "1.3.0",
    name: "钢琴",
    description: "钢琴附加包",

    packs: {
        bp: {
            root: "bp",
            uuid: "04f4bc5e-60a2-49f6-840c-5a22dbb19bf7",
            moduleUuid: "f2c4ed57-79a9-4e3c-b876-f7bf697417d0",
            compile: {
                entry: "src/main.ts",
                // 条件编译注入：标识符引用级替换（rolldown transform.define），
                // 优于 replace.values（不触碰对象键/字符串字面量/注释）
                // @minecraft/server-admin/server-net 等 catalog 依赖自动 external
                define: {
                    __PIANO_TARGET__: JSON.stringify("client"),
                },
            },
            // clean 模式：manifest 从配置全量重建，双配置交替构建互不污染
            manifest: {
                merge: "clean",
                minEngineVersion: "1.26.30",
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
            manifest: {
                merge: "clean",
                minEngineVersion: "1.26.30",
            },
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
            await cp("../../midis/js/", join(ctx.paths.scriptOutDir, "midis"), {
                recursive: true,
                force: true,
            });
            return "midi copy success";
        },
    },
    plugins: [sapiPro()],
    replace: {
        // **NAME**/**VERSION**/**DESCRIPTION**/**UUID** 模板占位符仍用 replace；
        // 条件编译标识符 __PIANO_TARGET__ 已改用 compile.define（见上）
        builtins: {
            NAME: true,
            DESCRIPTION: true,
            VERSION: true,
            UUID: true,
        },
    },
});
