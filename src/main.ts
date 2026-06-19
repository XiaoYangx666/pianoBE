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
    name: "小阳钢琴",
    version: "1.2.0",
    description: "小阳牌钢琴",
    author: "XiaoYangx666",
    nameSpace: "xypiano",
    uuid: "ee4ee253-b1c5-4447-9e52-356f5e6ed11b",
});

pcommand.registerCommand(
    new Command("midilist", "查看midi播放器列表", true, (player) => {
        player.sendMessage(midiPlayerManager.debugDump());
    })
);
