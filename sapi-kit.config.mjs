import { cp } from "fs/promises";
import os from "os";
import { join } from "path";

export default {
    // === 全局配置 ===

    /** 行为包根目录 */
    bpRoot: "./bp",
    /** 资源包根目录 */
    rpRoot: "./rp",

    // === build相关 ===
    /** 缓存目录(需要和tsconfig中outDir保持一致) */
    cacheDir: "./cache",
    /**入口文件(入口文件相对缓存目录的名字) */
    entryPoint: "main.js",
    /** 构建时清空scripts目录 */
    shouldClearOutput: true,
    /** 是否通过 npx 调用 tsc。建议在 tsc 无法直接调用（例如未全局安装）时启用，注意可能会降低启动速度。 */
    useNpx: false,
    /**是否使用tsgo进行编译 */
    useTsGo: true,

    // === 拷贝相关 ===

    /** 构建完成后是否自动复制行为包到游戏目录 */
    shouldCopyToGame: true,
    /** 游戏路径类型："win" 表示默认 Windows 路径，"custom" 表示自定义路径 */
    gamePathMode: os.platform() == "linux" ? "custom" : "win",
    /**
     * 自定义游戏根目录(本机为com.mojang目录;服务器为服务器根目录)
     * 仅当 gamePathMode 为 "custom" 时有效
     */
    customGameRoot: "/server/server1",
    /** 行为包在 development_behavior_packs 中的文件夹名称 */
    behaviorPackFolderName: "pianoBP",
    /** 资源包在 development_resource_packs 中的文件夹名称 */
    resourcePackFolderName: "pianoRP",

    // === 打包相关 ===

    /**
     * 自定义打包名，若未定义，则从manifest.json读取
     * 如果有两个包，打包mcaddon，必须指定名字
     */
    packageName: "template",
    /**
     * 自定义名字构造函数
     * @param {string} name 自定义名字或manifest.json中读取的名字
     * @param {[number,number,number]} version 版本
     * @returns {string}
     */
    // buildName(name, version) {
    //     return `${name}(${version.join(".")})`;
    // },

    /** 是否启用二次 zip 压缩(用于上传蓝奏云等平台) */
    enableExtraZip: false,

    /** 打包文件名中是否包含版本号（版本号从 manifest.json 中读取） */
    includeVersionInName: true,

    /** 是否使用逗号格式的版本号如 v1,x,x 以兼容某些玩家导入问题 */
    useCommaStyleVersion: true,

    hooks: {
        afterBundle: (ctx) => {
            return cp("./midis/js/", join(ctx.outputDir, "midis"), {
                recursive: true,
                force: true,
            });
        },
    },
};
