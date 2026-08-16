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

// 动态导入 serveradmin（BDS 专属：读 secrets.json 配置后端 URL/token，
// 经 server-net 启用远程曲库）。客户端环境/未配置时静默降级内嵌曲库。
system.runTimeout(async () => {
    try {
        const { initServerAdmin } = await import("./serverAdmin/index.js");
        await initServerAdmin();
    } catch (e) {
        console.warn("[serverAdmin] 初始化失败，使用内嵌曲库", e);
    }
}, 20);
