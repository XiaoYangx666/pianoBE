import type { Player } from "@minecraft/server";
import { DEFAULT_PIANO_SETTINGS } from "@domain/piano/settings";
import { FOLLOW_PIANO_VELOCITY, resolveManualVelocity } from "@domain/piano/soundTypes";
import type { PianoRuntime } from "@app/PianoRuntime";

/**
 * 手动敲键力度，唯一入口：玩家在自己的按钮里选过就用自己的，
 * 否则跟随钢琴设置。只由服务器写入 `piano:sound`，没设置就没有属性。
 */
export function playerVelocity(player: Player, piano: PianoRuntime) {
    const override = player.getDynamicProperty("piano:sound");
    return resolveManualVelocity(
        typeof override === "number" ? override : FOLLOW_PIANO_VELOCITY,
        piano.settings?.manualVelocity ?? DEFAULT_PIANO_SETTINGS.manualVelocity
    );
}
