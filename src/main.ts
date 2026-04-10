import { blockPlacerComponent } from "@addon/blockPlacer";
import { PianoBlockComponent } from "@addon/pianoBlock";
import { system } from "@minecraft/server";

//注册模组组件
system.beforeEvents.startup.subscribe((e) => {
    e.itemComponentRegistry.registerCustomComponent(
        "xypiano:placer",
        blockPlacerComponent
    );
    e.blockComponentRegistry.registerCustomComponent(
        "xypiano:block",
        PianoBlockComponent
    );
});
