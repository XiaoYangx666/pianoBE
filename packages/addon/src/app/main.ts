import { blockPlacerComponent } from "@app/components/blockPlacer";
import { PianoBlockComponent, regEvents } from "@app/components/pianoBlock";
import { invalidateMidiImport } from "@app/ui/midi/importUI";
import { pianoWorld } from "@app/PianoWorld";
import { openPbeSettings } from "@app/ui/adminSettingsUI";
import { midiManager, importedMidiManager, importedSongs } from "@app/midi";
import { system, world } from "@minecraft/server";
import { Command, initSAPIPro, pcommand } from "sapi-pro";

//注册模组组件
system.beforeEvents.startup.subscribe((e) => {
    e.itemComponentRegistry.registerCustomComponent(
        "xypiano:placer",
        blockPlacerComponent
    );
    e.blockComponentRegistry.registerCustomComponent(
        "xypiano:piano_block",
        PianoBlockComponent
    );
});

regEvents();

// 世界动态属性不能在模块求值期访问（early execution），延后到首个游戏刻扫描导入曲库。
system.run(() => {
    try {
        importedSongs.reload();
        midiManager.addSource(importedSongs);
        void importedMidiManager.refresh();
    } catch (error) {
        console.warn("[piano] 扫描本地导入曲库失败", error);
    }
});

// 玩家离开时清空 MIDI 导入进度；其它表单实例会随各自 show() 结束自动释放。
world.afterEvents.playerLeave.subscribe((e) => {
    invalidateMidiImport(e.playerId);
});

// 启动标记：确认行为包脚本已加载及其构建目标（模板包=client / 服务器专用包=server）
console.log(`[piano] 主脚本已加载，构建目标: ${__PIANO_TARGET__}`);

initSAPIPro({
    name: "**NAME**",
    version: "**VERSION**",
    description: "**DESCRIPTION**",
    author: "XiaoYangx666",
    nameSpace: "pbe",
    uuid: "ee4ee253-b1c5-4447-9e52-356f5e6ed11b",
});

// stable 版 SAPI 只能注册原生命令；registerCommand 在 stable 下不可调用。
pcommand.registerNative(
    new Command("midilist", "查看 MIDI 缓存与钢琴运行时诊断", true, (player) => {
        const stats = midiManager.cacheStats();
        player.sendMessage(
            `[SongCache] ${stats.songs} 首 / ${(stats.bytes / 1048576).toFixed(2)} MB ` +
                `(预算 ${(stats.maxBytes / 1048576).toFixed(0)} MB, 加载中 ${stats.loading})`
        );
        player.sendMessage(pianoWorld.debugDump());
    })
);

// 管理员设置：/pbe:pbe_setting（原生命令 + 管理员权限）
pcommand.registerNative(
    new Command("pbe_setting", "PianoBE 管理员设置", true, (player) => {
        openPbeSettings(player);
    })
);

// 远程曲库（BDS 专用：server-admin 读 secrets.json 配置后端 URL/token，
// 经 server-net 拉取）。client 构建时此分支被 compile.define 注入常量折叠
// + 死代码消除整体裁剪（产物不含 serverAdmin/serverNet 代码，不依赖 BDS 模块）。
if (__PIANO_TARGET__ === "server") {
    console.log("[piano] server 构建：20 tick 后尝试初始化远程曲库");
    system.runTimeout(async () => {
        try {
            const { initServerAdmin } = await import("./serverAdmin.js");
            const ok = await initServerAdmin();
            console.log(
                `[piano] 远程曲库初始化结果: ${ok ? "成功" : "未启用（使用内嵌曲库）"}`
            );
        } catch (e) {
            console.warn("[serverAdmin] 初始化失败，使用内嵌曲库", e);
        }
    }, 20);
}
