import { defineConfig, sapiPro } from "@bepack/cli";
import { platform } from "process";

/**
 * 服务器专用构建配置（BDS + 后端远程曲库）。
 * - 与 client 配置共用同一 bp/rp 目录：每次构建清空重建 scripts、重写 manifest，
 *   产物互不污染（构建后立即 pack）
 * - manifest 依赖含 @minecraft/server-net / server-admin（bepack 内置 catalog，
 *   自动写入 manifest 并 external）
 * - 不拷贝内嵌曲库（纯远程拉取 + 游戏内缓存）
 */
export default defineConfig({
    root: ".",
    target: "latest",
    manifestFormat: 3,
    version: "1.2.0",
    name: "钢琴(服务器版)",
    description: "钢琴附加包（服务器专用，搭配后端曲库）",

    packs: {
        bp: {
            root: "bp",
            uuid: "32559cdb-d3be-49cf-9f05-2a9a774fe17f",
            moduleUuid: "544d1620-bdcb-4c71-a0a7-8c32fb059a44",
            compile: {
                entry: "src/main.ts",
                // BDS 运行时模块：保留为动态 import，不打包（catalog 亦自动 external，此处显式双保险）
                external: [/^@minecraft\/server-admin$/, /^@minecraft\/server-net$/],
            },
            name: "钢琴(服务器版)",
            description: "钢琴行为包（服务器专用）",
            dependencies: {
                "@minecraft/server": "beta",
                "@minecraft/server-ui": "beta",
                "sapi-pro": "beta",
                "@minecraft/vanilla-data": "stable",
                "@minecraft/server-net": "beta",
                "@minecraft/server-admin": "beta",
            },
        },
        rp: {
            root: "rp",
            uuid: "d891a694-3ffd-4773-b629-21698dcb6884",
            moduleUuid: "a51c41cc-6b76-4364-a372-381b4bdf0ee7",
            name: "钢琴资源包(服务器版)",
            description: "钢琴资源包",
            pbr: true,
            packScope: "world",
        },
    },
    build: {
        copy: false,
    },
    pack: {
        name: "server",
        outDir: "dist",
    },
    copy: {
        defaultTarget: platform == "linux" ? "server" : "win",
        targets: {
            server: {
                type: "gameRoot",
                path: "/server/server1",
                name: {
                    bp: "pianoServerBP",
                    rp: "pianoServerRP",
                },
            },
        },
    },
    hooks: {
        afterBuild: async (ctx) => {
            // 服务器专用包不带内嵌曲库（纯远程拉取）
            return "server build: skipped midi copy";
        },
    },
    plugins: [sapiPro()],
    replace: {
        // server 构建：远程曲库分支注入为 true 常量（保留）
        values: {
            __PIANO_TARGET__: '"server"',
        },
        builtins: {
            NAME: true,
            DESCRIPTION: true,
            VERSION: true,
            UUID: true,
        },
    },
});