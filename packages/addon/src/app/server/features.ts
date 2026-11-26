import { world } from "@minecraft/server";
import { hostScope } from "@platform/host";
import { createLogger } from "@runtime/log";
import { PianoScope } from "@runtime/scope";
import { OnlineTranscribeClient } from "@platform/server/admin/transcribeClient";
import type { ServerBackend } from "@app/serverAdmin";
import { registerMidiMenuAction } from "@app/ui/midi/menuActions";
import { POLL_INTERVAL_MS, TranscriptionManager } from "./transcription/manager";
import { TranscribePage } from "./transcription/ui";

/**
 * 服务器版附加包的可选功能组装点。
 *
 * 只在 server 构建、且后端配置可用时初始化；入口、管理器与轮询都集中在这里，
 * 基础包不引用本目录。资源统一挂在 hostScope 的子树下，便于整体销毁。
 */

/** 管理器轮询节拍：按 20 tick/秒换算，与任务管理器内部的 2 秒节流一致。 */
const POLL_TICKS = Math.max(1, Math.round(POLL_INTERVAL_MS / 50));
const log = createLogger("transcribe");

let scope: PianoScope | undefined;
let manager: TranscriptionManager | undefined;

export function initServerFeatures(backend: ServerBackend): void {
    if (manager) return;

    const featureScope = new PianoScope(hostScope, "server");
    const client = new OnlineTranscribeClient({
        baseUrl: backend.baseUrl,
        fetch: backend.fetch,
        extraHeaders: backend.extraHeaders,
    });

    const transcription = new TranscriptionManager({
        client,
        notify: (playerId, message) => {
            const player = world.getAllPlayers().find((item) => item.id === playerId);
            if (!player?.isValid) return;
            try {
                player.sendMessage(message);
            } catch (error) {
                log.warn("通知玩家失败", error, { player: playerId });
            }
        },
        schedule: (callback) => {
            const handle = featureScope.interval(POLL_TICKS, callback);
            return () => handle.cancel();
        },
        report: (error) => log.warn("在线转录异常", error),
    });

    featureScope.own("transcription", () => transcription.dispose());

    const onLeave = ({ playerId }: { playerId: string }) => {
        transcription.releasePlayer(playerId);
    };
    world.afterEvents.playerLeave.subscribe(onLeave);
    featureScope.own("playerLeave", () => world.afterEvents.playerLeave.unsubscribe(onLeave));

    registerMidiMenuAction({
        id: "online-transcribe",
        label: "在线转录",
        open: (ui, piano) => {
            ui.push(TranscribePage, { piano, manager: transcription });
        },
    });

    // 管理器内部同样按 POLL_INTERVAL_MS 节流；这里只保留一个共同来源。
    scope = featureScope;
    manager = transcription;
    log.info("在线转录已启用");
}

/** 显式销毁（测试或将来热重载）；正常游戏生命周期由 hostScope 管理。 */
export function disposeServerFeatures(): void {
    scope?.dispose();
    scope = undefined;
    manager = undefined;
}
