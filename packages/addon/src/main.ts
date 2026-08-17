import { blockPlacerComponent } from "@addon/blockPlacer";
import { PianoBlockComponent, regEvents } from "@addon/pianoBlock";
import { initPlayer, midiPlayerManager } from "@midiPlayer";
import { system } from "@minecraft/server";
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
initPlayer();

initSAPIPro({
    name: "**NAME**",
    version: "**VERSION**",
    description: "**DESCRIPTION**",
    author: "XiaoYangx666",
    nameSpace: "xypiano",
    uuid: "ee4ee253-b1c5-4447-9e52-356f5e6ed11b",
});

pcommand.registerCommand(
    new Command("midilist", "查看midi播放器列表", true, (player) => {
        player.sendMessage(midiPlayerManager.debugDump());
    })
);

// 远程曲库（BDS 专用：server-admin 读 secrets.json 配置后端 URL/token，
// 经 server-net 拉取）。client 构建时此分支被 compile.define 注入常量折叠
// + 死代码消除整体裁剪（产物不含 serverAdmin/serverNet 代码，不依赖 BDS 模块）。
if (__PIANO_TARGET__ === "server") {
    system.runTimeout(async () => {
        try {
            const { initServerAdmin } = await import("./serverAdmin/index.js");
            await initServerAdmin();
        } catch (e) {
            console.warn("[serverAdmin] 初始化失败，使用内嵌曲库", e);
        }
    }, 20);
}
