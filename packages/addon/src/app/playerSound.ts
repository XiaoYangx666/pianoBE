import type { Player } from "@minecraft/server";
import { DEFAULT_PIANO_SETTINGS } from "@domain/piano/settings";
import { FOLLOW_PIANO_LAYER, resolveSoundLayer } from "@domain/piano/soundTypes";
import type { PianoRuntime } from "@app/PianoRuntime";

/**
 * 手动弹奏用的音长层，唯一入口：玩家在钢琴面板里选过就用玩家的，否则跟随钢琴设置。
 * 只有面板里的「音长」按钮会写 `piano:sound`，没点过的玩家没有这个属性。
 */
export function playerSoundLayer(player: Player, piano: PianoRuntime) {
    const override = player.getDynamicProperty("piano:sound");
    return resolveSoundLayer(
        typeof override === "number" ? override : FOLLOW_PIANO_LAYER,
        piano.settings?.soundLayer ?? DEFAULT_PIANO_SETTINGS.soundLayer
    );
}
